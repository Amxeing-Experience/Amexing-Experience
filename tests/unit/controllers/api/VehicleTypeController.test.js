/**
 * VehicleTypeController Unit Tests
 * Tests for vehicle type management API controller
 */

// Mock dependencies BEFORE requiring the controller
jest.mock('../../../../src/application/services/VehicleTypeService');
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('parse/node', () => ({
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
  Query: jest.fn(() => ({
    equalTo: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  })),
}));

const controller = require('../../../../src/application/controllers/api/VehicleTypeController');
const VehicleTypeService = require('../../../../src/application/services/VehicleTypeService');
const logger = require('../../../../src/infrastructure/logger');

describe('VehicleTypeController', () => {
  let mockReq;
  let mockRes;
  let mockVehicleTypeService;

  beforeEach(() => {
    mockVehicleTypeService = controller.vehicleTypeService;

    mockReq = {
      user: {
        id: 'admin-user-123',
        role: 'admin',
        get: jest.fn((field) => (field === 'role' ? 'admin' : null)),
      },
      userRole: 'admin',
      params: {},
      body: {},
      query: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    jest.clearAllMocks();
  });

  describe('toggleVehicleTypeStatus', () => {
    const mockVehicleTypeId = 'vehicle-type-123';
    const mockVehicleType = {
      id: mockVehicleTypeId,
      objectId: mockVehicleTypeId,
      name: 'Test Type',
      code: 'test_type',
      description: 'Test Description',
      icon: 'car',
      defaultCapacity: 4,
      sortOrder: 1,
      active: true,
      exists: true,
    };

    it('should toggle vehicle type status to inactive successfully', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };

      const serviceResult = {
        success: true,
        vehicleType: { ...mockVehicleType, active: false },
        previousStatus: true,
        newStatus: false,
      };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockResolvedValue(serviceResult);

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-user-123', role: 'admin' }),
        mockVehicleTypeId,
        false,
        'Status changed via vehicle types dashboard'
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('deactivated'),
          data: expect.objectContaining({ active: false }),
        })
      );
    });

    it('should toggle vehicle type status to active successfully', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: true };

      const serviceResult = {
        success: true,
        vehicleType: { ...mockVehicleType, active: true },
        previousStatus: false,
        newStatus: true,
      };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockResolvedValue(serviceResult);

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-user-123', role: 'admin' }),
        mockVehicleTypeId,
        true,
        'Status changed via vehicle types dashboard'
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('activated'),
        })
      );
    });

    it('should require authentication', async () => {
      mockReq.user = null;
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Autenticación requerida',
        })
      );

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).not.toHaveBeenCalled();
    });

    it('should require vehicle type ID', async () => {
      mockReq.params = {}; // No ID
      mockReq.body = { active: false };

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'El ID del tipo de vehículo es requerido',
        })
      );

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).not.toHaveBeenCalled();
    });

    it('should validate active is a boolean', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: 'not-a-boolean' };

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'El estado activo debe ser un valor booleano',
        })
      );

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).not.toHaveBeenCalled();
    });

    it('should handle service returning failure', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };

      const serviceResult = {
        success: false,
        message: 'Insufficient permissions',
      };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockResolvedValue(serviceResult);

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Insufficient permissions',
        })
      );
    });

    it('should handle service throwing error', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockRejectedValue(new Error('Database connection failed'));

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to toggle vehicle type status',
        })
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error in VehicleTypeController.toggleVehicleTypeStatus',
        expect.objectContaining({
          error: 'Database connection failed',
          typeId: mockVehicleTypeId,
        })
      );
    });

    it('should add role to currentUser before calling service', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };
      mockReq.userRole = 'superadmin';
      mockReq.user.role = undefined;

      const serviceResult = {
        success: true,
        vehicleType: mockVehicleType,
        previousStatus: true,
        newStatus: false,
      };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockResolvedValue(serviceResult);

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      // Verify the user object passed to service has the role set
      expect(mockVehicleTypeService.toggleVehicleTypeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'superadmin' }),
        mockVehicleTypeId,
        false,
        'Status changed via vehicle types dashboard'
      );
    });

    it('should handle user role from user.get() method', async () => {
      mockReq.params = { id: mockVehicleTypeId };
      mockReq.body = { active: false };
      mockReq.userRole = undefined;
      mockReq.user.role = undefined;
      mockReq.user.get = jest.fn((field) => (field === 'role' ? 'admin' : null));

      const serviceResult = {
        success: true,
        vehicleType: mockVehicleType,
      };

      mockVehicleTypeService.toggleVehicleTypeStatus = jest
        .fn()
        .mockResolvedValue(serviceResult);

      await controller.toggleVehicleTypeStatus(mockReq, mockRes);

      expect(mockVehicleTypeService.toggleVehicleTypeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        mockVehicleTypeId,
        false,
        'Status changed via vehicle types dashboard'
      );
    });
  });

  describe('sendSuccess', () => {
    it('should send success response with correct format', () => {
      const data = { test: 'data' };
      const message = 'Test successful';

      controller.sendSuccess(mockRes, data, message);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message,
        data,
      });
    });

    it('should send success response with custom status code', () => {
      const data = { test: 'data' };
      const message = 'Resource created';

      controller.sendSuccess(mockRes, data, message, 201);

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });
  });

  describe('sendError', () => {
    it('should send error response with correct format', () => {
      const errorMessage = 'Test error';

      controller.sendError(mockRes, errorMessage, 400);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: errorMessage,
      });
    });

    it('should default to status 500 if not provided', () => {
      const errorMessage = 'Test error';

      controller.sendError(mockRes, errorMessage);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
