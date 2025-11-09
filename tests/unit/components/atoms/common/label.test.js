/**
 * Label Atom Component Tests
 * Tests for the form label component with required indicators
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Label Atom Component', () => {
  const componentPath = 'atoms/common/label';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('<label');
      expect(html).toHaveClasses(['form-label']);
      expect(html).toContainText('Label');
    });

    test('should render as a label element', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);
      expect($('label').length).toBe(1);
    });
  });

  describe('Text Parameter', () => {
    test('should display custom text', async () => {
      const html = await renderComponent(componentPath, { text: 'Username' });
      expect(html).toContainText('Username');
    });

    test('should handle empty text', async () => {
      const html = await renderComponent(componentPath, { text: '' });
      const $ = parseHTML(html);
      // Should still render but with empty content
      expect($('label').text().trim()).toBe('');
    });

    test('should handle special characters', async () => {
      const specialText = 'Email Address (required)';
      const html = await renderComponent(componentPath, { text: specialText });
      expect(html).toContainText(specialText);
    });
  });

  describe('HtmlFor Parameter', () => {
    test('should add for attribute when provided', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Email',
        htmlFor: 'email-input'
      });
      expect(html).toHaveAttributes({ for: 'email-input' });
    });

    test('should not add for attribute when empty', async () => {
      const html = await renderComponent(componentPath, { htmlFor: '' });
      const attributes = extractAttributes(html);
      expect(attributes.for).toBeUndefined();
    });

    test('should not add for attribute when undefined', async () => {
      const html = await renderComponent(componentPath, { htmlFor: undefined });
      const attributes = extractAttributes(html);
      expect(attributes.for).toBeUndefined();
    });
  });

  describe('Required Parameter', () => {
    test('should show asterisk when required is true', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Password',
        required: true
      });

      expect(html).toContainText('Password');
      expect(html).toMatch(/<span[^>]*class="[^"]*text-danger[^"]*"[^>]*>\*<\/span>/);
    });

    test('should not show asterisk when required is false', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Optional Field',
        required: false
      });

      expect(html).toContainText('Optional Field');
      expect(html).not.toMatch(/\*/);
    });

    test('should not show asterisk by default', async () => {
      const html = await renderComponent(componentPath, { text: 'Default Field' });
      expect(html).not.toMatch(/\*/);
    });
  });

  describe('Variant Parameter', () => {
    test('should apply small variant', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Small Label',
        variant: 'small'
      });
      expect(html).toHaveClasses(['form-label', 'fs-7']);
    });

    test('should apply large variant', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Large Label',
        variant: 'large'
      });
      expect(html).toHaveClasses(['form-label', 'fs-5', 'fw-semibold']);
    });

    test('should use default styling when variant is default', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Default Label',
        variant: 'default'
      });
      expect(html).toHaveClasses(['form-label']);
      expect(html).not.toMatch(/fs-[0-9]/);
    });
  });

  describe('Color Parameter', () => {
    test('should apply color class when provided', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Colored Label',
        color: 'primary'
      });
      expect(html).toHaveClasses(['form-label', 'text-primary']);
    });

    test('should handle different color values', async () => {
      const colors = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];

      for (const color of colors) {
        const html = await renderComponent(componentPath, {
          text: 'Test Label',
          color
        });
        expect(html).toHaveClasses(['form-label', `text-${color}`]);
      }
    });

    test('should not apply color class when empty', async () => {
      const html = await renderComponent(componentPath, {
        text: 'No Color',
        color: ''
      });
      expect(html).toHaveClasses(['form-label']);
      expect(html).not.toMatch(/text-/);
    });
  });

  describe('Additional Classes Parameter', () => {
    test('should apply additional classes', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Custom Label',
        additionalClasses: 'custom-label mb-2'
      });
      expect(html).toHaveClasses(['form-label', 'custom-label', 'mb-2']);
    });

    test('should handle single additional class', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Single Class',
        additionalClasses: 'highlight'
      });
      expect(html).toHaveClasses(['form-label', 'highlight']);
    });
  });

  describe('Combined Parameters', () => {
    test('should handle all parameters together', async () => {
      const params = {
        text: 'Complete Label',
        htmlFor: 'complete-input',
        required: true,
        variant: 'large',
        color: 'primary',
        additionalClasses: 'custom-required-label'
      };

      const html = await renderComponent(componentPath, params);

      expect(html).toContainText('Complete Label');
      expect(html).toHaveAttributes({ for: 'complete-input' });
      expect(html).toHaveClasses([
        'form-label', 'fs-5', 'fw-semibold', 'text-primary', 'custom-required-label'
      ]);
      expect(html).toMatch(/\*/); // Should have required asterisk
    });

    test('should prioritize variant classes correctly', async () => {
      const params = {
        text: 'Priority Test',
        variant: 'small',
        color: 'danger'
      };

      const html = await renderComponent(componentPath, params);
      const classes = extractClasses(html);

      expect(classes).toContain('form-label');
      expect(classes).toContain('fs-7');
      expect(classes).toContain('text-danger');
    });
  });

  describe('HTML Output Validation', () => {
    test('should produce valid HTML structure', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Valid Label',
        htmlFor: 'valid-input'
      });
      const $ = parseHTML(html);

      expect($('label').length).toBe(1);
      expect($('label').attr('for')).toBe('valid-input');
      expect($('label').text()).toContain('Valid Label');
    });

    test('should handle required asterisk structure', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Required Label',
        required: true
      });
      const $ = parseHTML(html);

      expect($('label').length).toBe(1);
      expect($('span').text()).toBe('*');
      expect($('span').hasClass('text-danger')).toBeTruthy();
      expect($('span').hasClass('ms-1')).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Accessible Label',
        htmlFor: 'accessible-input'
      });
      expect(html).toBeAccessible();
    });

    test('should maintain accessibility with required indicator', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Required Field',
        htmlFor: 'required-input',
        required: true
      });
      expect(html).toBeAccessible();
    });

    test('should properly associate with form controls', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Username',
        htmlFor: 'username-input'
      });

      const $ = parseHTML(html);
      expect($('label').attr('for')).toBe('username-input');
    });
  });

  describe('Error Handling', () => {
    test('should handle null parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        text: null,
        htmlFor: null,
        required: null,
        variant: null,
        color: null
      });

      expect(html).toBeTruthy();
      expect(html).toContain('<label');
    });

    test('should handle undefined parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        text: undefined,
        htmlFor: undefined,
        required: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContain('form-label');
    });

    test('should handle boolean edge cases', async () => {
      // Test with string 'false' - should not be treated as boolean false
      const html = await renderComponent(componentPath, {
        text: 'Boolean Test',
        required: 'false' // String, not boolean
      });

      // String values should be truthy
      expect(html).toMatch(/\*/);
    });
  });
});