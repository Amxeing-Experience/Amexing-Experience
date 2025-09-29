/**
 * Dashboard Header Organism - Baseline Tests
 * Tests for the existing dashboard header before refactoring
 * This establishes baseline functionality that must be preserved
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('Dashboard Header Organism - Baseline Tests', () => {
  const componentPath = 'organisms/dashboard/header/dashboard-header';

  describe('Basic Rendering', () => {
    test('should render header with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('app-header');
      expect(html).toContain('navbar');
    });

    test('should render for each user role', async () => {
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];

      for (const role of roles) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toContain('app-header');
        expect(html).toContain('user-avatar');
        expect(html).toContain('dropdown');
      }
    });

    test('should include navbar structure', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('navbar navbar-expand-lg navbar-light');
      expect(html).toContain('d-flex align-items-center justify-content-between w-100');
    });
  });

  describe('Mobile Sidebar Toggle', () => {
    test('should include mobile sidebar toggle', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-lg-none');
      expect(html).toContain('headerCollapse');
      expect(html).toContain('ti-menu-2');
    });

    test('should have proper mobile toggle attributes', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('id="headerCollapse"');
      expect(html).toContain('type="button"');
      expect(html).toContain('aria-label="Toggle sidebar"');
    });
  });

  describe('User Menu Dropdown', () => {
    test('should render user dropdown with correct structure', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin',
        user: { name: 'Test User', email: 'test@test.com' }
      });

      expect(html).toContain('data-bs-toggle="dropdown"');
      expect(html).toContain('dropdown-menu');
      expect(html).toContain('dropdown-menu-end');
    });

    test('should not include chevron down icon (removed in refactoring)', async () => {
      const html = await renderComponent(componentPath);
      expect(html).not.toContain('ti-chevron-down');
    });

    test('should have user avatar section', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('user-avatar');
      expect(html).toContain('position-relative');
    });

    test('should include online status indicator', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('bg-success');
      expect(html).toContain('border border-white rounded-circle');
      expect(html).toContain('width: 10px; height: 10px');
    });

    test('should show user info on desktop', async () => {
      const html = await renderComponent(componentPath, {
        user: { name: 'John Doe', email: 'john@test.com' }
      });

      expect(html).toContain('d-none d-sm-block');
      expect(html).toContainText('John Doe');
    });

    test('should include all menu items', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });

      expect(html).toContain('My Profile');
      expect(html).toContain('Settings');
      expect(html).toContain('Help & Support');
      expect(html).toContain('Sign Out');
    });

    test('should have proper menu item links', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });

      expect(html).toContain('/dashboard/admin/profile');
      expect(html).toContain('/dashboard/admin/settings');
      expect(html).toContain('/dashboard/admin/help');
      expect(html).toContain('/logout');
    });
  });

  describe('User Avatar Handling', () => {
    test('should show avatar image when provided', async () => {
      const html = await renderComponent(componentPath, {
        user: {
          name: 'Test User',
          avatar: '/images/user.jpg'
        }
      });

      expect(html).toContain('src="/images/user.jpg"');
      expect(html).toContain('alt="Test User"');
      expect(html).toContain('onerror=');
    });

    test('should show initials when no avatar', async () => {
      const html = await renderComponent(componentPath, {
        user: { name: 'John Doe' }
      });

      expect(html).toContain('avatar-placeholder');
      expect(html).toContainText('JD');
    });

    test('should handle single name for initials', async () => {
      const html = await renderComponent(componentPath, {
        user: { name: 'Admin' }
      });

      expect(html).toContainText('A');
    });

    test('should show duplicated avatar in dropdown header', async () => {
      const html = await renderComponent(componentPath, {
        user: { name: 'Test User' }
      });

      // Should have avatar in main button and dropdown header
      const avatarCount = (html.match(/user-avatar/g) || []).length;
      expect(avatarCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Role-Based Colors', () => {
    test('should apply correct role colors', async () => {
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
        expect(html).toMatch(new RegExp(`background:\\s*${color.replace('#', '#')}`));
      }
    });

    test('should display formatted role names', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'department_manager'
      });
      expect(html).toContainText('Dept. Manager');

      const superHtml = await renderComponent(componentPath, {
        userRole: 'superadmin'
      });
      expect(superHtml).toContainText('Super Admin');
    });
  });

  describe('Responsive Design', () => {
    test('should hide user info on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-none d-sm-block');
    });

    test('should adjust padding on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('@media (max-width: 991.98px)');
    });
  });

  describe('CSS Styles', () => {
    test('should include header styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('.app-header');
      expect(html).toContain('box-shadow: 0 1px 3px rgba(0,0,0,0.1)');
      expect(html).toContain('backdrop-filter: blur(10px)');
    });

    test('should include avatar styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('.user-avatar');
      expect(html).toContain('.avatar-placeholder');
    });

    test('should include basic header styles (dropdown styles moved to molecular component)', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('.app-header');
      expect(html).toContain('box-shadow: 0 1px 3px');
      expect(html).toContain('backdrop-filter: blur(10px)');
    });
  });

  describe('JavaScript Functionality', () => {
    test('should include initialization script', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain("document.addEventListener('DOMContentLoaded'");
      expect(html).toContainText('Dashboard header initialized for:');
    });

    test('should include commented notification functions', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('/* TODO: Implementar notificaciones en el futuro');
      expect(html).toContain('loadNotifications');
      expect(html).toContain('updateNotificationCount');
    });
  });

  describe('Accessibility', () => {
    test('should have proper ARIA attributes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-label="Toggle sidebar"');
    });

    test('should have tooltip attributes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('data-bs-toggle="tooltip"');
      expect(html).toContain('title="Online"');
    });
  });

  describe('User Data Validation', () => {
    test('should handle undefined user gracefully', async () => {
      const html = await renderComponent(componentPath, {
        user: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContainText('User');
    });

    test('should handle empty user object', async () => {
      const html = await renderComponent(componentPath, {
        user: {}
      });

      expect(html).toBeTruthy();
      expect(html).toContainText('User');
    });

    test('should extract user data correctly', async () => {
      const html = await renderComponent(componentPath, {
        user: {
          name: 'John Smith',
          fullName: 'John Smith Jr.',
          email: 'john@test.com',
          profilePicture: '/avatar.jpg'
        }
      });

      expect(html).toContainText('John Smith');
      // Email no longer displayed in dropdown header (removed in user-menu refactoring)
      expect(html).toContain('/avatar.jpg');
    });
  });

  describe('Current Order Validation', () => {
    test('should have user info first, then avatar (no chevron)', async () => {
      const html = await renderComponent(componentPath, {
        user: { name: 'Test User' }
      });

      const userInfoIndex = html.indexOf('user-info-section');
      const avatarIndex = html.indexOf('user-avatar-trigger');

      expect(userInfoIndex).toBeLessThan(avatarIndex);
      expect(html).not.toContain('ti-chevron-down');
    });
  });
});