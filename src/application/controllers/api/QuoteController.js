/**
 * QuoteController - Handles quote/cotización CRUD operations
 * Uses Quote domain model that extends BaseModel with validation.
 */

const Parse = require('parse/node');
const Quote = require('../../../domain/models/Quote');
const QuoteService = require('../../services/QuoteService');
const pricingHelper = require('../../utils/pricingHelper');
const logger = require('../../../infrastructure/logger');

/**
 * Quote Controller - Manages quote/cotización CRUD operations
 * Handles creation, retrieval, update, and deletion of quotes with rate assignments.
 * @class QuoteController
 */
class QuoteController {
  constructor() {
    this.quoteService = new QuoteService();
  }

  /**
   * Create a new quote
   * POST /api/quotes
   * Note: Rate is no longer required at quote level (v2.0.0+).
   * Rates are now managed at subconcept/service level.
   * @param {object} req - Express request object.
   * @param {object} req.body - Request body.
   * @param {string} [req.body.client] - Client ID (AmexingUser objectId) - OPTIONAL.
   * @param {string} [req.body.contactPerson] - Contact person name.
   * @param {string} [req.body.contactEmail] - Contact email.
   * @param {string} [req.body.contactPhone] - Contact phone.
   * @param {string} [req.body.notes] - Additional notes.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createQuote(req, res) {
    // Declare variables at method scope for error logging
    let clientObj = null;
    let createdByObj = null;

    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Usuario no autenticado', 401);
      }

      // 2. Extract fields from request body
      const {
        client,
        clientId,
        contactPerson,
        contactEmail,
        contactPhone,
        notes,
        eventType,
        numberOfPeople,
      } = req.body;

      // Normalize field names (accept both formats)
      const clientIdNormalized = client || clientId;

      // 3. Create client pointer to AmexingUser (if provided)
      if (clientIdNormalized) {
        clientObj = {
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: clientIdNormalized,
        };
      }

      // 4. Create createdBy pointer to current user (required)
      createdByObj = {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      };

      // 5. Generate unique folio
      const folio = await this.generateFolio();

      // 6. Create quote using Quote domain model (extends BaseModel)
      const quote = new Quote();

      // 7. Assign Parse objects (NOT string IDs!) - Using Pointer structure
      if (clientObj) {
        quote.set('client', clientObj); // Full Pointer object (optional)
      }
      // Note: Rate is no longer set at quote level (v2.0.0+)
      quote.set('createdBy', createdByObj); // Full Pointer object (required)

      // 8. Set basic fields
      quote.set('folio', folio);
      quote.set('contactPerson', contactPerson || '');
      quote.set('contactEmail', contactEmail || '');
      quote.set('contactPhone', contactPhone || '');
      quote.set('notes', notes || '');
      quote.set('eventType', eventType || '');
      quote.set('numberOfPeople', numberOfPeople ? parseInt(numberOfPeople, 10) : 1);

      // 9. Set automatic fields
      quote.set('status', 'requested');
      // validUntil: 30 days from now
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      quote.set('validUntil', validUntil);
      quote.set('active', true);
      quote.set('exists', true);

      // 10. Log what we're about to save (debugging)
      logger.info('Attempting to save quote with data:', {
        folio,
        clientPointer: clientObj,
        contactPerson: contactPerson || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        notes: notes || '',
        status: 'requested',
        userId: currentUser.id,
      });

      // 11. Save with user context for audit trail
      await quote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // 12. Log success (using Pointer objects - IDs only)
      logger.info('Quote created successfully', {
        quoteId: quote.id,
        folio,
        clientId: clientObj ? clientObj.objectId : null,
        createdBy: currentUser.id,
        createdByEmail: currentUser.get('email'),
      });

      // 13. Return success response (using Pointer objects - IDs only)
      const data = {
        id: quote.id,
        folio,
        clientId: clientObj ? clientObj.objectId : null,
        contactPerson: contactPerson || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        notes: notes || '',
        status: 'requested',
        validUntil: validUntil.toISOString(),
        active: true,
      };

      return this.sendSuccess(res, data, 'Cotización creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in QuoteController.createQuote - DETAILED ERROR:', {
        errorMessage: error.message,
        errorCode: error.code,
        errorName: error.name,
        errorToString: error.toString(),
        parseErrorCode: error.code,
        stack: error.stack,
        userId: req.user?.id,
        requestBody: req.body,
        clientPointerAttempted: clientObj,
      });

      // Return more detailed error message
      const errorMsg = error.message || 'Error al crear la cotización';
      return this.sendError(res, `Error al crear la cotización: ${errorMsg}`, 500);
    }
  }

  /**
   * GET /api/quotes - Get quotes with DataTables server-side processing.
   * Now supports role-based filtering for department managers.
   *
   * Query Parameters (DataTables format):
   * - draw: Draw counter for DataTables
   * - start: Starting record number
   * - length: Number of records to return
   * - search[value]: Search term
   * - order[0][column]: Column index to sort
   * - order[0][dir]: Sort direction (asc/desc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // DataTables will call this endpoint automatically
   */
  async getQuotes(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || 25, 100);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting (matches frontend columns order)
      // Columns: client, rate, eventType, numberOfPeople, createdBy, status, actions
      const columns = ['client', 'rate', 'eventType', 'numberOfPeople', 'createdBy', 'status', 'createdAt'];
      const sortField = columns[sortColumnIndex] || 'createdAt';

      // Build base query for all existing records with role-based filtering
      const baseQuery = new Parse.Query('Quote');
      baseQuery.equalTo('exists', true);
      baseQuery.include('client');
      baseQuery.include('rate');
      baseQuery.include('createdBy');

      // Apply role-based filters
      await this.applyRoleBasedQuoteFilters(baseQuery, currentUser, req.userRole);

      // Get total records count (without search filter but with role filters)
      const totalRecordsQuery = new Parse.Query('Quote');
      totalRecordsQuery.equalTo('exists', true);
      await this.applyRoleBasedQuoteFilters(totalRecordsQuery, currentUser, req.userRole);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Search in folio, client name, or contact person
        const folioQuery = new Parse.Query('Quote');
        folioQuery.equalTo('exists', true);
        folioQuery.matches('folio', searchValue, 'i');
        await this.applyRoleBasedQuoteFilters(folioQuery, currentUser, req.userRole);

        const contactQuery = new Parse.Query('Quote');
        contactQuery.equalTo('exists', true);
        contactQuery.matches('contactPerson', searchValue, 'i');
        await this.applyRoleBasedQuoteFilters(contactQuery, currentUser, req.userRole);

        filteredQuery = Parse.Query.or(folioQuery, contactQuery);
        filteredQuery.include('client');
        filteredQuery.include('rate');
        filteredQuery.include('createdBy');
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const quotes = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables and check for pending invoice requests
      const data = await Promise.all(quotes.map(async (quote) => {
        const client = quote.get('client');
        const rate = quote.get('rate');
        const createdBy = quote.get('createdBy');

        // Check if quote has pending invoice request
        let hasPendingInvoiceRequest = false;
        try {
          hasPendingInvoiceRequest = await this.quoteService.hasPendingInvoiceRequest(quote.id);
        } catch (error) {
          logger.warn('Error checking pending invoice request', { quoteId: quote.id, error: error.message });
        }

        return {
          id: quote.id,
          objectId: quote.id,
          folio: quote.get('folio') || 'N/A',
          client: client
            ? {
              id: client.id,
              firstName: client.get('firstName') || '',
              lastName: client.get('lastName') || '',
              companyName: client.get('companyName') || '',
              fullName: `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
            }
            : null,
          rate: rate
            ? {
              id: rate.id,
              name: rate.get('name') || 'N/A',
              color: rate.get('color') || '#6366F1',
            }
            : null,
          eventType: quote.get('eventType') || '',
          numberOfPeople: quote.get('numberOfPeople') || 1,
          createdBy: createdBy
            ? {
              id: createdBy.id,
              firstName: createdBy.get('firstName') || '',
              lastName: createdBy.get('lastName') || '',
              email: createdBy.get('email') || '',
              fullName: `${createdBy.get('firstName') || ''} ${createdBy.get('lastName') || ''}`.trim(),
            }
            : null,
          status: quote.get('status') || 'requested',
          contactPerson: quote.get('contactPerson') || '',
          contactEmail: quote.get('contactEmail') || '',
          contactPhone: quote.get('contactPhone') || '',
          notes: quote.get('notes') || '',
          validUntil: quote.get('validUntil'),
          active: quote.get('active'),
          hasPendingInvoiceRequest, // Add invoice status
          createdAt: quote.createdAt,
          updatedAt: quote.updatedAt,
        };
      }));

      // DataTables response format
      const response = {
        success: true,
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in QuoteController.getQuotes', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener las cotizaciones',
        500
      );
    }
  }

  /**
   * GET /api/quotes/:id - Get quote by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getQuoteById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // Query quote with includes
      const query = new Parse.Query('Quote');
      query.include('client');
      query.include('rate');
      query.include('createdBy');
      query.equalTo('exists', true);

      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Check access permissions after getting the quote
      const hasAccess = await this.checkQuoteAccess(currentUser, quote, req.userRole);
      if (!hasAccess) {
        return this.sendError(res, 'No tienes permisos para acceder a esta cotización', 403);
      }

      const client = quote.get('client');
      const rate = quote.get('rate');
      const createdBy = quote.get('createdBy');

      const data = {
        id: quote.id,
        folio: quote.get('folio'),
        client: client
          ? {
            id: client.id,
            firstName: client.get('firstName') || '',
            lastName: client.get('lastName') || '',
            companyName: client.get('companyName') || '',
            email: client.get('email') || '',
            phone: client.get('phone') || '',
            fullName: `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
          }
          : null,
        rate: rate
          ? {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color'),
          }
          : null,
        eventType: quote.get('eventType') || '',
        numberOfPeople: quote.get('numberOfPeople') || 1,
        contactPerson: quote.get('contactPerson') || '',
        contactEmail: quote.get('contactEmail') || '',
        contactPhone: quote.get('contactPhone') || '',
        notes: quote.get('notes') || '',
        status: quote.get('status') || 'requested',
        validUntil: quote.get('validUntil'),
        serviceItems: quote.get('serviceItems') || {
          days: [],
          subtotal: 0,
          iva: 0,
          total: 0,
        },
        createdBy: createdBy
          ? {
            id: createdBy.id,
            firstName: createdBy.get('firstName') || '',
            lastName: createdBy.get('lastName') || '',
            email: createdBy.get('email') || '',
            fullName: `${createdBy.get('firstName') || ''} ${createdBy.get('lastName') || ''}`.trim(),
          }
          : null,
        active: quote.get('active'),
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
      };

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getQuoteById', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener la cotización',
        500
      );
    }
  }

  /**
   * PUT /api/quotes/:id - Update quote.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Update quote status
   */
  async updateQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      const updates = req.body;

      // Call service
      const result = await this.quoteService.updateQuote(
        currentUser,
        quoteId,
        updates,
        updates.reason || 'Quote updated',
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.updateQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al actualizar la cotización',
        500
      );
    }
  }

  /**
   * POST /api/quotes/:id/duplicate - Duplicate an existing quote.
   * Creates a copy of a quote with:
   * - New auto-generated folio (QTE-YYYY-####)
   * - EventType with incremented "Opción X" suffix
   * - Status set to "draft"
   * - ValidUntil set to +30 days from now
   * - Complete copy of serviceItems
   * - Same rate, client, contact info, and notes.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Duplicate quote
   * POST /api/quotes/abc123/duplicate
   * // Response:
   * {
   *   success: true,
   *   message: 'Cotización duplicada exitosamente',
   *   data: {
   *     quote: { id, folio, eventType, status, ... },
   *     originalFolio: 'QTE-2025-0041'
   *   }
   * }
   */
  async duplicateQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // 1. Get original quote with all includes
      const query = new Parse.Query('Quote');
      query.include('client');
      query.include('rate');
      query.include('createdBy');
      query.equalTo('exists', true);

      let originalQuote;
      try {
        originalQuote = await query.get(quoteId, { useMasterKey: true });
      } catch (error) {
        logger.warn('Quote not found for duplication', {
          quoteId,
          error: error.message,
          userId: currentUser.id,
        });
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      if (!originalQuote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      const originalFolio = originalQuote.get('folio');

      // 2. Process eventType to add/increment "Opción X"
      const originalEventType = originalQuote.get('eventType') || '';
      let newEventType;

      // Regex to match "- Opción X" at the end of the string
      const optionRegex = / - Opción (\d+)$/;
      const match = originalEventType.match(optionRegex);

      if (match) {
        // EventType already has "Opción X" - increment the number
        const currentNumber = parseInt(match[1], 10);
        const newNumber = currentNumber + 1;
        newEventType = originalEventType.replace(optionRegex, ` - Opción ${newNumber}`);
      } else {
        // EventType doesn't have suffix - add "Opción 2"
        newEventType = `${originalEventType} - Opción 2`;
      }

      // 3. Generate new folio
      const newFolio = await this.generateFolio();

      // 4. Create new quote object
      const newQuote = new Quote();

      // 5. Copy pointer fields (rate, client)
      const rate = originalQuote.get('rate');
      if (rate) {
        newQuote.set('rate', {
          __type: 'Pointer',
          className: 'Rate',
          objectId: rate.id,
        });
      }

      const client = originalQuote.get('client');
      if (client) {
        newQuote.set('client', {
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: client.id,
        });
      }

      // 6. Set createdBy to current user (who is duplicating)
      newQuote.set('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });

      // 7. Copy basic fields
      newQuote.set('folio', newFolio);
      newQuote.set('eventType', newEventType);
      newQuote.set('numberOfPeople', originalQuote.get('numberOfPeople') || 1);
      newQuote.set('contactPerson', originalQuote.get('contactPerson') || '');
      newQuote.set('contactEmail', originalQuote.get('contactEmail') || '');
      newQuote.set('contactPhone', originalQuote.get('contactPhone') || '');
      newQuote.set('notes', originalQuote.get('notes') || '');

      // 8. Copy serviceItems (complete itinerary)
      const originalServiceItems = originalQuote.get('serviceItems');
      if (originalServiceItems) {
        // Deep clone serviceItems to avoid reference issues
        newQuote.set('serviceItems', JSON.parse(JSON.stringify(originalServiceItems)));
      } else {
        newQuote.set('serviceItems', {
          days: [],
          subtotal: 0,
          iva: 0,
          total: 0,
        });
      }

      // 9. Set new values for status and validUntil
      newQuote.set('status', 'requested');
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      newQuote.set('validUntil', validUntil);

      // 10. Set standard fields
      newQuote.set('active', true);
      newQuote.set('exists', true);

      // 11. Save new quote
      await newQuote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // 12. Fetch the saved quote with includes for response
      const fetchQuery = new Parse.Query('Quote');
      fetchQuery.include('client');
      fetchQuery.include('rate');
      fetchQuery.include('createdBy');
      const savedQuote = await fetchQuery.get(newQuote.id, { useMasterKey: true });

      // 13. Format response data
      const clientData = savedQuote.get('client');
      const rateData = savedQuote.get('rate');
      const createdByData = savedQuote.get('createdBy');

      const responseData = {
        objectId: savedQuote.id,
        id: savedQuote.id,
        folio: savedQuote.get('folio'),
        client: clientData
          ? {
            id: clientData.id,
            firstName: clientData.get('firstName') || '',
            lastName: clientData.get('lastName') || '',
            companyName: clientData.get('companyName') || '',
            email: clientData.get('email') || '',
            fullName: `${clientData.get('firstName') || ''} ${clientData.get('lastName') || ''}`.trim(),
          }
          : null,
        rate: rateData
          ? {
            id: rateData.id,
            objectId: rateData.id,
            name: rateData.get('name'),
            color: rateData.get('color'),
          }
          : null,
        eventType: savedQuote.get('eventType'),
        numberOfPeople: savedQuote.get('numberOfPeople'),
        contactPerson: savedQuote.get('contactPerson'),
        contactEmail: savedQuote.get('contactEmail'),
        contactPhone: savedQuote.get('contactPhone'),
        notes: savedQuote.get('notes'),
        status: savedQuote.get('status'),
        validUntil: savedQuote.get('validUntil'),
        serviceItems: savedQuote.get('serviceItems'),
        createdBy: createdByData
          ? {
            id: createdByData.id,
            firstName: createdByData.get('firstName') || '',
            lastName: createdByData.get('lastName') || '',
            email: createdByData.get('email') || '',
            fullName: `${createdByData.get('firstName') || ''} ${createdByData.get('lastName') || ''}`.trim(),
          }
          : null,
        active: savedQuote.get('active'),
        createdAt: savedQuote.createdAt,
        updatedAt: savedQuote.updatedAt,
      };

      // 14. Log success
      logger.info('Quote duplicated successfully', {
        originalQuoteId: quoteId,
        originalFolio,
        newQuoteId: savedQuote.id,
        newFolio,
        originalEventType,
        newEventType,
        userId: currentUser.id,
        userEmail: currentUser.get('email'),
      });

      // 15. Return response
      return res.status(201).json({
        success: true,
        message: 'Cotización duplicada exitosamente',
        data: {
          quote: responseData,
          originalFolio,
        },
      });
    } catch (error) {
      logger.error('Error in QuoteController.duplicateQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al duplicar la cotización',
        500
      );
    }
  }

  /**
   * DELETE /api/quotes/:id - Soft delete quote.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Delete quote
   */
  async deleteQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      // Call service
      const result = await this.quoteService.softDeleteQuote(
        currentUser,
        quoteId,
        req.body.reason || 'Quote deleted',
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.deleteQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al eliminar la cotización',
        500
      );
    }
  }

  /**
   * Update service items for a quote
   * PUT /api/quotes/:id/service-items.
   * @param {object} req - Express request object.
   * @param {object} req.params - Request parameters.
   * @param {string} req.params.id - Quote ID.
   * @param {object} req.body - Service items object.
   * @param {Array} req.body.days - Array of day objects.
   * @param {number} req.body.subtotal - Subtotal amount.
   * @param {number} req.body.iva - IVA amount (16% of subtotal).
   * @param {number} req.body.total - Total amount (subtotal + iva).
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateServiceItems(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      const {
        days = [], subtotal = 0, iva = 0, total = 0,
      } = req.body;

      // Validate serviceItems structure
      if (!Array.isArray(days)) {
        return this.sendError(res, 'El campo days debe ser un array', 400);
      }

      // Validate numeric fields
      if (typeof subtotal !== 'number' || subtotal < 0) {
        return this.sendError(res, 'El subtotal debe ser un número positivo', 400);
      }

      // Validate IVA calculation (should be 16% of subtotal)
      const expectedIva = Math.round(subtotal * 0.16 * 100) / 100;
      const ivaRounded = Math.round(iva * 100) / 100;
      if (Math.abs(ivaRounded - expectedIva) > 0.01) {
        return this.sendError(res, 'El IVA debe ser el 16% del subtotal', 400);
      }

      // Validate total calculation
      const expectedTotal = Math.round((subtotal + iva) * 100) / 100;
      const totalRounded = Math.round(total * 100) / 100;
      if (Math.abs(totalRounded - expectedTotal) > 0.01) {
        return this.sendError(res, 'El total debe ser la suma del subtotal + IVA', 400);
      }

      // Validate day structure with new subconcepts format
      for (let i = 0; i < days.length; i++) {
        const day = days[i];

        // Validate dayNumber
        if (!day.dayNumber || typeof day.dayNumber !== 'number' || day.dayNumber < 1) {
          return this.sendError(res, `El día ${i + 1} debe tener un dayNumber válido (>= 1)`, 400);
        }

        // Validate dayTitle (optional field - can be empty string)
        if (day.dayTitle !== undefined && day.dayTitle !== null && typeof day.dayTitle !== 'string') {
          return this.sendError(res, `El título del día ${day.dayNumber} debe ser texto`, 400);
        }

        // Validate subconcepts array (new structure)
        if (!Array.isArray(day.subconcepts)) {
          return this.sendError(res, `El día ${day.dayNumber} debe tener un array de subconcepts`, 400);
        }

        // Validate each subconcept
        for (let j = 0; j < day.subconcepts.length; j++) {
          const sub = day.subconcepts[j];

          // Validate time format HH:MM (optional but if exists must be valid)
          if (sub.time && !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(sub.time)) {
            return this.sendError(
              res,
              `Hora inválida en subconcepto ${j + 1} del día ${day.dayNumber}. Use formato HH:MM (00:00 - 23:59)`,
              400
            );
          }

          // Validate numeric fields in subconcept
          if (sub.hours !== null && sub.hours !== undefined) {
            if (typeof sub.hours !== 'number' || sub.hours < 0) {
              return this.sendError(res, `Horas inválidas en subconcepto ${j + 1} del día ${day.dayNumber}`, 400);
            }
          }

          if (sub.unitPrice !== null && sub.unitPrice !== undefined) {
            if (typeof sub.unitPrice !== 'number' || sub.unitPrice < 0) {
              return this.sendError(
                res,
                `Precio unitario inválido en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.total !== null && sub.total !== undefined) {
            if (typeof sub.total !== 'number' || sub.total < 0) {
              return this.sendError(res, `Total inválido en subconcepto ${j + 1} del día ${day.dayNumber}`, 400);
            }
          }

          // Validate per-person pricing fields
          if (sub.isPerPerson !== undefined && typeof sub.isPerPerson !== 'boolean') {
            return this.sendError(
              res,
              `isPerPerson debe ser booleano en subconcepto ${j + 1} del día ${day.dayNumber}`,
              400
            );
          }

          if (sub.isPerPerson && sub.numberOfPeople !== undefined) {
            if (typeof sub.numberOfPeople !== 'number' || sub.numberOfPeople < 1) {
              return this.sendError(
                res,
                `numberOfPeople debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.vehicleCapacity !== undefined && sub.vehicleCapacity !== null) {
            if (typeof sub.vehicleCapacity !== 'number' || sub.vehicleCapacity < 1) {
              return this.sendError(
                res,
                `vehicleCapacity debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }

          if (sub.vehicleMultiplier !== undefined && sub.vehicleMultiplier !== null) {
            if (typeof sub.vehicleMultiplier !== 'number' || sub.vehicleMultiplier < 1) {
              return this.sendError(
                res,
                `vehicleMultiplier debe ser mayor a 0 en subconcepto ${j + 1} del día ${day.dayNumber}`,
                400
              );
            }
          }
        }

        // Validate dayTotal (new field - must equal sum of subconcepts totals)
        if (typeof day.dayTotal !== 'number' || day.dayTotal < 0) {
          return this.sendError(res, `El total del día ${day.dayNumber} debe ser un número positivo`, 400);
        }

        const calculatedDayTotal = day.subconcepts.reduce((sum, sub) => sum + (parseFloat(sub.total) || 0), 0);

        const dayTotalRounded = Math.round(day.dayTotal * 100) / 100;
        const expectedRounded = Math.round(calculatedDayTotal * 100) / 100;

        if (Math.abs(dayTotalRounded - expectedRounded) > 0.01) {
          return this.sendError(
            res,
            `El total del día ${day.dayNumber} ($${dayTotalRounded}) no coincide con la suma de subconceptos ($${expectedRounded})`,
            400
          );
        }
      }

      // Query quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Update serviceItems
      const serviceItems = {
        days,
        subtotal,
        iva,
        total,
      };

      quote.set('serviceItems', serviceItems);

      // Save with user context
      await quote.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      logger.info('Service items updated successfully', {
        quoteId: quote.id,
        folio: quote.get('folio'),
        daysCount: days.length,
        subtotal,
        iva,
        total,
        updatedBy: currentUser.id,
      });

      return this.sendSuccess(
        res,
        {
          id: quote.id,
          folio: quote.get('folio'),
          serviceItems,
        },
        'Servicios actualizados exitosamente',
        200
      );
    } catch (error) {
      logger.error('Error in QuoteController.updateServiceItems', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al actualizar los servicios',
        500
      );
    }
  }

  /**
   * Generate unique folio for quote
   * Format: QTE-YYYY-0001.
   * @returns {Promise<string>} Generated folio.
   * @example
   */
  async generateFolio() {
    try {
      // Get count of existing quotes
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const count = await query.count({ useMasterKey: true });

      // Generate folio with current year
      const year = new Date().getFullYear();
      const sequenceNumber = String(count + 1).padStart(4, '0');

      return `QTE-${year}-${sequenceNumber}`;
    } catch (error) {
      logger.error('Error generating folio', { error: error.message });
      // Fallback to timestamp-based folio
      return `QTE-${new Date().getFullYear()}-${Date.now()}`;
    }
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON response.
   * @example
   */
  sendSuccess(res, data, message, statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  /**
   * Get available services (transfers) for a quote filtered by its assigned rate.
   * GET /api/quotes/:id/available-services
   * Used by quote-services.ejs to populate transfer selector.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Response structure:
   * {
   *   success: true,
   *   data: [{
   *     value: "service123",
   *     label: "Aeropuerto Internacional → Hotel Rosewood",
   *     vehicleType: "Sprinter",
   *     vehicleTypeId: "vt456",
   *     price: 2500.00,
   *     note: "Recepción en sala VIP",
   *     isRoundTrip: false,
   *     serviceType: "Aeropuerto"
   *   }]
   * }
   */
  async getAvailableServicesForQuote(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        return this.sendError(res, 'El ID de la cotización es requerido', 400);
      }

      // Get quote
      const query = new Parse.Query('Quote');
      query.include('rate');
      query.equalTo('exists', true);

      const quote = await query.get(quoteId, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // Get quote's rate
      const rate = quote.get('rate');
      if (!rate) {
        return this.sendError(res, 'La cotización no tiene una tarifa asignada', 400);
      }

      await rate.fetch({ useMasterKey: true });

      // Get services filtered by this rate
      const servicesQuery = new Parse.Query('Service');
      servicesQuery.equalTo('rate', rate);
      servicesQuery.equalTo('active', true);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include('originPOI');
      servicesQuery.include('destinationPOI');
      servicesQuery.include('destinationPOI.serviceType');
      servicesQuery.include('vehicleType');
      servicesQuery.limit(1000); // Support large datasets

      const services = await servicesQuery.find({ useMasterKey: true });

      // Group services by route (origin → destination)
      const routeMap = new Map();

      // Use for...of to support async price calculations
      for (const service of services) {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');
        const serviceType = destinationPOI?.get('serviceType');

        const originId = originPOI ? originPOI.id : 'local';
        const destinationId = destinationPOI ? destinationPOI.id : '';
        const routeKey = `${originId}_${destinationId}`;

        const originName = originPOI ? originPOI.get('name') : 'Local';
        const destinationName = destinationPOI ? destinationPOI.get('name') : '';
        const isRoundTrip = service.get('isRoundTrip') || false;

        if (!routeMap.has(routeKey)) {
          routeMap.set(routeKey, {
            routeKey,
            originName,
            destinationName,
            originId,
            destinationId,
            serviceType: serviceType ? serviceType.get('name') : '',
            vehicles: [],
            hasRoundTrip: false, // Will be set to true if any vehicle is round trip
          });
        }

        // Update hasRoundTrip flag if this service is round trip
        const route = routeMap.get(routeKey);
        if (isRoundTrip) {
          route.hasRoundTrip = true;
        }

        // Get price breakdown with surcharge
        const basePrice = service.get('price') || 0;
        const priceBreakdown = await pricingHelper.getPriceBreakdown(basePrice);

        // Add vehicle type to this route with price breakdown
        route.vehicles.push({
          serviceId: service.id,
          vehicleType: vehicleType ? vehicleType.get('name') : '',
          vehicleTypeId: vehicleType ? vehicleType.id : null,
          capacity: vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4,
          basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
          price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
          surcharge: priceBreakdown.surcharge, // Surcharge amount
          surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
          note: service.get('note') || '',
          isRoundTrip,
        });
      }

      // Convert map to array and add labels with appropriate arrows
      const groupedRoutes = Array.from(routeMap.values()).map((route) => {
        const arrow = route.hasRoundTrip ? '<->' : '->';
        const label = route.originName === 'Local'
          ? route.destinationName
          : `${route.originName} ${arrow} ${route.destinationName}`;

        return {
          ...route,
          label,
        };
      });

      logger.info('Available services fetched and grouped for quote', {
        quoteId,
        rateId: rate.id,
        rateName: rate.get('name'),
        servicesCount: services.length,
        routesCount: groupedRoutes.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedRoutes,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableServicesForQuote', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los servicios disponibles', 500);
    }
  }

  /**
   * Get available services filtered by specific rate (not quote-level).
   * GET /api/quotes/services-by-rate/:rateId?numberOfPeople=X.
   *
   * Used when adding traslado subconcept - user selects rate first, then service.
   * Returns services grouped by route with vehicle types and pricing.
   * Filters vehicles by capacity if numberOfPeople query parameter is provided.
   * Includes trunk capacity for each vehicle type.
   * @param {object} req - Express request object.
   * @param {string} req.params.rateId - Rate ID to filter services.
   * @param {number} [req.query.numberOfPeople] - Optional number of people for capacity filtering.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/services-by-rate/ABC123?numberOfPeople=10
   * Response: { success: true, data: [{ routeKey, originName, destinationName, vehicles: [{ capacity: 14, trunkCapacity: 10, ... }] }] }
   */
  async getAvailableServicesByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params and optional quoteNumberOfPeople from query
      const { rateId } = req.params;
      const quoteNumberOfPeople = parseInt(req.query.numberOfPeople) || 0;

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get services filtered by this rate
      const servicesQuery = new Parse.Query('Service');
      servicesQuery.equalTo('rate', rate);
      servicesQuery.equalTo('active', true);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include('originPOI');
      servicesQuery.include('destinationPOI');
      servicesQuery.include('destinationPOI.serviceType');
      servicesQuery.include('vehicleType');
      servicesQuery.limit(1000); // Support large datasets

      const services = await servicesQuery.find({ useMasterKey: true });

      // 5. Group services by route (origin → destination)
      const routeMap = new Map();

      // Use for...of to support async price calculations
      for (const service of services) {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');
        const serviceType = destinationPOI?.get('serviceType');

        const originId = originPOI ? originPOI.id : 'local';
        const destinationId = destinationPOI ? destinationPOI.id : '';
        const routeKey = `${originId}_${destinationId}`;

        const originName = originPOI ? originPOI.get('name') : 'Local';
        const destinationName = destinationPOI ? destinationPOI.get('name') : '';
        const isRoundTrip = service.get('isRoundTrip') || false;

        if (!routeMap.has(routeKey)) {
          routeMap.set(routeKey, {
            routeKey,
            originName,
            destinationName,
            originId,
            destinationId,
            serviceType: serviceType ? serviceType.get('name') : '',
            vehicles: [],
            hasRoundTrip: false, // Will be set to true if any vehicle is round trip
          });
        }

        // Update hasRoundTrip flag if this service is round trip
        const route = routeMap.get(routeKey);
        if (isRoundTrip) {
          route.hasRoundTrip = true;
        }

        // Get vehicle capacity
        const vehicleCapacity = vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4;
        const trunkCapacity = vehicleType ? vehicleType.get('trunkCapacity') || 0 : 0;

        // Filter by capacity if quoteNumberOfPeople is provided
        // Only add vehicle if it meets capacity requirements
        if (!(quoteNumberOfPeople > 0 && vehicleCapacity < quoteNumberOfPeople)) {
          // Get price breakdown with surcharge
          const basePrice = service.get('price') || 0;
          const priceBreakdown = await pricingHelper.getPriceBreakdown(basePrice);

          // Add vehicle type to this route with price breakdown and capacity info
          route.vehicles.push({
            serviceId: service.id,
            vehicleType: vehicleType ? vehicleType.get('name') : '',
            vehicleTypeId: vehicleType ? vehicleType.id : null,
            capacity: vehicleCapacity,
            trunkCapacity,
            basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
            price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
            surcharge: priceBreakdown.surcharge, // Surcharge amount
            surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
            note: service.get('note') || '',
            isRoundTrip,
          });
        }
      }

      // 6. Convert map to array and add labels with appropriate arrows
      const groupedRoutes = Array.from(routeMap.values()).map((route) => {
        const arrow = route.hasRoundTrip ? '<->' : '->';
        const label = route.originName === 'Local'
          ? route.destinationName
          : `${route.originName} ${arrow} ${route.destinationName}`;

        return {
          ...route,
          label,
        };
      });

      logger.info('Available services fetched and grouped by rate', {
        rateId,
        rateName: rate.get('name'),
        servicesCount: services.length,
        routesCount: groupedRoutes.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedRoutes,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableServicesByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los servicios disponibles', 500);
    }
  }

  /**
   * Get available tours filtered by specific rate (not quote-level).
   * GET /api/quotes/tours-by-rate/:rateId.
   *
   * Used when adding tour subconcept - user selects rate first, then tour.
   * Returns tours grouped by destination with vehicle types and pricing.
   * @param {object} req - Express request object.
   * @param {string} req.params.rateId - Rate ID to filter tours.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/tours-by-rate/ABC123
   * Response: { success: true, data: [{ destinationKey, destinationName, vehicles: [...] }] }
   */
  async getAvailableToursByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params
      const { rateId } = req.params;
      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get tours filtered by this rate
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('destinationPOI');
      toursQuery.include('vehicleType');
      toursQuery.limit(1000); // Support large datasets

      const tours = await toursQuery.find({ useMasterKey: true });

      // 5. Group tours by destination POI
      const destinationMap = new Map();

      // Use for...of to support async price calculations
      for (const tour of tours) {
        const destinationPOI = tour.get('destinationPOI');
        const vehicleType = tour.get('vehicleType');

        const destinationId = destinationPOI ? destinationPOI.id : 'unknown';
        const destinationName = destinationPOI ? destinationPOI.get('name') : 'Sin destino';

        if (!destinationMap.has(destinationId)) {
          destinationMap.set(destinationId, {
            destinationKey: destinationId,
            destinationName,
            vehicles: [],
          });
        }

        // Get price breakdown with surcharge
        const basePrice = tour.get('price') || 0;
        const priceBreakdown = await pricingHelper.getPriceBreakdown(basePrice);

        // Get duration in minutes and convert to hours
        const durationMinutes = tour.get('time') || 0;
        const durationHours = Math.round((durationMinutes / 60) * 10) / 10; // Round to 1 decimal

        // Add vehicle type to this destination with price breakdown
        const destination = destinationMap.get(destinationId);
        destination.vehicles.push({
          tourId: tour.id,
          vehicleType: vehicleType ? vehicleType.get('name') : '',
          vehicleTypeId: vehicleType ? vehicleType.id : null,
          capacity: vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4,
          basePrice: priceBreakdown.basePrice, // Cash price (precio efectivo)
          price: priceBreakdown.totalPrice, // Price with surcharge (precio base - default display)
          surcharge: priceBreakdown.surcharge, // Surcharge amount
          surchargePercentage: priceBreakdown.surchargePercentage, // Current percentage
          durationMinutes, // Original duration in minutes
          durationHours, // Converted to hours for display
          minPassengers: tour.get('minPassengers') || null,
          maxPassengers: tour.get('maxPassengers') || null,
          note: tour.get('notes') || '',
        });
      }

      // 6. Convert map to array and add labels
      const groupedDestinations = Array.from(destinationMap.values()).map((destination) => ({
        ...destination,
        label: destination.destinationName, // For dropdown display
      }));

      logger.info('Available tours fetched and grouped by destination', {
        rateId,
        rateName: rate.get('name'),
        toursCount: tours.length,
        destinationsCount: groupedDestinations.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: groupedDestinations,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getAvailableToursByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener los tours disponibles', 500);
    }
  }

  /**
   * Get unique tour destinations for a specific rate (Step 2 of 3-step tour selection).
   * GET /api/quotes/tours/destinations-by-rate/:rateId.
   *
   * Returns list of unique destinations that have tours available for the specified rate.
   * This is the second step in the tour selection flow: Rate → Destination → Vehicle.
   * @param {object} req - Express request object with rateId in params.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * Response: {
   *   success: true,
   *   data: [
   *     { destinationId: 'abc123', destinationName: 'San Miguel de Allende' },
   *     { destinationId: 'def456', destinationName: 'Dolores Hidalgo' }
   *   ]
   * }
   */
  async getTourDestinationsByRate(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID from params
      const { rateId } = req.params;
      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Get all tours for this rate
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('destinationPOI');
      toursQuery.limit(1000);

      const tours = await toursQuery.find({ useMasterKey: true });

      // 5. Extract unique destinations
      const destinationMap = new Map();

      tours.forEach((tour) => {
        const destinationPOI = tour.get('destinationPOI');
        if (destinationPOI) {
          const destinationId = destinationPOI.id;
          const destinationName = destinationPOI.get('name');

          if (!destinationMap.has(destinationId)) {
            destinationMap.set(destinationId, {
              destinationId,
              destinationName,
            });
          }
        }
      });

      // 6. Convert map to array
      const uniqueDestinations = Array.from(destinationMap.values());

      logger.info('Tour destinations fetched for rate', {
        rateId,
        rateName: rate.get('name'),
        destinationsCount: uniqueDestinations.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: uniqueDestinations,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getTourDestinationsByRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener destinos de tours', 500);
    }
  }

  /**
   * Get available vehicles for a specific rate and destination (Step 3 of 3-step tour selection).
   * GET /api/quotes/tours/vehicles-by-rate-destination/:rateId/:destinationId?numberOfPeople=X.
   *
   * Returns list of vehicle types available for the specified rate + destination combination.
   * Each vehicle includes tour details (tourId, price, duration, capacity, trunk capacity).
   * Filters vehicles by capacity if numberOfPeople query parameter is provided.
   * This is the third step in the tour selection flow: Rate → Destination → Vehicle.
   * @param {object} req - Express request object with rateId and destinationId in params.
   * @param {number} [req.query.numberOfPeople] - Optional number of people for capacity filtering.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/quotes/tours/vehicles-by-rate-destination/ABC123/POI456?numberOfPeople=10
   * Response: {
   *   success: true,
   *   data: [
   *     {
   *       tourId: 'tour123',
   *       vehicleType: 'Sprinter',
   *       vehicleTypeId: 'veh456',
   *       capacity: 14,
   *       trunkCapacity: 10,
   *       basePrice: 925.72,
   *       price: 1065.58,
   *       surcharge: 139.86,
   *       surchargePercentage: 15.1,
   *       durationMinutes: 120,
   *       durationHours: 2.0
   *     }
   *   ]
   * }
   */
  async getTourVehiclesByRateAndDestination(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // 2. Get rate ID, destination ID from params, and optional numberOfPeople and dayDate from query
      const { rateId, destinationId } = req.params;
      const quoteNumberOfPeople = parseInt(req.query.numberOfPeople) || 0;
      // TODO: Implement day-of-week filtering if needed
      // const { dayDate } = req.query;

      if (!rateId || !destinationId) {
        return this.sendError(res, 'El ID de la tarifa y destino son requeridos', 400);
      }

      // 3. Fetch rate
      const rateQuery = new Parse.Query('Rate');
      const rate = await rateQuery.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      // 4. Fetch destination POI
      const poiQuery = new Parse.Query('POI');
      const destinationPOI = await poiQuery.get(destinationId, { useMasterKey: true });

      if (!destinationPOI) {
        return this.sendError(res, 'Destino no encontrado', 404);
      }

      // 5. Get tours filtered by rate AND destination
      const toursQuery = new Parse.Query('Tours');
      toursQuery.equalTo('rate', rate);
      toursQuery.equalTo('destinationPOI', destinationPOI);
      toursQuery.equalTo('active', true);
      toursQuery.equalTo('exists', true);
      toursQuery.include('vehicleType');
      toursQuery.limit(1000);

      const tours = await toursQuery.find({ useMasterKey: true });

      if (tours.length === 0) {
        return this.sendResponse(res, []);
      }

      // 6. Build vehicle list with pricing
      const vehicles = [];

      for (const tour of tours) {
        const vehicleType = tour.get('vehicleType');

        if (vehicleType) {
          // Get vehicle capacity
          const vehicleCapacity = vehicleType ? vehicleType.get('defaultCapacity') || 4 : 4;
          const trunkCapacity = vehicleType ? vehicleType.get('trunkCapacity') || 0 : 0;

          // Filter by capacity if quoteNumberOfPeople is provided
          // Only add vehicle if it meets capacity requirements
          if (!(quoteNumberOfPeople > 0 && vehicleCapacity < quoteNumberOfPeople)) {
            // Get price breakdown with surcharge
            const basePrice = tour.get('price') || 0;
            const priceBreakdown = await pricingHelper.getPriceBreakdown(basePrice);

            // Get duration in minutes and convert to hours
            const durationMinutes = tour.get('time') || 0;
            const durationHours = Math.round((durationMinutes / 60) * 10) / 10;

            vehicles.push({
              tourId: tour.id,
              vehicleType: vehicleType ? vehicleType.get('name') : '',
              vehicleTypeId: vehicleType ? vehicleType.id : null,
              capacity: vehicleCapacity,
              trunkCapacity,
              basePrice: priceBreakdown.basePrice,
              price: priceBreakdown.totalPrice,
              surcharge: priceBreakdown.surcharge,
              surchargePercentage: priceBreakdown.surchargePercentage,
              durationMinutes,
              durationHours,
              minPassengers: tour.get('minPassengers') || null,
              maxPassengers: tour.get('maxPassengers') || null,
              note: tour.get('notes') || '',
            });
          }
        }
      }

      logger.info('Tour vehicles fetched for rate and destination', {
        rateId,
        rateName: rate.get('name'),
        destinationId,
        destinationName: destinationPOI.get('name'),
        vehiclesCount: vehicles.length,
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        data: vehicles,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getTourVehiclesByRateAndDestination', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.rateId,
        destinationId: req.params.destinationId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener vehículos de tours', 500);
    }
  }

  /**
   * Generate share link for public quote viewing.
   * POST /api/quotes/:id/share-link.
   *
   * Generates a shareable public URL using the quote's folio.
   * No token generation needed - folio acts as the access key.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/quotes/A2tZ1JtzD4/share-link
   * Response: { success: true, data: { shareUrl: "http://localhost:1337/quotes/QTE-2025-0004" } }
   */
  async generateShareLink(req, res) {
    try {
      // 1. Verify authenticated user
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Usuario no autenticado', 401);
      }

      // 2. Get quote ID from params
      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'ID de cotización requerido', 400);
      }

      // 3. Fetch quote
      const query = new Parse.Query('Quote');
      query.equalTo('exists', true);
      const quote = await query.get(id, { useMasterKey: true });

      if (!quote) {
        return this.sendError(res, 'Cotización no encontrada', 404);
      }

      // 4. Verify quote is active
      const isActive = quote.get('active');
      if (!isActive) {
        return this.sendError(res, 'No se puede compartir una cotización inactiva', 400);
      }

      // 5. Get folio (required for public access)
      const folio = quote.get('folio');
      if (!folio) {
        return this.sendError(res, 'La cotización no tiene folio asignado', 500);
      }

      // 6. Generate share URL using folio
      const { protocol } = req; // http or https
      const host = req.get('host'); // localhost:1337 or domain
      const shareUrl = `${protocol}://${host}/quotes/${folio}`;

      // 7. Log share link generation for audit trail
      logger.info('Share link generated for quote', {
        quoteId: quote.id,
        folio,
        shareUrl,
        generatedBy: currentUser.id,
        timestamp: new Date().toISOString(),
      });

      // 8. Return share URL
      return res.json({
        success: true,
        data: {
          shareUrl,
          folio,
          quoteId: quote.id,
        },
      });
    } catch (error) {
      logger.error('Error in QuoteController.generateShareLink', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al generar enlace de compartir', 500);
    }
  }

  /**
   * Check if a user has access to view a specific quote.
   * Used for single quote access validation in getQuoteById.
   * @param {object} currentUser - Current authenticated user.
   * @param {object} quote - Parse Quote object.
   * @param {string} userRole - User role from middleware.
   * @returns {Promise<boolean>} True if user has access, false otherwise.
   * @example
   * const hasAccess = await this.checkQuoteAccess(currentUser, quote, userRole);
   */
  async checkQuoteAccess(currentUser, quote, userRole) {
    try {
      // Super admins and admins can access all quotes
      if (userRole === 'superadmin' || userRole === 'admin') {
        return true;
      }

      // For all other roles, check if they created the quote
      const createdBy = quote.get('createdBy');
      if (createdBy && createdBy.id === currentUser.id) {
        return true;
      }

      // Department managers can access quotes created by users in their department
      if (userRole === 'department_manager') {
        const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');
        if (!userDepartmentId || !createdBy) {
          return false;
        }

        // Check if the quote creator is in the same department
        try {
          const creatorQuery = new Parse.Query('AmexingUser');
          const creator = await creatorQuery.get(createdBy.id, { useMasterKey: true });

          if (creator) {
            const creatorDepartmentId = creator.departmentId || creator.get('departmentId');
            return creatorDepartmentId === userDepartmentId;
          }
        } catch (error) {
          logger.warn('Could not fetch quote creator for department check', {
            createdById: createdBy.id,
            error: error.message,
          });
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking quote access', {
        error: error.message,
        userId: currentUser.id,
        quoteId: quote.id,
        role: userRole,
      });
      return false;
    }
  }

  /**
   * Apply role-based filters to quote queries.
   * Ensures department managers only see quotes created by users in their department.
   * @param {Parse.Query} query - Parse query to apply filters to.
   * @param {object} currentUser - Current authenticated user.
   * @param {string} userRole - User role from middleware.
   * @returns {Promise<void>}
   * @example
   * // Apply filters to a quote query
   * await this.applyRoleBasedQuoteFilters(query, currentUser, userRole);
   */
  async applyRoleBasedQuoteFilters(query, currentUser, userRole) {
    try {
      logger.debug('Applying role-based quote filters', {
        userId: currentUser.id,
        role: userRole,
      });

      // Super admins and admins can see all quotes
      if (userRole === 'superadmin' || userRole === 'admin') {
        logger.debug('Admin/superadmin user - showing all quotes', { userRole });
        return; // No additional filters needed
      }

      // Department managers can only see quotes created by users in their department
      if (userRole === 'department_manager') {
        const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');

        if (!userDepartmentId) {
          logger.warn('Department manager missing departmentId, restricting to own quotes only', {
            userId: currentUser.id,
            role: userRole,
          });
          // If no department ID, only show quotes they created themselves
          query.equalTo('createdBy', {
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: currentUser.id,
          });
          return;
        }

        // Find all users in the same department
        const departmentUsersQuery = new Parse.Query('AmexingUser');
        departmentUsersQuery.equalTo('departmentId', userDepartmentId);
        departmentUsersQuery.equalTo('exists', true);
        departmentUsersQuery.equalTo('active', true);

        const departmentUsers = await departmentUsersQuery.find({ useMasterKey: true });

        if (departmentUsers.length === 0) {
          // No users in department, restrict to own quotes only
          query.equalTo('createdBy', {
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: currentUser.id,
          });
          return;
        }

        // Create array of user pointers for the department
        const departmentUserPointers = departmentUsers.map((user) => ({
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: user.id,
        }));

        // Filter quotes to only those created by users in this department
        query.containedIn('createdBy', departmentUserPointers);

        logger.info('Applied department filter to quotes query', {
          userId: currentUser.id,
          departmentId: userDepartmentId,
          departmentUsersCount: departmentUsers.length,
        });

        return;
      }

      // Clients can only see quotes created by users in their organization
      if (userRole === 'client') {
        const userClientId = currentUser.clientId || currentUser.get('clientId') || currentUser.id;

        // Find all users in the same client organization
        const clientUsersQuery = new Parse.Query('AmexingUser');
        clientUsersQuery.equalTo('clientId', userClientId);
        clientUsersQuery.equalTo('exists', true);
        clientUsersQuery.equalTo('active', true);

        const clientUsers = await clientUsersQuery.find({ useMasterKey: true });

        if (clientUsers.length === 0) {
          // No users in organization, restrict to own quotes only
          query.equalTo('createdBy', {
            __type: 'Pointer',
            className: 'AmexingUser',
            objectId: currentUser.id,
          });
          return;
        }

        const clientUserPointers = clientUsers.map((user) => ({
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: user.id,
        }));

        query.containedIn('createdBy', clientUserPointers);

        logger.info('Applied client filter to quotes query', {
          userId: currentUser.id,
          clientId: userClientId,
          clientUsersCount: clientUsers.length,
        });

        return;
      }

      // Employees, drivers, guests can only see their own quotes
      query.equalTo('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });

      logger.info('Applied user-only filter to quotes query', {
        userId: currentUser.id,
        role: userRole,
      });
    } catch (error) {
      logger.error('Error applying role-based quote filters', {
        error: error.message,
        userId: currentUser.id,
        role: userRole,
      });

      // On error, restrict to user's own quotes as fallback
      query.equalTo('createdBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: currentUser.id,
      });
    }
  }

  /**
   * Generate receipt for reserved quote.
   * POST /api/quotes/:id/generate-receipt.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async generateReceipt(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      // Get payment info parameters from request body (for admin role)
      const { includePaymentInfo, paymentInfoId } = req.body;

      const result = await this.quoteService.generateReceipt(
        currentUser,
        quoteId,
        req.userRole, // Pass userRole from JWT middleware
        includePaymentInfo, // Pass the flag from request
        paymentInfoId // Pass the specific payment info ID
      );

      // If PDF buffer is returned, send it as a downloadable file
      if (result.success && result.data.pdfBuffer) {
        const { pdfBuffer, filename } = result.data;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        return res.send(pdfBuffer);
      }

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.generateReceipt', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al generar el recibo',
        500
      );
    }
  }

  /**
   * Request invoice for reserved quote.
   * POST /api/quotes/:id/request-invoice.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async requestInvoice(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;

      const result = await this.quoteService.requestInvoice(
        currentUser,
        quoteId,
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.requestInvoice', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
      });

      // Check for specific business rule errors that should return 400
      const businessRuleErrors = [
        'There is already a pending invoice request for this quote',
        'Quote must be in scheduled status to request invoice',
        'Quote not found',
        'Unauthorized: Role',
      ];

      const isBusinessRuleError = businessRuleErrors.some((errorText) => error.message.includes(errorText));

      const statusCode = isBusinessRuleError ? 400 : 500;
      let errorMessage;
      if (isBusinessRuleError) {
        errorMessage = error.message;
      } else if (process.env.NODE_ENV === 'development') {
        errorMessage = `Error: ${error.message}`;
      } else {
        errorMessage = 'Error al solicitar la factura';
      }

      return this.sendError(res, errorMessage, statusCode);
    }
  }

  /**
   * Cancel reservation for reserved quote.
   * POST /api/quotes/:id/cancel-reservation.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async cancelReservation(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const quoteId = req.params.id;
      const { reason } = req.body;

      const result = await this.quoteService.cancelReservation(
        currentUser,
        quoteId,
        reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return res.json(result);
    } catch (error) {
      logger.error('Error in QuoteController.cancelReservation', {
        error: error.message,
        stack: error.stack,
        quoteId: req.params.id,
        userId: req.user?.id,
        reason: req.body?.reason,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al cancelar la reserva',
        500
      );
    }
  }

  /**
   * Get quotes with completed invoices and file information
   * GET /api/quotes/with-invoices
   * Filters quotes that have completed invoices with XML and PDF files available
   * Department managers can only access quotes from their department.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getQuotesWithInvoices(req, res) {
    console.log('🔍🔍🔍 getQuotesWithInvoices method START - FIRST LINE!');
    try {
      console.log('🔍 getQuotesWithInvoices method called!');
      console.log('User info:', {
        hasUser: !!req.user,
        userRole: req.userRole,
        userId: req.user?.objectId || req.user?.userId || req.user?.id,
      });

      logger.info('getQuotesWithInvoices called', {
        hasUser: !!req.user,
        userRole: req.userRole,
        userId: req.user?.objectId || req.user?.userId || req.user?.id,
        query: req.query,
      });

      const currentUser = req.user;
      if (!currentUser) {
        logger.warn('getQuotesWithInvoices: No user found');
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || 25, 100);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting (matches frontend columns order)
      const sortColumns = [
        'quote.folio', // 0
        'quote.client.fullName', // 1
        'quote.eventType', // 2
        'quote.numberOfPeople', // 3
        'invoiceNumber', // 4
        'processDate', // 5
        null, // 6 - Files (not sortable)
        null, // 7 - Downloads (not sortable)
      ];

      const sortBy = sortColumns[sortColumnIndex] || 'processDate';

      // Build base query for invoices with completed status and files
      const Invoice = Parse.Object.extend('Invoice');
      const query = new Parse.Query(Invoice);

      // Base conditions for all completed invoices
      query.equalTo('status', 'completed');
      query.equalTo('exists', true);

      // For now, let's get all completed invoices and filter for files later in code
      // This avoids compound query issues with Parse.Query.or()

      // Department manager filtering based on requestedBy field
      if (req.userRole === 'department_manager') {
        // Get the full AmexingUser record to access user information
        const userId = currentUser.objectId || currentUser.userId || currentUser.id;

        logger.info('Department manager filtering - user details', {
          userId,
          currentUser: {
            objectId: currentUser.objectId,
            userId: currentUser.userId,
            id: currentUser.id,
            username: currentUser.username,
            role: currentUser.role,
          },
        });

        try {
          const AmexingUser = Parse.Object.extend('AmexingUser');
          const fullUserQuery = new Parse.Query(AmexingUser);
          fullUserQuery.equalTo('objectId', userId);

          logger.info('Looking up AmexingUser with objectId', { userId });
          const fullUser = await fullUserQuery.first({ useMasterKey: true });

          if (!fullUser) {
            logger.warn('Department manager AmexingUser record not found', { userId });
            return res.status(400).json({
              success: false,
              error: 'User account not found. Please contact administrator.',
              code: 'USER_NOT_FOUND',
            });
          }

          logger.info('Found AmexingUser record', {
            id: fullUser.id,
            username: fullUser.get('username'),
            role: fullUser.get('role'),
            departmentId: fullUser.get('departmentId'),
          });

          // Filter by requestedBy field
          query.equalTo('requestedBy', fullUser);

          logger.info('Applied requestedBy filtering for department manager', {
            userId,
            username: fullUser.get('username'),
            departmentId: fullUser.get('departmentId'),
          });
        } catch (departmentError) {
          logger.error('Error fetching department manager user details', {
            error: departmentError.message,
            userId,
            stack: departmentError.stack,
          });

          return res.status(500).json({
            success: false,
            error: 'Error retrieving user information',
            code: 'USER_LOOKUP_ERROR',
          });
        }
      }

      // Include related data
      query.include(['quote', 'quote.client', 'requestedBy']);

      // Search functionality - temporarily disabled to fix main query issue
      // TODO: Re-implement search with proper compound query handling
      if (searchValue.trim()) {
        logger.info('Search functionality temporarily disabled during query refactoring', {
          searchValue,
          userRole: req.userRole,
        });
      }

      // Get total count for pagination (create separate count query)
      const totalQuery = new Parse.Query(Invoice);
      totalQuery.equalTo('status', 'completed');
      totalQuery.equalTo('exists', true);

      // Apply same role-based filtering for count query
      if (req.userRole === 'department_manager') {
        const userId = currentUser.objectId || currentUser.userId || currentUser.id;
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const fullUserQuery = new Parse.Query(AmexingUser);
        fullUserQuery.equalTo('objectId', userId);
        const fullUser = await fullUserQuery.first({ useMasterKey: true });

        if (fullUser) {
          totalQuery.equalTo('requestedBy', fullUser);
        }
      }

      const totalRecords = await totalQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortBy && sortBy !== 'null') {
        if (sortDirection === 'desc') {
          query.descending(sortBy);
        } else {
          query.ascending(sortBy);
        }
      } else {
        // Default sort by process date descending
        query.descending('processDate');
      }

      // Apply pagination
      query.skip(start);
      query.limit(length);

      // Execute query
      logger.info('Executing invoices query with filters', {
        userRole: req.userRole,
        searchValue,
        sortBy,
        sortDirection,
      });

      logger.info('About to execute invoice query...');
      const invoices = await query.find({ useMasterKey: true });
      logger.info('Invoice query executed successfully', { count: invoices.length });

      logger.info('Invoices found', {
        count: invoices.length,
        firstInvoiceId: invoices.length > 0 ? invoices[0].id : null,
      });

      // Transform invoices data to match expected format - only include invoices with files
      const invoicesData = [];

      for (const invoice of invoices) {
        try {
          // Check if invoice has at least one file (XML or PDF)
          const hasXmlFile = invoice.get('xmlFileS3Key') || invoice.get('xmlFileUrl');
          const hasPdfFile = invoice.get('pdfFileS3Key') || invoice.get('pdfFileUrl');

          if (hasXmlFile || hasPdfFile) {
            const quote = invoice.get('quote');

            // Build invoice data object
            const invoiceData = {
              objectId: quote ? quote.id : null,
              folio: quote ? quote.get('folio') : 'N/A',
              eventType: quote ? quote.get('eventType') : 'N/A',
              numberOfPeople: quote ? (quote.get('numberOfPeople') || 1) : 1,
              status: quote ? quote.get('status') : 'N/A',
              createdAt: quote ? quote.get('createdAt') : invoice.get('createdAt'),
              updatedAt: quote ? quote.get('updatedAt') : invoice.get('updatedAt'),
              client: null,
              invoice: {
                objectId: invoice.id,
                invoiceNumber: invoice.get('invoiceNumber'),
                processDate: invoice.get('processDate'),
                xmlFileS3Key: invoice.get('xmlFileS3Key'),
                xmlFileUrl: invoice.get('xmlFileUrl'),
                xmlStorageMethod: invoice.get('xmlStorageMethod'),
                pdfFileS3Key: invoice.get('pdfFileS3Key'),
                pdfFileUrl: invoice.get('pdfFileUrl'),
                pdfStorageMethod: invoice.get('pdfStorageMethod'),
              },
            };

            // Add client information if available
            const client = quote ? quote.get('client') : null;
            if (client) {
              invoiceData.client = {
                objectId: client.id,
                fullName: client.get('fullName') || `${client.get('firstName')} ${client.get('lastName')}`,
                companyName: client.get('companyName'),
                email: client.get('email'),
              };
            }

            invoicesData.push(invoiceData);
          }
        } catch (invoiceError) {
          logger.error('Error processing invoice data', {
            invoiceId: invoice.id,
            error: invoiceError.message,
            stack: invoiceError.stack,
          });
          // Error logged, skip to next invoice
        }
      }

      logger.info('Invoices with quotes retrieved successfully', {
        userId: currentUser.objectId || currentUser.userId || currentUser.id,
        userRole: req.userRole,
        totalRecords,
        filteredRecords: invoicesData.length,
        returnedRecords: invoicesData.length,
        searchValue,
      });

      return res.json({
        draw,
        recordsTotal: totalRecords,
        recordsFiltered: invoicesData.length,
        data: invoicesData,
      });
    } catch (error) {
      logger.error('Error in QuoteController.getQuotesWithInvoices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
        query: req.query,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al cargar las facturas',
        500
      );
    }
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON response.
   * @example
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }
}

module.exports = new QuoteController();
