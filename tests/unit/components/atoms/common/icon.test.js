/**
 * Icon Atom Component Tests
 * Tests for the reusable icon component with Tabler Icons
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Icon Atom Component', () => {
  const componentPath = 'atoms/common/icon';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('<i class=');
      expect(html).toHaveClasses(['ti', 'ti-circle']);
    });

    test('should render as an i element', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);
      expect($('i').length).toBe(1);
    });
  });

  describe('Icon Name Parameter', () => {
    test('should use custom icon name', async () => {
      const html = await renderComponent(componentPath, { name: 'dashboard' });
      expect(html).toHaveClasses(['ti', 'ti-dashboard']);
    });

    test('should use custom icon name with hyphen', async () => {
      const html = await renderComponent(componentPath, { name: 'user-circle' });
      expect(html).toHaveClasses(['ti', 'ti-user-circle']);
    });


    test('should handle undefined icon name', async () => {
      const html = await renderComponent(componentPath, { name: undefined });
      expect(html).toHaveClasses(['ti', 'ti-circle']); // Should fallback to default
    });
  });

  describe('Size Parameter', () => {
    test('should apply size class when provided', async () => {
      const html = await renderComponent(componentPath, { name: 'home', size: '4' });
      expect(html).toHaveClasses(['ti', 'ti-home', 'fs-4']);
    });

    test('should handle multiple size values', async () => {
      const sizes = ['1', '2', '3', '4', '5', '6'];

      for (const size of sizes) {
        const html = await renderComponent(componentPath, { name: 'home', size });
        expect(html).toHaveClasses(['ti', 'ti-home', `fs-${size}`]);
      }
    });

    test('should not apply size class when empty', async () => {
      const html = await renderComponent(componentPath, { name: 'home', size: '' });
      expect(html).toHaveClasses(['ti', 'ti-home']);
      expect(html).not.toMatch(/fs-/);
    });
  });

  describe('Color Parameter', () => {
    test('should apply color class when provided', async () => {
      const html = await renderComponent(componentPath, { name: 'home', color: 'primary' });
      expect(html).toHaveClasses(['ti', 'ti-home', 'text-primary']);
    });

    test('should handle different color values', async () => {
      const colors = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];

      for (const color of colors) {
        const html = await renderComponent(componentPath, { name: 'home', color });
        expect(html).toHaveClasses(['ti', 'ti-home', `text-${color}`]);
      }
    });

    test('should not apply color class when empty', async () => {
      const html = await renderComponent(componentPath, { name: 'home', color: '' });
      expect(html).toHaveClasses(['ti', 'ti-home']);
      expect(html).not.toMatch(/text-/);
    });
  });

  describe('Additional Classes Parameter', () => {
    test('should apply additional classes when provided', async () => {
      const html = await renderComponent(componentPath, {
        name: 'home',
        additionalClasses: 'custom-class another-class'
      });
      expect(html).toHaveClasses(['ti', 'ti-home', 'custom-class', 'another-class']);
    });

    test('should handle single additional class', async () => {
      const html = await renderComponent(componentPath, {
        name: 'home',
        additionalClasses: 'custom-class'
      });
      expect(html).toHaveClasses(['ti', 'ti-home', 'custom-class']);
    });

    test('should not apply additional classes when empty', async () => {
      const html = await renderComponent(componentPath, { name: 'home', additionalClasses: '' });
      expect(html).toHaveClasses(['ti', 'ti-home']);
    });
  });

  describe('Combined Parameters', () => {
    test('should handle all parameters together', async () => {
      const params = {
        name: 'settings',
        size: '3',
        color: 'warning',
        additionalClasses: 'rotate-90 me-2'
      };

      const html = await renderComponent(componentPath, params);
      expect(html).toHaveClasses([
        'ti', 'ti-settings', 'fs-3', 'text-warning', 'rotate-90', 'me-2'
      ]);
    });

    test('should prioritize parameters correctly', async () => {
      const params = {
        name: 'star',
        size: '5',
        color: 'success',
        additionalClasses: 'highlight'
      };

      const html = await renderComponent(componentPath, params);
      const classes = extractClasses(html);

      expect(classes).toContain('ti');
      expect(classes).toContain('ti-star');
      expect(classes).toContain('fs-5');
      expect(classes).toContain('text-success');
      expect(classes).toContain('highlight');
    });
  });

  describe('HTML Output Validation', () => {
    test('should produce valid HTML structure', async () => {
      const html = await renderComponent(componentPath, { name: 'check' });
      const $ = parseHTML(html);

      expect($('i').length).toBe(1);
      expect($('i').attr('class')).toMatch(/^ti ti-check/);
    });

    test('should not contain any text content', async () => {
      const html = await renderComponent(componentPath, { name: 'home' });
      const $ = parseHTML(html);

      expect($('i').text().trim()).toBe('');
    });

    test('should be self-closing element', async () => {
      const html = await renderComponent(componentPath, { name: 'close' });
      expect(html).toMatch(/<i[^>]*><\/i>$/);
    });
  });

  describe('Accessibility', () => {
    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, { name: 'info' });
      expect(html).toBeAccessible();
    });

    test('should work with screen readers when properly labeled', async () => {
      // Note: This component is primarily for decorative icons
      // Semantic meaning should be provided by parent elements
      const html = await renderComponent(componentPath, { name: 'warning' });
      const $ = parseHTML(html);

      // Icon itself doesn't need aria-label (decorative)
      expect($('i').attr('aria-hidden')).toBeUndefined();
    });
  });

  describe('Error Handling', () => {

    test('should handle special characters in parameters', async () => {
      const html = await renderComponent(componentPath, {
        name: 'arrow-right',
        additionalClasses: 'test-class'
      });

      expect(html).toHaveClasses(['ti', 'ti-arrow-right', 'test-class']);
    });
  });
});