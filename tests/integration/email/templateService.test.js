/**
 * TemplateService Integration Tests
 *
 * Tests email template rendering, variable substitution,
 * and dynamic asset URL generation.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const TemplateService = require('../../../src/infrastructure/email/TemplateService');
const fs = require('fs');
const path = require('path');

describe('TemplateService Integration Tests', () => {
  describe('Template Loading', () => {
    it('should load booking confirmation HTML template', () => {
      const service = new TemplateService();
      const template = service.loadTemplate('booking_confirmation', 'html');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
      expect(template).toContain('<!DOCTYPE html>');
      expect(template).toContain('{{NOMBRE_CLIENTE}}');
    });

    it('should load booking confirmation TXT template', () => {
      const service = new TemplateService();
      const template = service.loadTemplate('booking_confirmation', 'txt');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template).toContain('AMEXING EXPERIENCE');
      expect(template).toContain('{{NOMBRE_CLIENTE}}');
    });

    it('should load welcome email template', () => {
      const service = new TemplateService();
      const template = service.loadTemplate('welcome', 'html');

      expect(template).toBeDefined();
      expect(template).toContain('Bienvenido');
      expect(template).toContain('{{NOMBRE_USUARIO}}');
    });

    it('should load password reset template', () => {
      const service = new TemplateService();
      const template = service.loadTemplate('password_reset', 'html');

      expect(template).toBeDefined();
      expect(template).toContain('Restablecer Contraseña');
      expect(template).toContain('{{URL_RESET}}');
    });

    it('should throw error for non-existent template', () => {
      const service = new TemplateService();

      expect(() => {
        service.loadTemplate('non_existent_template', 'html');
      }).toThrow('Template not found');
    });
  });

  describe('Variable Substitution', () => {
    it('should substitute simple variables', () => {
      const service = new TemplateService();
      const template = 'Hello {{NAME}}, welcome to {{COMPANY}}!';
      const result = service.substituteVariables(template, {
        NAME: 'Juan Pérez',
        COMPANY: 'Amexing Experience',
      });

      expect(result).toBe('Hello Juan Pérez, welcome to Amexing Experience!');
    });

    it('should substitute multiple occurrences of same variable', () => {
      const service = new TemplateService();
      const template = '{{NAME}} is {{NAME}} and {{NAME}} again';
      const result = service.substituteVariables(template, {
        NAME: 'Test',
      });

      expect(result).toBe('Test is Test and Test again');
    });

    it('should preserve placeholders without matching variables', () => {
      const service = new TemplateService();
      const template = 'Hello {{NAME}}, your code is {{CODE}}';
      const result = service.substituteVariables(template, {
        NAME: 'Juan',
      });

      expect(result).toBe('Hello Juan, your code is {{CODE}}');
    });

    it('should handle null and undefined values', () => {
      const service = new TemplateService();
      const template = 'Value1: {{VAL1}}, Value2: {{VAL2}}';
      const result = service.substituteVariables(template, {
        VAL1: null,
        VAL2: undefined,
      });

      expect(result).toBe('Value1: , Value2: ');
    });

    it('should convert non-string values to strings', () => {
      const service = new TemplateService();
      const template = 'Number: {{NUM}}, Boolean: {{BOOL}}';
      const result = service.substituteVariables(template, {
        NUM: 123,
        BOOL: true,
      });

      expect(result).toBe('Number: 123, Boolean: true');
    });

    it('should throw error for invalid template', () => {
      const service = new TemplateService();

      expect(() => {
        service.substituteVariables(null, {});
      }).toThrow('Template must be a non-empty string');
    });

    it('should throw error for invalid variables', () => {
      const service = new TemplateService();

      expect(() => {
        service.substituteVariables('{{TEST}}', null);
      }).toThrow('Variables must be an object');
    });
  });

  describe('Template Rendering', () => {
    it('should render booking confirmation with all variables', () => {
      const variables = {
        ...TemplateService.getCommonVariables(),
        ASUNTO: 'Confirmación de Reserva',
        TITULO_PRINCIPAL: 'Su reserva está confirmada',
        NOMBRE_CLIENTE: 'Juan Pérez',
        CONTENIDO_MENSAJE: 'Gracias por reservar',
        NUMERO_RESERVA: 'AMX-12345',
        TIPO_SERVICIO: 'Traslado Aeropuerto',
        FECHA: '25 de enero, 2025',
        HORA: '10:00 AM',
        LUGAR: 'Hotel Rosewood',
        URL_BOTON: 'http://localhost:1337/bookings/AMX-12345',
        TEXTO_BOTON: 'Ver Detalles',
        MENSAJE_ADICIONAL: 'Nos vemos pronto',
      };

      const { html, text } = TemplateService.render(
        'booking_confirmation',
        variables,
        { includeText: true }
      );

      // Verify HTML rendering
      expect(html).toBeDefined();
      expect(html).toContain('Juan Pérez');
      expect(html).toContain('AMX-12345');
      expect(html).toContain('Traslado Aeropuerto');
      expect(html).not.toContain('{{NOMBRE_CLIENTE}}');
      expect(html).not.toContain('{{NUMERO_RESERVA}}');

      // Verify TXT rendering
      expect(text).toBeDefined();
      expect(text).toContain('Juan Pérez');
      expect(text).toContain('AMX-12345');
    });

    it('should render welcome email template', () => {
      const variables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: 'María García',
        EMAIL_USUARIO: 'maria@example.com',
        TIPO_CUENTA: 'Cliente Premium',
        URL_DASHBOARD: 'http://localhost:1337/dashboard',
      };

      const { html } = TemplateService.render('welcome', variables);

      expect(html).toBeDefined();
      expect(html).toContain('María García');
      expect(html).toContain('maria@example.com');
      expect(html).toContain('Cliente Premium');
      expect(html).not.toContain('{{NOMBRE_USUARIO}}');
    });

    it('should render password reset template', () => {
      const variables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: 'Pedro López',
        URL_RESET: 'http://localhost:1337/reset?token=abc123',
        TIEMPO_EXPIRACION: '1 hora',
      };

      const { html } = TemplateService.render('password_reset', variables);

      expect(html).toBeDefined();
      expect(html).toContain('Pedro López');
      expect(html).toContain('http://localhost:1337/reset?token=abc123');
      expect(html).toContain('1 hora');
      expect(html).not.toContain('{{URL_RESET}}');
    });

    it('should include text version when requested', () => {
      const variables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: 'Test User',
        EMAIL_USUARIO: 'test@example.com',
        TIPO_CUENTA: 'Cliente',
        URL_DASHBOARD: 'http://localhost:1337',
      };

      const result = TemplateService.render('welcome', variables, {
        includeText: true,
      });

      expect(result.html).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.text).toContain('Test User');
    });

    it('should not include text version by default', () => {
      const variables = {
        ...TemplateService.getCommonVariables(),
        NOMBRE_USUARIO: 'Test User',
        EMAIL_USUARIO: 'test@example.com',
        TIPO_CUENTA: 'Cliente',
        URL_DASHBOARD: 'http://localhost:1337',
      };

      const result = TemplateService.render('welcome', variables);

      expect(result.html).toBeDefined();
      expect(result.text).toBeUndefined();
    });
  });

  describe('Logo URL Generation', () => {
    it('should generate logo URL with base URL', () => {
      const logoUrl = TemplateService.getLogoUrl();

      expect(logoUrl).toBeDefined();
      expect(logoUrl).toContain('img/amexing_logo_horizontal.avif');
    });

    it('should include development base URL', () => {
      // In test environment with APP_BASE_URL set
      const logoUrl = TemplateService.getLogoUrl();
      const expectedBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 1337}`;

      expect(logoUrl).toContain(expectedBaseUrl);
      expect(logoUrl).toBe(`${expectedBaseUrl}/img/amexing_logo_horizontal.avif`);
    });

    it('should generate asset URL', () => {
      const assetUrl = TemplateService.getAssetUrl('/img/icon.png');
      const expectedBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 1337}`;

      expect(assetUrl).toBeDefined();
      expect(assetUrl).toContain('/img/icon.png');
      expect(assetUrl).toContain(expectedBaseUrl);
    });
  });

  describe('Common Variables', () => {
    it('should return common branding variables', () => {
      const vars = TemplateService.getCommonVariables();

      expect(vars).toBeDefined();
      expect(vars).toHaveProperty('LOGO_URL');
      expect(vars).toHaveProperty('AÑO');
      expect(vars).toHaveProperty('TELEFONO');
      expect(vars).toHaveProperty('EMAIL_CONTACTO');
      expect(vars).toHaveProperty('SITIO_WEB');
      expect(vars).toHaveProperty('INSTAGRAM');
      expect(vars).toHaveProperty('FACEBOOK');
      expect(vars).toHaveProperty('TRIPADVISOR');
      expect(vars).toHaveProperty('TAGLINE');
    });

    it('should have correct contact information', () => {
      const vars = TemplateService.getCommonVariables();

      expect(vars.TELEFONO).toBe('+52 (415) 167 39 90');
      expect(vars.TELEFONO_EMERGENCIAS).toBe('+52 (415) 153 50 67');
      expect(vars.EMAIL_CONTACTO).toBe('contact@amexingexperience.com');
      expect(vars.SITIO_WEB).toBe('https://www.amexingexperience.com');
    });

    it('should have correct social media links', () => {
      const vars = TemplateService.getCommonVariables();

      expect(vars.INSTAGRAM).toBe('https://www.instagram.com/amexingexperience/');
      expect(vars.FACEBOOK).toBe('https://www.facebook.com/amexingexperience/');
      expect(vars.TRIPADVISOR).toContain('tripadvisor.com.mx');
    });

    it('should have current year', () => {
      const vars = TemplateService.getCommonVariables();
      const currentYear = new Date().getFullYear();

      expect(vars.AÑO).toBe(currentYear);
    });

    it('should have company information', () => {
      const vars = TemplateService.getCommonVariables();

      expect(vars.NOMBRE_EMPRESA).toBe('Amexing Experience');
      expect(vars.UBICACION).toBe('San Miguel de Allende, Guanajuato');
      expect(vars.TAGLINE).toBe('Elevamos la experiencia de viaje en San Miguel de Allende');
    });
  });

  describe('Template Validation', () => {
    it('should validate template has required placeholders', () => {
      const validation = TemplateService.validateTemplate('booking_confirmation', [
        'NOMBRE_CLIENTE',
        'NUMERO_RESERVA',
        'FECHA',
      ]);

      expect(validation.valid).toBe(true);
      expect(validation.found).toContain('NOMBRE_CLIENTE');
      expect(validation.found).toContain('NUMERO_RESERVA');
      expect(validation.missing).toHaveLength(0);
    });

    it('should detect missing required placeholders', () => {
      const validation = TemplateService.validateTemplate('welcome', [
        'NOMBRE_USUARIO',
        'NON_EXISTENT_PLACEHOLDER',
      ]);

      expect(validation.valid).toBe(false);
      expect(validation.found).toContain('NOMBRE_USUARIO');
      expect(validation.missing).toContain('NON_EXISTENT_PLACEHOLDER');
    });

    it('should list extra placeholders', () => {
      const validation = TemplateService.validateTemplate('booking_confirmation', [
        'NOMBRE_CLIENTE',
      ]);

      expect(validation.extra).toBeDefined();
      expect(validation.extra.length).toBeGreaterThan(0);
      expect(validation.extra).toContain('NUMERO_RESERVA');
    });
  });

  describe('Template Listing', () => {
    it('should list all available templates', () => {
      const templates = TemplateService.listTemplates();

      expect(templates).toBeDefined();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThanOrEqual(3);
      expect(templates).toContain('booking_confirmation');
      expect(templates).toContain('welcome');
      expect(templates).toContain('password_reset');
    });

    it('should return unique template names', () => {
      const templates = TemplateService.listTemplates();

      const uniqueTemplates = [...new Set(templates)];
      expect(templates.length).toBe(uniqueTemplates.length);
    });
  });

  describe('Template Cache', () => {
    it('should cache templates in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const service = new TemplateService();

      // Load template first time
      const template1 = service.loadTemplate('welcome', 'html');

      // Load same template second time (should come from cache)
      const template2 = service.loadTemplate('welcome', 'html');

      expect(template1).toBe(template2);
      expect(service.templateCache.size).toBeGreaterThan(0);

      process.env.NODE_ENV = originalEnv;
    });

    it('should not cache templates in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const service = new TemplateService();

      service.loadTemplate('welcome', 'html');

      expect(service.cacheEnabled).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it('should clear template cache', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const service = new TemplateService();
      service.loadTemplate('welcome', 'html');

      expect(service.templateCache.size).toBeGreaterThan(0);

      TemplateService.clearCache();

      const newService = new TemplateService();
      expect(newService.templateCache.size).toBe(0);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Template File Integrity', () => {
    it('should have matching HTML and TXT templates', () => {
      const templates = TemplateService.listTemplates();

      templates.forEach(templateName => {
        const htmlPath = path.join(
          __dirname,
          '../../../src/infrastructure/email/templates',
          `${templateName}.html`
        );
        const txtPath = path.join(
          __dirname,
          '../../../src/infrastructure/email/templates',
          `${templateName}.txt`
        );

        expect(fs.existsSync(htmlPath)).toBe(true);
        expect(fs.existsSync(txtPath)).toBe(true);
      });
    });

    it('should have valid HTML structure in templates', () => {
      const service = new TemplateService();
      const templates = ['booking_confirmation', 'welcome', 'password_reset'];

      templates.forEach(templateName => {
        const html = service.loadTemplate(templateName, 'html');

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html');
        expect(html).toContain('</html>');
        expect(html).toContain('<head>');
        expect(html).toContain('</head>');
        expect(html).toContain('<body');
        expect(html).toContain('</body>');
      });
    });

    it('should have responsive design in templates', () => {
      const service = new TemplateService();
      const html = service.loadTemplate('booking_confirmation', 'html');

      expect(html).toContain('viewport');
      expect(html).toContain('max-width');
      expect(html).toContain('@media');
    });

    it('should include Amexing branding in all templates', () => {
      const service = new TemplateService();
      const templates = ['booking_confirmation', 'welcome', 'password_reset'];

      templates.forEach(templateName => {
        const html = service.loadTemplate(templateName, 'html');

        expect(html).toContain('{{LOGO_URL}}');
        expect(html).toContain('{{TAGLINE}}');
        expect(html).toContain('{{AÑO}}');
        expect(html).toContain('Amexing Experience');
      });
    });
  });
});
