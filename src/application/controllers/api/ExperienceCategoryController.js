/**
 * ExperienceCategoryController - RESTful API for Experience Category Management.
 *
 * CRUD del catálogo de categorías de experiencias (catas, arte, etc.), con imagen única
 * por categoría (misma lógica de optimización/S3 que Destinos/experiencias).
 * Lectura para department_manager y superiores; escritura solo admin/superadmin.
 * @author Denisse Maldonado
 * @version 1.1.0
 * @since 1.0.0
 * @example
 * GET    /api/experience-categories       - Lista (client-side) con conteo de experiencias
 * GET    /api/experience-categories/:id   - Categoría por id
 * POST   /api/experience-categories       - Crear
 * PUT    /api/experience-categories/:id   - Actualizar (incluye toggle active)
 * DELETE /api/experience-categories/:id   - Soft delete
 */

const Parse = require('parse/node');
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');
const logger = require('../../../infrastructure/logger');

const CODE_PATTERN = /^[a-z0-9_-]+$/;

/**
 * ExperienceCategoryController class implementing the RESTful API.
 */
class ExperienceCategoryController {
  constructor() {
    // Servicios de imagen (mismos que Destinos/experiencias) para la imagen única de la
    // categoría. Carpeta S3 propia `experience-categories/…`; presigned AVIF/WebP/JPEG.
    const s3Options = {
      baseFolder: 'experience-categories',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    };
    this.imageOptimizationService = new ImageOptimizationService({
      ...s3Options,
      enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION !== 'false',
    });
    this.serverOptimizationService = new ServerImageOptimizationService(s3Options);
  }

  /**
   * Procesa la imagen única de una categoría (una sola imagen, misma lógica que Destinos).
   * @param {object|null} image - `{ dataUrl }` (nueva) o `{ s3Key, optimizedVariants, ... }` (existente).
   * @param {string} categoryId - Id de la categoría (para la ruta en S3).
   * @param {object} userContext - Contexto de auditoría.
   * @returns {Promise<object|null>} Imagen optimizada, la existente, o null.
   * @example
   */
  async processSingleImage(image, categoryId, userContext) {
    if (!image) {
      return null;
    }

    // Imagen nueva (data URL base64) → optimizar y subir
    if (image.dataUrl && image.dataUrl.startsWith('data:')) {
      const matches = image.dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        logger.warn('Invalid base64 data URL for category image', { categoryId });
        return image.s3Key ? image : null;
      }

      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substr(2, 9);
      const originalFileName = image.fileName || 'image.jpg';
      const extension = originalFileName.split('.').pop() || 'jpg';
      const uniqueFileName = `${timestamp}-${randomString}.${extension}`;

      const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
        buffer,
        uniqueFileName,
        mimeType,
        { entityPath: `experience-categories/${categoryId}`, entityId: categoryId, userContext }
      );

      logger.info('Category image optimized', {
        categoryId,
        fileName: originalFileName,
        s3Key: optimizationResult.originalS3Key,
        userId: userContext?.userId,
      });

      return {
        s3Key: optimizationResult.originalS3Key,
        fileName: originalFileName,
        originalName: originalFileName,
        optimizedVariants: optimizationResult.optimizedVariants,
        optimizationMetadata: optimizationResult.metadata,
        fileSize: buffer.length,
        mimeType,
      };
    }

    // Imagen existente → conservar (sin persistir url/dataUrl transitorias).
    if (image.s3Key || image.optimizedVariants || image.optimizationMetadata) {
      const persisted = { ...image };
      delete persisted.url;
      delete persisted.dataUrl;
      return persisted;
    }

    return null;
  }

  /**
   * Formatea la imagen de la categoría para la respuesta: presigned URL en el formato óptimo.
   * @param {object|null} image - Imagen persistida.
   * @param {string} acceptHeader - Header Accept del navegador.
   * @returns {Promise<object|null>} Imagen con `url`/`dataUrl` o null.
   * @example
   */
  async formatImageForResponse(image, acceptHeader = '') {
    if (!image) {
      return null;
    }

    try {
      let { s3Key } = image;
      const variants = image.optimizedVariants;
      if (variants && typeof variants === 'object') {
        const preferred = this.imageOptimizationService.detectPreferredFormat?.(acceptHeader);
        const order = [preferred, 'avif', 'webp', 'jpeg'].filter(Boolean);
        /**
         * Extrae la s3Key de una variante de imagen (objeto con s3Key, o string).
         * @param {object|string} v - Variante de imagen.
         * @returns {string|null} La s3Key o null.
         */
        const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;
        const chosen = order.map((fmt) => keyFrom(variants[fmt])).find(Boolean);
        if (chosen) {
          s3Key = chosen;
        }
      }

      if (s3Key) {
        const url = await this.imageOptimizationService.getPresignedUrl(s3Key);
        return { ...image, url, dataUrl: url };
      }
    } catch (error) {
      logger.warn('Error formatting category image for response', { error: error.message });
    }

    return image;
  }

  /**
   * Cuenta cuántas experiencias (Experience + ProviderExperiencia) usan un code de categoría.
   * @param {string} code - Código de la categoría.
   * @returns {Promise<number>} Total de experiencias asociadas.
   * @private
   * @example
   */
  async countExperiencesForCode(code) {
    try {
      const expQuery = new Parse.Query('Experience');
      expQuery.equalTo('experience_category', code);
      expQuery.equalTo('exists', true);
      expQuery.doesNotExist('valid_until');

      const provQuery = new Parse.Query('ProviderExperiencia');
      provQuery.equalTo('experience_category', code);
      provQuery.equalTo('exists', true);

      const [expCount, provCount] = await Promise.all([
        expQuery.count({ useMasterKey: true }),
        provQuery.count({ useMasterKey: true }),
      ]);

      return expCount + provCount;
    } catch (error) {
      logger.warn('Error counting experiences for category', { code, error: error.message });
      return 0;
    }
  }

  /**
   * GET /api/experience-categories - Lista todas las categorías (client-side render).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getCategories(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      query.ascending('sortOrder');
      query.addAscending('name');
      query.limit(500);

      const categories = await query.find({ useMasterKey: true });
      const accept = req.get('accept') || '';

      const data = await Promise.all(
        categories.map(async (cat) => {
          const code = cat.get('code');
          return {
            id: cat.id,
            objectId: cat.id,
            name: cat.get('name'),
            name_en: cat.get('name_en') || null,
            code,
            description: cat.get('description') || null,
            icon: cat.get('icon') || 'star',
            color: cat.get('color') || null,
            sortOrder: cat.get('sortOrder') || 0,
            active: cat.get('active') !== false,
            image: await this.formatImageForResponse(cat.get('image'), accept),
            experienceCount: await this.countExperiencesForCode(code),
            createdAt: cat.createdAt,
            updatedAt: cat.updatedAt,
          };
        })
      );

      return this.sendSuccess(res, data, 'Categorías obtenidas exitosamente');
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.getCategories', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener las categorías',
        500
      );
    }
  }

  /**
   * GET /api/experience-categories/active - Categorías activas (ligero, para selects/filtros).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getActiveCategories(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.ascending('sortOrder');
      query.addAscending('name');
      query.limit(500);

      const categories = await query.find({ useMasterKey: true });

      const data = categories.map((cat) => ({
        code: cat.get('code'),
        name: cat.get('name'),
        name_en: cat.get('name_en') || null,
      }));

      return this.sendSuccess(res, data, 'Categorías activas obtenidas exitosamente');
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.getActiveCategories', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener las categorías activas', 500);
    }
  }

  /**
   * GET /api/experience-categories/:id - Categoría por id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getCategoryById(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const categoryId = req.params.id;
      if (!categoryId) {
        return this.sendError(res, 'El ID de la categoría es requerido', 400);
      }

      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      const category = await query.get(categoryId, { useMasterKey: true });

      if (!category) {
        return this.sendError(res, 'Categoría no encontrada', 404);
      }

      const data = {
        id: category.id,
        name: category.get('name'),
        name_en: category.get('name_en') || '',
        code: category.get('code'),
        description: category.get('description') || '',
        icon: category.get('icon') || 'star',
        color: category.get('color') || '',
        sortOrder: category.get('sortOrder') || 0,
        active: category.get('active') !== false,
        image: await this.formatImageForResponse(category.get('image'), req.get('accept') || ''),
      };

      return this.sendSuccess(res, data, 'Categoría obtenida exitosamente');
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.getCategoryById', {
        error: error.message,
        categoryId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener la categoría', 500);
    }
  }

  /**
   * POST /api/experience-categories - Crear categoría.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createCategory(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const {
        name, name_en: nameEn, code, description, icon, color, sortOrder, image,
      } = req.body;

      const validationError = this.validatePayload({ name, code });
      if (validationError) {
        return this.sendError(res, validationError, 400);
      }

      // Unicidad del código
      const checkQuery = new Parse.Query('ExperienceCategory');
      checkQuery.equalTo('code', code);
      checkQuery.equalTo('exists', true);
      const existingCount = await checkQuery.count({ useMasterKey: true });
      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe una categoría con ese código', 409);
      }

      const ExperienceCategoryClass = Parse.Object.extend('ExperienceCategory');
      const category = new ExperienceCategoryClass();

      category.set('name', name.trim());
      category.set('name_en', nameEn ? String(nameEn).trim() : null);
      category.set('code', code.trim());
      category.set('description', description ? String(description).trim() : null);
      category.set('icon', icon ? String(icon).trim() : 'star');
      category.set('color', color ? String(color).trim() : null);
      category.set('sortOrder', Number.isFinite(Number(sortOrder)) ? parseInt(sortOrder, 10) : 0);
      category.set('active', true);
      category.set('exists', true);

      await category.save(null, {
        useMasterKey: true,
        context: this.auditContext(currentUser),
      });

      // Imagen (opcional): se procesa DESPUÉS del primer save para tener el id (ruta S3).
      if (image) {
        const processedImage = await this.processSingleImage(image, category.id, this.imageUserContext(currentUser));
        if (processedImage) {
          category.set('image', processedImage);
          await category.save(null, { useMasterKey: true, context: this.auditContext(currentUser) });
        }
      }

      logger.info('Experience category created', { categoryId: category.id, code: category.get('code'), createdBy: currentUser.id });

      return this.sendSuccess(res, {
        id: category.id,
        name: category.get('name'),
        code: category.get('code'),
        image: await this.formatImageForResponse(category.get('image'), req.get('accept') || ''),
      }, 'Categoría creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.createCategory', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al crear la categoría', 500);
    }
  }

  /**
   * PUT /api/experience-categories/:id - Actualizar categoría (incluye toggle de active).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateCategory(req, res) {
    try {
      const currentUser = req.user;
      const categoryId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }
      if (!categoryId) {
        return this.sendError(res, 'El ID de la categoría es requerido', 400);
      }

      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      const category = await query.get(categoryId, { useMasterKey: true });
      if (!category) {
        return this.sendError(res, 'Categoría no encontrada', 404);
      }

      const {
        name, name_en: nameEn, code, description, icon, color, sortOrder, active, image,
      } = req.body;

      // Toggle-only (el view manda PUT con { active } para activar/desactivar)
      const isToggleOnly = typeof active === 'boolean'
        && name === undefined && nameEn === undefined && code === undefined && description === undefined
        && icon === undefined && color === undefined && sortOrder === undefined && image === undefined;

      if (!isToggleOnly) {
        const validationError = this.validatePayload({
          name: name !== undefined ? name : category.get('name'),
          code: code !== undefined ? code : category.get('code'),
        });
        if (validationError) {
          return this.sendError(res, validationError, 400);
        }
      }

      if (code !== undefined && code !== category.get('code')) {
        const checkQuery = new Parse.Query('ExperienceCategory');
        checkQuery.equalTo('code', code);
        checkQuery.equalTo('exists', true);
        checkQuery.notEqualTo('objectId', categoryId);
        const existingCount = await checkQuery.count({ useMasterKey: true });
        if (existingCount > 0) {
          return this.sendError(res, 'Ya existe una categoría con ese código', 409);
        }
        category.set('code', String(code).trim());
      }

      if (name !== undefined) category.set('name', String(name).trim());
      if (nameEn !== undefined) category.set('name_en', nameEn ? String(nameEn).trim() : null);
      if (description !== undefined) category.set('description', description ? String(description).trim() : null);
      if (icon !== undefined) category.set('icon', icon ? String(icon).trim() : 'star');
      if (color !== undefined) category.set('color', color ? String(color).trim() : null);
      if (sortOrder !== undefined) category.set('sortOrder', Number.isFinite(Number(sortOrder)) ? parseInt(sortOrder, 10) : 0);
      if (typeof active === 'boolean') category.set('active', active);

      // Imagen: solo se toca si el campo viene en el body (así el toggle-only no la borra).
      if (image !== undefined) {
        const processedImage = image
          ? await this.processSingleImage(image, category.id, this.imageUserContext(currentUser))
          : null;
        if (processedImage) {
          category.set('image', processedImage);
        } else {
          category.unset('image');
        }
      }

      await category.save(null, {
        useMasterKey: true,
        context: this.auditContext(currentUser),
      });

      logger.info('Experience category updated', { categoryId: category.id, updatedBy: currentUser.id });

      return this.sendSuccess(res, {
        id: category.id,
        name: category.get('name'),
        code: category.get('code'),
        active: category.get('active') !== false,
        image: await this.formatImageForResponse(category.get('image'), req.get('accept') || ''),
      }, 'Categoría actualizada exitosamente');
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.updateCategory', {
        error: error.message,
        stack: error.stack,
        categoryId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al actualizar la categoría', 500);
    }
  }

  /**
   * DELETE /api/experience-categories/:id - Soft delete.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteCategory(req, res) {
    try {
      const currentUser = req.user;
      const categoryId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }
      if (!categoryId) {
        return this.sendError(res, 'El ID de la categoría es requerido', 400);
      }

      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      const category = await query.get(categoryId, { useMasterKey: true });
      if (!category) {
        return this.sendError(res, 'Categoría no encontrada', 404);
      }

      category.set('exists', false);
      category.set('active', false);

      await category.save(null, {
        useMasterKey: true,
        context: this.auditContext(currentUser),
      });

      logger.info('Experience category soft deleted', { categoryId, deletedBy: currentUser.id });

      return this.sendSuccess(res, null, 'Categoría eliminada exitosamente');
    } catch (error) {
      logger.error('Error in ExperienceCategoryController.deleteCategory', {
        error: error.message,
        stack: error.stack,
        categoryId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al eliminar la categoría', 500);
    }
  }

  /**
   * Valida nombre y código de una categoría.
   * @param {object} payload - { name, code }.
   * @param payload.name
   * @param payload.code
   * @returns {string|null} Mensaje de error, o null si es válido.
   * @private
   * @example
   */
  validatePayload({ name, code }) {
    if (!name || !String(name).trim()) return 'El nombre es requerido';
    if (String(name).length > 280) return 'El nombre debe tener 280 caracteres o menos';
    if (!code || !String(code).trim()) return 'El código es requerido';
    if (String(code).length > 50) return 'El código debe tener 50 caracteres o menos';
    if (!CODE_PATTERN.test(String(code).trim())) return 'El código solo puede contener minúsculas, números, guiones y guiones bajos';
    return null;
  }

  /**
   * Contexto de auditoría para el save.
   * @param {object} currentUser - Usuario Parse actual.
   * @returns {object} Contexto con datos del usuario.
   * @private
   * @example
   */
  auditContext(currentUser) {
    return {
      user: {
        objectId: currentUser.id,
        id: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username') || currentUser.get('email'),
      },
    };
  }

  /**
   * Contexto de usuario (plano) para el servicio de imágenes.
   * @param {object} currentUser - Usuario Parse actual.
   * @returns {object} Contexto con userId.
   * @private
   * @example
   */
  imageUserContext(currentUser) {
    return {
      objectId: currentUser.id,
      id: currentUser.id,
      userId: currentUser.id,
      email: currentUser.get('email'),
      username: currentUser.get('username') || currentUser.get('email'),
    };
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {*} data - Data to send.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code (default 200).
   * @returns {object} Response object.
   * @private
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({ success: true, data, message });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code (default 400).
   * @returns {object} Response object.
   * @private
   * @example
   */
  sendError(res, message, statusCode = 400) {
    return res.status(statusCode).json({ success: false, error: message });
  }
}

// Singleton instance
const instance = new ExperienceCategoryController();

module.exports = {
  getCategories: (req, res) => instance.getCategories(req, res),
  getActiveCategories: (req, res) => instance.getActiveCategories(req, res),
  getCategoryById: (req, res) => instance.getCategoryById(req, res),
  createCategory: (req, res) => instance.createCategory(req, res),
  updateCategory: (req, res) => instance.updateCategory(req, res),
  deleteCategory: (req, res) => instance.deleteCategory(req, res),
};
