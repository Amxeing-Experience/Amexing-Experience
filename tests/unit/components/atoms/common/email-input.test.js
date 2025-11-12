/**
 * Email Input Atom Component Tests
 * Tests for RFC 5322 compliant email validation component
 *
 * Component: src/presentation/views/atoms/common/email-input.ejs
 *
 * Features tested:
 * - HTML5 email input rendering
 * - RFC 5322 pattern validation
 * - Real-time JavaScript validation
 * - Email normalization (lowercase, trim)
 * - Bootstrap 5 validation feedback
 * - Accessibility compliance
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes }
  = require('../../../../helpers/ejsTestUtils');

describe('Email Input Atom Component', () => {
  const componentPath = 'atoms/common/email-input';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toBeTruthy();
      expect(html).toContain('<input');
      expect(html).toContain('type="email"');
    });

    test('should render as email input element', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      expect($('input[type="email"]').length).toBe(1);
    });

    test('should have form-control class', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveClasses(['form-control']);
    });
  });

  describe('Label Parameter', () => {
    test('should display custom label text', async () => {
      const html = await renderComponent(componentPath, {
        label: 'Correo Electrónico'
      });

      expect(html).toContainText('Correo Electrónico');
    });

    test('should show required asterisk when required=true', async () => {
      const html = await renderComponent(componentPath, {
        required: true
      });

      expect(html).toMatch(/<span[^>]*class="[^"]*text-danger[^"]*"[^>]*>\*<\/span>/);
    });

    test('should not show asterisk when required=false', async () => {
      const html = await renderComponent(componentPath, {
        required: false,
        label: 'Email Address'
      });
      const $ = parseHTML(html);

      expect($('.text-danger').text()).not.toContain('*');
    });

    test('should default to "Email" label', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContainText('Email');
    });
  });

  describe('Name and ID Parameters', () => {
    test('should use custom name attribute', async () => {
      const html = await renderComponent(componentPath, {
        name: 'userEmail'
      });

      expect(html).toHaveAttributes({ name: 'userEmail' });
    });

    test('should use custom id attribute', async () => {
      const html = await renderComponent(componentPath, {
        id: 'email-input-1'
      });

      expect(html).toHaveAttributes({ id: 'email-input-1' });
    });

    test('should generate random ID when not provided', async () => {
      const html = await renderComponent(componentPath, {
        name: 'testEmail'
      });
      const $ = parseHTML(html);
      const inputId = $('input[type="email"]').attr('id');

      expect(inputId).toBeDefined();
      expect(inputId.length).toBeGreaterThan(0);
    });

    test('should associate label with input via htmlFor', async () => {
      const html = await renderComponent(componentPath, {
        id: 'test-email',
        label: 'Test Email'
      });
      const $ = parseHTML(html);

      expect($('label').attr('for')).toBe('test-email');
      expect($('input').attr('id')).toBe('test-email');
    });
  });

  describe('Required Parameter', () => {
    test('should add required attribute when true', async () => {
      const html = await renderComponent(componentPath, {
        required: true
      });

      expect(html).toMatch(/<input[^>]*required[^>]*>/);
    });

    test('should not add required when false', async () => {
      const html = await renderComponent(componentPath, {
        required: false
      });
      const $ = parseHTML(html);

      expect($('input[type="email"]').attr('required')).toBeUndefined();
    });
  });

  describe('Value Parameter', () => {
    test('should pre-populate input with value', async () => {
      const html = await renderComponent(componentPath, {
        value: 'test@example.com'
      });

      expect(html).toHaveAttributes({ value: 'test@example.com' });
    });

    test('should handle empty value', async () => {
      const html = await renderComponent(componentPath, {
        value: ''
      });
      const $ = parseHTML(html);

      expect($('input[type="email"]').attr('value')).toBe('');
    });
  });

  describe('Placeholder Parameter', () => {
    test('should use custom placeholder', async () => {
      const html = await renderComponent(componentPath, {
        placeholder: 'tu@email.com'
      });

      expect(html).toHaveAttributes({ placeholder: 'tu@email.com' });
    });

    test('should use default placeholder when not provided', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);
      const placeholder = $('input[type="email"]').attr('placeholder');

      expect(placeholder).toBeDefined();
      expect(placeholder.length).toBeGreaterThan(0);
    });
  });

  describe('Email Pattern Validation', () => {
    test('should have HTML5 pattern attribute', async () => {
      const html = await renderComponent(componentPath);
      const attributes = extractAttributes(html, 'input[type="email"]');

      expect(attributes.pattern).toBeDefined();
      expect(attributes.pattern).toContain('@');
    });

    test('should validate simplified RFC 5322 email format', async () => {
      const html = await renderComponent(componentPath);
      const attributes = extractAttributes(html, 'input[type="email"]');

      // Check for simplified pattern: [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}
      expect(attributes.pattern).toMatch(/\[a-zA-Z0-9.*\]\+@/);
      expect(attributes.pattern).toContain('[.][a-zA-Z]');
    });

    test('should contain email validation regex in script', async () => {
      const html = await renderComponent(componentPath);

      // Check for RFC 5322 regex in JavaScript
      expect(html).toContain('EMAIL_PATTERN');
      expect(html).toMatch(/\/\^.*@.*\$\//); // Regex pattern
    });
  });

  describe('Maxlength Parameter', () => {
    test('should use custom maxlength', async () => {
      const html = await renderComponent(componentPath, {
        maxlength: 320
      });

      expect(html).toHaveAttributes({ maxlength: '320' });
    });

    test('should default to 255 characters', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveAttributes({ maxlength: '255' });
    });
  });

  describe('Autocomplete Parameter', () => {
    test('should use custom autocomplete value', async () => {
      const html = await renderComponent(componentPath, {
        autocomplete: 'work email'
      });

      expect(html).toHaveAttributes({ autocomplete: 'work email' });
    });

    test('should default to "email"', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveAttributes({ autocomplete: 'email' });
    });
  });

  describe('Help Text Parameter', () => {
    test('should display help text when provided', async () => {
      const html = await renderComponent(componentPath, {
        helpText: 'Usaremos este correo para contactarte'
      });

      expect(html).toContainText('Usaremos este correo para contactarte');
      expect(html).toContain('form-text');
    });

    test('should not render help text when empty', async () => {
      const html = await renderComponent(componentPath, {
        helpText: ''
      });
      const $ = parseHTML(html);

      expect($('.form-text').length).toBe(0);
    });
  });

  describe('Container Class Parameter', () => {
    test('should apply custom container classes', async () => {
      const html = await renderComponent(componentPath, {
        containerClass: 'mb-4 custom-email'
      });

      expect(html).toHaveClasses(['mb-4', 'custom-email']);
    });
  });

  describe('Validation Feedback', () => {
    test('should include invalid-feedback element', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('invalid-feedback');
    });

    test('should include valid-feedback element', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('valid-feedback');
    });

    test('should have validation messages in Spanish', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContainText('email válido');
      expect(html).toContainText('Email válido');
    });
  });

  describe('Styling', () => {
    test('should include scoped CSS styles', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('<style>');
      expect(html).toContain('.email-input-wrapper');
    });

    test('should have focus styles defined', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain(':focus');
      expect(html).toContain('border-color');
      expect(html).toContain('box-shadow');
    });

    test('should have validation state styles (is-valid, is-invalid)', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('.is-invalid');
      expect(html).toContain('.is-valid');
    });
  });

  describe('JavaScript Functionality', () => {
    test('should include email validation script', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('<script>');
      expect(html).toContain('initEmailValidation');
    });

    test('should have normalization logic (lowercase, trim)', async () => {
      const html = await renderComponent(componentPath);

      // Check for lowercase and trim logic
      expect(html).toContain('toLowerCase()');
      expect(html).toContain('trim()');
    });

    test('should have real-time validation on input', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'input\'');
      expect(html).toContain('is-valid');
      expect(html).toContain('is-invalid');
    });

    test('should have validation on blur', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'blur\'');
    });

    test('should have form submission validation', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'submit\'');
      expect(html).toContain('preventDefault');
    });
  });

  describe('Data Attributes', () => {
    test('should have data-email-input attribute', async () => {
      const html = await renderComponent(componentPath, {
        name: 'testEmail'
      });

      expect(html).toMatch(/data-email-input="testEmail"/);
    });
  });

  describe('Combined Parameters', () => {
    test('should handle all parameters together', async () => {
      const params = {
        name: 'userEmail',
        id: 'email-input-1',
        label: 'Correo Electrónico',
        required: true,
        value: 'test@example.com',
        placeholder: 'tu@email.com',
        helpText: 'Usaremos este correo para contactarte',
        maxlength: 320,
        autocomplete: 'work email',
        containerClass: 'mb-4 custom-email'
      };

      const html = await renderComponent(componentPath, params);

      expect(html).toHaveAttributes({
        name: 'userEmail',
        id: 'email-input-1',
        type: 'email',
        value: 'test@example.com',
        placeholder: 'tu@email.com',
        maxlength: '320',
        autocomplete: 'work email'
      });
      expect(html).toContainText('Correo Electrónico');
      expect(html).toContainText('Usaremos este correo para contactarte');
      expect(html).toHaveClasses(['mb-4', 'custom-email']);
      expect(html).toMatch(/required/);
    });
  });

  describe('Accessibility', () => {
    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, {
        label: 'Email Address',
        id: 'user-email'
      });

      expect(html).toBeAccessible();
    });

    test('should have proper label association', async () => {
      const html = await renderComponent(componentPath, {
        id: 'test-email',
        label: 'Test Email'
      });
      const $ = parseHTML(html);

      expect($('label').attr('for')).toBe('test-email');
      expect($('input').attr('id')).toBe('test-email');
    });

    test('should have validation feedback for screen readers', async () => {
      const html = await renderComponent(componentPath);

      // Check for feedback elements
      expect(html).toContain('invalid-feedback');
      expect(html).toContain('valid-feedback');
    });
  });

  describe('Error Handling', () => {
    test('should handle null parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        label: null,
        value: null,
        placeholder: null
      });

      expect(html).toBeTruthy();
      expect(html).toContain('type="email"');
    });

    test('should handle undefined parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        label: undefined,
        required: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContain('form-control');
    });
  });
});
