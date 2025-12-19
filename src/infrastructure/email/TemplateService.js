/**
 * Email Template Service.
 *
 * Manages email templates with dynamic variable substitution and environment-aware asset URLs.
 * Supports HTML and plain text templates with placeholder replacement.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-01-18
 * @example
 * // Render booking confirmation email
 * const html = TemplateService.render('booking_confirmation', {
 *   LOGO_URL: TemplateService.getLogoUrl(),
 *   NOMBRE_CLIENTE: 'Juan Pérez',
 *   NUMERO_RESERVA: 'AMX-12345',
 *   FECHA: '25 de enero, 2025',
 *   AÑO: new Date().getFullYear()
 * });
 *
 * // Get environment-aware logo URL
 * const logoUrl = TemplateService.getLogoUrl();
 * // Dev: http://localhost:1337/img/amexing_logo_horizontal.avif
 * // Prod: https://amexingexperience.com/img/amexing_logo_horizontal.avif
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

/**
 * Email Template Service.
 *
 * Features:
 * - Load templates from external files (HTML and TXT)
 * - Dynamic placeholder substitution ({{VARIABLE}})
 * - Environment-aware asset URLs
 * - Template validation
 * - Caching for performance.
 * @class TemplateService
 */
class TemplateService {
  constructor() {
    this.templatesPath = path.join(__dirname, 'templates');
    this.templateCache = new Map();
    this.cacheEnabled = process.env.NODE_ENV === 'production';
  }

  /**
   * Get application base URL based on environment.
   * For emails, uses EMAIL_BASE_URL to ensure production domain in templates.
   * @returns {string} Base URL.
   * @private
   * @example
   * const baseUrl = this.getBaseUrl();
   * // Dev: https://quotes.amexingexperience.com (EMAIL_BASE_URL)
   * // Prod: https://amexingexperience.com (EMAIL_BASE_URL or APP_BASE_URL)
   */
  getBaseUrl() {
    // Priority: EMAIL_BASE_URL > APP_BASE_URL > auto-detect from PORT
    if (process.env.EMAIL_BASE_URL) {
      return process.env.EMAIL_BASE_URL;
    }

    if (process.env.APP_BASE_URL) {
      return process.env.APP_BASE_URL;
    }

    // Fallback based on environment and port
    const port = process.env.PORT || 1337;
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      return `http://localhost:${port}`;
    }

    // Production fallback (should always set EMAIL_BASE_URL in production)
    logger.warn('[TemplateService] EMAIL_BASE_URL not set, using fallback');
    return `http://localhost:${port}`;
  }

  /**
   * Get logo URL with environment-aware base URL.
   * @param {string} [logoPath] - Logo file path.
   * @returns {string} Full logo URL.
   * @example
   * const logoUrl = TemplateService.getLogoUrl();
   * // Returns: http://localhost:1337/img/amexing_logo_horizontal.avif (dev)
   * // Returns: https://amexingexperience.com/img/amexing_logo_horizontal.avif (prod)
   */
  static getLogoUrl(logoPath = '/img/amexing_logo_horizontal.avif') {
    const instance = new TemplateService();
    const baseUrl = instance.getBaseUrl();
    return `${baseUrl}${logoPath}`;
  }

  /**
   * Get asset URL with environment-aware base URL.
   * @param {string} assetPath - Asset path (e.g., '/img/icon.png').
   * @returns {string} Full asset URL.
   * @example
   * const iconUrl = TemplateService.getAssetUrl('/img/email-icon.png');
   */
  static getAssetUrl(assetPath) {
    const instance = new TemplateService();
    const baseUrl = instance.getBaseUrl();
    return `${baseUrl}${assetPath}`;
  }

  /**
   * Load template from file system.
   * @param {string} templateName - Template name (without extension).
   * @param {string} [type] - Template type ('html' or 'txt').
   * @returns {string} Template content.
   * @private
   * @example
   * const html = this.loadTemplate('booking_confirmation', 'html');
   * const text = this.loadTemplate('booking_confirmation', 'txt');
   */
  loadTemplate(templateName, type = 'html') {
    const cacheKey = `${templateName}.${type}`;

    // Return from cache if enabled and available
    if (this.cacheEnabled && this.templateCache.has(cacheKey)) {
      logger.debug('[TemplateService] Loaded template from cache', {
        templateName,
        type,
      });
      return this.templateCache.get(cacheKey);
    }

    try {
      const templatePath = path.join(this.templatesPath, `${templateName}.${type}`);

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templateName}.${type}`);
      }

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = fs.readFileSync(templatePath, 'utf-8');

      // Cache if enabled
      if (this.cacheEnabled) {
        this.templateCache.set(cacheKey, content);
      }

      logger.debug('[TemplateService] Loaded template from file', {
        templateName,
        type,
        path: templatePath,
      });

      return content;
    } catch (error) {
      logger.error('[TemplateService] Error loading template', {
        templateName,
        type,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Substitute placeholders in template with provided variables.
   *
   * Replaces {{VARIABLE}} placeholders with values from variables object.
   * Preserves placeholders that have no matching variable.
   * @param {string} template - Template content with placeholders.
   * @param {object} variables - Variables to substitute.
   * @returns {string} Template with substituted variables.
   * @private
   * @example
   * const result = this.substituteVariables('Hello {{NAME}}!', { NAME: 'Juan' });
   * // Returns: 'Hello Juan!'
   */
  substituteVariables(template, variables) {
    if (!template || typeof template !== 'string') {
      throw new Error('Template must be a non-empty string');
    }

    if (!variables || typeof variables !== 'object') {
      throw new Error('Variables must be an object');
    }

    // Replace all {{VARIABLE}} placeholders (supports Spanish characters like Ñ)
    const result = template.replace(/\{\{([A-ZÁÉÍÓÚÑ_0-9]+)\}\}/gi, (match, key) => {
      // Try exact match first, then case-insensitive
      if (key in variables) {
        const value = variables[key];
        // Handle null/undefined as empty string
        return value !== null && value !== undefined ? String(value) : '';
      }
      // Try uppercase match for compatibility
      const upperKey = key.toUpperCase();
      if (upperKey in variables) {
        const value = variables[upperKey];
        return value !== null && value !== undefined ? String(value) : '';
      }
      // Preserve placeholder if no variable provided
      return match;
    });

    logger.debug('[TemplateService] Substituted template variables', {
      variablesProvided: Object.keys(variables).length,
      placeholdersFound: (template.match(/\{\{([A-ZÁÉÍÓÚÑ_0-9]+)\}\}/gi) || []).length,
    });

    return result;
  }

  /**
   * Render email template with variables.
   * @param {string} templateName - Template name (without extension).
   * @param {object} variables - Variables to substitute in template.
   * @param {object} [options] - Rendering options.
   * @param {boolean} [options.includeText] - Include plain text version.
   * @returns {object} Rendered template(s).
   * @example
   * const { html, text } = TemplateService.render('booking_confirmation', {
   *   LOGO_URL: TemplateService.getLogoUrl(),
   *   NOMBRE_CLIENTE: 'Juan Pérez',
   *   NUMERO_RESERVA: 'AMX-12345',
   *   AÑO: new Date().getFullYear()
   * }, { includeText: true });
   */
  static render(templateName, variables, options = {}) {
    const instance = new TemplateService();
    const { includeText = false } = options;

    try {
      // Load HTML template
      const htmlTemplate = instance.loadTemplate(templateName, 'html');
      const html = instance.substituteVariables(htmlTemplate, variables);

      const result = { html };

      // Load text template if requested
      if (includeText) {
        try {
          const textTemplate = instance.loadTemplate(templateName, 'txt');
          result.text = instance.substituteVariables(textTemplate, variables);
        } catch (error) {
          logger.warn('[TemplateService] Text template not found, skipping', {
            templateName,
            error: error.message,
          });
          result.text = null;
        }
      }

      logger.info('[TemplateService] Rendered template', {
        templateName,
        includeText,
        htmlLength: html.length,
        textLength: result.text ? result.text.length : 0,
      });

      return result;
    } catch (error) {
      logger.error('[TemplateService] Error rendering template', {
        templateName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Validate template has all required placeholders.
   * @param {string} templateName - Template name.
   * @param {Array<string>} requiredPlaceholders - Required placeholder names.
   * @returns {object} Validation result.
   * @example
   * const validation = TemplateService.validateTemplate('booking_confirmation', [
   *   'NOMBRE_CLIENTE', 'NUMERO_RESERVA', 'FECHA'
   * ]);
   * if (!validation.valid) {
   *   console.error('Missing placeholders:', validation.missing);
   * }
   */
  static validateTemplate(templateName, requiredPlaceholders) {
    const instance = new TemplateService();

    try {
      const htmlTemplate = instance.loadTemplate(templateName, 'html');

      // Extract all placeholders from template
      const placeholderMatches = htmlTemplate.match(/\{\{(\w+)\}\}/g) || [];
      const foundPlaceholders = placeholderMatches.map((match) => match.replace(/\{\{|\}\}/g, ''));

      // Check for missing required placeholders
      const missing = requiredPlaceholders.filter(
        (required) => !foundPlaceholders.includes(required)
      );

      const valid = missing.length === 0;

      logger.debug('[TemplateService] Validated template', {
        templateName,
        valid,
        foundCount: foundPlaceholders.length,
        requiredCount: requiredPlaceholders.length,
        missingCount: missing.length,
      });

      return {
        valid,
        found: foundPlaceholders,
        required: requiredPlaceholders,
        missing,
        extra: foundPlaceholders.filter(
          (found) => !requiredPlaceholders.includes(found)
        ),
      };
    } catch (error) {
      logger.error('[TemplateService] Error validating template', {
        templateName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List all available templates.
   * @returns {Array<string>} Template names (without extensions).
   * @example
   * const templates = TemplateService.listTemplates();
   * // Returns: ['booking_confirmation', 'welcome', 'password_reset']
   */
  static listTemplates() {
    const instance = new TemplateService();

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!fs.existsSync(instance.templatesPath)) {
        logger.warn('[TemplateService] Templates directory not found');
        return [];
      }

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = fs.readdirSync(instance.templatesPath);

      // Get unique template names (without extensions)
      const templates = [...new Set(
        files
          .filter((file) => file.endsWith('.html') || file.endsWith('.txt'))
          .map((file) => file.replace(/\.(html|txt)$/, ''))
      )];

      logger.debug('[TemplateService] Listed templates', {
        count: templates.length,
        templates,
      });

      return templates;
    } catch (error) {
      logger.error('[TemplateService] Error listing templates', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Clear template cache
   * Useful for development or when templates are updated.
   * @example
   * TemplateService.clearCache();
   */
  static clearCache() {
    const instance = new TemplateService();
    instance.templateCache.clear();

    logger.info('[TemplateService] Template cache cleared');
  }

  /**
   * Get common email variables for Amexing branding.
   * @returns {object} Common variables.
   * @example
   * const variables = {
   *   ...TemplateService.getCommonVariables(),
   *   NOMBRE_CLIENTE: 'Juan Pérez',
   *   NUMERO_RESERVA: 'AMX-12345'
   * };
   */
  static getCommonVariables() {
    return {
      LOGO_URL: this.getLogoUrl('/img/amexing_logo_vertical.avif'),
      AÑO: new Date().getFullYear(),
      TELEFONO: '+52 (415) 167 39 90',
      TELEFONO_EMERGENCIAS: '+52 (415) 153 50 67',
      EMAIL_CONTACTO: 'contact@amexingexperience.com',
      SITIO_WEB: 'https://www.amexingexperience.com',
      AVISO_PRIVACIDAD: 'https://www.amexingexperience.com/privacidad',
      INSTAGRAM: 'https://www.instagram.com/amexingexperience/',
      FACEBOOK: 'https://www.facebook.com/amexingexperience/',
      TRIPADVISOR: 'https://www.tripadvisor.com.mx/Attraction_Review-g151932-d19425238-Reviews-Amexing_Experience_by_Angelica_Tours-San_Miguel_de_Allende_Central_Mexico_and_Gu.html',
      TAGLINE: 'Elevamos la experiencia de viaje en San Miguel de Allende',
      NOMBRE_EMPRESA: 'Amexing Experience',
      UBICACION: 'San Miguel de Allende, Guanajuato',
    };
  }
}

module.exports = TemplateService;
