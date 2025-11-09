/**
 * VehicleTypeService - Business logic for Vehicle Type Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for vehicle type operations including
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
 * @since 2024-01-15
 * @example
 * const service = new VehicleTypeService();
 * const result = await service.toggleVehicleTypeStatus(currentUser, typeId, false, 'Deactivating outdated type');
 * // Returns: { success: true, vehicleType: {...}, previousStatus: true, newStatus: false }
 */

const Parse = require('parse/node');
const VehicleType = require('../../domain/models/VehicleType');
const logger = require('../../infrastructure/logger');

/**
 * VehicleTypeService class implementing vehicle type business logic.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages vehicle type operations only
 * - Open/Closed: Extensible through role-specific strategies
 * - Liskov Substitution: Can be substituted with specialized implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel and domain abstractions.
 */
class VehicleTypeService {
  constructor() {
    this.className = 'VehicleType';
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      employee_amexing: 3,
    };
  }

  /**
   * Toggle vehicle type active status (activate or deactivate).
   *
   * This method handles the complete lifecycle of toggling a vehicle type's
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
   * @param {string} typeId - Vehicle type ID to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change (for audit logging).
   * @returns {Promise<object>} Result with success status and vehicle type data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.toggleVehicleTypeStatus(
   *   currentUser,
   *   'abc123',
   *   false,
   *   'Type no longer in use'
   * );
   * // Returns: {
   * //   success: true,
   * //   vehicleType: { id, name, code, active, ... },
   * //   previousStatus: true,
   * //   newStatus: false
   * // }
   */
  async toggleVehicleTypeStatus(currentUser, typeId, targetStatus, reason = 'Status change via API') {
    try {
      // Validate inputs
      if (!currentUser || !currentUser.id) {
        return {
          success: false,
          message: 'Authentication required',
        };
      }

      if (!typeId) {
        return {
          success: false,
          message: 'Vehicle type ID is required',
        };
      }

      if (typeof targetStatus !== 'boolean') {
        return {
          success: false,
          message: 'Target status must be a boolean',
        };
      }

      // CRITICAL: Use Parse.Object.extend locally to avoid registered subclass issues
      // The registered VehicleType class (BaseModel subclass) has issues with set() + save()
      // Using a local Parse.Object.extend works as proven in tests
      const LocalVehicleType = Parse.Object.extend('VehicleType');

      // Query for vehicle type - try existing records first
      const query = new Parse.Query(LocalVehicleType);
      query.equalTo('exists', true);

      let vehicleType;
      try {
        vehicleType = await query.get(typeId, { useMasterKey: true });
      } catch (error) {
        logger.warn('Vehicle type not found in exists:true query, trying all records', {
          typeId,
          error: error.message,
        });

        // Try without exists filter as fallback
        const fallbackQuery = new Parse.Query(LocalVehicleType);
        try {
          vehicleType = await fallbackQuery.get(typeId, { useMasterKey: true });
        } catch (fallbackError) {
          return {
            success: false,
            message: 'Vehicle type not found',
          };
        }
      }

      if (!vehicleType) {
        return {
          success: false,
          message: 'Vehicle type not found',
        };
      }

      // Validate permissions
      const currentUserRole = currentUser.role || currentUser.get?.('role') || 'guest';
      if (!this.allowedRoles.includes(currentUserRole)) {
        logger.warn('Unauthorized toggle attempt', {
          userId: currentUser.id,
          userRole: currentUserRole,
          typeId,
        });

        return {
          success: false,
          message: 'Insufficient permissions to change vehicle type status',
        };
      }

      const previousStatus = vehicleType.get('active');

      // FIX: Use unregistered Parse.Object.extend instead of the VehicleType subclass
      // The registered VehicleType class (with BaseModel) has issues with set() + save()
      // Using Parse.Object.extend directly works as proven in deactivate-all script
      vehicleType.set('active', targetStatus);
      vehicleType.set('exists', true);
      await vehicleType.save(null, { useMasterKey: true });

      // After save, vehicleType is updated in place
      const updatedVehicleType = vehicleType;

      // Log activity for audit trail
      logger.info('Vehicle type status toggled successfully', {
        typeId,
        name: updatedVehicleType.get('name'),
        code: updatedVehicleType.get('code'),
        previousStatus,
        newStatus: updatedVehicleType.get('active'),
        changedBy: currentUser.id,
        changedByRole: currentUserRole,
        reason,
        timestamp: new Date().toISOString(),
      });

      // Transform to safe response format using updated object
      const vehicleTypeData = this.transformVehicleTypeToSafeFormat(updatedVehicleType);

      return {
        success: true,
        vehicleType: vehicleTypeData,
        previousStatus,
        newStatus: updatedVehicleType.get('active'),
      };
    } catch (error) {
      logger.error('Error in VehicleTypeService.toggleVehicleTypeStatus', {
        error: error.message,
        stack: error.stack,
        typeId,
        targetStatus,
        changedBy: currentUser?.id,
        reason,
      });
      throw error;
    }
  }

  /**
   * Transform vehicle type to safe format for API responses
   * Removes sensitive fields and formats data consistently.
   * @param {VehicleType} vehicleType - Vehicle type Parse object.
   * @returns {object} Safe vehicle type data for API response.
   * @private
   * @example
   * // Usage example documented above
   */
  transformVehicleTypeToSafeFormat(vehicleType) {
    return {
      id: vehicleType.id,
      objectId: vehicleType.id,
      name: vehicleType.get('name'),
      code: vehicleType.get('code'),
      description: vehicleType.get('description') || '',
      icon: vehicleType.get('icon') || 'car',
      defaultCapacity: vehicleType.get('defaultCapacity') || 4,
      sortOrder: vehicleType.get('sortOrder') || 0,
      active: vehicleType.get('active'),
      exists: vehicleType.get('exists'),
      createdAt: vehicleType.get('createdAt'),
      updatedAt: vehicleType.get('updatedAt'),
    };
  }

  /**
   * Soft delete vehicle type (set active: false, exists: false)
   * This makes the type invisible to normal queries while preserving data.
   * @param {object} currentUser - User performing the action.
   * @param {string} typeId - Vehicle type ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.softDeleteVehicleType(
   *   currentUser,
   *   'abc123',
   *   'Type deprecated and no longer used'
   * );
   */
  async softDeleteVehicleType(currentUser, typeId, reason = 'Soft delete via API') {
    try {
      // Validate inputs
      if (!currentUser || !currentUser.id) {
        return {
          success: false,
          message: 'Authentication required',
        };
      }

      if (!typeId) {
        return {
          success: false,
          message: 'Vehicle type ID is required',
        };
      }

      // Query for vehicle type
      const query = new Parse.Query('VehicleType');
      query.equalTo('exists', true);

      let vehicleType;
      try {
        vehicleType = await query.get(typeId, { useMasterKey: true });
      } catch (error) {
        return {
          success: false,
          message: 'Vehicle type not found',
        };
      }

      // Check if type can be deleted (no vehicles using it)
      const canDeleteCheck = await vehicleType.canDelete();
      if (!canDeleteCheck.canDelete) {
        return {
          success: false,
          message: canDeleteCheck.reason,
        };
      }

      // Validate permissions - only SuperAdmin and Admin can soft delete
      const currentUserRole = currentUser.role || currentUser.get?.('role') || 'guest';
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return {
          success: false,
          message: 'Only SuperAdmin and Admin can delete vehicle types',
        };
      }

      // Soft delete: set both active and exists to false
      vehicleType.set('active', false);
      vehicleType.set('exists', false);
      vehicleType.set('updatedAt', new Date());

      await vehicleType.save(null, { useMasterKey: true });

      logger.info('Vehicle type soft deleted successfully', {
        typeId,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        deletedBy: currentUser.id,
        deletedByRole: currentUserRole,
        reason,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Vehicle type deleted successfully',
        vehicleType: this.transformVehicleTypeToSafeFormat(vehicleType),
      };
    } catch (error) {
      logger.error('Error in VehicleTypeService.softDeleteVehicleType', {
        error: error.message,
        stack: error.stack,
        typeId,
        deletedBy: currentUser?.id,
        reason,
      });
      throw error;
    }
  }
}

module.exports = VehicleTypeService;
