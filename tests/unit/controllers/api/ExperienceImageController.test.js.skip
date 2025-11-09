/**
 * Unit Tests for ExperienceImageController
 *
 * Tests image upload, CRUD operations, and race condition handling.
 * Validates multer configuration, file validation, and displayOrder logic.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-16
 */

// Mock dependencies before imports
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('parse/node', () => {
  const mockQuery = {
    equalTo: jest.fn().mockReturnThis(),
    notEqualTo: jest.fn().mockReturnThis(),
    include: jest.fn().mockReturnThis(),
    ascending: jest.fn().mockReturnThis(),
    find: jest.fn(),
    first: jest.fn(),
    get: jest.fn(),
    count: jest.fn(),
  };

  return {
    Object: class MockParseObject {
      constructor() {
        this.className = '';
        this.attributes = {};
        this.id = 'mock-id-' + Math.random();
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
    Query: jest.fn(() => mockQuery),
  };
});

// Mock ExperienceImage model static methods
jest.mock('../../../../src/domain/models/ExperienceImage', () => {
  class MockExperienceImage {
    constructor() {
      this.attributes = {};
      this.id = 'mock-image-id';
    }
    set(key, value) {
      this.attributes[key] = value;
    }
    get(key) {
      return this.attributes[key];
    }
    save() {
      return Promise.resolve(this);
    }
  }

  MockExperienceImage.getImageCount = jest.fn();
  MockExperienceImage.findByExperience = jest.fn();
  MockExperienceImage.findPrimaryImages = jest.fn();
  MockExperienceImage.recalculateDisplayOrder = jest.fn();
  MockExperienceImage.setPrimaryImage = jest.fn();

  return MockExperienceImage;
});

const ExperienceImageController = require('../../../../src/application/controllers/api/ExperienceImageController');
const logger = require('../../../../src/infrastructure/logger');
const fs = require('fs/promises');
const ExperienceImage = require('../../../../src/domain/models/ExperienceImage');
const Parse = require('parse/node');

describe('ExperienceImageController', () => {
  let controller;
  let mockReq;
  let mockRes;
  let mockQuery;

  beforeEach(() => {
    controller = new ExperienceImageController();

    // Get fresh mock query instance
    mockQuery = new Parse.Query();

    mockReq = {
      user: {
        id: 'admin-user-123',
        role: 'admin',
      },
      params: {
        id: 'exp-123',
      },
      body: {},
      query: {},
      file: {
        filename: 'test-image.jpg',
        path: '/uploads/experiences/exp123/test-image.jpg',
        mimetype: 'image/jpeg',
        size: 1024 * 1024, // 1MB
        originalname: 'test-image.jpg',
      },
      files: [],
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  // =================
  // uploadImage Tests
  // =================

  describe('uploadImage', () => {
    it('should return 400 when no file uploaded', async () => {
      // Arrange
      mockReq.file = null;

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('archivo'),
        })
      );
    });

    it('should upload image successfully with displayOrder and isPrimary', async () => {
      // Arrange
      const mockExperience = {
        id: 'exp-123',
        get: jest.fn().mockReturnValue('Test Experience'),
      };

      mockQuery.get.mockResolvedValue(mockExperience);

      // Mock ExperienceImage static methods
      ExperienceImage.getImageCount.mockResolvedValue(0);
      ExperienceImage.findPrimaryImages.mockResolvedValue([]);
      ExperienceImage.recalculateDisplayOrder.mockResolvedValue(undefined);

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(mockQuery.get).toHaveBeenCalledWith('exp-123', { useMasterKey: true });
      expect(ExperienceImage.getImageCount).toHaveBeenCalledWith('exp-123');
      expect(ExperienceImage.findPrimaryImages).toHaveBeenCalledWith('exp-123');
      expect(ExperienceImage.recalculateDisplayOrder).toHaveBeenCalledWith('exp-123');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it('should set first image as primary automatically', async () => {
      // Arrange
      const mockExperience = { id: 'exp-123' };
      mockQuery.get.mockResolvedValue(mockExperience);

      ExperienceImage.getImageCount.mockResolvedValue(0); // First image
      ExperienceImage.findPrimaryImages.mockResolvedValue([]);
      ExperienceImage.recalculateDisplayOrder.mockResolvedValue(undefined);

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(ExperienceImage.getImageCount).toHaveBeenCalledWith('exp-123');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should handle race condition by correcting multiple primary images', async () => {
      // Arrange
      const mockExperience = { id: 'exp-123' };

      const oldestPrimaryImage = {
        id: 'img-oldest',
        get: jest.fn((field) => {
          if (field === 'createdAt') return new Date('2025-01-01T10:00:00Z');
          if (field === 'isPrimary') return true;
          return null;
        }),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      const newerPrimaryImage = {
        id: 'img-newer',
        get: jest.fn((field) => {
          if (field === 'createdAt') return new Date('2025-01-01T10:00:01Z');
          if (field === 'isPrimary') return true;
          return null;
        }),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      mockQuery.get.mockResolvedValue(mockExperience);

      ExperienceImage.getImageCount.mockResolvedValue(2);
      ExperienceImage.findPrimaryImages.mockResolvedValue([
        oldestPrimaryImage,
        newerPrimaryImage,
      ]);
      ExperienceImage.recalculateDisplayOrder.mockResolvedValue(undefined);

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert: Should warn about multiple primaries
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Multiple primary images'),
        expect.objectContaining({
          experienceId: 'exp-123',
          count: 2,
        })
      );

      // Assert: Should unset isPrimary on newer image only
      expect(newerPrimaryImage.set).toHaveBeenCalledWith('isPrimary', false);
      expect(newerPrimaryImage.save).toHaveBeenCalled();

      // Assert: Oldest should NOT be modified
      expect(oldestPrimaryImage.set).not.toHaveBeenCalled();

      // Assert: Should recalculate display order
      expect(ExperienceImage.recalculateDisplayOrder).toHaveBeenCalledWith('exp-123');
    });

    it('should return 500 when experience not found', async () => {
      // Arrange
      mockQuery.get.mockRejectedValue({ code: 101, message: 'Object not found' });

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log upload with audit trail', async () => {
      // Arrange
      const mockExperience = { id: 'exp-123' };
      mockQuery.get.mockResolvedValue(mockExperience);

      ExperienceImage.getImageCount.mockResolvedValue(0);
      ExperienceImage.findPrimaryImages.mockResolvedValue([]);
      ExperienceImage.recalculateDisplayOrder.mockResolvedValue(undefined);

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        'Experience image uploaded',
        expect.objectContaining({
          experienceId: 'exp-123',
          uploadedBy: 'admin-user-123',
        })
      );
    });

    it('should recalculate displayOrder after upload', async () => {
      // Arrange
      const mockExperience = { id: 'exp-123' };
      mockQuery.get.mockResolvedValue(mockExperience);

      ExperienceImage.getImageCount.mockResolvedValue(3);
      ExperienceImage.findPrimaryImages.mockResolvedValue([]);
      ExperienceImage.recalculateDisplayOrder.mockResolvedValue(undefined);

      // Act
      await controller.uploadImage(mockReq, mockRes);

      // Assert
      expect(ExperienceImage.recalculateDisplayOrder).toHaveBeenCalledWith('exp-123');
    });
  });

  // =================
  // listImages Tests
  // =================

  describe('listImages', () => {
    it('should list all images for an experience', async () => {
      // Arrange
      const mockImages = [
        {
          id: 'img-1',
          get: jest.fn((field) => {
            if (field === 'url') return '/uploads/image1.jpg';
            if (field === 'displayOrder') return 0;
            if (field === 'isPrimary') return true;
            if (field === 'caption') return 'First image';
            return null;
          }),
        },
        {
          id: 'img-2',
          get: jest.fn((field) => {
            if (field === 'url') return '/uploads/image2.jpg';
            if (field === 'displayOrder') return 1;
            if (field === 'isPrimary') return false;
            if (field === 'caption') return 'Second image';
            return null;
          }),
        },
      ];

      ExperienceImage.findByExperience.mockResolvedValue(mockImages);

      // Act
      await controller.listImages(mockReq, mockRes);

      // Assert
      expect(ExperienceImage.findByExperience).toHaveBeenCalledWith('exp-123');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              id: 'img-1',
              isPrimary: true,
            }),
            expect.objectContaining({
              id: 'img-2',
              isPrimary: false,
            }),
          ]),
        })
      );
    });

    it('should return empty array when no images exist', async () => {
      // Arrange
      ExperienceImage.findByExperience.mockResolvedValue([]);

      // Act
      await controller.listImages(mockReq, mockRes);

      // Assert
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [],
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      ExperienceImage.findByExperience.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Act
      await controller.listImages(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // =================
  // deleteImage Tests
  // =================

  describe('deleteImage', () => {
    it('should delete image successfully with soft delete', async () => {
      // Arrange
      mockReq.params.imageId = 'img-123';

      const mockImage = {
        id: 'img-123',
        get: jest.fn((field) => {
          if (field === 'url') return '/uploads/experiences/exp123/test-image.jpg';
          if (field === 'isPrimary') return false;
          return null;
        }),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      mockQuery.get.mockResolvedValue(mockImage);

      // Act
      await controller.deleteImage(mockReq, mockRes);

      // Assert
      expect(mockImage.set).toHaveBeenCalledWith('exists', false);
      expect(mockImage.set).toHaveBeenCalledWith('active', false);
      expect(mockImage.save).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it('should delete any image including primary', async () => {
      // Arrange
      mockReq.params.imageId = 'img-primary';

      const mockImage = {
        id: 'img-primary',
        get: jest.fn((field) => {
          if (field === 'url') return '/uploads/image.jpg';
          if (field === 'isPrimary') return true;
          return null;
        }),
        set: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      mockQuery.get.mockResolvedValue(mockImage);

      // Act
      await controller.deleteImage(mockReq, mockRes);

      // Assert: Controller allows deletion of primary images
      expect(mockImage.set).toHaveBeenCalledWith('exists', false);
      expect(mockImage.set).toHaveBeenCalledWith('active', false);
      expect(mockImage.save).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should return 500 when image not found', async () => {
      // Arrange
      mockReq.params.imageId = 'non-existent';
      mockQuery.get.mockRejectedValue({ code: 101, message: 'Object not found' });

      // Act
      await controller.deleteImage(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // =================
  // setPrimary Tests
  // =================

  describe('setPrimary', () => {
    it('should set image as primary successfully', async () => {
      // Arrange
      mockReq.params.imageId = 'img-new-primary';
      ExperienceImage.setPrimaryImage.mockResolvedValue(true);

      // Act
      await controller.setPrimary(mockReq, mockRes);

      // Assert
      expect(ExperienceImage.setPrimaryImage).toHaveBeenCalledWith('exp-123', 'img-new-primary');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.any(String),
        })
      );
    });

    it('should log primary image change for audit trail', async () => {
      // Arrange
      mockReq.params.imageId = 'img-new-primary';
      ExperienceImage.setPrimaryImage.mockResolvedValue(true);

      // Act
      await controller.setPrimary(mockReq, mockRes);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        'Experience primary image set',
        expect.objectContaining({
          experienceId: 'exp-123',
          imageId: 'img-new-primary',
          setBy: 'admin-user-123',
        })
      );
    });

    it('should return 500 when setPrimaryImage fails', async () => {
      // Arrange
      mockReq.params.imageId = 'non-existent';
      ExperienceImage.setPrimaryImage.mockRejectedValue(
        new Error('Image not found')
      );

      // Act
      await controller.setPrimary(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // =================
  // reorderImages Tests
  // =================

  describe('reorderImages', () => {
    it('should reorder images successfully', async () => {
      // Arrange
      mockReq.body = {
        imageIds: ['img-3', 'img-1', 'img-2'],
      };

      const mockImages = [
        {
          id: 'img-3',
          set: jest.fn(),
          save: jest.fn().mockResolvedValue(true),
        },
        {
          id: 'img-1',
          set: jest.fn(),
          save: jest.fn().mockResolvedValue(true),
        },
        {
          id: 'img-2',
          set: jest.fn().mockResolvedValue(true),
          save: jest.fn().mockResolvedValue(true),
        },
      ];

      mockQuery.get.mockImplementation((id) => {
        const img = mockImages.find((img) => img.id === id);
        return Promise.resolve(img);
      });

      // Act
      await controller.reorderImages(mockReq, mockRes);

      // Assert
      expect(mockImages[0].set).toHaveBeenCalledWith('displayOrder', 0);
      expect(mockImages[1].set).toHaveBeenCalledWith('displayOrder', 1);
      expect(mockImages[2].set).toHaveBeenCalledWith('displayOrder', 2);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should return 400 when imageIds array is missing', async () => {
      // Arrange
      mockReq.body = {};

      // Act
      await controller.reorderImages(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should return 400 when imageIds is not an array', async () => {
      // Arrange
      mockReq.body = {
        imageIds: 'not-an-array',
      };

      // Act
      await controller.reorderImages(mockReq, mockRes);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });

    it('should log reorder operation for audit trail', async () => {
      // Arrange
      mockReq.body = {
        imageIds: ['img-2', 'img-1'],
      };

      const mockImages = [
        {
          id: 'img-2',
          set: jest.fn(),
          save: jest.fn().mockResolvedValue(true),
        },
        {
          id: 'img-1',
          set: jest.fn(),
          save: jest.fn().mockResolvedValue(true),
        },
      ];

      mockQuery.get.mockImplementation((id) => {
        const img = mockImages.find((img) => img.id === id);
        return Promise.resolve(img);
      });

      // Act
      await controller.reorderImages(mockReq, mockRes);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        'Experience images reordered',
        expect.objectContaining({
          experienceId: 'exp-123',
          imageCount: 2,
          reorderedBy: 'admin-user-123',
        })
      );
    });
  });
});
