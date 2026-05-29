/**
 * ReservationController - API controller for reservation management.
 *
 * Handles CRUD operations for reservations created when quotes
 * are confirmed ("Agendado"). Supports DataTables server-side
 * processing, employee assignment, and service status updates.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const FileStorageService = require('../../services/FileStorageService');
// Models used via Parse.Query string references

// Module-level FileStorageService for presigned S3 URLs (static class needs this)
const fileStorageService = new FileStorageService({
  baseFolder: 'vehicles',
  isPublic: false,
  presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
});

/**
 * ReservationController - API controller for reservation management.
 */
class ReservationController {
  /**
   * Get role-based user pointers for filtering reservations by clientPtr.
   * Filters by clientPtr (the client the reservation is FOR), not createdBy,
   * so reservations created by admins on behalf of a client still appear.
   * Returns null if no filtering needed (admin/superadmin), or an array of user pointers.
   * @param {object} req - Express request with user info from JWT middleware.
   * @returns {Array|null} Array of AmexingUser pointers for containedIn on clientPtr, or null.
   * @example
   */
  static async getRoleFilterPointers(req) {
    const { userRole } = req;
    const currentUser = req.user;

    // Admins and superadmins see all reservations
    if (userRole === 'superadmin' || userRole === 'admin') {
      return null;
    }

    // Department managers see reservations for clients in their department
    if (userRole === 'department_manager') {
      const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');

      if (userDepartmentId) {
        const departmentUsersQuery = new Parse.Query('AmexingUser');
        departmentUsersQuery.equalTo('departmentId', userDepartmentId);
        departmentUsersQuery.equalTo('exists', true);
        departmentUsersQuery.equalTo('active', true);
        const departmentUsers = await departmentUsersQuery.find({ useMasterKey: true });

        if (departmentUsers.length > 0) {
          logger.info('Applied department filter to reservations query (clientPtr)', {
            userId: currentUser.id,
            departmentId: userDepartmentId,
            departmentUsersCount: departmentUsers.length,
          });
          return departmentUsers.map((user) => ({
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: user.id,
          }));
        }
      }

      // Fallback: only reservations where they are the client
      logger.warn('Department manager missing departmentId, restricting to own reservations', {
        userId: currentUser.id,
      });
      return [{ __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id }];
    }

    // Clients see reservations for users in their client organization
    if (userRole === 'client') {
      const userClientId = currentUser.clientId || currentUser.get('clientId') || currentUser.id;

      const clientUsersQuery = new Parse.Query('AmexingUser');
      clientUsersQuery.equalTo('clientId', userClientId);
      clientUsersQuery.equalTo('exists', true);
      clientUsersQuery.equalTo('active', true);
      const clientUsers = await clientUsersQuery.find({ useMasterKey: true });

      const pointers = [];

      // Add user pointers for users with matching clientId
      if (clientUsers.length > 0) {
        const userIds = clientUsers.map((u) => u.id);
        logger.info('Applied client filter to reservations query (clientPtr)', {
          userId: currentUser.id,
          clientId: userClientId,
          clientUsersCount: clientUsers.length,
          userIds: userIds.slice(0, 5), // Log first 5 user IDs for debugging
        });

        clientUsers.forEach((user) => {
          pointers.push({
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: user.id,
          });
        });
      }

      // IMPORTANT: Also add the clientId itself as a pointer
      // This handles legacy reservations where clientPtr was incorrectly set to clientId
      // instead of a user object ID (e.g., RES-2026-0002)
      pointers.push({
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: userClientId,
      });

      logger.info('Including legacy clientId pointer for old reservations', {
        clientId: userClientId,
        totalPointers: pointers.length,
      });

      return pointers;
    }

    // Default: only reservations where they are the client
    return [{ __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id }];
  }

  /**
   * GET /api/reservations — DataTables server-side processing.
   * @param req
   * @param res
   * @example
   */
  static async getReservations(req, res) {
    try {
      const draw = parseInt(req.query.draw) || 1;
      const start = parseInt(req.query.start) || 0;
      const length = parseInt(req.query.length) || 10;
      const searchValue = req.query.search?.value || '';
      const orderColumnIndex = parseInt(req.query.order?.[0]?.column) || 0;
      const orderDir = req.query.order?.[0]?.dir === 'desc' ? 'descending' : 'ascending';

      // Column mapping for sorting
      const columnMap = ['folio', 'clientPtr', 'eventType', 'startDate', 'numberOfPeople', 'totalAmount', 'status', 'createdAt'];
      const orderField = columnMap[orderColumnIndex] || 'createdAt';

      // Status filter
      const statusFilter = req.query.statusFilter || '';

      // Date filter
      const dateFilter = req.query.dateFilter || 'upcoming'; // Default to upcoming

      // Year, Month, Day filters
      const yearFilter = req.query.yearFilter ? parseInt(req.query.yearFilter, 10) : null;
      const monthFilter = req.query.monthFilter ? parseInt(req.query.monthFilter, 10) : null;
      const dayFilter = req.query.dayFilter ? parseInt(req.query.dayFilter, 10) : null;

      // Get role-based filter pointers (null = no filter for admins)
      const roleFilterPointers = await ReservationController.getRoleFilterPointers(req);

      // Build query
      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('quotePtr');
      query.include('clientPtr');
      query.include('createdBy');
      if (roleFilterPointers) {
        query.containedIn('clientPtr', roleFilterPointers);
      }

      /**
       * Apply year/month/day filters to a Parse query against the `startDate` field.
       * Each filter narrows the date range further; nulls are ignored.
       * @param {Parse.Query} q - The Parse query to constrain.
       * @param {number|null} yearVal - Year filter (e.g. 2026) or null.
       * @param {number|null} monthVal - Month filter (1-12) or null.
       * @param {number|null} dayVal - Day-of-month filter (1-31) or null.
       * @returns {void}
       * @example
       *   applySpecificDateFilters(query, 2026, 5, null); // all of May 2026
       */
      const applySpecificDateFilters = (q, yearVal, monthVal, dayVal) => {
        if (yearVal !== null) {
          // Create date range for the year
          const yearStart = new Date(yearVal, 0, 1); // January 1st
          const yearEnd = new Date(yearVal + 1, 0, 1); // January 1st of next year

          if (monthVal !== null) {
            // Specific month in year
            const monthStart = new Date(yearVal, monthVal - 1, 1); // First day of month (monthVal is 1-based)
            const monthEnd = new Date(yearVal, monthVal, 1); // First day of next month

            if (dayVal !== null) {
              // Specific day
              const dayStart = new Date(yearVal, monthVal - 1, dayVal);
              const dayEnd = new Date(yearVal, monthVal - 1, dayVal + 1);

              // Reservation overlaps with this specific day
              q.lessThan('startDate', dayEnd);
              q.greaterThanOrEqualTo('endDate', dayStart);
            } else {
              // Month filter only - reservation overlaps with this month
              q.lessThan('startDate', monthEnd);
              q.greaterThanOrEqualTo('endDate', monthStart);
            }
          } else {
            // Year filter only - reservation overlaps with this year
            q.lessThan('startDate', yearEnd);
            q.greaterThanOrEqualTo('endDate', yearStart);
          }
        }
      };

      // Apply date filter based on startDate and endDate
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      if (dateFilter === 'upcoming') {
        // Reservations that haven't started yet
        query.greaterThan('startDate', today);
      } else if (dateFilter === 'ongoing') {
        // Reservations currently in progress
        query.lessThanOrEqualTo('startDate', today);
        query.greaterThanOrEqualTo('endDate', today);
      } else if (dateFilter === 'past') {
        // Reservations that have ended
        query.lessThan('endDate', today);
      }

      // Apply additional year/month/day filters
      applySpecificDateFilters(query, yearFilter, monthFilter, dayFilter);

      // Total count (without search/status filters, but with role filter)
      const totalQuery = new Parse.Query('Reservation');
      totalQuery.equalTo('active', true);
      totalQuery.equalTo('exists', true);
      if (roleFilterPointers) {
        totalQuery.containedIn('clientPtr', roleFilterPointers);
      }

      // Apply date filter to total count
      if (dateFilter === 'upcoming') {
        totalQuery.greaterThan('startDate', today);
      } else if (dateFilter === 'ongoing') {
        totalQuery.lessThanOrEqualTo('startDate', today);
        totalQuery.greaterThanOrEqualTo('endDate', today);
      } else if (dateFilter === 'past') {
        totalQuery.lessThan('endDate', today);
      }

      // Apply additional year/month/day filters to total count
      applySpecificDateFilters(totalQuery, yearFilter, monthFilter, dayFilter);

      const recordsTotal = await totalQuery.count({ useMasterKey: true });

      // Apply search filter
      if (searchValue) {
        const folioQuery = new Parse.Query('Reservation');
        folioQuery.equalTo('active', true);
        folioQuery.equalTo('exists', true);
        folioQuery.matches('folio', searchValue, 'i');

        const contactQuery = new Parse.Query('Reservation');
        contactQuery.equalTo('active', true);
        contactQuery.equalTo('exists', true);
        contactQuery.matches('contactPerson', searchValue, 'i');

        const eventQuery = new Parse.Query('Reservation');
        eventQuery.equalTo('active', true);
        eventQuery.equalTo('exists', true);
        eventQuery.matches('eventType', searchValue, 'i');

        const emailQuery = new Parse.Query('Reservation');
        emailQuery.equalTo('active', true);
        emailQuery.equalTo('exists', true);
        emailQuery.matches('contactEmail', searchValue, 'i');

        // Apply role filter to each sub-query
        if (roleFilterPointers) {
          folioQuery.containedIn('clientPtr', roleFilterPointers);
          contactQuery.containedIn('clientPtr', roleFilterPointers);
          eventQuery.containedIn('clientPtr', roleFilterPointers);
          emailQuery.containedIn('clientPtr', roleFilterPointers);
        }

        // Apply date filter to search queries
        if (dateFilter === 'upcoming') {
          folioQuery.greaterThan('startDate', today);
          contactQuery.greaterThan('startDate', today);
          eventQuery.greaterThan('startDate', today);
          emailQuery.greaterThan('startDate', today);
        } else if (dateFilter === 'ongoing') {
          folioQuery.lessThanOrEqualTo('startDate', today);
          folioQuery.greaterThanOrEqualTo('endDate', today);
          contactQuery.lessThanOrEqualTo('startDate', today);
          contactQuery.greaterThanOrEqualTo('endDate', today);
          eventQuery.lessThanOrEqualTo('startDate', today);
          eventQuery.greaterThanOrEqualTo('endDate', today);
          emailQuery.lessThanOrEqualTo('startDate', today);
          emailQuery.greaterThanOrEqualTo('endDate', today);
        } else if (dateFilter === 'past') {
          folioQuery.lessThan('endDate', today);
          contactQuery.lessThan('endDate', today);
          eventQuery.lessThan('endDate', today);
          emailQuery.lessThan('endDate', today);
        }

        // Apply additional year/month/day filters to search queries
        applySpecificDateFilters(folioQuery, yearFilter, monthFilter, dayFilter);
        applySpecificDateFilters(contactQuery, yearFilter, monthFilter, dayFilter);
        applySpecificDateFilters(eventQuery, yearFilter, monthFilter, dayFilter);
        applySpecificDateFilters(emailQuery, yearFilter, monthFilter, dayFilter);

        const compoundQuery = Parse.Query.or(folioQuery, contactQuery, eventQuery, emailQuery);
        compoundQuery.include('quotePtr');
        compoundQuery.include('clientPtr');
        compoundQuery.include('createdBy');

        if (statusFilter) {
          compoundQuery.equalTo('status', statusFilter);
        }

        // Sort
        if (orderDir === 'descending') {
          compoundQuery.descending(orderField);
        } else {
          compoundQuery.ascending(orderField);
        }

        const recordsFiltered = await compoundQuery.count({ useMasterKey: true });

        compoundQuery.skip(start);
        compoundQuery.limit(length);
        const results = await compoundQuery.find({ useMasterKey: true });

        // Get service counts for each reservation
        const data = await Promise.all(results.map(async (reservation) => {
          const serviceCount = await ReservationController.getServiceCounts(reservation.id);
          return ReservationController.formatReservationRow(reservation, serviceCount);
        }));

        return res.json({
          draw, recordsTotal, recordsFiltered, data,
        });
      }

      // Apply status filter
      if (statusFilter) {
        query.equalTo('status', statusFilter);
      }

      // Count filtered
      const countQuery = new Parse.Query('Reservation');
      countQuery.equalTo('active', true);
      countQuery.equalTo('exists', true);
      if (roleFilterPointers) {
        countQuery.containedIn('clientPtr', roleFilterPointers);
      }
      if (statusFilter) {
        countQuery.equalTo('status', statusFilter);
      }

      // Apply date filter to count query
      if (dateFilter === 'upcoming') {
        countQuery.greaterThan('startDate', today);
      } else if (dateFilter === 'ongoing') {
        countQuery.lessThanOrEqualTo('startDate', today);
        countQuery.greaterThanOrEqualTo('endDate', today);
      } else if (dateFilter === 'past') {
        countQuery.lessThan('endDate', today);
      }

      // Apply additional year/month/day filters to count query
      applySpecificDateFilters(countQuery, yearFilter, monthFilter, dayFilter);

      const recordsFiltered = await countQuery.count({ useMasterKey: true });

      // Sort
      if (orderDir === 'descending') {
        query.descending(orderField);
      } else {
        query.ascending(orderField);
      }

      query.skip(start);
      query.limit(length);
      const results = await query.find({ useMasterKey: true });

      // Get service counts for each reservation
      const data = await Promise.all(results.map(async (reservation) => {
        const serviceCount = await ReservationController.getServiceCounts(reservation.id);
        return ReservationController.formatReservationRow(reservation, serviceCount);
      }));

      return res.json({
        draw, recordsTotal, recordsFiltered, data,
      });
    } catch (error) {
      logger.error('Error fetching reservations', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al obtener reservaciones' });
    }
  }

  /**
   * GET /api/reservations/:id — Get reservation detail with services.
   * @param req
   * @param res
   * @example
   */
  static async getReservationById(req, res) {
    try {
      const { id } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('quotePtr');
      query.include('clientPtr');
      query.include('createdBy');
      query.include('serviceCustomer');
      const reservation = await query.get(id, { useMasterKey: true });

      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch services
      const servicesQuery = new Parse.Query('ReservationService');
      servicesQuery.equalTo('reservationPtr', reservation);
      servicesQuery.equalTo('active', true);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include('assignedDriver');
      servicesQuery.include('assignedGuide');
      servicesQuery.include('assignedGreeter');
      servicesQuery.include('assignedVehicle');
      servicesQuery.include('assignedServiceCustomer');
      servicesQuery.ascending('dayNumber');
      servicesQuery.addAscending('time');
      servicesQuery.limit(1000);
      const services = await servicesQuery.find({ useMasterKey: true });

      const client = reservation.get('clientPtr');

      // Build a lookup from serviceItemsSnapshot for fallback when subconcept is null
      const snapshot = reservation.get('serviceItemsSnapshot') || {};
      const snapshotDays = snapshot.days || [];
      const snapshotLookup = {};
      for (const day of snapshotDays) {
        for (const sub of (day.subconcepts || [])) {
          const key = `${day.dayNumber || 1}_${sub.concept || sub.name || ''}_${sub.time || ''}`;
          snapshotLookup[key] = sub;
        }
      }

      const serviceCustomerObj = reservation.get('serviceCustomer');

      // Build a Rate id → { name, color } map so older subconcepts that were saved before
      // we started persisting categoryName / categoryColor / segmentName / segmentColor can
      // still surface a proper segment label in the booking dashboard.
      const rateMap = new Map();
      try {
        const rateQuery = new Parse.Query('Rate');
        rateQuery.equalTo('exists', true);
        rateQuery.limit(1000);
        const rates = await rateQuery.find({ useMasterKey: true });
        rates.forEach((r) => rateMap.set(r.id, {
          name: r.get('name') || '',
          color: r.get('color') || '',
        }));
      } catch (rateErr) {
        logger.warn('ReservationController.getReservationById: failed to load rate map', { error: rateErr.message });
      }
      // Mutates the given subconcept in place to fill any missing segment names / colors
      // using the rateMap. Returns the same object for fluent use.
      // Intentional in-place mutation: this helper enriches the subconcept blob with
      // segment names / colors when they are missing, so callers receive a fully populated
      // object without having to remap. The no-param-reassign rule is disabled accordingly.
      /* eslint-disable no-param-reassign */
      /**
       * Enrich a subconcept blob with segment names / colors when missing, using rateMap.
       * Mutates the passed object in place and returns it for fluent chaining.
       * @param {object} sub - Subconcept blob from a ReservationService.
       * @returns {object} The same subconcept, with categoryName/categoryColor/etc filled in.
       * @example
       *   enrichSubconceptSegments(service.get('subconcept'));
       */
      const enrichSubconceptSegments = (sub) => {
        if (!sub || typeof sub !== 'object') return sub;
        const mainSegmentId = sub.category || sub.rateId;
        if (mainSegmentId && rateMap.has(mainSegmentId)) {
          const r = rateMap.get(mainSegmentId);
          if (!sub.categoryName) sub.categoryName = r.name;
          if (!sub.categoryColor) sub.categoryColor = r.color;
        }
        if (sub.additionalVehicleSegment && rateMap.has(sub.additionalVehicleSegment)) {
          const r = rateMap.get(sub.additionalVehicleSegment);
          if (!sub.additionalVehicleSegmentName) sub.additionalVehicleSegmentName = r.name;
          if (!sub.additionalVehicleSegmentColor) sub.additionalVehicleSegmentColor = r.color;
        }
        if (Array.isArray(sub.extraAdditionalVehicles)) {
          sub.extraAdditionalVehicles = sub.extraAdditionalVehicles.map((v) => {
            if (!v || !v.segment) return v;
            const r = rateMap.get(v.segment);
            if (!r) return v;
            return {
              ...v,
              segmentName: v.segmentName || r.name,
              segmentColor: v.segmentColor || r.color,
            };
          });
        }
        return sub;
      };
      /* eslint-enable no-param-reassign */

      // Batch fetch primary images for assigned vehicles (including extra assignments)
      const vehicleIds = services
        .map((svc) => svc.get('assignedVehicle')?.id)
        .filter(Boolean);
      // Also collect vehicle IDs from extra assignments
      services.forEach((svc) => {
        const extras = svc.get('extraAssignments') || [];
        extras.forEach((ea) => {
          if (ea.vehicleId) vehicleIds.push(ea.vehicleId);
        });
      });
      const uniqueVehicleIds = [...new Set(vehicleIds)];
      const vehicleImageMap = {};
      if (uniqueVehicleIds.length > 0) {
        try {
          // First try: query with isPrimary
          const imgQuery = new Parse.Query('VehicleImage');
          const Vehicle = Parse.Object.extend('Vehicle');
          const vehiclePointers = uniqueVehicleIds.map((vid) => Vehicle.createWithoutData(vid));
          imgQuery.containedIn('vehicleId', vehiclePointers);
          imgQuery.equalTo('isPrimary', true);
          imgQuery.equalTo('exists', true);
          let images = await imgQuery.find({ useMasterKey: true });

          // Fallback: if no primary images, get first image per vehicle
          if (images.length === 0) {
            const fallbackQuery = new Parse.Query('VehicleImage');
            fallbackQuery.containedIn('vehicleId', vehiclePointers);
            fallbackQuery.equalTo('exists', true);
            fallbackQuery.ascending('displayOrder');
            images = await fallbackQuery.find({ useMasterKey: true });
          }

          // Deduplicate: keep first image per vehicle, generate presigned URLs
          const formatPriority = ['avif', 'webp', 'jpeg'];
          await Promise.all(images.map(async (img) => {
            const vid = img.get('vehicleId')?.id;
            if (!vid || vehicleImageMap[vid]) return;

            let imageUrl = '';
            const optimizedVariants = img.get('optimizedVariants');
            const optimizationMetadata = img.get('optimizationMetadata');
            const s3Key = img.get('s3Key');
            const imageFile = img.get('imageFile');

            // Prefer optimized variants (avif → webp → jpeg)
            if (optimizedVariants && typeof optimizedVariants === 'object') {
              for (const format of formatPriority) {
                const variant = optimizedVariants[format];
                if (variant?.s3Key) {
                  try {
                    imageUrl = await fileStorageService.getPresignedUrl(variant.s3Key);
                    break;
                  } catch (e) {
                    // Continue to next format
                  }
                }
              }
            }

            // Fallback: optimizationMetadata.formats (older uploads)
            if (!imageUrl && optimizationMetadata?.formats && typeof optimizationMetadata.formats === 'object') {
              for (const format of formatPriority) {
                const formatData = optimizationMetadata.formats[format];
                if (formatData?.s3Key) {
                  try {
                    imageUrl = await fileStorageService.getPresignedUrl(formatData.s3Key);
                    break;
                  } catch (e) {
                    // Continue to next format
                  }
                }
              }
            }

            // Fallback: original s3Key
            if (!imageUrl && s3Key) {
              try {
                imageUrl = await fileStorageService.getPresignedUrl(s3Key);
              } catch (e) {
                // Fall through to legacy
              }
            }

            // Fallback: construct direct S3 URL from metadata
            if (!imageUrl && s3Key) {
              const s3Bucket = img.get('s3Bucket');
              const s3Region = img.get('s3Region');
              if (s3Bucket && s3Region) {
                imageUrl = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${s3Key}`;
              }
            }

            // Fallback: legacy Parse.File or url field
            if (!imageUrl && imageFile) {
              imageUrl = imageFile.url();
            } else if (!imageUrl) {
              imageUrl = img.get('url') || '';
            }

            vehicleImageMap[vid] = imageUrl;
          }));
        } catch (imgErr) {
          logger.warn('Failed to fetch vehicle images', { error: imgErr.message });
        }
      }

      return res.json({
        success: true,
        data: {
          id: reservation.id,
          folio: reservation.get('folio'),
          quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
          quoteId: reservation.get('quotePtr')?.id || '',
          quoteStatus: reservation.get('quotePtr')?.get('status') || '',
          status: reservation.get('status'),
          startDate: reservation.get('startDate'),
          endDate: reservation.get('endDate'),
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal: reservation.get('servicesSubtotal') || reservation.get('totalAmount'),
          adjustments: reservation.get('adjustments') || [],
          currency: reservation.get('currency'),
          paymentType: reservation.get('paymentType'),
          numberOfPeople: reservation.get('numberOfPeople'),
          eventType: reservation.get('eventType'),
          contactPerson: reservation.get('contactPerson'),
          contactEmail: reservation.get('contactEmail'),
          contactPhone: reservation.get('contactPhone'),
          // Lead guest names and quote-level notes propagated from the quote at
          // conversion time (see QuoteService.createReservationFromQuote).
          leadGuestFirstName: reservation.get('leadGuestFirstName') || '',
          leadGuestLastName: reservation.get('leadGuestLastName') || '',
          notes: reservation.get('notes'),
          client: client ? {
            id: client.id,
            fullName: client.get('fullName') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
            companyName: client.get('contextualData')?.companyName || null,
            email: client.get('email'),
            phone: client.get('phone'),
          } : null,
          serviceCustomer: serviceCustomerObj ? {
            id: serviceCustomerObj.id,
            fullName: serviceCustomerObj.get('fullName') || `${serviceCustomerObj.get('firstName') || ''} ${serviceCustomerObj.get('lastName') || ''}`.trim() || serviceCustomerObj.get('username'),
            phone: serviceCustomerObj.get('phone') || '',
            profilePhotoUrl: serviceCustomerObj.get('profilePhotoUrl') || '',
          } : null,
          createdBy: reservation.get('createdBy')?.get('username') || '',
          createdAt: reservation.createdAt,
          services: services.map((svc) => {
            // Use stored subconcept, or fallback to snapshot match
            const storedSub = svc.get('subconcept');
            const fallbackKey = `${svc.get('dayNumber') || 1}_${svc.get('concept') || ''}_${svc.get('time') || ''}`;
            const subconcept = enrichSubconceptSegments(storedSub || snapshotLookup[fallbackKey] || null);

            return {
              id: svc.id,
              dayNumber: svc.get('dayNumber'),
              dayTitle: svc.get('dayTitle'),
              serviceDate: svc.get('serviceDate'),
              type: svc.get('type'),
              concept: svc.get('concept'),
              time: svc.get('time'),
              status: svc.get('status'),
              price: svc.get('price'),
              total: svc.get('total'),
              originName: svc.get('originName'),
              destinationName: svc.get('destinationName'),
              vehicleTypeName: svc.get('vehicleTypeName'),
              notes: svc.get('notes'),
              subconcept,
              // Suggested departure time fields
              flightDepartureTimeSuggested: svc.get('flightDepartureTimeSuggested'),
              roundTripDepartureTimeSuggestedIda: svc.get('roundTripDepartureTimeSuggestedIda'),
              roundTripDepartureTimeSuggestedVuelta: svc.get('roundTripDepartureTimeSuggestedVuelta'),
              assignedDriver: svc.get('assignedDriver') ? {
                id: svc.get('assignedDriver').id,
                fullName: svc.get('assignedDriver').get('fullName') || `${svc.get('assignedDriver').get('firstName') || ''} ${svc.get('assignedDriver').get('lastName') || ''}`.trim() || svc.get('assignedDriver').get('username'),
                phone: svc.get('assignedDriver').get('phone') || '',
                profilePhotoUrl: svc.get('assignedDriver').get('profilePhotoUrl') || '',
              } : null,
              assignedGuide: svc.get('assignedGuide') ? {
                id: svc.get('assignedGuide').id,
                fullName: svc.get('assignedGuide').get('fullName') || `${svc.get('assignedGuide').get('firstName') || ''} ${svc.get('assignedGuide').get('lastName') || ''}`.trim() || svc.get('assignedGuide').get('username'),
                phone: svc.get('assignedGuide').get('phone') || '',
                profilePhotoUrl: svc.get('assignedGuide').get('profilePhotoUrl') || '',
              } : null,
              assignedGreeter: svc.get('assignedGreeter') ? {
                id: svc.get('assignedGreeter').id,
                fullName: svc.get('assignedGreeter').get('fullName') || `${svc.get('assignedGreeter').get('firstName') || ''} ${svc.get('assignedGreeter').get('lastName') || ''}`.trim() || svc.get('assignedGreeter').get('username'),
                phone: svc.get('assignedGreeter').get('phone') || '',
                profilePhotoUrl: svc.get('assignedGreeter').get('profilePhotoUrl') || '',
              } : null,
              assignedVehicle: svc.get('assignedVehicle') ? {
                id: svc.get('assignedVehicle').id,
                name: `${svc.get('assignedVehicle').get('brand') || ''} ${svc.get('assignedVehicle').get('model') || ''}`.trim() || svc.get('assignedVehicle').get('licensePlate') || 'Vehiculo',
                imageUrl: vehicleImageMap[svc.get('assignedVehicle').id] || '',
              } : null,
              assignedServiceCustomer: svc.get('assignedServiceCustomer') ? {
                id: svc.get('assignedServiceCustomer').id,
                fullName: svc.get('assignedServiceCustomer').get('fullName') || `${svc.get('assignedServiceCustomer').get('firstName') || ''} ${svc.get('assignedServiceCustomer').get('lastName') || ''}`.trim() || svc.get('assignedServiceCustomer').get('username'),
                phone: svc.get('assignedServiceCustomer').get('phone') || '',
                profilePhotoUrl: svc.get('assignedServiceCustomer').get('profilePhotoUrl') || '',
              } : null,
              extraAssignments: (svc.get('extraAssignments') || []).map((ea) => {
                // Backfill segmentName / segmentColor from rateMap when missing (legacy data).
                let segName = ea.segmentName || '';
                let segColor = ea.segmentColor || '';
                if (ea.segmentId && rateMap.has(ea.segmentId)) {
                  const r = rateMap.get(ea.segmentId);
                  if (!segName) segName = r.name;
                  if (!segColor) segColor = r.color;
                }
                return {
                  ...ea,
                  segmentName: segName,
                  segmentColor: segColor,
                  vehicleImageUrl: ea.vehicleId ? (vehicleImageMap[ea.vehicleId] || '') : '',
                };
              }),
            };
          }),
        },
      });
    } catch (error) {
      logger.error('Error fetching reservation detail', { id: req.params.id, error: error.message });
      return res.status(500).json({ success: false, error: 'Error al obtener reservación' });
    }
  }

  /**
   * PUT /api/reservations/:id/services/:serviceId/assign — Assign employees/vehicle to a service.
   * @param req
   * @param res
   * @example
   */
  static async assignEmployee(req, res) {
    try {
      const { id, serviceId } = req.params;
      const {
        driverId, guideId, greeterId, vehicleId, serviceCustomerId, extraAssignments,
      } = req.body;

      // Verify reservation exists
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await resQuery.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch the service
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      const service = await svcQuery.get(serviceId, { useMasterKey: true });
      if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
      }

      // Assign fields
      if (driverId !== undefined) {
        if (driverId) {
          const driver = new Parse.Object('AmexingUser');
          driver.id = driverId;
          service.set('assignedDriver', driver);
        } else {
          service.unset('assignedDriver');
        }
      }

      if (guideId !== undefined) {
        if (guideId) {
          const guide = new Parse.Object('AmexingUser');
          guide.id = guideId;
          service.set('assignedGuide', guide);
        } else {
          service.unset('assignedGuide');
        }
      }

      if (greeterId !== undefined) {
        if (greeterId) {
          const greeter = new Parse.Object('AmexingUser');
          greeter.id = greeterId;
          service.set('assignedGreeter', greeter);
        } else {
          service.unset('assignedGreeter');
        }
      }

      if (vehicleId !== undefined) {
        if (vehicleId) {
          const vehicle = new Parse.Object('Vehicle');
          vehicle.id = vehicleId;
          service.set('assignedVehicle', vehicle);
        } else {
          service.unset('assignedVehicle');
        }
      }

      if (serviceCustomerId !== undefined) {
        if (serviceCustomerId) {
          const sc = new Parse.Object('AmexingUser');
          sc.id = serviceCustomerId;
          service.set('assignedServiceCustomer', sc);
        } else {
          service.unset('assignedServiceCustomer');
        }
      }

      if (extraAssignments !== undefined) {
        service.set('extraAssignments', extraAssignments || []);
      }

      // Auto-update service status: pending → assigned when a driver is assigned
      const hasDriver = driverId || service.get('assignedDriver');
      if (hasDriver && service.get('status') === 'pending') {
        service.set('status', 'assigned');
      }
      // If all assignments are removed, revert to pending
      if (!driverId && driverId !== undefined && !service.get('assignedDriver') && service.get('status') === 'assigned') {
        service.set('status', 'pending');
      }

      await service.save(null, { useMasterKey: true });

      // Check if all services in the reservation now have at least one assignment
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Service assignment updated', {
        reservationId: id,
        serviceId,
        driverId,
        guideId,
        greeterId,
        vehicleId,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Asignación actualizada exitosamente' });
    } catch (error) {
      logger.error('Error assigning employee', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al asignar empleado' });
    }
  }

  /**
   * PATCH /api/reservations/:id/services/:serviceId/status — Update individual service status.
   * @param req
   * @param res
   * @example
   */
  static async updateServiceStatus(req, res) {
    try {
      const { id, serviceId } = req.params;
      const { status } = req.body;

      const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'confirmed', 'hold'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: `Estado inválido. Debe ser: ${validStatuses.join(', ')}` });
      }

      // Verify reservation
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await resQuery.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch service
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      const service = await svcQuery.get(serviceId, { useMasterKey: true });
      if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
      }

      service.set('status', status);
      await service.save(null, { useMasterKey: true });

      // Update parent reservation status based on service statuses
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Service status updated', {
        reservationId: id,
        serviceId,
        newStatus: status,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Estado del servicio actualizado' });
    } catch (error) {
      logger.error('Error updating service status', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al actualizar estado del servicio' });
    }
  }

  /**
   * POST /api/reservations/:id/cancel — Cancel reservation and cascade to services.
   * @param req
   * @param res
   * @example
   */
  static async cancelReservation(req, res) {
    try {
      const { id } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await query.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Cancel reservation
      reservation.set('status', 'cancelled');
      await reservation.save(null, { useMasterKey: true });

      // Cascade cancel to all services
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      svcQuery.limit(1000);
      const services = await svcQuery.find({ useMasterKey: true });

      for (const svc of services) {
        svc.set('status', 'cancelled');
      }
      if (services.length > 0) {
        await Parse.Object.saveAll(services, { useMasterKey: true });
      }

      // Revert linked quote status back to 'requested'
      const quotePtr = reservation.get('quotePtr');
      if (quotePtr) {
        const quoteQuery = new Parse.Query('Quote');
        quoteQuery.equalTo('exists', true);
        const quote = await quoteQuery.get(quotePtr.id, { useMasterKey: true });
        if (quote && quote.get('status') === 'scheduled') {
          quote.set('status', 'requested');
          await quote.save(null, { useMasterKey: true });
          logger.info('Quote status reverted to requested', { quoteId: quote.id });
        }
      }

      logger.info('Reservation cancelled with cascade', {
        reservationId: id,
        servicesCancelled: services.length,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Reservación cancelada exitosamente' });
    } catch (error) {
      logger.error('Error cancelling reservation', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al cancelar reservación' });
    }
  }

  /**
   * PUT /api/reservations/:id/services/batch-assign — Batch assign employees/vehicle to multiple services.
   * @param req
   * @param res
   * @example
   */
  static async batchAssignEmployees(req, res) {
    try {
      const { id } = req.params;
      const {
        serviceIds, driverId, guideId, greeterId, vehicleId, serviceCustomerId,
      } = req.body;

      if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Se requiere al menos un servicio' });
      }

      // Verify reservation exists
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await resQuery.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch all target services
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      svcQuery.containedIn('objectId', serviceIds);
      svcQuery.limit(1000);
      const services = await svcQuery.find({ useMasterKey: true });

      if (services.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontraron servicios' });
      }

      // Apply assignments to all services
      for (const service of services) {
        if (driverId !== undefined) {
          if (driverId) {
            const driver = new Parse.Object('AmexingUser');
            driver.id = driverId;
            service.set('assignedDriver', driver);
          } else {
            service.unset('assignedDriver');
          }
        }
        if (guideId !== undefined) {
          if (guideId) {
            const guide = new Parse.Object('AmexingUser');
            guide.id = guideId;
            service.set('assignedGuide', guide);
          } else {
            service.unset('assignedGuide');
          }
        }
        if (greeterId !== undefined) {
          if (greeterId) {
            const greeter = new Parse.Object('AmexingUser');
            greeter.id = greeterId;
            service.set('assignedGreeter', greeter);
          } else {
            service.unset('assignedGreeter');
          }
        }
        if (vehicleId !== undefined) {
          if (vehicleId) {
            const vehicle = new Parse.Object('Vehicle');
            vehicle.id = vehicleId;
            service.set('assignedVehicle', vehicle);
          } else {
            service.unset('assignedVehicle');
          }
        }
        if (serviceCustomerId !== undefined) {
          if (serviceCustomerId) {
            const sc = new Parse.Object('AmexingUser');
            sc.id = serviceCustomerId;
            service.set('assignedServiceCustomer', sc);
          } else {
            service.unset('assignedServiceCustomer');
          }
        }
      }

      await Parse.Object.saveAll(services, { useMasterKey: true });
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Batch assignment updated', {
        reservationId: id,
        serviceCount: services.length,
        driverId,
        guideId,
        greeterId,
        vehicleId,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: `Asignación actualizada en ${services.length} servicio(s)` });
    } catch (error) {
      logger.error('Error batch assigning', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al asignar en lote' });
    }
  }

  /**
   * PUT /api/reservations/:id/service-customer — Assign service customer at reservation level.
   * @param req
   * @param res
   * @example
   */
  static async assignServiceCustomer(req, res) {
    try {
      const { id } = req.params;
      const { serviceCustomerId } = req.body;

      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await resQuery.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      if (serviceCustomerId) {
        const sc = new Parse.Object('AmexingUser');
        sc.id = serviceCustomerId;
        reservation.set('serviceCustomer', sc);
      } else {
        reservation.unset('serviceCustomer');
      }

      await reservation.save(null, { useMasterKey: true });

      logger.info('Reservation service customer updated', {
        reservationId: id,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Seguidor de servicio actualizado' });
    } catch (error) {
      logger.error('Error assigning service customer', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al asignar seguidor' });
    }
  }

  // =========================
  // FINANCIAL ADJUSTMENTS
  // =========================

  /**
   * POST /api/reservations/:id/adjustments — Add extra charge or discount.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON response with updated adjustments.
   * @example
   */
  static async addAdjustment(req, res) {
    try {
      const { id } = req.params;
      const {
        type, description, amount, percentage,
      } = req.body;

      // Validate type
      if (!type || !['charge', 'discount'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Tipo inválido. Debe ser "charge" o "discount"',
        });
      }

      // Validate description
      if (!description || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({
          success: false,
          error: 'La descripción es requerida',
        });
      }

      // Validate amount or percentage
      if (type === 'charge') {
        if (!amount || typeof amount !== 'number' || amount <= 0) {
          return res.status(400).json({
            success: false,
            error: 'El monto debe ser un número mayor a 0',
          });
        }
      } else if (!percentage && (!amount || typeof amount !== 'number' || amount <= 0)) {
        // Discount requires either amount or percentage
        if (percentage !== undefined && (typeof percentage !== 'number' || percentage <= 0 || percentage > 100)) {
          return res.status(400).json({
            success: false,
            error: 'El porcentaje debe ser un número entre 0 y 100',
          });
        }
        if (!percentage) {
          return res.status(400).json({
            success: false,
            error: 'Se requiere un monto o porcentaje para el descuento',
          });
        }
      }

      // Fetch reservation
      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await query.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Initialize servicesSubtotal if not set
      const servicesSubtotal = reservation.get('servicesSubtotal')
        || reservation.get('totalAmount') || 0;
      if (!reservation.get('servicesSubtotal')) {
        reservation.set('servicesSubtotal', servicesSubtotal);
      }

      // Calculate final amount for percentage discounts
      let finalAmount = amount;
      if (type === 'discount' && percentage) {
        finalAmount = Math.round(((servicesSubtotal * percentage) / 100) * 100) / 100;
      }

      // Create adjustment entry
      const adjustment = {
        id: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type,
        description: description.trim(),
        amount: finalAmount,
        percentage: type === 'discount' && percentage ? percentage : null,
        createdAt: new Date().toISOString(),
      };

      // Append to adjustments array
      const adjustments = reservation.get('adjustments') || [];
      adjustments.push(adjustment);
      reservation.set('adjustments', adjustments);

      // Recalculate total
      ReservationController.recalculateTotal(reservation);

      await reservation.save(null, { useMasterKey: true });

      logger.info('Reservation adjustment added', {
        reservationId: id,
        adjustmentId: adjustment.id,
        type,
        amount: finalAmount,
        description: description.trim(),
        performedBy: req.user?.id,
      });

      return res.json({
        success: true,
        message: type === 'charge' ? 'Cargo agregado' : 'Descuento agregado',
        data: {
          adjustment,
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal,
          adjustments,
        },
      });
    } catch (error) {
      logger.error('Error adding adjustment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al agregar ajuste' });
    }
  }

  /**
   * DELETE /api/reservations/:id/adjustments/:adjustmentId — Remove an adjustment.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON response with updated adjustments.
   * @example
   */
  static async removeAdjustment(req, res) {
    try {
      const { id, adjustmentId } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await query.get(id, { useMasterKey: true });
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      const adjustments = reservation.get('adjustments') || [];
      const idx = adjustments.findIndex((a) => a.id === adjustmentId);
      if (idx === -1) {
        return res.status(404).json({ success: false, error: 'Ajuste no encontrado' });
      }

      const removed = adjustments.splice(idx, 1)[0];
      reservation.set('adjustments', adjustments);

      // Recalculate total
      ReservationController.recalculateTotal(reservation);

      await reservation.save(null, { useMasterKey: true });

      logger.info('Reservation adjustment removed', {
        reservationId: id,
        adjustmentId,
        type: removed.type,
        amount: removed.amount,
        performedBy: req.user?.id,
      });

      return res.json({
        success: true,
        message: 'Ajuste eliminado',
        data: {
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal: reservation.get('servicesSubtotal') || reservation.get('totalAmount'),
          adjustments,
        },
      });
    } catch (error) {
      logger.error('Error removing adjustment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al eliminar ajuste' });
    }
  }

  /**
   * Recalculate totalAmount from servicesSubtotal and adjustments.
   * @param {object} reservation - Parse Reservation object.
   * @example
   */
  static recalculateTotal(reservation) {
    const servicesSubtotal = reservation.get('servicesSubtotal')
      || reservation.get('totalAmount') || 0;
    const adjustments = reservation.get('adjustments') || [];

    const charges = adjustments
      .filter((a) => a.type === 'charge')
      .reduce((sum, a) => sum + (a.amount || 0), 0);

    const discounts = adjustments
      .filter((a) => a.type === 'discount')
      .reduce((sum, a) => sum + (a.amount || 0), 0);

    const finalTotal = Math.max(0, servicesSubtotal + charges - discounts);
    reservation.set('totalAmount', Math.round(finalTotal * 100) / 100);
  }

  // =================
  // PRIVATE HELPERS
  // =================

  /**
   * Get service counts for a reservation (total, assigned).
   * @param reservationId
   * @example
   */
  static async getServiceCounts(reservationId) {
    const resPointer = new Parse.Object('Reservation');
    resPointer.id = reservationId;

    const totalQuery = new Parse.Query('ReservationService');
    totalQuery.equalTo('reservationPtr', resPointer);
    totalQuery.equalTo('active', true);
    totalQuery.equalTo('exists', true);
    const totalCount = await totalQuery.count({ useMasterKey: true });

    const assignedQuery = new Parse.Query('ReservationService');
    assignedQuery.equalTo('reservationPtr', resPointer);
    assignedQuery.equalTo('active', true);
    assignedQuery.equalTo('exists', true);
    assignedQuery.equalTo('status', 'assigned');
    const assignedCount = await assignedQuery.count({ useMasterKey: true });

    return { totalCount, assignedCount };
  }

  /**
   * Format a reservation for DataTable row.
   * @param reservation
   * @param serviceCount
   * @example
   */
  static formatReservationRow(reservation, serviceCount) {
    const client = reservation.get('clientPtr');

    // Try to get company name from contextualData first, then fallback to name fields
    let clientName = 'N/A';
    if (client) {
      const contextualData = client.get('contextualData');
      if (contextualData && contextualData.companyName) {
        clientName = contextualData.companyName;
      } else {
        clientName = client.get('fullName') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim();
      }
    }

    // Final fallback to contactPerson if no client data
    if (clientName === 'N/A' || !clientName) {
      clientName = reservation.get('contactPerson') || 'N/A';
    }

    const status = reservation.get('status');
    const quoteStatus = reservation.get('quotePtr')?.get('status') || '';
    console.log(`🔍 [API] Reservation ${reservation.get('folio')} - Quote status: ${quoteStatus}, Reservation status: ${status}`);

    return {
      id: reservation.id,
      folio: reservation.get('folio'),
      quoteId: reservation.get('quotePtr')?.id || '',
      quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
      quoteStatus,
      clientName,
      eventType: reservation.get('eventType') || '',
      startDate: reservation.get('startDate'),
      numberOfPeople: reservation.get('numberOfPeople'),
      totalAmount: reservation.get('totalAmount'),
      currency: reservation.get('currency'),
      totalServices: serviceCount.totalCount,
      assignedServices: serviceCount.assignedCount,
      status,
      createdAt: reservation.createdAt,
    };
  }

  /**
   * Update reservation status based on service statuses.
   * @param reservation
   * @example
   */
  static async updateReservationStatus(reservation) {
    const svcQuery = new Parse.Query('ReservationService');
    svcQuery.equalTo('reservationPtr', reservation);
    svcQuery.equalTo('active', true);
    svcQuery.equalTo('exists', true);
    svcQuery.limit(1000);
    const services = await svcQuery.find({ useMasterKey: true });

    if (services.length === 0) return;

    const currentStatus = reservation.get('status');
    const statuses = services.map((s) => s.get('status'));
    const allCompleted = statuses.every((s) => s === 'completed' || s === 'cancelled');
    const allAssigned = statuses.every((s) => s === 'assigned' || s === 'completed' || s === 'cancelled');
    const someInProgress = statuses.some((s) => s === 'in_progress');

    let newStatus = currentStatus;

    // Preserve 'confirmed' and 'hold' statuses unless services are completed
    if (allCompleted) {
      newStatus = 'completed';
    } else if (someInProgress) {
      newStatus = 'in_progress';
    } else if (allAssigned && !['confirmed', 'hold'].includes(currentStatus)) {
      newStatus = 'assigned';
    } else if (!allAssigned && !['confirmed', 'hold'].includes(currentStatus)) {
      newStatus = 'pending';
    }
    // For 'confirmed' and 'hold', only change to 'in_progress' or 'completed'

    if (newStatus !== currentStatus) {
      reservation.set('status', newStatus);
      await reservation.save(null, { useMasterKey: true });
    }
  }
}

module.exports = ReservationController;
