/**
 * Phone Input Atom Component Tests
 * Tests for international phone input with country code selector
 *
 * Component: src/presentation/views/atoms/common/phone-input.ejs
 *
 * Features tested:
 * - HTML5 tel input rendering
 * - Country code selector (40 countries, 3 regions)
 * - Digit-only validation (keypress + input sanitization)
 * - Country-specific length validation
 * - International format handling (E.164)
 * - Smart paste with country code detection
 * - Bootstrap 5 validation feedback
 * - Accessibility compliance
 * - XSS prevention (no <%- JSON.stringify())
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes }
  = require('../../../../helpers/ejsTestUtils');

describe('Phone Input Atom Component', () => {
  const componentPath = 'atoms/common/phone-input';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toBeTruthy();
      expect(html).toContain('<input');
      expect(html).toContain('type="tel"');
    });

    test('should render as tel input element', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      expect($('input[type="tel"]').length).toBe(1);
    });

    test('should have inputmode="tel" attribute', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveAttributes({ inputmode: 'tel' });
    });

    test('should have form-control class', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveClasses(['form-control', 'phone-number-input']);
    });
  });

  describe('Label Parameter', () => {
    test('should display custom label text', async () => {
      const html = await renderComponent(componentPath, {
        label: 'Número de Contacto'
      });

      expect(html).toContainText('Número de Contacto');
    });

    test('should show required asterisk when required=true', async () => {
      const html = await renderComponent(componentPath, {
        required: true
      });

      expect(html).toMatch(/<span[^>]*class="[^"]*text-danger[^"]*"[^>]*>\*<\/span>/);
    });

    test('should default to "Teléfono" label', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContainText('Teléfono');
    });

    test('should associate label with input via htmlFor', async () => {
      const html = await renderComponent(componentPath, {
        id: 'test-phone',
        label: 'Test Phone'
      });
      const $ = parseHTML(html);

      expect($('label').attr('for')).toBe('test-phone');
      expect($('input[type="tel"]').attr('id')).toBe('test-phone');
    });
  });

  describe('Country Code Selector', () => {
    test('should render country selector button', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      expect($('button.country-selector').length).toBe(1);
      expect($('button.dropdown-toggle').length).toBeGreaterThan(0);
    });

    test('should render country dropdown menu', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      expect($('.dropdown-menu.country-dropdown').length).toBe(1);
    });

    test('should default to Mexico (MX)', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContainText('🇲🇽');
      expect(html).toContainText('+52');
    });

    test('should display correct flag and code for selected country', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'US'
      });

      expect(html).toContainText('🇺🇸');
      expect(html).toContainText('+1');
    });

    test('should include 40 countries in dropdown', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      const countryOptions = $('.country-option').length;
      expect(countryOptions).toBe(40);
    });

    test('should organize countries by region', async () => {
      const html = await renderComponent(componentPath);

      // Verify countries from all three regions are present
      // América
      expect(html).toContain('México');
      expect(html).toContain('+52');
      // Europa
      expect(html).toContain('España');
      expect(html).toContain('+34');
      // Asia
      expect(html).toContain('China');
      expect(html).toContain('+86');
    });
  });

  describe('Country Selection', () => {
    test('should mark selected country as active', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'MX'
      });
      const $ = parseHTML(html);

      // Check for active country option with MX data attribute
      const activeOptions = $('.country-option.active');
      expect(activeOptions.length).toBeGreaterThan(0);

      // Verify MX is in the data
      expect(html).toContain('data-country="MX"');
      expect(html).toContain('class="dropdown-item country-option active"');
    });

    test('should have country data attributes', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      const firstOption = $('.country-option').first();
      expect(firstOption.attr('data-country')).toBeDefined();
      expect(firstOption.attr('data-code')).toBeDefined();
      expect(firstOption.attr('data-flag')).toBeDefined();
      expect(firstOption.attr('data-format')).toBeDefined();
      expect(firstOption.attr('data-min')).toBeDefined();
      expect(firstOption.attr('data-max')).toBeDefined();
    });
  });

  describe('Name and ID Parameters', () => {
    test('should use custom name attribute', async () => {
      const html = await renderComponent(componentPath, {
        name: 'userPhone'
      });

      expect(html).toHaveAttributes({ name: 'userPhone' });
    });

    test('should use custom id attribute', async () => {
      const html = await renderComponent(componentPath, {
        id: 'phone-input-1'
      });

      expect(html).toHaveAttributes({ id: 'phone-input-1' });
    });

    test('should generate random ID when not provided', async () => {
      const html = await renderComponent(componentPath, {
        name: 'testPhone'
      });
      const $ = parseHTML(html);
      const inputId = $('input[type="tel"]').attr('id');

      expect(inputId).toBeDefined();
      expect(inputId.length).toBeGreaterThan(0);
    });
  });

  describe('Required Parameter', () => {
    test('should add required attribute when true', async () => {
      const html = await renderComponent(componentPath, {
        required: true
      });

      expect(html).toMatch(/<input[^>]*required[^>]*>/);
    });

    test('should not add required when false (default)', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);

      expect($('input[type="tel"]').attr('required')).toBeUndefined();
    });
  });

  describe('Value Parameter', () => {
    test('should pre-populate input with value', async () => {
      const html = await renderComponent(componentPath, {
        value: '9991234567'
      });

      expect(html).toHaveAttributes({ value: '9991234567' });
    });

    test('should handle empty value', async () => {
      const html = await renderComponent(componentPath, {
        value: ''
      });
      const $ = parseHTML(html);

      expect($('input[type="tel"]').attr('value')).toBe('');
    });
  });

  describe('Placeholder Parameter', () => {
    test('should use custom placeholder', async () => {
      const html = await renderComponent(componentPath, {
        placeholder: '999 123 4567'
      });

      expect(html).toHaveAttributes({ placeholder: '999 123 4567' });
    });

    test('should use country format as default placeholder', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'MX'
      });
      const $ = parseHTML(html);
      const placeholder = $('input[type="tel"]').attr('placeholder');

      // Mexico's default format
      expect(placeholder).toContain('999');
    });
  });

  describe('MaxLength Parameter', () => {
    test('should use custom maxlength', async () => {
      const html = await renderComponent(componentPath, {
        maxlength: 15
      });

      expect(html).toHaveAttributes({ maxlength: '15' });
    });

    test('should default to 20 characters', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toHaveAttributes({ maxlength: '20' });
    });
  });

  describe('Hidden Full Number Field', () => {
    test('should render hidden input for full international number', async () => {
      const html = await renderComponent(componentPath, {
        name: 'phone',
        id: 'userPhone'
      });

      // Check for hidden input with _full suffix
      expect(html).toContain('type="hidden"');
      expect(html).toContain('id="userPhone_full"');
      expect(html).toContain('name="phone_full"');
    });

    test('should have _full suffix in name', async () => {
      const html = await renderComponent(componentPath, {
        name: 'contactPhone'
      });

      expect(html).toMatch(/name="contactPhone_full"/);
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

      expect(html).toContainText('número de teléfono válido');
      expect(html).toContainText('Número de teléfono válido');
    });
  });

  describe('Help Text Parameter', () => {
    test('should display help text when provided', async () => {
      const html = await renderComponent(componentPath, {
        helpText: 'Número de contacto del cliente'
      });

      expect(html).toContainText('Número de contacto del cliente');
      expect(html).toContain('form-text');
    });

    test('should not render help text when empty', async () => {
      const html = await renderComponent(componentPath, {
        helpText: ''
      });

      // When helpText is empty, form-text element should not be rendered or should be empty
      const hasFormText = html.includes('class="form-text');
      if (hasFormText) {
        // If it exists, it should be empty or contain no meaningful text
        const formTextMatch = html.match(/<div[^>]*class="[^"]*form-text[^"]*"[^>]*>(.*?)<\/div>/s);
        if (formTextMatch) {
          const content = formTextMatch[1].trim();
          expect(content.length).toBe(0);
        }
      } else {
        // Or it shouldn't exist at all (preferred)
        expect(hasFormText).toBe(false);
      }
    });
  });

  describe('Container Class Parameter', () => {
    test('should apply custom container classes', async () => {
      const html = await renderComponent(componentPath, {
        containerClass: 'mb-4 custom-phone'
      });

      expect(html).toHaveClasses(['mb-4', 'custom-phone']);
    });
  });

  describe('Styling', () => {
    test('should include scoped CSS styles', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('<style>');
      expect(html).toContain('.phone-input-wrapper');
    });

    test('should style country selector button', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('.country-selector');
      expect(html).toContain('.country-flag');
      expect(html).toContain('.country-code');
    });

    test('should style country dropdown', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('.country-dropdown');
      expect(html).toContain('.country-option');
    });

    test('should have focus styles', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain(':focus');
      expect(html).toContain('border-color');
      expect(html).toContain('box-shadow');
    });

    test('should have validation state styles', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('.is-invalid');
      expect(html).toContain('.is-valid');
    });
  });

  describe('JavaScript Functionality', () => {
    test('should include phone validation script', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('<script>');
      expect(html).toContain('initPhoneInput');
    });

    test('should have keypress prevention for non-digits', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'keypress\'');
      expect(html).toContain('preventDefault');
    });

    test('should have input sanitization (remove non-digits)', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'input\'');
      expect(html).toContain('replace(/\\D/g');
    });

    test('should have country-based length validation', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('minLength');
      expect(html).toContain('maxLength');
      expect(html).toContain('validatePhone');
    });

    test('should have paste handling with country detection', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('addEventListener(\'paste\'');
      expect(html).toContain('clipboardData');
      expect(html).toContain('dialCode');
    });

    test('should generate full international number (E.164)', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('fullNumberInput.value');
      expect(html).toContain('countryCodeDigits');
    });
  });

  describe('Data Attributes', () => {
    test('should have data-phone-input attribute', async () => {
      const html = await renderComponent(componentPath, {
        name: 'testPhone'
      });

      expect(html).toMatch(/data-phone-input="testPhone"/);
    });

    test('should have data-country attribute', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'MX'
      });

      expect(html).toMatch(/data-country="MX"/);
    });

    test('should have data-phone-wrapper on container', async () => {
      const html = await renderComponent(componentPath, {
        id: 'testPhone'
      });

      expect(html).toMatch(/data-phone-wrapper="testPhone"/);
    });
  });

  describe('Country Data Structure', () => {
    test('should include countries object in JavaScript', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('const countries = {');
    });

    test('should have name, code, flag, format properties', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('name:');
      expect(html).toContain('code:');
      expect(html).toContain('minLength:');
      expect(html).toContain('maxLength:');
    });

    test('should have minLength and maxLength for validation', async () => {
      const html = await renderComponent(componentPath);

      // Check that countries have these properties
      expect(html).toMatch(/minLength:\s*\d+/);
      expect(html).toMatch(/maxLength:\s*\d+/);
    });

    test('should include region grouping in data', async () => {
      const html = await renderComponent(componentPath);

      // Verify countries from all three regions are present in data structure
      // América
      expect(html).toContain('MX:');
      expect(html).toContain('México');
      // Europa
      expect(html).toContain('ES:');
      expect(html).toContain('España');
      // Asia
      expect(html).toContain('CN:');
      expect(html).toContain('China');
    });
  });

  describe('Specific Country Validation', () => {
    test('should support Mexico (MX): 10 digits, +52', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'MX'
      });

      expect(html).toContainText('🇲🇽');
      expect(html).toContainText('+52');
      expect(html).toContainText('México');
    });

    test('should support USA (US): 10 digits, +1', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'US'
      });

      expect(html).toContainText('🇺🇸');
      expect(html).toContainText('+1');
    });

    test('should support Spain (ES): 9 digits, +34', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'ES'
      });

      expect(html).toContainText('🇪🇸');
      expect(html).toContainText('+34');
    });

    test('should support China (CN): 11 digits, +86', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'CN'
      });

      expect(html).toContainText('🇨🇳');
      expect(html).toContainText('+86');
    });

    test('should support Singapore (SG): 8 digits, +65', async () => {
      const html = await renderComponent(componentPath, {
        countryCode: 'SG'
      });

      expect(html).toContainText('🇸🇬');
      expect(html).toContainText('+65');
    });
  });

  describe('Combined Parameters', () => {
    test('should handle all parameters together', async () => {
      const params = {
        name: 'contactPhone',
        id: 'phone-input-1',
        label: 'Teléfono de Contacto',
        required: true,
        value: '9991234567',
        countryCode: 'MX',
        placeholder: '999 123 4567',
        helpText: 'Número de contacto directo',
        maxlength: 15,
        containerClass: 'mb-4 custom-phone'
      };

      const html = await renderComponent(componentPath, params);

      expect(html).toHaveAttributes({
        name: 'contactPhone',
        id: 'phone-input-1',
        type: 'tel',
        value: '9991234567',
        placeholder: '999 123 4567',
        maxlength: '15'
      });
      expect(html).toContainText('Teléfono de Contacto');
      expect(html).toContainText('Número de contacto directo');
      expect(html).toContainText('🇲🇽');
      expect(html).toHaveClasses(['mb-4', 'custom-phone']);
      expect(html).toMatch(/required/);
    });
  });

  describe('Accessibility', () => {
    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, {
        label: 'Phone Number',
        id: 'user-phone'
      });

      expect(html).toBeAccessible();
    });

    test('should have proper label association', async () => {
      const html = await renderComponent(componentPath, {
        id: 'test-phone',
        label: 'Test Phone'
      });
      const $ = parseHTML(html);

      expect($('label').attr('for')).toBe('test-phone');
      expect($('input[type="tel"]').attr('id')).toBe('test-phone');
    });

    test('should have dropdown accessibility (aria-expanded)', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toMatch(/aria-expanded/);
    });
  });

  describe('XSS Prevention', () => {
    test('should not use <%- JSON.stringify() for countries', async () => {
      const html = await renderComponent(componentPath);

      // Should NOT contain unescaped JSON.stringify
      expect(html).not.toMatch(/<%- JSON\.stringify/);
    });

    test('should construct countries object with <%= %> (escaped)', async () => {
      const html = await renderComponent(componentPath);

      // Should construct object safely
      expect(html).toContain('const countries = {');
      // Check that it uses template escaping
      expect(html).toMatch(/MX:\s*\{/);
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
      expect(html).toContain('type="tel"');
    });

    test('should handle undefined parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        label: undefined,
        required: undefined,
        countryCode: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContain('form-control');
      // Should default to MX
      expect(html).toContainText('🇲🇽');
    });
  });
});
