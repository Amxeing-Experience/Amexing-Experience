/**
 * Client Model - Business Entity Management for Amexing Platform
 * Represents client companies and organizations in the transportation management system.
 * Follows AI agent data lifecycle rules with active/exists pattern.
 *
 * Features:
 * - Corporate OAuth domain management
 * - Employee auto-provisioning settings
 * - Department and budget management
 * - AI agent compliant lifecycle operations
 * - Comprehensive audit trails.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-22
 * @example
 * // Model method usage
 * const result = await client.require({ './BaseModel': 'example' });
 * // Returns: model operation result
 */

const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Client class representing business entities using the transportation services.
 * Implements BaseModel for consistent lifecycle management across the platform.
 */
class Client extends BaseModel {
  // Constructor removed - useless constructor that only calls super with no additional logic
  // Parse.Object.extend pattern handles this automatically

  /**
   * Creates a new Client instance with default lifecycle values.
   * Follows AI agent rules for data creation.
   * @param {object} clientData - Client data object.
   * @returns {Client} - Operation result New Client instance.
   * @example
   * // Create model instance
   * const instance = Client.create(data);
   * const saved = await instance.save();
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static create(clientData) {
    const client = new Client();

    // Core business fields
    client.set('name', clientData.name);
    client.set('email', clientData.email);
    client.set('phone', clientData.phone || null);
    client.set('contactPerson', clientData.contactPerson || null);
    client.set('companyType', clientData.companyType || 'corporate');
    client.set('taxId', clientData.taxId || null);
    client.set('website', clientData.website || null);
    client.set('notes', clientData.notes || '');

    // Address as embedded object
    client.set('address', {
      street: clientData.address?.street || '',
      city: clientData.address?.city || '',
      state: clientData.address?.state || '',
      zipCode: clientData.address?.zipCode || '',
      country: clientData.address?.country || '',
    });

    // OAuth and employee management settings
    client.set(
      'isCorporate',
      clientData.isCorporate !== undefined ? clientData.isCorporate : true
    );
    client.set('oauthDomain', clientData.oauthDomain || null);
    client.set(
      'autoProvisionEmployees',
      clientData.autoProvisionEmployees || false
    );
    client.set(
      'defaultEmployeeRole',
      clientData.defaultEmployeeRole || 'employee'
    );
    client.set(
      'employeeAccessLevel',
      clientData.employeeAccessLevel || 'basic'
    );

    // Lifecycle fields are set by BaseModel constructor
    // active: true, exists: true are defaults

    // Audit fields - Handle both User objects and string IDs as Pointers
    if (clientData.createdBy) {
      if (typeof clientData.createdBy === 'string') {
        const AmexingUser = require('./AmexingUser');
        const createdByPointer = new AmexingUser();
        createdByPointer.id = clientData.createdBy;
        client.set('createdBy', createdByPointer);
      } else {
        client.set('createdBy', clientData.createdBy);
      }
    }
    if (clientData.modifiedBy) {
      if (typeof clientData.modifiedBy === 'string') {
        const AmexingUser = require('./AmexingUser');
        const modifiedByPointer = new AmexingUser();
        modifiedByPointer.id = clientData.modifiedBy;
        client.set('modifiedBy', modifiedByPointer);
      } else {
        client.set('modifiedBy', clientData.modifiedBy);
      }
    }

    return client;
  }

  /**
   * Get all active departments for this client.
   * Uses AI agent compliant queries.
   * @returns {Promise<Array>} - Array of active departments.
   * @example
   * // Model method usage
   * const result = await client.getDepartments({ clientData: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getDepartments() {
    try {
      const Department = require('./Department');
      const query = BaseModel.queryActive('Department');
      query.equalTo('clientId', this.id);
      query.addOrder('name', 'ascending');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching client departments', {
        clientId: this.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all active employees for this client.
   * Uses AI agent compliant queries with role filtering.
   * @param {string} role - Optional role filter.
   * @returns {Promise<Array>} - Array of client employees.
   * @example
   * // Model method usage
   * const result = await client.getEmployees({ role: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getEmployees(role = null) {
    try {
      const AmexingUser = require('./AmexingUser');
      const query = BaseModel.queryActive('AmexingUser');
      query.equalTo('clientId', this.id);

      // Filter by role if specified
      if (role) {
        query.equalTo('role', role);
      } else {
        // Get employee roles only
        query.containedIn('role', ['employee', 'department_manager']);
      }

      query.addOrder('lastName', 'ascending');
      query.addOrder('firstName', 'ascending');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching client employees', {
        clientId: this.id,
        role,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get client statistics for dashboard display.
   * @returns {Promise<object>} - Client statistics object.
   * @example
   * // Model method usage
   * const result = await client.getStatistics({ role: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getStatistics() {
    try {
      const [departments, employees, activeOrders] = await Promise.all([
        this.getDepartmentCount(),
        this.getEmployeeCount(),
        this.getActiveOrderCount(),
      ]);

      return {
        departmentCount: departments,
        employeeCount: employees,
        activeOrderCount: activeOrders,
        isActive: this.get('active'),
        createdAt: this.get('createdAt'),
        lastModified: this.get('updatedAt'),
      };
    } catch (error) {
      logger.error('Error fetching client statistics', {
        clientId: this.id,
        error: error.message,
      });
      return {
        departmentCount: 0,
        employeeCount: 0,
        activeOrderCount: 0,
        isActive: this.get('active'),
        createdAt: this.get('createdAt'),
        lastModified: this.get('updatedAt'),
      };
    }
  }

  /**
   * Get count of active departments.
   * @returns {Promise<number>} - Department count.
   * @example
   * // Model method usage
   * const result = await client.getDepartmentCount({ role: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getDepartmentCount() {
    try {
      const query = BaseModel.queryActive('Department');
      query.equalTo('clientId', this.id);
      return await query.count({ useMasterKey: true });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get count of active employees.
   * @returns {Promise<number>} - Employee count.
   * @example
   * // Model method usage
   * const result = await client.getEmployeeCount({ role: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getEmployeeCount() {
    try {
      const query = BaseModel.queryActive('AmexingUser');
      query.equalTo('clientId', this.id);
      query.containedIn('role', ['employee', 'department_manager']);
      return await query.count({ useMasterKey: true });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get count of active orders.
   * @returns {Promise<number>} - Active order count.
   * @example
   * // Model method usage
   * const result = await client.getActiveOrderCount({ role: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getActiveOrderCount() {
    try {
      const query = BaseModel.queryActive('Order');
      query.equalTo('clientId', this.id);
      query.containedIn('status', ['pending', 'confirmed', 'in_progress']);
      return await query.count({ useMasterKey: true });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Create a new department for this client.
   * @param {object} departmentData - Department data.
   * @param {string} createdBy - User ID creating the department.
   * @returns {Promise<object>} - Created department.
   * @example
   * // Create model instance
   * const instance = Client.create(data);
   * const saved = await instance.save();
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async createDepartment(departmentData, createdBy) {
    try {
      const Department = require('./Department');
      const department = Department.create({
        ...departmentData,
        clientId: this.id,
        createdBy,
        modifiedBy: createdBy,
      });

      await department.save(null, { useMasterKey: true });

      logger.info('Department created for client', {
        clientId: this.id,
        departmentId: department.id,
        departmentName: departmentData.name,
        createdBy,
      });

      return department;
    } catch (error) {
      logger.error('Error creating department for client', {
        clientId: this.id,
        departmentData,
        createdBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Auto-provision an employee based on OAuth domain settings.
   * @param {object} userData - User data from OAuth.
   * @param {string} oauthProvider - OAuth provider name.
   * @returns {Promise<object>} - Created user or null if not allowed.
   * @example
   * // Model method usage
   * const result = await client.autoProvisionEmployee({ userData: 'example', oauthProvider: 'example' });
   * // Returns: model operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async autoProvisionEmployee(userData, oauthProvider) {
    try {
      // Check if auto-provisioning is enabled
      if (!this.get('autoProvisionEmployees')) {
        return null;
      }

      // Validate OAuth domain
      const oauthDomain = this.get('oauthDomain');
      if (
        oauthDomain
        && !userData.email.toLowerCase().endsWith(`@${oauthDomain.toLowerCase()}`)
      ) {
        return null;
      }

      const AmexingUser = require('./AmexingUser');

      // Check if user already exists
      const existingUserQuery = BaseModel.queryExisting('AmexingUser');
      existingUserQuery.equalTo('email', userData.email.toLowerCase());
      const existingUser = await existingUserQuery.first({
        useMasterKey: true,
      });

      if (existingUser) {
        // User exists, update OAuth information if needed
        if (!existingUser.get('active')) {
          // Reactivate if user was deactivated
          await existingUser.activate(this.id);
        }

        // Update OAuth accounts
        const oauthAccounts = existingUser.get('oauthAccounts') || [];
        const hasProvider = oauthAccounts.some(
          (account) => account.provider === oauthProvider
        );

        if (!hasProvider) {
          oauthAccounts.push({
            provider: oauthProvider,
            providerId: userData.providerId || userData.id,
            email: userData.email,
            connectedAt: new Date(),
          });

          existingUser.set('oauthAccounts', oauthAccounts);
          existingUser.set('primaryOAuthProvider', oauthProvider);
          existingUser.set('lastAuthMethod', 'oauth');
          // Set modifiedBy as Pointer to this Client
          const clientPointer = new Client();
          clientPointer.id = this.id;
          existingUser.set('modifiedBy', clientPointer);

          await existingUser.save(null, { useMasterKey: true });
        }

        return existingUser;
      }

      // Create new user with Pointer to this Client for audit fields
      const clientPointer = new Client();
      clientPointer.id = this.id;

      const newUser = AmexingUser.create({
        username: userData.email,
        email: userData.email,
        firstName: userData.firstName || userData.given_name || '',
        lastName: userData.lastName || userData.family_name || '',
        role: this.get('defaultEmployeeRole'),
        clientId: this.id,
        emailVerified: true, // OAuth emails are considered verified
        active: true,
        exists: true,
        oauthAccounts: [
          {
            provider: oauthProvider,
            providerId: userData.providerId || userData.id,
            email: userData.email,
            connectedAt: new Date(),
          },
        ],
        primaryOAuthProvider: oauthProvider,
        lastAuthMethod: 'oauth',
        createdBy: clientPointer,
        modifiedBy: clientPointer,
      });

      await newUser.save(null, { useMasterKey: true });

      logger.info('Employee auto-provisioned for client', {
        clientId: this.id,
        userId: newUser.id,
        email: userData.email,
        provider: oauthProvider,
        role: this.get('defaultEmployeeRole'),
      });

      return newUser;
    } catch (error) {
      logger.error('Error auto-provisioning employee', {
        clientId: this.id,
        userData: { ...userData, password: '[REDACTED]' },
        oauthProvider,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update client settings with validation.
   * @param {object} updates - Fields to update.
   * @param {string} modifiedBy - User ID making the update.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Update model
   * const updated = await client.update(data);
   * // Returns: updated instance
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   */
  async updateSettings(updates, modifiedBy) {
    try {
      const allowedFields = [
        'name',
        'email',
        'phone',
        'contactPerson',
        'companyType',
        'taxId',
        'website',
        'notes',
        'address',
        'isCorporate',
        'oauthDomain',
        'autoProvisionEmployees',
        'defaultEmployeeRole',
        'employeeAccessLevel',
        'active',
      ];

      // Apply only allowed updates
      Object.keys(updates).forEach((field) => {
        if (allowedFields.includes(field)) {
          this.set(field, updates[field]);
        }
      });

      // Update modification tracking - Handle both User objects and string IDs
      if (modifiedBy) {
        if (typeof modifiedBy === 'string') {
          const AmexingUser = require('./AmexingUser');
          const modifiedByPointer = new AmexingUser();
          modifiedByPointer.id = modifiedBy;
          this.set('modifiedBy', modifiedByPointer);
        } else {
          this.set('modifiedBy', modifiedBy);
        }
      }
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('Client settings updated', {
        clientId: this.id,
        modifiedBy,
        fieldsUpdated: Object.keys(updates).filter((field) => allowedFields.includes(field)),
      });

      return true;
    } catch (error) {
      logger.error('Error updating client settings', {
        clientId: this.id,
        updates,
        modifiedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get safe client data for API responses.
   * Excludes sensitive information.
   * @returns {object} - Operation result Safe client data.
   * @example
   * // Model method usage
   * const result = await client.toSafeJSON({ updates: 'example', modifiedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  toSafeJSON() {
    return {
      id: this.id,
      name: this.get('name'),
      email: this.get('email'),
      phone: this.get('phone'),
      contactPerson: this.get('contactPerson'),
      companyType: this.get('companyType'),
      website: this.get('website'),
      address: this.get('address'),
      isCorporate: this.get('isCorporate'),
      oauthDomain: this.get('oauthDomain'),
      autoProvisionEmployees: this.get('autoProvisionEmployees'),
      defaultEmployeeRole: this.get('defaultEmployeeRole'),
      employeeAccessLevel: this.get('employeeAccessLevel'),
      active: this.get('active'),
      exists: this.get('exists'),
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
      createdBy: this.get('createdBy'),
      modifiedBy: this.get('modifiedBy'),
    };
  }

  /**
   * Validate client data before save operations.
   * @param {object} clientData - Data to validate.
   * @returns {Array} - Array of results Array of validation errors.
   * @example
   * // Model method usage
   * const result = await client.validate({ clientData: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  static validate(clientData) {
    const errors = [];

    // Required fields
    if (!clientData.name || clientData.name.trim() === '') {
      errors.push('Client name is required');
    }

    if (!clientData.email || clientData.email.trim() === '') {
      errors.push('Client email is required');
    }

    // Email format validation
    if (clientData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientData.email)) {
        errors.push('Invalid email format');
      }
    }

    // OAuth domain validation
    if (clientData.oauthDomain) {
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(clientData.oauthDomain)) {
        errors.push('Invalid OAuth domain format');
      }
    }

    // Company type validation
    const allowedCompanyTypes = [
      'corporate',
      'government',
      'nonprofit',
      'individual',
    ];
    if (
      clientData.companyType
      && !allowedCompanyTypes.includes(clientData.companyType)
    ) {
      errors.push('Invalid company type');
    }

    // Employee role validation
    const allowedEmployeeRoles = ['employee', 'department_manager'];
    if (
      clientData.defaultEmployeeRole
      && !allowedEmployeeRoles.includes(clientData.defaultEmployeeRole)
    ) {
      errors.push('Invalid default employee role');
    }

    return errors;
  }
}

// Register the class with Parse
if (typeof Parse !== 'undefined') {
  Parse.Object.registerSubclass('Client', Client);
}

module.exports = Client;
