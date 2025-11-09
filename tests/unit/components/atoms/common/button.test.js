/**
 * Button Atom Component Tests
 * Tests for the reusable button component with Bootstrap styling
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Button Atom Component', () => {
  const componentPath = 'atoms/common/button';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('<button');
      expect(html).toHaveClasses(['btn', 'btn-primary']);
      expect(html).toContainText('Button');
    });

    test('should render as a button element by default', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);
      expect($('button').length).toBe(1);
      expect($('a').length).toBe(0);
    });
  });

  describe('Button Type Parameter', () => {
    test('should use custom button type', async () => {
      const html = await renderComponent(componentPath, { type: 'submit' });
      expect(html).toHaveAttributes({ type: 'submit' });
    });

    test('should handle different button types', async () => {
      const types = ['button', 'submit', 'reset'];

      for (const type of types) {
        const html = await renderComponent(componentPath, { type });
        expect(html).toHaveAttributes({ type });
      }
    });

    test('should default to button type', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toHaveAttributes({ type: 'button' });
    });
  });

  describe('Button Variant Parameter', () => {
    test('should apply variant classes', async () => {
      const variants = [
        'primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'
      ];

      for (const variant of variants) {
        const html = await renderComponent(componentPath, { variant });
        expect(html).toHaveClasses(['btn', `btn-${variant}`]);
      }
    });

    test('should default to primary variant', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toHaveClasses(['btn', 'btn-primary']);
    });
  });

  describe('Button Size Parameter', () => {
    test('should apply size classes', async () => {
      const html = await renderComponent(componentPath, { size: 'lg' });
      expect(html).toHaveClasses(['btn', 'btn-primary', 'btn-lg']);
    });

    test('should handle different sizes', async () => {
      const sizes = ['sm', 'lg'];

      for (const size of sizes) {
        const html = await renderComponent(componentPath, { size });
        expect(html).toHaveClasses(['btn', 'btn-primary', `btn-${size}`]);
      }
    });

    test('should not apply size class when empty', async () => {
      const html = await renderComponent(componentPath, { size: '' });
      expect(html).toHaveClasses(['btn', 'btn-primary']);
      expect(html).not.toMatch(/btn-sm|btn-lg/);
    });
  });

  describe('Button Text Parameter', () => {
    test('should display custom text', async () => {
      const html = await renderComponent(componentPath, { text: 'Click Me!' });
      expect(html).toContainText('Click Me!');
    });

    test('should handle empty text', async () => {
      const html = await renderComponent(componentPath, { text: '' });
      const $ = parseHTML(html);
      expect($('button').text().trim()).toBe('');
    });

    test('should handle special characters in text', async () => {
      const specialText = 'Save & Continue →';
      const html = await renderComponent(componentPath, { text: specialText });
      expect(html).toContainText(specialText);
    });
  });

  describe('Icon Parameter', () => {
    test('should render icon when provided', async () => {
      const html = await renderComponent(componentPath, { icon: 'plus', text: 'Add' });
      expect(html).toMatch(/<i class="ti ti-plus"><\/i>/);
      expect(html).toContainText('Add');
    });

    test('should render icon in different positions', async () => {
      // Left position (default)
      const leftHtml = await renderComponent(componentPath, {
        icon: 'download',
        iconPosition: 'left',
        text: 'Download'
      });
      const $left = parseHTML(leftHtml);
      const leftOrder = $left('button').html();
      expect(leftOrder.indexOf('ti-download')).toBeLessThan(leftOrder.indexOf('Download'));

      // Right position
      const rightHtml = await renderComponent(componentPath, {
        icon: 'download',
        iconPosition: 'right',
        text: 'Download'
      });
      const $right = parseHTML(rightHtml);
      const rightOrder = $right('button').html();
      expect(rightOrder.indexOf('Download')).toBeLessThan(rightOrder.indexOf('ti-download'));
    });

    test('should render icon only when no text', async () => {
      const html = await renderComponent(componentPath, { icon: 'close', text: '' });
      expect(html).toMatch(/<i class="ti ti-close"><\/i>/);
      expect(html).not.toMatch(/\s{2,}/); // Should not have extra spaces
    });
  });

  describe('Disabled Parameter', () => {
    test('should add disabled attribute when true', async () => {
      const html = await renderComponent(componentPath, { disabled: true });
      expect(html).toHaveAttributes({ disabled: '' });
    });

    test('should not add disabled attribute when false', async () => {
      const html = await renderComponent(componentPath, { disabled: false });
      const attributes = extractAttributes(html);
      expect(attributes.disabled).toBeUndefined();
    });
  });

  describe('Href Parameter (Link Button)', () => {
    test('should render as anchor when href provided', async () => {
      const html = await renderComponent(componentPath, {
        href: '/dashboard',
        text: 'Go to Dashboard'
      });

      const $ = parseHTML(html);
      expect($('a').length).toBe(1);
      expect($('button').length).toBe(0);
      expect($('a').attr('href')).toBe('/dashboard');
      expect($('a').attr('role')).toBe('button');
    });

    test('should handle disabled state for link buttons', async () => {
      const html = await renderComponent(componentPath, {
        href: '/disabled',
        disabled: true,
        text: 'Disabled Link'
      });

      expect(html).toHaveAttributes({ 'aria-disabled': 'true' });
    });
  });

  describe('Additional Classes Parameter', () => {
    test('should apply additional classes', async () => {
      const html = await renderComponent(componentPath, {
        additionalClasses: 'custom-btn shadow-lg'
      });
      expect(html).toHaveClasses(['btn', 'btn-primary', 'custom-btn', 'shadow-lg']);
    });
  });

  describe('Additional Attributes Parameter', () => {
    test('should apply additional attributes', async () => {
      const html = await renderComponent(componentPath, {
        attributes: {
          'data-toggle': 'modal',
          'data-target': '#myModal'
        }
      });

      expect(html).toHaveAttributes({
        'data-toggle': 'modal',
        'data-target': '#myModal'
      });
    });
  });

  describe('Combined Parameters', () => {
    test('should handle all parameters together', async () => {
      const params = {
        type: 'submit',
        variant: 'success',
        size: 'lg',
        text: 'Save Changes',
        icon: 'check',
        iconPosition: 'left',
        disabled: false,
        additionalClasses: 'custom-save-btn',
        attributes: { 'data-form': 'main-form' }
      };

      const html = await renderComponent(componentPath, params);

      expect(html).toHaveClasses(['btn', 'btn-success', 'btn-lg', 'custom-save-btn']);
      expect(html).toHaveAttributes({
        type: 'submit',
        'data-form': 'main-form'
      });
      expect(html).toContainText('Save Changes');
      expect(html).toMatch(/<i class="ti ti-check"><\/i>/);
    });
  });

  describe('HTML Output Validation', () => {
    test('should produce valid HTML structure for button', async () => {
      const html = await renderComponent(componentPath, { text: 'Test Button' });
      const $ = parseHTML(html);

      expect($('button').length).toBe(1);
      expect($('button').attr('type')).toBe('button');
      expect($('button').text()).toBe('Test Button');
    });

    test('should produce valid HTML structure for link', async () => {
      const html = await renderComponent(componentPath, {
        href: '/test',
        text: 'Test Link'
      });
      const $ = parseHTML(html);

      expect($('a').length).toBe(1);
      expect($('a').attr('href')).toBe('/test');
      expect($('a').attr('role')).toBe('button');
      expect($('a').text()).toBe('Test Link');
    });
  });

  describe('Accessibility', () => {
    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, { text: 'Accessible Button' });
      expect(html).toBeAccessible();
    });

    test('should maintain accessibility with icons', async () => {
      const html = await renderComponent(componentPath, {
        icon: 'delete',
        text: 'Delete Item'
      });
      expect(html).toBeAccessible();
    });

    test('should handle disabled state accessibility', async () => {
      const html = await renderComponent(componentPath, {
        text: 'Disabled Button',
        disabled: true
      });

      const $ = parseHTML(html);
      expect($('button').attr('disabled')).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle null parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        text: null,
        variant: null,
        size: null,
        icon: null
      });

      expect(html).toBeTruthy();
      expect(html).toContain('<button');
    });

    test('should handle undefined parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        text: undefined,
        variant: undefined,
        disabled: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContain('btn btn-primary');
    });
  });
});