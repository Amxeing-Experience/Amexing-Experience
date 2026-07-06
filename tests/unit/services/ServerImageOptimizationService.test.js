/**
 * ServerImageOptimizationService Unit Tests
 * Guards the fix where uploadOptimizedImage() must write the original file to the SAME
 * S3 key it returns as originalS3Key (customS3Key now forced on the first uploadFile call).
 */

// sharp can't process a fake buffer; short-circuit it so variant creation fails fast and quietly
// (the AVIF/WebP/JPEG blocks are wrapped in try/catch and are non-fatal to the method under test).
jest.mock('sharp', () => jest.fn(() => ({
  avif: () => ({ toBuffer: () => Promise.reject(new Error('mock sharp failure')) }),
  webp: () => ({ toBuffer: () => Promise.reject(new Error('mock sharp failure')) }),
  jpeg: () => ({ toBuffer: () => Promise.reject(new Error('mock sharp failure')) }),
})));

const ServerImageOptimizationService = require('../../../src/application/services/ServerImageOptimizationService');

describe('ServerImageOptimizationService.uploadOptimizedImage', () => {
  let service;
  let uploadFileSpy;

  beforeEach(() => {
    service = new ServerImageOptimizationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the original to the exact key it returns as originalS3Key', async () => {
    uploadFileSpy = jest
      .spyOn(ServerImageOptimizationService.prototype, 'uploadFile')
      .mockResolvedValue({ s3Key: 'mocked', success: true });

    const fileBuffer = Buffer.from('fake-image-data');
    const result = await service.uploadOptimizedImage(fileBuffer, 'photo.jpg', 'image/jpeg', {
      entityPath: 'documents/client123',
      entityId: 'doc1',
    });

    // First call is the original upload; it must force customS3Key === the key/fileName arg itself.
    const [firstCallArgs] = uploadFileSpy.mock.calls;
    const [callBuffer, callKey, callMimeType, callOptions] = firstCallArgs;

    expect(callBuffer).toBe(fileBuffer);
    expect(callMimeType).toBe('image/jpeg');
    expect(callOptions.customS3Key).toBeDefined();
    expect(callOptions.customS3Key).toBe(callKey);

    // The bug: originalS3Key used to differ from the key actually written to S3.
    expect(result.originalS3Key).toBe(callKey);
    expect(result.success).toBe(true);
  });

  it('falls back to a plain uploadFile (no customS3Key) and still succeeds when the try block throws', async () => {
    uploadFileSpy = jest
      .spyOn(ServerImageOptimizationService.prototype, 'uploadFile')
      .mockRejectedValueOnce(new Error('S3 unavailable'))
      .mockResolvedValueOnce({ s3Key: 'fallback-key.jpg', success: true });

    const fileBuffer = Buffer.from('fake-image-data');
    const result = await service.uploadOptimizedImage(fileBuffer, 'photo.jpg', 'image/jpeg', {
      entityPath: 'documents/client123',
      entityId: 'doc1',
    });

    expect(uploadFileSpy).toHaveBeenCalledTimes(2);

    // Fallback call re-uploads without forcing customS3Key.
    const [, fallbackCallArgs] = uploadFileSpy.mock.calls;
    const fallbackOptions = fallbackCallArgs[3];
    expect(fallbackOptions.customS3Key).toBeUndefined();

    expect(result).toEqual({
      success: true,
      originalS3Key: 'fallback-key.jpg',
      optimizedVariants: {},
      metadata: {
        fallback: true,
        error: 'S3 unavailable',
        original: {
          s3Key: 'fallback-key.jpg',
          format: 'jpg',
        },
      },
    });
    expect(result.metadata.fallback).toBe(true);
  });
});
