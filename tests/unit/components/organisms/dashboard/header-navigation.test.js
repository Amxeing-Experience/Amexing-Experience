/**
 * Header Navigation Organism Tests
 * Comprehensive tests for the new header navigation that replaces sidebar
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Header Navigation Organism', () => {
  const componentPath = 'organisms/dashboard/navigation/header-nav';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('header-navigation');
      expect(html).toContain('<nav class="header-navigation');
    });

    test('should render for each user role', async () => {
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];

      for (const role of roles) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toContain('header-navigation');
        expect(html).toContain('brand-logo-link');
        expect(html).toContain('role-badge-header');
      }
    });

    test('should include navigation structure', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('container-fluid');
      expect(html).toContain('d-flex align-items-center justify-content-between');
    });
  });

  describe('Logo and Branding', () => {
    test('should include brand logo', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      expect(html).toContain('brand-logo-link');
      expect(html).toContain('amexing-logo.svg');
      expect(html).toContain('/dashboard/admin');
    });

    test('should display role badge with proper styling', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });
      expect(html).toContain('role-badge-header');
      expect(html).toContain('Super Administrador');
      expect(html).toContain('#ff6b6b'); // SuperAdmin color
    });

    test('should handle department_manager role formatting', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'department_manager'
      });
      expect(html).toContain('Jefe de Departamento');
      expect(html).toContain('#10b981'); // Department manager color
    });
  });

  describe('Desktop Navigation Menu', () => {
    test('should render desktop navigation sections', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });
      expect(html).toContain('header-nav-center');
      expect(html).toContain('d-none d-lg-flex');
      expect(html).toContain('nav-section-dropdown');
    });

    test('should include all superadmin navigation sections', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });
      expect(html).toContain('System Management');
      expect(html).toContain('Analytics &amp; Reports'); // HTML escaped
      expect(html).toContain('System Configuration');
    });

    test('should include all admin navigation sections', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      // Updated to Spanish after i18n translation
      expect(html).toContain('Operaciones Principales');
      expect(html).toContain('Equipo y Recursos');
    });

    test('should include mega menu dropdowns', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      expect(html).toContain('mega-menu');
      expect(html).toContain('mega-menu-content');
      expect(html).toContain('mega-menu-item');
    });

    test('should include navigation items with proper links', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      expect(html).toContain('/dashboard/admin/events');
      expect(html).toContain('/dashboard/admin/clients');
      expect(html).toContain('/dashboard/admin/bookings');
    });
  });

  describe('Mobile Navigation', () => {
    test('should include mobile navigation toggle', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('mobile-nav-toggle');
      expect(html).toContain('d-lg-none');
      expect(html).toContain('ti-menu-2');
    });

    test('should include mobile navigation collapse', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      expect(html).toContain('mobile-nav-collapse');
      expect(html).toContain('mobileNavCollapse');
      expect(html).toContain('mobile-nav-content');
    });

    test('should render mobile navigation sections', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'client'
      });
      expect(html).toContain('mobile-nav-section');
      expect(html).toContain('mobile-section-title');
      expect(html).toContain('mobile-nav-items');
    });

    test('should include mobile navigation items', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'client'
      });
      expect(html).toContain('mobile-nav-item');
      expect(html).toContain('/dashboard/client/events');
      expect(html).toContain('/dashboard/client/billing');
    });
  });

  describe('Role-Based Navigation Content', () => {
    test('should show correct superadmin navigation', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });
      expect(html).toContain('User Management');
      expect(html).toContain('Client Management');
      expect(html).toContain('Permissions &amp; Roles'); // HTML escaped
      expect(html).toContain('System Analytics');
      expect(html).toContain('PCI DSS Compliance');
    });

    test('should show correct client navigation', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'client'
      });
      expect(html).toContain('My Business');
      expect(html).toContain('Services &amp; Billing'); // HTML escaped
      expect(html).toContain('My Events');
      expect(html).toContain('Landing Pages');
    });

    test('should show correct employee navigation', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'employee'
      });
      expect(html).toContain('My Services');
      expect(html).toContain('My Bookings');
      expect(html).toContain('Available Services');
    });

    test('should show correct driver navigation', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'driver'
      });
      expect(html).toContain('My Trips');
      expect(html).toContain('Active Trips');
      expect(html).toContain('Trip History');
    });
  });

  describe('Active State Management', () => {
    test('should mark active navigation items', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin',
        currentPath: '/dashboard/admin/events'
      });
      expect(html).toContain('class="mega-menu-item d-flex align-items-center p-2 rounded text-decoration-none active"');
    });

    test('should mark active mobile navigation items', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'client',
        currentPath: '/dashboard/client/billing'
      });
      expect(html).toContain('class="mobile-nav-item d-flex align-items-center p-3 text-decoration-none border-bottom active"');
    });

    test('should handle path matching correctly', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin',
        currentPath: '/dashboard/superadmin/users/edit/123'
      });
      // Should match /dashboard/superadmin/users
      expect(html).toContain('active');
    });
  });

  describe('Color Scheme and Styling', () => {
    test('should apply role-based colors', async () => {
      const roleTests = [
        { role: 'superadmin', color: '#ff6b6b' },
        { role: 'admin', color: '#5d87ff' },
        { role: 'client', color: '#8b5cf6' },
        { role: 'department_manager', color: '#10b981' },
        { role: 'employee', color: '#06b6d4' },
        { role: 'driver', color: '#f59e0b' },
        { role: 'guest', color: '#6b7280' }
      ];

      for (const { role, color } of roleTests) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toMatch(new RegExp(color.replace('#', '#')));
      }
    });

    test('should include component-specific CSS classes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('.header-navigation');
      expect(html).toContain('.nav-section-trigger');
      expect(html).toContain('.mega-menu');
      expect(html).toContain('.mobile-nav-toggle');
    });

    test('should include responsive styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('@media (max-width: 991.98px)');
      expect(html).toContain('@media (max-width: 575.98px)');
    });
  });

  describe('JavaScript Functionality', () => {
    test('should include initialization script', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain("document.addEventListener('DOMContentLoaded'");
      // Initialization log removed - component initializes silently
    });

    test('should include mobile toggle functionality', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('mobile-nav-toggle');
      expect(html).toContain('mobileNavCollapse');
      expect(html).toContain('aria-expanded');
    });

    test('should include dropdown hover effects', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('mouseenter');
      expect(html).toContain('mouseleave');
    });

    test('should include keyboard navigation', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain("e.key === 'Escape'");
    });

    test('should include analytics tracking', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('data-nav-item');
      expect(html).toContain('navigation_click');
    });
  });

  describe('Accessibility Features', () => {
    test('should have proper ARIA attributes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-controls="mobileNavCollapse"');
      expect(html).toContain('aria-label="Toggle mobile navigation"');
    });

    test('should have proper button types', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('type="button"');
    });

    test('should include focus styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain(':focus');
      expect(html).toContain('outline: 2px solid');
    });

    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });
      expect(html).toBeAccessible();
    });
  });

  describe('Responsive Design', () => {
    test('should hide desktop menu on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-none d-lg-flex');
    });

    test('should show mobile toggle only on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-lg-none');
    });

    test('should include responsive logo sizing', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('width="120"'); // Desktop size
    });

    test('should include mobile-specific styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('mobile-nav-content');
      expect(html).toContain('mobile-section-title');
    });
  });

  describe('Parameter Validation and Defaults', () => {
    test('should handle undefined user role gracefully', async () => {
      const html = await renderComponent(componentPath, {
        userRole: undefined
      });
      expect(html).toBeTruthy();
      expect(html).toContain('guest');
    });

    test('should handle null parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        userRole: null,
        currentPath: null,
        user: null
      });
      expect(html).toBeTruthy();
      expect(html).toContain('header-navigation');
    });

    test('should use defaults for missing parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('guest'); // Default role
    });

    test('should handle custom colors parameter', async () => {
      const customColors = { primary: '#ff0000', secondary: '#00ff00' };
      const html = await renderComponent(componentPath, {
        userRole: 'admin',
        colors: customColors
      });
      expect(html).toContain('#ff0000');
      expect(html).toContain('#00ff00');
    });
  });

  describe('Performance and Structure', () => {
    test('should have efficient HTML structure', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });

      // Should not be excessively large
      const lines = html.split('\n');
      expect(lines.length).toBeLessThan(1000); // Reasonable size
    });

    test('should include navigation items for all roles', async () => {
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver'];

      for (const role of roles) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toContain('nav-section-dropdown');
        expect(html).toContain('mobile-nav-section');
      }
    });

    test('should maintain consistent structure across roles', async () => {
      const roles = ['superadmin', 'admin', 'client'];

      for (const role of roles) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toContain('header-nav-left');
        expect(html).toContain('header-nav-center');
        expect(html).toContain('header-nav-right');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed role gracefully', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'invalid_role'
      });
      expect(html).toBeTruthy();
      expect(html).toContain('header-navigation');
    });

    test('should handle empty currentPath', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin',
        currentPath: ''
      });
      expect(html).toBeTruthy();
      // With empty path, no navigation item should be marked as active
      expect(html).not.toMatch(/class=\"[^\"]*active[^\"]*\"/);
    });

    test('should handle special characters in parameters', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin',
        currentPath: '/dashboard/admin/test&special=chars'
      });
      expect(html).toBeTruthy();
    });
  });

  describe('Print and SEO Optimization', () => {
    test('should include print styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('@media print');
      expect(html).toContain('display: none !important');
    });

    test('should have semantic HTML structure', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('<nav class="header-navigation');
      expect(html).toContain('alt="Amexing Logo"');
    });
  });
});