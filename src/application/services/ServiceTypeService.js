/**
 * ServiceTypeService - Business logic for Service Type Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for service type operations including
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
 * @since 2024-10-24
 * @example
 * const service = new ServiceTypeService();
 * const result = await service.toggleServiceTypeStatus(currentUser, typeId, false, 'Deactivating unused type');
 * // Returns: { success: true, serviceType: {...}, previousStatus: true, newStatus: false }
 */

const Parse = require('parse/node');
const ServiceType = require('../../domain/models/ServiceType');
const logger = require('../../infrastructure/logger');

/**
 * ServiceTypeService class implementing service type business logic.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages service type operations only
 * - Open/Closed: Extensible through role-specific strategies
 * - Liskov Substitution: Can be substituted with specialized implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel and domain abstractions.
 */
class ServiceTypeService {
  constructor() {
    this.className = 'ServiceType';
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      employee_amexing: 3,
    };

    // System-protected service types (cannot be modified or deleted)
    this.PROTECTED_TYPES = ['Aeropuerto', 'Punto a Punto', 'Local'];
  }

  /**
   * Check if a service type is system-protected.
   * @param {string} typeName - Name of the service type.
   * @returns {boolean} True if protected.
   * @private
   * @example
   */
  isProtectedType(typeName) {
    return this.PROTECTED_TYPES.includes(typeName);
  }

  /**
   * Toggle service type active status (activate or deactivate).
   *
   * This method handles the complete lifecycle of toggling a service type's
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
   * @param {string} typeId - Service type ID to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change (for audit logging).
   * @returns {Promise<object>} Result with success status and service type data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.toggleServiceTypeStatus(
   *   currentUser,
   *   'abc123',
   *   false,
   *   'Type no longer in use'
   * );
   * // Returns: {
   * //   success: true,
   * //   serviceType: { id, name, active, ... },
   * //   previousStatus: true,
   * //   newStatus: false
   * // }
   */
  async toggleServiceTypeStatus(currentUser, typeId, targetStatus, reason = 'Status change via API') {
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
          message: 'Service type ID is required',
        };
      }

      if (typeof targetStatus !== 'boolean') {
        return {
          success: false,
          message: 'Target status must be a boolean',
        };
      }

      // CRITICAL: Use Parse.Object.extend locally to avoid registered subclass issues
      // The registered ServiceType class (BaseModel subclass) has issues with set() + save()
      // Using a local Parse.Object.extend works as proven in tests
      const LocalServiceType = Parse.Object.extend('ServiceType');

      // Query for service type - try existing records first
      const query = new Parse.Query(LocalServiceType);
      query.equalTo('exists', true);

      let serviceType;
      try {
        serviceType = await query.get(typeId, { useMasterKey: true });
      } catch (error) {
        logger.warn('Service type not found in exists:true query, trying all records', {
          typeId,
          error: error.message,
        });

        // Try without exists filter as fallback
        const fallbackQuery = new Parse.Query(LocalServiceType);
        try {
          serviceType = await fallbackQuery.get(typeId, { useMasterKey: true });
        } catch (fallbackError) {
          return {
            success: false,
            message: 'Service type not found',
          };
        }
      }

      if (!serviceType) {
        return {
          success: false,
          message: 'Service type not found',
        };
      }

      // Check if type is system-protected
      const typeName = serviceType.get('name');
      if (this.isProtectedType(typeName)) {
        logger.warn('Attempted to modify protected service type', {
          typeId,
          typeName,
          userId: currentUser.id,
        });

        return {
          success: false,
          message: 'No se puede modificar este tipo de traslado. Es un tipo de sistema protegido.',
        };
      }

      // Validate permissions
      // Note: currentUser might be from req.user (Parse object) or have userRole attached
      const currentUserRole = currentUser.userRole || currentUser.role || currentUser.get?.('role') || 'guest';
      if (!this.allowedRoles.includes(currentUserRole)) {
        logger.warn('Unauthorized toggle attempt', {
          userId: currentUser.id,
          userRole: currentUserRole,
          typeId,
        });

        return {
          success: false,
          message: 'Insufficient permissions to change service type status',
        };
      }

      const previousStatus = serviceType.get('active');

      // FIX: Use unregistered Parse.Object.extend instead of the ServiceType subclass
      // The registered ServiceType class (with BaseModel) has issues with set() + save()
      // Using Parse.Object.extend directly works as proven in vehicle type service
      serviceType.set('active', targetStatus);
      serviceType.set('exists', true);
      await serviceType.save(null, { useMasterKey: true });

      // After save, serviceType is updated in place
      const updatedServiceType = serviceType;

      // Log activity for audit trail
      logger.info('Service type status toggled successfully', {
        typeId,
        name: updatedServiceType.get('name'),
        previousStatus,
        newStatus: updatedServiceType.get('active'),
        changedBy: currentUser.id,
        changedByRole: currentUserRole,
        reason,
        timestamp: new Date().toISOString(),
      });

      // Transform to safe response format using updated object
      const serviceTypeData = this.transformServiceTypeToSafeFormat(updatedServiceType);

      return {
        success: true,
        serviceType: serviceTypeData,
        previousStatus,
        newStatus: updatedServiceType.get('active'),
      };
    } catch (error) {
      logger.error('Error in ServiceTypeService.toggleServiceTypeStatus', {
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
   * Transform service type to safe format for API responses
   * Removes sensitive fields and formats data consistently.
   * @param {ServiceType} serviceType - Service type Parse object.
   * @returns {object} Safe service type data for API response.
   * @private
   * @example
   * // Usage example documented above
   */
  transformServiceTypeToSafeFormat(serviceType) {
    return {
      id: serviceType.id,
      objectId: serviceType.id,
      name: serviceType.get('name'),
      active: serviceType.get('active'),
      exists: serviceType.get('exists'),
      createdAt: serviceType.get('createdAt'),
      updatedAt: serviceType.get('updatedAt'),
    };
  }

  /**
   * Soft delete service type (set active: false, exists: false)
   * This makes the type invisible to normal queries while preserving data.
   * @param {object} currentUser - User performing the action.
   * @param {string} typeId - Service type ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.softDeleteServiceType(
   *   currentUser,
   *   'abc123',
   *   'Type deprecated and no longer used'
   * );
   */
  async softDeleteServiceType(currentUser, typeId, reason = 'Soft delete via API') {
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
          message: 'Service type ID is required',
        };
      }

      // CRITICAL: Use Parse.Object.extend locally to avoid registered subclass issues
      const LocalServiceType = Parse.Object.extend('ServiceType');

      // Query for service type
      const query = new Parse.Query(LocalServiceType);
      query.equalTo('exists', true);

      let serviceType;
      try {
        serviceType = await query.get(typeId, { useMasterKey: true });
      } catch (error) {
        return {
          success: false,
          message: 'Service type not found',
        };
      }

      // Check if type is system-protected
      const typeName = serviceType.get('name');
      if (this.isProtectedType(typeName)) {
        logger.warn('Attempted to delete protected service type', {
          typeId,
          typeName,
          userId: currentUser.id,
        });

        return {
          success: false,
          message: 'No se puede eliminar este tipo de traslado. Es un tipo de sistema protegido y es fundamental para el funcionamiento del sistema.',
        };
      }

      // Check if type can be deleted (no services using it)
      // For now, we'll skip the canDelete check since we don't have Service objects yet
      // TODO: Implement service count check when Service model is created
      // const canDeleteCheck = await serviceType.canDelete();
      // if (!canDeleteCheck.canDelete) {
      //   return {
      //     success: false,
      //     message: canDeleteCheck.reason,
      //   };
      // }

      // Validate permissions - only SuperAdmin and Admin can soft delete
      // Note: currentUser might be from req.user (Parse object) or have userRole attached
      const currentUserRole = currentUser.userRole || currentUser.role || currentUser.get?.('role') || 'guest';
      if (!['superadmin', 'admin'].includes(currentUserRole)) {
        return {
          success: false,
          message: 'Only SuperAdmin and Admin can delete service types',
        };
      }

      // Soft delete: set both active and exists to false
      serviceType.set('active', false);
      serviceType.set('exists', false);
      serviceType.set('updatedAt', new Date());

      await serviceType.save(null, { useMasterKey: true });

      logger.info('Service type soft deleted successfully', {
        typeId,
        name: serviceType.get('name'),
        deletedBy: currentUser.id,
        deletedByRole: currentUserRole,
        reason,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Service type deleted successfully',
        serviceType: this.transformServiceTypeToSafeFormat(serviceType),
      };
    } catch (error) {
      logger.error('Error in ServiceTypeService.softDeleteServiceType', {
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

module.exports = ServiceTypeService;
