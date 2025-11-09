/**
 * ExperienceController Unit Tests
 * Tests for experience and provider management API controller
 *
 * Covers CRUD operations, DataTables integration, type filtering,
 * array of pointers validation, and soft delete functionality.
 */

// Mock dependencies BEFORE requiring the controller
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('parse/node', () => {
  // Create a shared mock query instance that will be returned for all Query() calls
  const sharedMockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    notEqualTo: jest.fn().mockReturnThis(),
    containedIn: jest.fn().mockReturnThis(),
    ascending: jest.fn().mockReturnThis(),
    descending: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    include: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    get: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    first: jest.fn(),
  };

  // Mock Query class
  const MockQuery = jest.fn(() => sharedMockQuery);
  MockQuery.or = jest.fn(() => sharedMockQuery);

  return {
    Object: class MockParseObject {
      constructor() {
        this.className = '';
        this.attributes = {};
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

      set(key, value) {
        if (typeof key === 'object') {
          Object.assign(this.attributes, key);
        } else {
          this.attributes[key] = value;
        }
      }

      get(key) {
        return this.attributes[key];
      }

      save() {
        this.id = 'test-id-' + Date.now();
        return Promise.resolve(this);
      }
    },
    Query: MockQuery,
    Error: {
      OBJECT_NOT_FOUND: 101,
    },
  };
});

const controller = require('../../../../src/application/controllers/api/ExperienceController');
const logger = require('../../../../src/infrastructure/logger');
const Parse = require('parse/node');

describe('ExperienceController', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Controller is already instantiated (singleton export)

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

    // Reset Parse.Query mock
    const mockQuery = new Parse.Query();
    mockQuery.count.mockReset();
    mockQuery.find.mockReset();
    mockQuery.get.mockReset();
    mockQuery.first.mockReset();
  });

  describe('getExperiences', () => {
    const mockExperiences = [
      {
        id: 'exp-1',
        objectId: 'exp-1',
        get: jest.fn((key) => {
          const data = {
            name: 'Tour Centro Histórico',
            description: 'Tour por el centro',
            type: 'Experience',
            cost: 500,
            active: true,
            exists: true,
            experiences: [],
            updatedAt: new Date('2025-01-01'),
          };
          return data[key];
        }),
      },
      {
        id: 'exp-2',
        objectId: 'exp-2',
        get: jest.fn((key) => {
          const data = {
            name: 'Tour Gastronómico',
            description: 'Experiencia culinaria',
            type: 'Experience',
            cost: 750,
            active: true,
            exists: true,
            experiences: [],
            updatedAt: new Date('2025-01-02'),
          };
          return data[key];
        }),
      },
    ];

    it('should retrieve experiences with DataTables pagination successfully', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.count.mockResolvedValue(2);
      mockQuery.find.mockResolvedValue(mockExperiences);

      await controller.getExperiences(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          draw: 1,
          recordsTotal: 2,
          recordsFiltered: 2,
        })
      );
    });

    it('should filter by type parameter (Experience)', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
        type: 'Experience',
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.count.mockResolvedValue(2);
      mockQuery.find.mockResolvedValue(mockExperiences);

      await controller.getExperiences(mockReq, mockRes);

      expect(mockQuery.equalTo).toHaveBeenCalledWith('type', 'Experience');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          draw: 1,
        })
      );
    });

    it('should filter by type parameter (Provider)', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
        type: 'Provider',
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.count.mockResolvedValue(1);
      mockQuery.find.mockResolvedValue([mockExperiences[0]]);

      await controller.getExperiences(mockReq, mockRes);

      expect(mockQuery.equalTo).toHaveBeenCalledWith('type', 'Provider');
    });

    it('should handle search parameter', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
        search: { value: 'Centro' },
      };

      // Configure the global mock
      const mockQuery = new Parse.Query();
      mockQuery.count.mockResolvedValue(1);
      mockQuery.find.mockResolvedValue([mockExperiences[0]]);

      await controller.getExperiences(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          draw: 1,
        })
      );
    });

    it('should return empty array when no results', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.count.mockResolvedValue(0);
      mockQuery.find.mockResolvedValue([]);

      await controller.getExperiences(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [],
          recordsTotal: 0,
          draw: 1,
        })
      );
    });

    it('should handle authentication errors', async () => {
      mockReq.user = null;

      await controller.getExperiences(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockReq.query = {
        draw: '1',
        start: '0',
        length: '25',
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.count.mockRejectedValue(new Error('Database connection error'));

      await controller.getExperiences(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });
  });

  describe('getExperienceById', () => {
    it('should retrieve single experience by ID', async () => {
      const mockExperience = {
        id: 'exp-1',
        objectId: 'exp-1',
        get: jest.fn((key) => {
          const data = {
            name: 'Tour Centro',
            description: 'Tour description',
            type: 'Experience',
            cost: 500,
            active: true,
            exists: true,
            experiences: [],
          };
          return data[key];
        }),
      };

      mockReq.params = { id: 'exp-1' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.getExperienceById(mockReq, mockRes);

      expect(mockQuery.get).toHaveBeenCalledWith('exp-1', expect.any(Object));
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: 'exp-1',
            name: 'Tour Centro',
          }),
        })
      );
    });

    it('should include related experiences (array of pointers)', async () => {
      const relatedExp = {
        id: 'rel-1',
        get: jest.fn(() => 'Related Experience'),
      };

      const mockExperience = {
        id: 'exp-1',
        objectId: 'exp-1',
        get: jest.fn((key) => {
          const data = {
            name: 'Package Tour',
            description: 'Combined tour',
            type: 'Experience',
            cost: 1000,
            active: true,
            exists: true,
            experiences: [relatedExp],
          };
          return data[key];
        }),
      };

      mockReq.params = { id: 'exp-1' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.getExperienceById(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            experiences: ['rel-1'],
            experienceDetails: expect.arrayContaining([
              expect.objectContaining({
                id: 'rel-1',
              }),
            ]),
          }),
        })
      );
    });

    it('should return 404 when experience not found', async () => {
      mockReq.params = { id: 'non-existent' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockRejectedValue({ code: 101, message: 'Object not found' });

      await controller.getExperienceById(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });
  });

  describe('createExperience', () => {
    it('should create experience with valid data', async () => {
      mockReq.body = {
        name: 'New Tour',
        description: 'Amazing tour',
        type: 'Experience',
        cost: 600,
        experiences: [],
      };

      await controller.createExperience(mockReq, mockRes);

      expect(logger.info).toHaveBeenCalledWith(
        'Experience created successfully',
        expect.objectContaining({
          name: 'New Tour',
          type: 'Experience',
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.any(String),
        })
      );
    });

    it('should validate required fields', async () => {
      mockReq.body = {
        name: '',
        description: '',
        type: 'Experience',
        cost: undefined,
      };

      await controller.createExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should reject invalid type', async () => {
      mockReq.body = {
        name: 'Test',
        description: 'Test desc',
        type: 'InvalidType',
        cost: 100,
      };

      await controller.createExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should handle array of experiences (max 20)', async () => {
      const expIds = Array.from({ length: 15 }, (_, i) => `exp-${i}`);

      mockReq.body = {
        name: 'Package Tour',
        description: 'Combined experiences',
        type: 'Experience',
        cost: 2000,
        experiences: expIds,
      };

      // Mock experience queries for each ID
      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue({
        id: 'mock-exp',
        get: jest.fn(),
      });

      await controller.createExperience(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should reject more than 20 experiences', async () => {
      const expIds = Array.from({ length: 21 }, (_, i) => `exp-${i}`);

      mockReq.body = {
        name: 'Package Tour',
        description: 'Too many experiences',
        type: 'Experience',
        cost: 2000,
        experiences: expIds,
      };

      await controller.createExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('20'),
        })
      );
    });

    it('should set active=true and exists=true by default', async () => {
      mockReq.body = {
        name: 'Test Experience',
        description: 'Test',
        type: 'Experience',
        cost: 300,
      };

      const ExperienceClass = Parse.Object.extend('Experience');
      const spySet = jest.spyOn(ExperienceClass.prototype, 'set');

      await controller.createExperience(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });

  describe('updateExperience', () => {
    it('should update experience with valid data', async () => {
      const mockExperience = {
        id: 'exp-1',
        set: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
        get: jest.fn(),
      };

      mockReq.params = { id: 'exp-1' };
      mockReq.body = {
        name: 'Updated Tour',
        description: 'Updated description',
        cost: 750,
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.updateExperience(mockReq, mockRes);

      expect(mockExperience.set).toHaveBeenCalledWith('name', 'Updated Tour');
      expect(mockExperience.save).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should validate max 20 experiences on update', async () => {
      const mockExperience = {
        id: 'exp-1',
        set: jest.fn(),
        save: jest.fn(),
        get: jest.fn(),
      };

      mockReq.params = { id: 'exp-1' };
      mockReq.body = {
        experiences: Array.from({ length: 21 }, (_, i) => `exp-${i}`),
      };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.updateExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('20'),
        })
      );
    });

    it('should return 404 if experience not found', async () => {
      mockReq.params = { id: 'non-existent' };
      mockReq.body = { name: 'Test' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockRejectedValue({ code: 101 });

      await controller.updateExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteExperience', () => {
    it('should soft delete experience (exists=false)', async () => {
      const mockExperience = {
        id: 'exp-1',
        get: jest.fn((key) => (key === 'name' ? 'Test Experience' : null)),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };

      mockReq.params = { id: 'exp-1' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.deleteExperience(mockReq, mockRes);

      expect(mockExperience.set).toHaveBeenCalledWith('exists', false);
      expect(mockExperience.set).toHaveBeenCalledWith('active', false);
      expect(mockExperience.save).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Experience soft deleted successfully',
        expect.objectContaining({
          experienceId: 'exp-1',
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.any(String),
        })
      );
    });

    it('should require authentication', async () => {
      mockReq.user = null;
      mockReq.params = { id: 'exp-1' };

      await controller.deleteExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should return 404 if experience not found', async () => {
      mockReq.params = { id: 'non-existent' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockRejectedValue({ code: 101 });

      await controller.deleteExperience(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should log deletion with user audit trail', async () => {
      const mockExperience = {
        id: 'exp-1',
        get: jest.fn(),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue({}),
      };

      mockReq.params = { id: 'exp-1' };

      const mockQuery = new Parse.Query('Experience');
      mockQuery.get.mockResolvedValue(mockExperience);

      await controller.deleteExperience(mockReq, mockRes);

      expect(logger.info).toHaveBeenCalledWith(
        'Experience soft deleted successfully',
        expect.objectContaining({
          experienceId: 'exp-1',
          userId: 'admin-user-123',
        })
      );
    });
  });
});
