/**
 * Department Model - Organizational Unit Management for Amexing Platform
 * Represents departments within client organizations for budget and team management.
 * Follows AI agent data lifecycle rules with active/exists pattern.
 *
 * Features:
 * - Budget allocation and tracking
 * - Team member management
 * - Manager assignment and delegation
 * - AI agent compliant lifecycle operations
 * - Comprehensive audit trails.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-22
 * @example
 * // Model method usage
 * const result = await department.require({ './BaseModel': 'example' });
 * // Returns: model operation result
 */

const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * Department class representing organizational units within client companies.
 * Implements BaseModel for consistent lifecycle management across the platform.
 */
class Department extends BaseModel {
  constructor() {
    super('Department');
  }

  /**
   * Creates a new Department instance with default lifecycle values.
   * Follows AI agent rules for data creation.
   * @param {object} departmentData - Department data object.
   * @returns {Department} - Operation result New Department instance.
   * @example
   * // Create model instance
   * const instance = Department.create(data);
   * const saved = await instance.save();
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static create(departmentData) {
    const department = new Department();

    // Core business fields
    department.set('name', departmentData.name);
    department.set('description', departmentData.description || '');
    department.set('managerId', departmentData.managerId || null);
    department.set('clientId', departmentData.clientId);

    // Budget and cost management
    department.set('budget', departmentData.budget || 0);
    department.set('costCenter', departmentData.costCenter || null);

    // Lifecycle fields are set by BaseModel constructor
    // active: true, exists: true are defaults

    // Audit fields - Handle both User objects and string IDs as Pointers
    if (departmentData.createdBy) {
      if (typeof departmentData.createdBy === 'string') {
        const AmexingUser = require('./AmexingUser');
        const createdByPointer = new AmexingUser();
        createdByPointer.id = departmentData.createdBy;
        department.set('createdBy', createdByPointer);
      } else {
        department.set('createdBy', departmentData.createdBy);
      }
    }
    if (departmentData.modifiedBy) {
      if (typeof departmentData.modifiedBy === 'string') {
        const AmexingUser = require('./AmexingUser');
        const modifiedByPointer = new AmexingUser();
        modifiedByPointer.id = departmentData.modifiedBy;
        department.set('modifiedBy', modifiedByPointer);
      } else {
        department.set('modifiedBy', departmentData.modifiedBy);
      }
    }

    return department;
  }

  /**
   * Get the department manager.
   * Uses AI agent compliant queries.
   * @returns {Promise<object | null>} - Department manager or null.
   * @example
   * // Model method usage
   * const result = await department.getManager({ departmentData: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getManager() {
    try {
      if (!this.get('managerId')) {
        return null;
      }

      const AmexingUser = require('./AmexingUser');
      const query = BaseModel.queryActive('AmexingUser');
      query.equalTo('objectId', this.get('managerId'));

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching department manager', {
        departmentId: this.id,
        managerId: this.get('managerId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all active employees in this department.
   * Uses AI agent compliant queries.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} - Array of department employees.
   * @example
   * // Model method usage
   * const result = await department.getEmployees({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getEmployees(options = {}) {
    try {
      const { includeManager = true, role = null, active = true } = options;

      const AmexingUser = require('./AmexingUser');
      let query;

      if (active) {
        query = BaseModel.queryActive('AmexingUser');
      } else {
        query = BaseModel.queryExisting('AmexingUser');
      }

      query.equalTo('departmentId', this.id);

      // Filter by role if specified
      if (role) {
        query.equalTo('role', role);
      } else {
        // Include both employees and department managers
        const allowedRoles = includeManager ? ['employee', 'department_manager'] : ['employee'];
        query.containedIn('role', allowedRoles);
      }

      query.addOrder('lastName', 'ascending');
      query.addOrder('firstName', 'ascending');

      return await query.find({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching department employees', {
        departmentId: this.id,
        options,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get the parent client for this department.
   * Uses AI agent compliant queries.
   * @returns {Promise<object | null>} - Parent client or null.
   * @example
   * // Model method usage
   * const result = await department.getClient({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getClient() {
    try {
      if (!this.get('clientId')) {
        return null;
      }

      const Client = require('./Client');
      const query = BaseModel.queryActive('Client');
      query.equalTo('objectId', this.get('clientId'));

      return await query.first({ useMasterKey: true });
    } catch (error) {
      logger.error('Error fetching department client', {
        departmentId: this.id,
        clientId: this.get('clientId'),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get department statistics for dashboard display.
   * @returns {Promise<object>} - Department statistics object.
   * @example
   * // Model method usage
   * const result = await department.getStatistics({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getStatistics() {
    try {
      const [employeeCount, activeOrders, budgetUsed] = await Promise.all([
        this.getEmployeeCount(),
        this.getActiveOrderCount(),
        this.getBudgetUsed(),
      ]);

      const budget = this.get('budget') || 0;
      const budgetRemaining = budget - budgetUsed;
      const budgetUtilization = budget > 0 ? (budgetUsed / budget) * 100 : 0;

      return {
        employeeCount,
        activeOrderCount: activeOrders,
        budget,
        budgetUsed,
        budgetRemaining,
        budgetUtilization: Math.round(budgetUtilization * 100) / 100,
        isActive: this.get('active'),
        manager: await this.getManager(),
        createdAt: this.get('createdAt'),
        lastModified: this.get('updatedAt'),
      };
    } catch (error) {
      logger.error('Error fetching department statistics', {
        departmentId: this.id,
        error: error.message,
      });
      return {
        employeeCount: 0,
        activeOrderCount: 0,
        budget: this.get('budget') || 0,
        budgetUsed: 0,
        budgetRemaining: this.get('budget') || 0,
        budgetUtilization: 0,
        isActive: this.get('active'),
        manager: null,
        createdAt: this.get('createdAt'),
        lastModified: this.get('updatedAt'),
      };
    }
  }

  /**
   * Get count of active employees in this department.
   * @returns {Promise<number>} - Employee count.
   * @example
   * // Model method usage
   * const result = await department.getEmployeeCount({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getEmployeeCount() {
    try {
      const query = BaseModel.queryActive('AmexingUser');
      query.equalTo('departmentId', this.id);
      query.containedIn('role', ['employee', 'department_manager']);
      return await query.count({ useMasterKey: true });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get count of active orders for this department.
   * @returns {Promise<number>} - Active order count.
   * @example
   * // Model method usage
   * const result = await department.getActiveOrderCount({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getActiveOrderCount() {
    try {
      const query = BaseModel.queryActive('Order');
      query.equalTo('departmentId', this.id);
      query.containedIn('status', ['pending', 'confirmed', 'in_progress']);
      return await query.count({ useMasterKey: true });
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate total budget used by this department.
   * @returns {Promise<number>} - Budget used amount.
   * @example
   * // Model method usage
   * const result = await department.getBudgetUsed({ options: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async getBudgetUsed() {
    try {
      // This would typically aggregate from Order costs
      // For now, return 0 - implement based on Order model structure
      const query = BaseModel.queryActive('Order');
      query.equalTo('departmentId', this.id);
      query.select('cost');

      const orders = await query.find({ useMasterKey: true });
      return orders.reduce((total, order) => total + (order.get('cost') || 0), 0);
    } catch (error) {
      logger.error('Error calculating budget used', {
        departmentId: this.id,
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Assign a manager to this department.
   * @param {string} userId - User ID to assign as manager.
   * @param {string} assignedBy - User ID performing the assignment.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await department.assignManager({ userId: 'example' , assignedBy: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  async assignManager(userId, assignedBy) {
    try {
      // Validate that the user exists and has appropriate role
      const AmexingUser = require('./AmexingUser');
      const userQuery = BaseModel.queryActive('AmexingUser');
      userQuery.equalTo('objectId', userId);
      const user = await userQuery.first({ useMasterKey: true });

      if (!user) {
        throw new Error('User not found or not active');
      }

      // Check if user can be a department manager
      const allowedRoles = ['department_manager', 'admin', 'client'];
      if (!allowedRoles.includes(user.get('role'))) {
        throw new Error('User role not eligible for department management');
      }

      // Update user role to department_manager if they're an employee
      if (user.get('role') === 'employee') {
        user.set('role', 'department_manager');
        user.set('modifiedBy', assignedBy);
        await user.save(null, { useMasterKey: true });
      }

      // Assign user as department manager
      this.set('managerId', userId);
      this.set('modifiedBy', assignedBy);
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('Department manager assigned', {
        departmentId: this.id,
        managerId: userId,
        assignedBy,
        managerEmail: user.get('email'),
      });

      return true;
    } catch (error) {
      logger.error('Error assigning department manager', {
        departmentId: this.id,
        userId,
        assignedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Remove the current manager from this department.
   * @param {string} removedBy - User ID performing the removal.
   * @param {boolean} demoteUser - Whether to demote user back to employee.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await department.removeManager({ removedBy: 'example', demoteUser: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async removeManager(removedBy, demoteUser = false) {
    try {
      const currentManagerId = this.get('managerId');

      if (!currentManagerId) {
        return true; // No manager to remove
      }

      if (demoteUser) {
        // Demote current manager to employee if requested
        const AmexingUser = require('./AmexingUser');
        const userQuery = BaseModel.queryActive('AmexingUser');
        userQuery.equalTo('objectId', currentManagerId);
        const user = await userQuery.first({ useMasterKey: true });

        if (user && user.get('role') === 'department_manager') {
          user.set('role', 'employee');
          user.set('modifiedBy', removedBy);
          await user.save(null, { useMasterKey: true });
        }
      }

      // Remove manager from department
      this.set('managerId', null);
      this.set('modifiedBy', removedBy);
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('Department manager removed', {
        departmentId: this.id,
        formerManagerId: currentManagerId,
        removedBy,
        demotedUser: demoteUser,
      });

      return true;
    } catch (error) {
      logger.error('Error removing department manager', {
        departmentId: this.id,
        removedBy,
        demoteUser,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update department budget allocation.
   * @param {number} newBudget - New budget amount.
   * @param {string} modifiedBy - User ID making the update.
   * @param {string} reason - Reason for budget change.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Update model
   * const updated = await department.update(data);
   * // Returns: updated instance
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async updateBudget(newBudget, modifiedBy, reason = '') {
    try {
      const oldBudget = this.get('budget') || 0;

      this.set('budget', newBudget);
      this.set('modifiedBy', modifiedBy);
      this.set('updatedAt', new Date());

      await this.save(null, { useMasterKey: true });

      logger.info('Department budget updated', {
        departmentId: this.id,
        oldBudget,
        newBudget,
        modifiedBy,
        reason,
      });

      return true;
    } catch (error) {
      logger.error('Error updating department budget', {
        departmentId: this.id,
        newBudget,
        modifiedBy,
        reason,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Add an employee to this department.
   * @param {string} userId - User ID to add to department.
   * @param {string} addedBy - User ID performing the addition.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await department.addEmployee({ userId: 'example' , addedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async addEmployee(userId, addedBy) {
    try {
      const AmexingUser = require('./AmexingUser');
      const userQuery = BaseModel.queryActive('AmexingUser');
      userQuery.equalTo('objectId', userId);
      const user = await userQuery.first({ useMasterKey: true });

      if (!user) {
        throw new Error('User not found or not active');
      }

      // Update user's department
      user.set('departmentId', this.id);
      user.set('modifiedBy', addedBy);
      await user.save(null, { useMasterKey: true });

      logger.info('Employee added to department', {
        departmentId: this.id,
        userId,
        addedBy,
        userEmail: user.get('email'),
      });

      return true;
    } catch (error) {
      logger.error('Error adding employee to department', {
        departmentId: this.id,
        userId,
        addedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Remove an employee from this department.
   * @param {string} userId - User ID to remove from department.
   * @param {string} removedBy - User ID performing the removal.
   * @returns {Promise<boolean>} - Success status.
   * @example
   * // Model method usage
   * const result = await department.removeEmployee({ userId: 'example' , removedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  async removeEmployee(userId, removedBy) {
    try {
      const AmexingUser = require('./AmexingUser');
      const userQuery = BaseModel.queryActive('AmexingUser');
      userQuery.equalTo('objectId', userId);
      const user = await userQuery.first({ useMasterKey: true });

      if (!user) {
        throw new Error('User not found or not active');
      }

      // Remove user from department
      user.unset('departmentId');
      user.set('modifiedBy', removedBy);
      await user.save(null, { useMasterKey: true });

      logger.info('Employee removed from department', {
        departmentId: this.id,
        userId,
        removedBy,
        userEmail: user.get('email'),
      });

      return true;
    } catch (error) {
      logger.error('Error removing employee from department', {
        departmentId: this.id,
        userId,
        removedBy,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get safe department data for API responses.
   * Excludes sensitive information.
   * @returns {object} - Operation result Safe department data.
   * @example
   * // Model method usage
   * const result = await department.toSafeJSON({ userId: 'example' , removedBy: 'example' });
   * // Returns: model operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   */
  toSafeJSON() {
    return {
      id: this.id,
      name: this.get('name'),
      description: this.get('description'),
      managerId: this.get('managerId'),
      clientId: this.get('clientId'),
      budget: this.get('budget'),
      costCenter: this.get('costCenter'),
      active: this.get('active'),
      exists: this.get('exists'),
      createdAt: this.get('createdAt'),
      updatedAt: this.get('updatedAt'),
      createdBy: this.get('createdBy'),
      modifiedBy: this.get('modifiedBy'),
    };
  }

  /**
   * Validate department data before save operations.
   * @param {object} departmentData - Data to validate.
   * @returns {Array} - Array of results Array of validation errors.
   * @example
   * // Model method usage
   * const result = await department.validate({ departmentData: 'example' });
   * // Returns: model operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   */
  static validate(departmentData) {
    const errors = [];

    // Required fields
    if (!departmentData.name || departmentData.name.trim() === '') {
      errors.push('Department name is required');
    }

    if (!departmentData.clientId || departmentData.clientId.trim() === '') {
      errors.push('Client ID is required');
    }

    // Budget validation
    if (departmentData.budget !== undefined && departmentData.budget !== null) {
      if (typeof departmentData.budget !== 'number' || departmentData.budget < 0) {
        errors.push('Budget must be a non-negative number');
      }
    }

    // Name length validation
    if (departmentData.name && departmentData.name.length > 100) {
      errors.push('Department name must be 100 characters or less');
    }

    // Description length validation
    if (departmentData.description && departmentData.description.length > 500) {
      errors.push('Description must be 500 characters or less');
    }

    return errors;
  }
}

// Register the class with Parse
if (typeof Parse !== 'undefined') {
  Parse.Object.registerSubclass('Department', Department);
}

module.exports = Department;
