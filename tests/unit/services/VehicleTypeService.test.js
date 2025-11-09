/**
 * VehicleTypeService Unit Tests
 * Tests for vehicle type business logic service
 */

// Mock dependencies BEFORE requiring the service
jest.mock('../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('parse/node', () => {
  const mockVehicleType = {
    id: 'test-type-123',
    get: jest.fn((field) => {
      const data = {
        name: 'Test Type',
        code: 'test_type',
        description: 'Test Description',
        icon: 'car',
        defaultCapacity: 4,
        sortOrder: 1,
        active: true,
        exists: true,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      };
      return data[field];
    }),
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(),
    canDelete: jest.fn().mockResolvedValue({ canDelete: true, reason: null }),
  };

  const mockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue(mockVehicleType),
  };

  return {
    Object: class MockParseObject {
      constructor() {
        this.className = '';
      }

      static extend(className) {
        return class extends MockParseObject {
          constructor() {
            super();
            this.className = className;
          }
        };
      }

      static registerSubclass() {}

      set() {}
      get() {}
      save() {
        return Promise.resolve(this);
      }
    },
    Query: jest.fn(() => mockQuery),
  };
});

const VehicleTypeService = require('../../../src/application/services/VehicleTypeService');
const logger = require('../../../src/infrastructure/logger');
const Parse = require('parse/node');

describe('VehicleTypeService', () => {
  let service;
  let mockCurrentUser;
  let mockVehicleType;

  beforeEach(() => {
    service = new VehicleTypeService();

    mockCurrentUser = {
      id: 'admin-user-123',
      role: 'admin',
      get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
    };

    // Create a data object that can be modified by set()
    const mockData = {
      name: 'Test Type',
      code: 'test_type',
      description: 'Test Description',
      icon: 'car',
      defaultCapacity: 4,
      sortOrder: 1,
      active: true,
      exists: true,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    };

    mockVehicleType = {
      id: 'test-type-123',
      get: jest.fn((field) => mockData[field]),
      set: jest.fn((field, value) => {
        mockData[field] = value;
      }),
      save: jest.fn().mockResolvedValue(),
      canDelete: jest.fn().mockResolvedValue({ canDelete: true, reason: null }),
    };

    // Reset mocks
    jest.clearAllMocks();

    // Setup Query mock to return mockVehicleType
    const mockQuery = {
      equalTo: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue(mockVehicleType),
    };
    Parse.Query.mockImplementation(() => mockQuery);
  });

  describe('toggleVehicleTypeStatus', () => {
    it('should toggle vehicle type status to inactive successfully', async () => {
      const result = await service.toggleVehicleTypeStatus(
        mockCurrentUser,
        'test-type-123',
        false,
        'Test deactivation'
      );

      expect(result.success).toBe(true);
      expect(result.vehicleType).toBeDefined();
      expect(result.previousStatus).toBe(true);
      expect(result.newStatus).toBe(false);
      expect(mockVehicleType.set).toHaveBeenCalledWith('active', false);
      expect(mockVehicleType.set).toHaveBeenCalledWith('exists', true);
      expect(mockVehicleType.save).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Vehicle type status toggled successfully',
        expect.objectContaining({
          typeId: 'test-type-123',
          previousStatus: true,
          newStatus: false,
        })
      );
    });

    it('should toggle vehicle type status to active successfully', async () => {
      // Create mock data for inactive vehicle type
      const inactiveMockData = {
        name: 'Test Type',
        code: 'test_type',
        active: false,
        exists: true,
      };

      // Override get to return inactive data and set to update it
      mockVehicleType.get.mockImplementation((field) => inactiveMockData[field]);
      mockVehicleType.set.mockImplementation((field, value) => {
        inactiveMockData[field] = value;
      });

      const result = await service.toggleVehicleTypeStatus(
        mockCurrentUser,
        'test-type-123',
        true,
        'Test activation'
      );

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(false);
      expect(result.newStatus).toBe(true);
      expect(mockVehicleType.set).toHaveBeenCalledWith('active', true);
      expect(mockVehicleType.set).toHaveBeenCalledWith('exists', true);
    });

    it('should require authentication', async () => {
      const result = await service.toggleVehicleTypeStatus(
        null,
        'test-type-123',
        false
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication required');
    });

    it('should require vehicle type ID', async () => {
      const result = await service.toggleVehicleTypeStatus(
        mockCurrentUser,
        null,
        false
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Vehicle type ID is required');
    });

    it('should validate target status is boolean', async () => {
      const result = await service.toggleVehicleTypeStatus(
        mockCurrentUser,
        'test-type-123',
        'not-a-boolean'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Target status must be a boolean');
    });

    it('should handle vehicle type not found', async () => {
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Not found')),
      };
      Parse.Query.mockImplementation(() => mockQuery);

      const result = await service.toggleVehicleTypeStatus(
        mockCurrentUser,
        'nonexistent-id',
        false
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Vehicle type not found');
    });

    it('should validate user permissions', async () => {
      const unauthorizedUser = {
        id: 'user-123',
        role: 'guest',
        get: jest.fn((field) => (field === 'role' ? 'guest' : null)),
      };

      const result = await service.toggleVehicleTypeStatus(
        unauthorizedUser,
        'test-type-123',
        false
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Insufficient permissions to change vehicle type status'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Unauthorized toggle attempt',
        expect.objectContaining({
          userId: 'user-123',
          userRole: 'guest',
        })
      );
    });

    it('should handle database errors', async () => {
      mockVehicleType.save.mockRejectedValue(new Error('Database error'));

      await expect(
        service.toggleVehicleTypeStatus(
          mockCurrentUser,
          'test-type-123',
          false
        )
      ).rejects.toThrow('Database error');

      expect(logger.error).toHaveBeenCalledWith(
        'Error in VehicleTypeService.toggleVehicleTypeStatus',
        expect.objectContaining({
          error: 'Database error',
          typeId: 'test-type-123',
        })
      );
    });

    it('should allow superadmin to toggle status', async () => {
      const superadminUser = {
        id: 'superadmin-123',
        role: 'superadmin',
        get: jest.fn((field) => (field === 'role' ? 'superadmin' : null)),
      };

      const result = await service.toggleVehicleTypeStatus(
        superadminUser,
        'test-type-123',
        false
      );

      expect(result.success).toBe(true);
    });

    it('should allow employee_amexing to toggle status', async () => {
      const employeeUser = {
        id: 'employee-123',
        role: 'employee_amexing',
        get: jest.fn((field) =>
          field === 'role' ? 'employee_amexing' : null
        ),
      };

      const result = await service.toggleVehicleTypeStatus(
        employeeUser,
        'test-type-123',
        false
      );

      expect(result.success).toBe(true);
    });
  });

  describe('softDeleteVehicleType', () => {
    it('should soft delete vehicle type successfully', async () => {
      const result = await service.softDeleteVehicleType(
        mockCurrentUser,
        'test-type-123',
        'No longer needed'
      );

      expect(result.success).toBe(true);
      expect(mockVehicleType.set).toHaveBeenCalledWith('active', false);
      expect(mockVehicleType.set).toHaveBeenCalledWith('exists', false);
      expect(mockVehicleType.save).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Vehicle type soft deleted successfully',
        expect.objectContaining({
          typeId: 'test-type-123',
          deletedBy: 'admin-user-123',
        })
      );
    });

    it('should prevent deletion if vehicles are using the type', async () => {
      mockVehicleType.canDelete.mockResolvedValue({
        canDelete: false,
        reason: 'Cannot delete: 5 vehicle(s) are using this type',
      });

      const result = await service.softDeleteVehicleType(
        mockCurrentUser,
        'test-type-123'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Cannot delete: 5 vehicle(s) are using this type'
      );
    });

    it('should require authentication', async () => {
      const result = await service.softDeleteVehicleType(
        null,
        'test-type-123'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication required');
    });

    it('should only allow SuperAdmin and Admin to delete', async () => {
      const employeeUser = {
        id: 'employee-123',
        role: 'employee_amexing',
        get: jest.fn((field) =>
          field === 'role' ? 'employee_amexing' : null
        ),
      };

      const result = await service.softDeleteVehicleType(
        employeeUser,
        'test-type-123'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Only SuperAdmin and Admin can delete vehicle types'
      );
    });

    it('should handle vehicle type not found', async () => {
      const mockQuery = {
        equalTo: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Not found')),
      };
      Parse.Query.mockImplementation(() => mockQuery);

      const result = await service.softDeleteVehicleType(
        mockCurrentUser,
        'nonexistent-id'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Vehicle type not found');
    });
  });

  describe('transformVehicleTypeToSafeFormat', () => {
    it('should transform vehicle type to safe format', () => {
      const result = service.transformVehicleTypeToSafeFormat(mockVehicleType);

      expect(result).toEqual({
        id: 'test-type-123',
        objectId: 'test-type-123',
        name: 'Test Type',
        code: 'test_type',
        description: 'Test Description',
        icon: 'car',
        defaultCapacity: 4,
        sortOrder: 1,
        active: true,
        exists: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should handle missing optional fields with defaults', () => {
      mockVehicleType.get.mockImplementation((field) => {
        const data = {
          name: 'Test Type',
          code: 'test_type',
          active: true,
          exists: true,
        };
        return data[field];
      });

      const result = service.transformVehicleTypeToSafeFormat(mockVehicleType);

      expect(result.description).toBe('');
      expect(result.icon).toBe('car');
      expect(result.defaultCapacity).toBe(4);
      expect(result.sortOrder).toBe(0);
    });
  });
});
