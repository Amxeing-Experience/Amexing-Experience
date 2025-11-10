/**
 * RateService - Business logic for Rate (Pricing) Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for Rate operations including
 * toggle status, validation, and comprehensive audit logging.
 *
 * Features:
 * - Role-based access control
 * - Data lifecycle management (active/exists pattern)
 * - Comprehensive audit logging
 * - Input validation and sanitization
 * - Error handling with detailed logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const service = new RateService();
 * const result = await service.toggleRateStatus(currentUser, rateId, false, 'Deactivating unused rate');
 * // Returns: { success: true, rate: {...}, previousStatus: true, newStatus: false }
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * RateService class implementing Rate business logic.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages Rate operations only
 * - Open/Closed: Extensible through role-specific strategies
 * - Liskov Substitution: Can be substituted with specialized implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel and domain abstractions.
 */
class RateService {
  constructor() {
    this.className = 'Rate';
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      employee_amexing: 3,
    };
  }

  /**
   * Toggle Rate active status (activate or deactivate).
   *
   * This method handles the complete lifecycle of toggling a Rate's
   * active status, including permissions validation, state management,
   * and comprehensive audit logging.
   *
   * Business Rules:
   * - Only SuperAdmin, Admin, and employee_amexing with permissions can toggle
   * - Sets active field to targetStatus
   * - Maintains exists: true (toggle does not soft delete)
   * - Updates updatedAt timestamp
   * - Logs activity for audit trail.
   * @param {object} currentUser - User performing the action (Parse User object).
   * @param {string} rateId - Rate ID to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change (for audit logging).
   * @param userRole
   * @returns {Promise<object>} Result with success status and Rate data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.toggleRateStatus(
   *   currentUser,
   *   'abc123',
   *   false,
   *   'Rate no longer in use'
   * );
   * // Returns: {
   * //   success: true,
   * //   rate: { id, name, percentage, active, ... },
   * //   previousStatus: true,
   * //   newStatus: false
   * // }
   */
  async toggleRateStatus(currentUser, rateId, targetStatus, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot toggle Rate status`);
      }

      // Validate Rate ID
      if (!rateId) {
        throw new Error('Rate ID is required');
      }

      // Validate target status
      if (typeof targetStatus !== 'boolean') {
        throw new Error('Target status must be a boolean value');
      }

      // Fetch Rate
      const query = new Parse.Query('Rate');
      query.equalTo('exists', true);
      const rate = await query.get(rateId, { useMasterKey: true });

      if (!rate) {
        throw new Error('Rate not found');
      }

      // Get current status
      const previousStatus = rate.get('active');

      // Check if already in target status
      if (previousStatus === targetStatus) {
        logger.info('Rate already in target status', {
          rateId,
          currentStatus: previousStatus,
          targetStatus,
          userId: currentUser.id,
        });

        return {
          success: true,
          rate: this.transformRateToSafeFormat(rate),
          previousStatus,
          newStatus: targetStatus,
          message: 'Rate already in target status',
        };
      }

      // Update status
      rate.set('active', targetStatus);
      await rate.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Rate status toggled successfully', {
        rateId: rate.id,
        rateName: rate.get('name'),
        ratePercentage: rate.get('percentage'),
        previousStatus,
        newStatus: targetStatus,
        reason,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        rate: this.transformRateToSafeFormat(rate),
        previousStatus,
        newStatus: targetStatus,
      };
    } catch (error) {
      logger.error('Error toggling Rate status', {
        rateId,
        targetStatus,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Soft delete Rate (set exists = false).
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can delete
   * - Sets exists: false (maintains record for audit trail)
   * - Sets active: false as well
   * - Cannot be undone through normal UI
   * - Logs deletion for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} rateId - Rate ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @param userRole
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or Rate cannot be deleted.
   * @example
   * // Usage example documented above
   */
  async softDeleteRate(currentUser, rateId, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions (only superadmin and admin)
      if (!['superadmin', 'admin'].includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot delete Rates`);
      }

      // Validate Rate ID
      if (!rateId) {
        throw new Error('Rate ID is required');
      }

      // Fetch Rate
      const query = new Parse.Query('Rate');
      query.equalTo('exists', true);
      const rate = await query.get(rateId, { useMasterKey: true });

      if (!rate) {
        throw new Error('Rate not found');
      }

      // TODO: Future implementation - check if any Booking references this Rate
      // For now, we allow deletion as the canDelete() method always returns true

      // Soft delete: set exists = false and active = false
      rate.set('exists', false);
      rate.set('active', false);
      await rate.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Rate soft deleted successfully', {
        rateId: rate.id,
        rateName: rate.get('name'),
        ratePercentage: rate.get('percentage'),
        reason,
        performedBy: {
          userId: currentUser.id,
          userRole: role,
          username: currentUser.get('username'),
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Rate deleted successfully',
      };
    } catch (error) {
      logger.error('Error soft deleting Rate', {
        rateId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Transform Rate object to safe format for API response.
   * Removes sensitive fields and formats data consistently.
   * @param {object} rate - Parse Rate object.
   * @returns {object} Safe Rate data for API response.
   * @example
   * // Usage example documented above
   */
  transformRateToSafeFormat(rate) {
    if (!rate) {
      return null;
    }

    const percentage = rate.get('percentage');

    return {
      id: rate.id,
      name: rate.get('name'),
      percentage,
      formattedPercentage: percentage !== undefined && percentage !== null ? `${percentage}%` : '-',
      color: rate.get('color') || '#6366F1',
      active: rate.get('active'),
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }
}

module.exports = RateService;
