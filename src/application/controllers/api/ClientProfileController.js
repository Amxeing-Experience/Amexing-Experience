/**
 * ClientProfileController - RESTful API for a Client's profile sub-resources:
 * addresses (ClientAddress), travel preferences (TravelPreference), and loyalty
 * programs (the Client.loyaltyPrograms array of { type, number }).
 *
 * Mirrors ClientEmployeesController conventions: nested under /api/clients/:clientId,
 * useMasterKey writes, sendSuccess/sendError responses, audit logging. Restricted to
 * SuperAdmin/Admin via the route's validateClientAccess middleware.
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const ClientAddress = require('../../../domain/models/ClientAddress');
const TravelPreference = require('../../../domain/models/TravelPreference');
const ClientPassport = require('../../../domain/models/ClientPassport');

class ClientProfileController {
  constructor() {
    this.getAddresses = this.getAddresses.bind(this);
    this.createAddress = this.createAddress.bind(this);
    this.updateAddress = this.updateAddress.bind(this);
    this.deleteAddress = this.deleteAddress.bind(this);
    this.getTravelPreferences = this.getTravelPreferences.bind(this);
    this.createTravelPreference = this.createTravelPreference.bind(this);
    this.updateTravelPreference = this.updateTravelPreference.bind(this);
    this.deleteTravelPreference = this.deleteTravelPreference.bind(this);
    this.getLoyaltyPrograms = this.getLoyaltyPrograms.bind(this);
    this.saveLoyaltyPrograms = this.saveLoyaltyPrograms.bind(this);
    this.getPassports = this.getPassports.bind(this);
    this.createPassport = this.createPassport.bind(this);
    this.updatePassport = this.updatePassport.bind(this);
    this.deletePassport = this.deletePassport.bind(this);
    this.revealPassportNumber = this.revealPassportNumber.bind(this);
    this.getTrips = this.getTrips.bind(this);
  }

  // ---------- helpers ----------

  async validateClientExists(clientId) {
    const query = new Parse.Query('Client');
    query.equalTo('exists', true);
    const client = await query.get(clientId, { useMasterKey: true });
    if (!client) throw new Error('Client not found');
    return client;
  }

  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true, data, message, timestamp: new Date().toISOString(),
    });
  }

  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false, error: message, timestamp: new Date().toISOString(),
    });
  }

  // Find a sub-record and confirm it belongs to the client in the path.
  async findOwnedRecord(className, recordId, clientId) {
    const record = await new Parse.Query(className).get(recordId, { useMasterKey: true });
    const owner = record.get('client');
    if (!owner || owner.id !== clientId) {
      const err = new Error('Record does not belong to specified client');
      err.status = 403;
      throw err;
    }
    return record;
  }

  // ---------- addresses ----------

  async getAddresses(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);
      const addresses = await ClientAddress.getByClient(clientId);
      this.sendSuccess(res, { addresses: addresses.map((a) => a.toJSON()) }, 'Addresses retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getAddresses', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, 'Failed to retrieve addresses', error.status || 500);
    }
  }

  async createAddress(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);

      const data = { ...req.body, client: clientId };
      const errors = ClientAddress.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const address = ClientAddress.create(data);
      if (data.isFavorite) await this.clearFavoriteAddress(clientId);
      await address.save(null, { useMasterKey: true });

      logger.info('Client address created', { clientId, addressId: address.id, userId: req.user?.id });
      this.sendSuccess(res, { address: address.toJSON() }, 'Dirección creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createAddress', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updateAddress(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const address = await this.findOwnedRecord('ClientAddress', id, clientId);

      const fields = ['label', 'street', 'city', 'state', 'zipCode', 'country'];
      fields.forEach((f) => { if (req.body[f] !== undefined) address.set(f, req.body[f]); });
      if (req.body.isFavorite === true) {
        await this.clearFavoriteAddress(clientId);
        address.set('isFavorite', true);
      } else if (req.body.isFavorite === false) {
        address.set('isFavorite', false);
      }
      await address.save(null, { useMasterKey: true });

      this.sendSuccess(res, { address: address.toJSON() }, 'Dirección actualizada');
    } catch (error) {
      logger.error('Error in ClientProfileController.updateAddress', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async deleteAddress(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const address = await this.findOwnedRecord('ClientAddress', id, clientId);
      await address.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id }, 'Dirección eliminada');
    } catch (error) {
      logger.error('Error in ClientProfileController.deleteAddress', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Only one favorite per client: clear the flag on the others before setting a new one.
  async clearFavoriteAddress(clientId) {
    const current = await ClientAddress.getByClient(clientId);
    const favorites = current.filter((a) => a.isFavorite());
    if (favorites.length) {
      favorites.forEach((a) => a.set('isFavorite', false));
      await Parse.Object.saveAll(favorites, { useMasterKey: true });
    }
  }

  // ---------- travel preferences ----------

  async getTravelPreferences(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);
      const prefs = await TravelPreference.getByClient(clientId);
      this.sendSuccess(res, { preferences: prefs.map((p) => p.toJSON()) }, 'Preferences retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getTravelPreferences', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, 'Failed to retrieve preferences', error.status || 500);
    }
  }

  async createTravelPreference(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);

      const data = { ...req.body, client: clientId };
      const errors = TravelPreference.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const pref = TravelPreference.create(data);
      await pref.save(null, { useMasterKey: true });
      this.sendSuccess(res, { preference: pref.toJSON() }, 'Preferencia creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createTravelPreference', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updateTravelPreference(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const pref = await this.findOwnedRecord('TravelPreference', id, clientId);

      ['type', 'option'].forEach((f) => { if (req.body[f] !== undefined) pref.set(f, req.body[f]); });
      await pref.save(null, { useMasterKey: true });
      this.sendSuccess(res, { preference: pref.toJSON() }, 'Preferencia actualizada');
    } catch (error) {
      logger.error('Error in ClientProfileController.updateTravelPreference', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async deleteTravelPreference(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const pref = await this.findOwnedRecord('TravelPreference', id, clientId);
      await pref.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id }, 'Preferencia eliminada');
    } catch (error) {
      logger.error('Error in ClientProfileController.deleteTravelPreference', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- loyalty programs (Client.loyaltyPrograms array of { type, number }) ----------

  async getLoyaltyPrograms(req, res) {
    try {
      const { clientId } = req.params;
      const client = await this.validateClientExists(clientId);
      this.sendSuccess(res, { loyaltyPrograms: client.get('loyaltyPrograms') || [] }, 'Loyalty programs retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getLoyaltyPrograms', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, 'Failed to retrieve loyalty programs', error.status || 500);
    }
  }

  // Replaces the whole list (the UI sends the full set after an inline edit/add/delete).
  async saveLoyaltyPrograms(req, res) {
    try {
      const { clientId } = req.params;
      const client = await this.validateClientExists(clientId);

      const programs = Array.isArray(req.body.loyaltyPrograms) ? req.body.loyaltyPrograms : [];
      const clean = programs
        .filter((p) => p && typeof p.type === 'string' && p.type.trim())
        .map((p) => ({ type: p.type.trim(), number: (p.number || '').toString().trim() }));

      client.set('loyaltyPrograms', clean);
      await client.save(null, { useMasterKey: true });
      this.sendSuccess(res, { loyaltyPrograms: clean }, 'Programas de lealtad guardados');
    } catch (error) {
      logger.error('Error in ClientProfileController.saveLoyaltyPrograms', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- passports (ClientPassport; number encrypted, returned masked) ----------

  async getPassports(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);
      const passports = await ClientPassport.getByClient(clientId);
      // toSafeJSON is async (decrypts to mask); never returns the raw/encrypted number.
      const data = await Promise.all(passports.map((p) => p.toSafeJSON()));
      this.sendSuccess(res, { passports: data }, 'Passports retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getPassports', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, 'Failed to retrieve passports', error.status || 500);
    }
  }

  async createPassport(req, res) {
    try {
      const { clientId } = req.params;
      await this.validateClientExists(clientId);

      const data = { ...req.body, client: clientId };
      const errors = ClientPassport.validate(data);
      if (errors.length) return this.sendError(res, errors.join(', '), 400);

      const passport = ClientPassport.create(data);
      if (req.body.number) await passport.setNumber(req.body.number);
      await passport.save(null, { useMasterKey: true });

      logger.info('Client passport created', { clientId, passportId: passport.id, userId: req.user?.id });
      this.sendSuccess(res, { passport: await passport.toSafeJSON() }, 'Pasaporte creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in ClientProfileController.createPassport', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async updatePassport(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const passport = await this.findOwnedRecord('ClientPassport', id, clientId);

      const setters = {
        label: 'setLabel', countryOfIssue: 'setCountryOfIssue', nationality: 'setNationality',
        dateOfIssue: 'setDateOfIssue', expirationDate: 'setExpirationDate',
      };
      Object.entries(setters).forEach(([f, setter]) => { if (req.body[f] !== undefined) passport[setter](req.body[f]); });
      if (req.body.number !== undefined) await passport.setNumber(req.body.number);
      await passport.save(null, { useMasterKey: true });

      this.sendSuccess(res, { passport: await passport.toSafeJSON() }, 'Pasaporte actualizado');
    } catch (error) {
      logger.error('Error in ClientProfileController.updatePassport', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  async deletePassport(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const passport = await this.findOwnedRecord('ClientPassport', id, clientId);
      await passport.destroy({ useMasterKey: true });
      this.sendSuccess(res, { id }, 'Pasaporte eliminado');
    } catch (error) {
      logger.error('Error in ClientProfileController.deletePassport', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // Reveal the full number — authorized (admin/superadmin) + audited by the vault.
  async revealPassportNumber(req, res) {
    try {
      const { clientId, id } = req.params;
      await this.validateClientExists(clientId);
      const passport = await this.findOwnedRecord('ClientPassport', id, clientId);

      const user = { id: req.user?.id, role: req.userRole || req.user?.role };
      const number = await passport.getNumber({ user });
      if (number === null) return this.sendError(res, 'No autorizado para ver el número completo', 403);

      this.sendSuccess(res, { number }, 'Número revelado');
    } catch (error) {
      logger.error('Error in ClientProfileController.revealPassportNumber', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, error.message, error.status || 500);
    }
  }

  // ---------- trips (read-only: quotes/reservations linked to this client) ----------

  async getTrips(req, res) {
    try {
      const { clientId } = req.params;
      const client = await this.validateClientExists(clientId);

      // Direct clients link to quotes via Quote.companyClientPtr (see QuoteController).
      const query = new Parse.Query('Quote');
      query.equalTo('companyClientPtr', client);
      query.equalTo('exists', true);
      query.descending('createdAt');
      query.limit(100);
      const quotes = await query.find({ useMasterKey: true });

      const trips = quotes.map((q) => ({
        id: q.id,
        folio: q.get('folio') || '',
        eventType: q.get('eventType') || '',
        status: q.get('status') || '',
        startDate: q.get('startDate') || null,
        endDate: q.get('endDate') || null,
        createdAt: q.get('createdAt'),
      }));

      this.sendSuccess(res, { trips }, 'Trips retrieved successfully');
    } catch (error) {
      logger.error('Error in ClientProfileController.getTrips', { error: error.message, clientId: req.params.clientId });
      this.sendError(res, 'Failed to retrieve trips', error.status || 500);
    }
  }
}

module.exports = ClientProfileController;
