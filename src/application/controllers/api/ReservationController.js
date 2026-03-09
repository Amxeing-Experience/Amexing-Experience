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
// Models used via Parse.Query string references

/**
 * ReservationController - API controller for reservation management.
 */
class ReservationController {
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

      // Build query
      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('quotePtr');
      query.include('clientPtr');
      query.include('createdBy');

      // Total count (without filters)
      const totalQuery = new Parse.Query('Reservation');
      totalQuery.equalTo('active', true);
      totalQuery.equalTo('exists', true);
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
      // Re-build for count
      const countQuery = new Parse.Query('Reservation');
      countQuery.equalTo('active', true);
      countQuery.equalTo('exists', true);
      if (statusFilter) {
        countQuery.equalTo('status', statusFilter);
      }
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
      servicesQuery.ascending('dayNumber');
      servicesQuery.addAscending('time');
      servicesQuery.limit(1000);
      const services = await servicesQuery.find({ useMasterKey: true });

      const client = reservation.get('clientPtr');

      return res.json({
        success: true,
        data: {
          id: reservation.id,
          folio: reservation.get('folio'),
          quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
          quoteId: reservation.get('quotePtr')?.id || '',
          status: reservation.get('status'),
          startDate: reservation.get('startDate'),
          endDate: reservation.get('endDate'),
          totalAmount: reservation.get('totalAmount'),
          currency: reservation.get('currency'),
          paymentType: reservation.get('paymentType'),
          numberOfPeople: reservation.get('numberOfPeople'),
          eventType: reservation.get('eventType'),
          contactPerson: reservation.get('contactPerson'),
          contactEmail: reservation.get('contactEmail'),
          contactPhone: reservation.get('contactPhone'),
          notes: reservation.get('notes'),
          client: client ? {
            id: client.id,
            fullName: client.get('fullName') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
            email: client.get('email'),
            phone: client.get('phone'),
          } : null,
          createdBy: reservation.get('createdBy')?.get('username') || '',
          createdAt: reservation.createdAt,
          services: services.map((svc) => ({
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
            assignedDriver: svc.get('assignedDriver') ? {
              id: svc.get('assignedDriver').id,
              fullName: svc.get('assignedDriver').get('fullName') || svc.get('assignedDriver').get('username'),
            } : null,
            assignedGuide: svc.get('assignedGuide') ? {
              id: svc.get('assignedGuide').id,
              fullName: svc.get('assignedGuide').get('fullName') || svc.get('assignedGuide').get('username'),
            } : null,
            assignedGreeter: svc.get('assignedGreeter') ? {
              id: svc.get('assignedGreeter').id,
              fullName: svc.get('assignedGreeter').get('fullName') || svc.get('assignedGreeter').get('username'),
            } : null,
            assignedVehicle: svc.get('assignedVehicle') ? {
              id: svc.get('assignedVehicle').id,
              name: svc.get('assignedVehicle').get('name') || svc.get('assignedVehicle').get('plateNumber'),
            } : null,
          })),
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
        driverId, guideId, greeterId, vehicleId,
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

      const validStatuses = ['pending', 'assigned', 'completed', 'cancelled'];
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
    assignedQuery.exists('assignedDriver');
    // Count services that have at least a driver assigned
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
    const clientName = client
      ? (client.get('fullName') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim())
      : (reservation.get('contactPerson') || 'N/A');

    return {
      id: reservation.id,
      folio: reservation.get('folio'),
      quoteId: reservation.get('quotePtr')?.id || '',
      quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
      clientName,
      eventType: reservation.get('eventType') || '',
      startDate: reservation.get('startDate'),
      numberOfPeople: reservation.get('numberOfPeople'),
      totalAmount: reservation.get('totalAmount'),
      currency: reservation.get('currency'),
      totalServices: serviceCount.totalCount,
      assignedServices: serviceCount.assignedCount,
      status: reservation.get('status'),
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

    const statuses = services.map((s) => s.get('status'));
    const allCompleted = statuses.every((s) => s === 'completed' || s === 'cancelled');
    const someAssigned = statuses.some((s) => s === 'assigned' || s === 'completed');
    const someInProgress = statuses.some((s) => s === 'in_progress');

    let newStatus = reservation.get('status');

    if (allCompleted) {
      newStatus = 'completed';
    } else if (someInProgress) {
      newStatus = 'in_progress';
    } else if (someAssigned) {
      newStatus = 'assigned';
    }

    if (newStatus !== reservation.get('status')) {
      reservation.set('status', newStatus);
      await reservation.save(null, { useMasterKey: true });
    }
  }
}

module.exports = ReservationController;
