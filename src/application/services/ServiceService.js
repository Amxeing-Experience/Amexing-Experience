/**
 * ServiceService - Business logic for Service Management.
 *
 * Implements SOLID principles and follows consistent data lifecycle rules.
 * Provides centralized business logic for service operations including
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
 * const service = new ServiceService();
 * const result = await service.toggleServiceStatus(currentUser, serviceId, false, 'Deactivating route');
 * // Returns: { success: true, service: {...}, previousStatus: true, newStatus: false }
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * ServiceService class implementing Service business logic.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Manages Service operations only
 * - Open/Closed: Extensible through role-specific strategies
 * - Liskov Substitution: Can be substituted with specialized implementations
 * - Interface Segregation: Provides specific interfaces for different operations
 * - Dependency Inversion: Depends on BaseModel and domain abstractions.
 */
class ServiceService {
  constructor() {
    this.className = 'Service';
    this.allowedRoles = ['superadmin', 'admin', 'employee_amexing'];
    this.roleHierarchy = {
      superadmin: 7,
      admin: 6,
      employee_amexing: 3,
    };
  }

  /**
   * Toggle Service active status (activate or deactivate).
   *
   * This method handles the complete lifecycle of toggling a Service's
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
   * @param {string} serviceId - Service ID to toggle.
   * @param {boolean} targetStatus - Target active status (true/false).
   * @param {string} reason - Reason for status change (for audit logging).
   * @param userRole
   * @returns {Promise<object>} Result with success status and Service data.
   * @throws {Error} If validation fails or database operation fails.
   * @example
   * const result = await service.toggleServiceStatus(
   *   currentUser,
   *   'abc123',
   *   false,
   *   'Route no longer available'
   * );
   * // Returns: {
   * //   success: true,
   * //   service: { id, originPOI, destinationPOI, vehicleType, price, ... },
   * //   previousStatus: true,
   * //   newStatus: false
   * // }
   */
  async toggleServiceStatus(currentUser, serviceId, targetStatus, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions
      if (!this.allowedRoles.includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot toggle Service status`);
      }

      // Validate Service ID
      if (!serviceId) {
        throw new Error('Service ID is required');
      }

      // Validate target status
      if (typeof targetStatus !== 'boolean') {
        throw new Error('Target status must be a boolean value');
      }

      // Fetch Service
      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        throw new Error('Service not found');
      }

      // Get current status
      const previousStatus = service.get('active');

      // Check if already in target status
      if (previousStatus === targetStatus) {
        logger.info('Service already in target status', {
          serviceId,
          currentStatus: previousStatus,
          targetStatus,
          userId: currentUser.id,
        });

        return {
          success: true,
          service: this.transformServiceToSafeFormat(service),
          previousStatus,
          newStatus: targetStatus,
          message: 'Service already in target status',
        };
      }

      // Update status
      service.set('active', targetStatus);
      await service.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Service status toggled successfully', {
        serviceId: service.id,
        origin: service.get('originPOI')?.get('name'),
        destination: service.get('destinationPOI')?.get('name'),
        vehicleType: service.get('vehicleType')?.get('name'),
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
        service: this.transformServiceToSafeFormat(service),
        previousStatus,
        newStatus: targetStatus,
      };
    } catch (error) {
      logger.error('Error toggling Service status', {
        serviceId,
        targetStatus,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Soft delete Service (set exists = false).
   *
   * Business Rules:
   * - Only SuperAdmin and Admin can delete
   * - Sets exists: false (maintains record for audit trail)
   * - Sets active: false as well
   * - Cannot be undone through normal UI
   * - Logs deletion for audit trail.
   * @param {object} currentUser - User performing the action.
   * @param {string} serviceId - Service ID to delete.
   * @param {string} reason - Reason for deletion (for audit logging).
   * @param userRole
   * @returns {Promise<object>} Result with success status.
   * @throws {Error} If validation fails or Service cannot be deleted.
   * @example
   * // Usage example documented above
   */
  async softDeleteService(currentUser, serviceId, reason = '', userRole = null) {
    try {
      // Validate user authentication
      if (!currentUser) {
        throw new Error('User authentication required');
      }

      // Get user role - use provided role or fetch from user object
      const role = userRole || currentUser.get('role');

      // Validate user permissions (only superadmin and admin)
      if (!['superadmin', 'admin'].includes(role)) {
        throw new Error(`Unauthorized: Role '${role}' cannot delete Services`);
      }

      // Validate Service ID
      if (!serviceId) {
        throw new Error('Service ID is required');
      }

      // Fetch Service
      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        throw new Error('Service not found');
      }

      // TODO: Future implementation - check if any Booking references this Service
      // For now, we allow deletion as the canDelete() method always returns true

      // Soft delete: set exists = false and active = false
      service.set('exists', false);
      service.set('active', false);
      await service.save(null, { useMasterKey: true });

      // Audit logging
      logger.info('Service soft deleted successfully', {
        serviceId: service.id,
        origin: service.get('originPOI')?.get('name'),
        destination: service.get('destinationPOI')?.get('name'),
        vehicleType: service.get('vehicleType')?.get('name'),
        price: service.get('price'),
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
        message: 'Service deleted successfully',
      };
    } catch (error) {
      logger.error('Error soft deleting Service', {
        serviceId,
        error: error.message,
        stack: error.stack,
        userId: currentUser?.id,
      });

      throw error;
    }
  }

  /**
   * Transform Service object to safe format for API response.
   * Removes sensitive fields and formats data consistently.
   * @param {object} service - Parse Service object.
   * @returns {object} Safe Service data for API response.
   * @example
   * // Usage example documented above
   */
  transformServiceToSafeFormat(service) {
    if (!service) {
      return null;
    }

    const originPOI = service.get('originPOI');
    const destinationPOI = service.get('destinationPOI');
    const vehicleType = service.get('vehicleType');

    return {
      id: service.id,
      originPOI: originPOI
        ? {
          id: originPOI.id,
          name: originPOI.get('name'),
        }
        : null,
      destinationPOI: destinationPOI
        ? {
          id: destinationPOI.id,
          name: destinationPOI.get('name'),
        }
        : null,
      vehicleType: vehicleType
        ? {
          id: vehicleType.id,
          name: vehicleType.get('name'),
        }
        : null,
      note: service.get('note') || '',
      price: service.get('price'),
      active: service.get('active'),
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }
}

module.exports = ServiceService;
