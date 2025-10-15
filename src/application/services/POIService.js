/**
 * POIService - Business logic for POI (Point of Interest) Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for POI operations including
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
 * @since 2025-10-14
 * @example
 * const service = new POIService();
 * const result = await service.togglePOIStatus(currentUser, poiId, false, 'Deactivating unused location');
 * // Returns: { success: true, poi: {...}, previousStatus: true, newStatus: false }
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * POIService class implementing POI business logic.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages POI operations only
 * - Open/Closed: Extensible through role-specific strategies
 * - Liskov Substitution: Can be substituted with specialized implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel and domain abstractions.
 */
class POIService {
  constructor() {
    this.className = 'POI';
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      employee_amexing: 3,
    };
  }

  /**
   * Toggle POI active status (activate or deactivate).
   *
   * This method handles the complete lifecycle of toggling a POI's
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
   * @param {string} poiId - POI ID to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change (for audit logging).
   * @param {string} userRole - User role (optional, will be fetched from user if not provided).
   * @returns {Promise<object>} Result with success status and POI data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.togglePOIStatus(
   *   currentUser,
   *   'abc123',
   *   false,
   *   'Location no longer in use'
   * );
   * // Returns: {
   * //   success: true,
   * //   poi: { id, name, active, ... },
   * //   previousStatus: true,
   * //   newStatus: false
   * // }
   */
  async togglePOIStatus(
    currentUser,
    poiId,
    targetStatus,
    reason = '',
    userRole = null
  ) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(
          `Unauthorized: Role '${role}' cannot toggle POI status`
        );
      }

      // Validate POI ID
      if (!poiId) {
        throw new Error('POI ID is required');
      }

      // Validate target status
      if (typeof targetStatus !== 'boolean') {
        throw new Error('Target status must be a boolean value');
      }

      // Fetch POI
      const query = new Parse.Query('POI');
      query.equalTo('exists', true);
      const poi = await query.get(poiId, { useMasterKey: true });

      if (!poi) {
        throw new Error('POI not found');
      }

      // Get current status
      const previousStatus = poi.get('active');

      // Check if already in target status
      if (previousStatus === targetStatus) {
        logger.info('POI already in target status', {
          poiId,
          currentStatus: previousStatus,
          targetStatus,
          userId: currentUser.id,
        });

        return {
          success: true,
          poi: this.transformPOIToSafeFormat(poi),
          previousStatus,
          newStatus: targetStatus,
          message: 'POI already in target status',
        };
      }

      // Update status
      poi.set('active', targetStatus);
      await poi.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('POI status toggled successfully', {
        poiId: poi.id,
        poiName: poi.get('name'),
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
        poi: this.transformPOIToSafeFormat(poi),
        previousStatus,
        newStatus: targetStatus,
      };
    } catch (error) {
      logger.error('Error toggling POI status', {
        poiId,
        targetStatus,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Soft delete POI (set exists = false).
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can delete
   * - Sets exists: false (maintains record for audit trail)
   * - Sets active: false as well
   * - Cannot be undone through normal UI
   * - Logs deletion for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} poiId - POI ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @param {string} userRole - User role (optional, will be fetched from user if not provided).
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or POI cannot be deleted.
   * @example
   */
  async softDeletePOI(currentUser, poiId, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions (only superadmin and admin)
      if (!['superadmin', 'admin'].includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot delete POIs`);
      }

      // Validate POI ID
      if (!poiId) {
        throw new Error('POI ID is required');
      }

      // Fetch POI
      const query = new Parse.Query('POI');
      query.equalTo('exists', true);
      const poi = await query.get(poiId, { useMasterKey: true });

      if (!poi) {
        throw new Error('POI not found');
      }

      // TODO: Future implementation - check if any Service references this POI
      // For now, we allow deletion as the canDelete() method always returns true

      // Soft delete: set exists = false and active = false
      poi.set('exists', false);
      poi.set('active', false);
      await poi.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('POI soft deleted successfully', {
        poiId: poi.id,
        poiName: poi.get('name'),
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
        message: 'POI deleted successfully',
      };
    } catch (error) {
      logger.error('Error soft deleting POI', {
        poiId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Transform POI object to safe format for API response.
   * Removes sensitive fields and formats data consistently.
   * @param {object} poi - Parse POI object.
   * @returns {object} Safe POI data for API response.
   * @example
   */
  transformPOIToSafeFormat(poi) {
    if (!poi) {
      return null;
    }

    return {
      id: poi.id,
      name: poi.get('name'),
      active: poi.get('active'),
      createdAt: poi.createdAt,
      updatedAt: poi.updatedAt,
    };
  }
}

module.exports = POIService;
