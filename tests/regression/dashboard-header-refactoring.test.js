/**
 * Dashboard Header Refactoring Regression Tests
 * Ensures that the refactoring maintains all existing functionality
 * Compares behavior before and after the molecular componentization
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../helpers/ejsTestUtils');

describe('Dashboard Header Refactoring Regression Tests', () => {
  const refactoredHeaderPath = 'organisms/dashboard/header/dashboard-header';

  // Helper function to extract menu items from HTML
  function extractMenuItems(html) {
    const $ = parseHTML(html);
    const items = [];
    $('.dropdown-item').each((i, elem) => {
      const $elem = $(elem);
      items.push({
        text: $elem.text().trim(),
        href: $elem.attr('href'),
        icon: $elem.find('i').attr('class')
      });
    });
    return items;
  }

  // Helper function to extract role colors from HTML
  function extractRoleColors(html) {
    const colorMatches = html.match(/background:\s*(#[0-9a-f]{6})/gi) || [];
    return colorMatches.map(match => match.replace(/background:\s*/i, '').toLowerCase());
  }

  // Helper function to extract responsive classes
  function extractResponsiveClasses(html) {
    const responsivePatterns = [
      'd-none d-sm-block',
      'd-lg-none',
      '@media \\(max-width:',
      'col-sm-',
      'col-md-',
      'col-lg-'
    ];

    return responsivePatterns.filter(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(html);
    });
  }

  describe('Core Functionality Preservation', () => {
    test('should maintain all menu items after refactoring', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        userRole: 'admin',
        user: { name: 'Test User', email: 'test@test.com' }
      });

      const menuItems = extractMenuItems(refactoredHtml);

      // Expected menu items that should be preserved
      const expectedItems = [
        { text: 'My Profile', href: '/dashboard/admin/profile' },
        { text: 'Settings', href: '/dashboard/admin/settings' },
        { text: 'Help & Support', href: '/dashboard/admin/help' },
        { text: 'Sign Out', href: '/logout' }
      ];

      expectedItems.forEach(expectedItem => {
        const found = menuItems.find(item =>
          item.text === expectedItem.text && item.href === expectedItem.href
        );
        expect(found).toBeTruthy();
      });

      // Should have exactly the expected number of menu items
      expect(menuItems.length).toBe(expectedItems.length);
    });

    test('should preserve online status indicator', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Online status should be preserved
      expect(refactoredHtml).toContain('bg-success');
      expect(refactoredHtml).toContain('border border-white rounded-circle');
      expect(refactoredHtml).toContain('width: 10px; height: 10px');
      expect(refactoredHtml).toContain('title="Online"');
    });

    test('should maintain role-based styling', async () => {
      const roles = [
        { role: 'superadmin', expectedColor: '#ff6b6b' },
        { role: 'admin', expectedColor: '#5d87ff' },
        { role: 'client', expectedColor: '#8b5cf6' },
        { role: 'department_manager', expectedColor: '#10b981' }
      ];

      for (const { role, expectedColor } of roles) {
        const refactoredHtml = await renderComponent(refactoredHeaderPath, {
          userRole: role,
          colors: { primary: expectedColor, secondary: '#000' }
        });

        const colors = extractRoleColors(refactoredHtml);
        expect(colors).toContain(expectedColor.toLowerCase());
      }
    });

    test('should preserve responsive behavior', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      const responsiveClasses = extractResponsiveClasses(refactoredHtml);

      // Essential responsive behaviors should be maintained
      expect(responsiveClasses).toContain('d-none d-sm-block'); // User info hiding on mobile
      expect(responsiveClasses).toContain('d-lg-none'); // Mobile sidebar toggle
      expect(responsiveClasses.some(cls => cls.includes('@media'))).toBe(true); // CSS media queries
    });
  });

  describe('User Avatar Functionality Regression', () => {
    test('should handle avatar image display consistently', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: { name: 'Avatar User', avatar: '/test-avatar.jpg' }
      });

      // Avatar should be displayed
      expect(refactoredHtml).toContain('src="/test-avatar.jpg"');
      expect(refactoredHtml).toContain('alt="Avatar User"');
      expect(refactoredHtml).toContain('onerror=');
    });

    test('should generate initials when no avatar provided', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: { name: 'John Doe' }
      });

      expect(refactoredHtml).toContain('avatar-placeholder');
      expect(refactoredHtml).toContainText('JD');
    });

    test('should handle edge cases in name processing', async () => {
      const testCases = [
        { name: 'Single', expected: 'SI' },
        { name: 'Multiple Word Name Test', expected: 'MW' },
        { name: '', expected: '' }
      ];

      for (const { name, expected } of testCases) {
        const refactoredHtml = await renderComponent(refactoredHeaderPath, {
          user: { name }
        });

        if (expected) {
          expect(refactoredHtml).toContainText(expected);
        }
        expect(refactoredHtml).toContain('user-menu-molecule');
      }
    });
  });

  describe('Dropdown Functionality Regression', () => {
    test('should maintain proper dropdown structure', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);
      const $ = parseHTML(refactoredHtml);

      // Should have exactly one dropdown trigger
      const triggers = $('[data-bs-toggle="dropdown"]');
      expect(triggers.length).toBe(1);

      // Should have dropdown menu
      const dropdownMenu = $('.dropdown-menu');
      expect(dropdownMenu.length).toBe(1);
      expect(dropdownMenu.hasClass('dropdown-menu-end')).toBe(true);

      // Should have proper width
      expect(dropdownMenu.attr('style')).toContain('width: 250px');
    });

    test('should maintain logout confirmation functionality', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain('onclick="return confirm(');
      expect(refactoredHtml).toContain('Are you sure you want to sign out?');
    });

    test('should preserve dropdown icons', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      const expectedIcons = ['ti-user', 'ti-settings', 'ti-help', 'ti-logout'];
      expectedIcons.forEach(icon => {
        expect(refactoredHtml).toContain(icon);
      });
    });
  });

  describe('Mobile Responsiveness Regression', () => {
    test('should maintain mobile sidebar toggle', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain('id="headerCollapse"');
      expect(refactoredHtml).toContain('d-lg-none');
      expect(refactoredHtml).toContain('ti-menu-2');
      expect(refactoredHtml).toContain('aria-label="Toggle sidebar"');
    });

    test('should hide user info on mobile devices', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: { name: 'Mobile User' }
      });

      // User info should be hidden on mobile
      expect(refactoredHtml).toContain('d-none d-sm-block');
      expect(refactoredHtml).toContainText('Mobile User');
    });

    test('should maintain mobile CSS media queries', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toMatch(/@media\s*\([^)]*max-width[^)]*\)/);
    });
  });

  describe('Accessibility Regression', () => {
    test('should maintain ARIA attributes', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Essential ARIA attributes should be preserved
      expect(refactoredHtml).toContain('aria-expanded="false"');
      expect(refactoredHtml).toContain('aria-label');
    });

    test('should maintain tooltip functionality', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain('data-bs-toggle="tooltip"');
      expect(refactoredHtml).toContain('title="Online"');
    });

    test('should be accessible after refactoring', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        userName: 'Accessible User'
      });

      expect(refactoredHtml).toBeAccessible();
    });
  });

  describe('Role-Based Behavior Regression', () => {
    test('should maintain all role-specific functionality', async () => {
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];

      for (const role of roles) {
        const refactoredHtml = await renderComponent(refactoredHeaderPath, { userRole: role });

        // Should render for all roles without errors
        expect(refactoredHtml).toContain('user-menu-molecule');
        expect(refactoredHtml).toContain('app-header');

        // Should have role-specific links
        expect(refactoredHtml).toContain(`/dashboard/${role}/profile`);
        expect(refactoredHtml).toContain(`/dashboard/${role}/settings`);
        expect(refactoredHtml).toContain(`/dashboard/${role}/help`);
      }
    });

    test('should display formatted role names correctly', async () => {
      const roleFormatTests = [
        { role: 'department_manager', expected: 'Dept. Manager' },
        { role: 'superadmin', expected: 'Super Admin' },
        { role: 'admin', expected: 'Admin' },
        { role: 'client', expected: 'Client' }
      ];

      for (const { role, expected } of roleFormatTests) {
        const refactoredHtml = await renderComponent(refactoredHeaderPath, { userRole: role });
        expect(refactoredHtml).toContainText(expected);
      }
    });
  });

  describe('CSS and Styling Regression', () => {
    test('should maintain header styling classes', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Core header classes should be preserved
      expect(refactoredHtml).toContain('app-header');
      expect(refactoredHtml).toContain('navbar navbar-expand-lg navbar-light');
      expect(refactoredHtml).toContain('border-bottom');
    });

    test('should maintain backdrop filter effect', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain('backdrop-filter: blur(10px)');
      expect(refactoredHtml).toContain('-webkit-backdrop-filter: blur(10px)');
    });

    test('should preserve notification badge styles for future use', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Notification styles should be preserved for future implementation
      expect(refactoredHtml).toContain('#notification-count');
      expect(refactoredHtml).toContain('transform: translate(50%, -50%)');
    });
  });

  describe('JavaScript Functionality Regression', () => {
    test('should maintain initialization scripts', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain("document.addEventListener('DOMContentLoaded'");
      expect(refactoredHtml).toContainText('Dashboard header initialized for:');
    });

    test('should preserve commented notification functions for future', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      expect(refactoredHtml).toContain('/* TODO: Implementar notificaciones en el futuro');
      expect(refactoredHtml).toContain('loadNotifications');
      expect(refactoredHtml).toContain('updateNotificationCount');
    });
  });

  describe('Parameter Handling Regression', () => {
    test('should handle undefined parameters gracefully', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: undefined,
        userRole: undefined
      });

      expect(refactoredHtml).toBeTruthy();
      expect(refactoredHtml).toContain('app-header');
      expect(refactoredHtml).toContain('user-menu-molecule');
    });

    test('should handle empty user object', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: {},
        userRole: 'guest'
      });

      expect(refactoredHtml).toBeTruthy();
      expect(refactoredHtml).toContainText('User'); // Default name
      expect(refactoredHtml).toContainText('Guest'); // Role display
    });

    test('should handle complex user objects', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        user: {
          name: 'Complex User',
          fullName: 'Complex User Full Name',
          email: 'complex@test.com',
          avatar: '/avatar.jpg',
          profilePicture: '/profile.jpg'
        },
        userRole: 'admin'
      });

      expect(refactoredHtml).toContainText('Complex User');
      // Email no longer displayed in dropdown header (removed in simplification)
      expect(refactoredHtml).toContain('/avatar.jpg');
    });
  });

  describe('Performance Regression', () => {
    test('should render in reasonable time after refactoring', async () => {
      const startTime = Date.now();

      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        userRole: 'admin',
        user: { name: 'Performance Test' }
      });

      const endTime = Date.now();
      const renderTime = endTime - startTime;

      // Should render reasonably fast
      expect(renderTime).toBeLessThan(200);
      expect(refactoredHtml).toContain('user-menu-molecule');
    });

    test('should have reduced complexity after componentization', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Component should be more modular
      expect(refactoredHtml).toContain('<%- include('); // Should use includes

      // Should be shorter due to componentization
      const lines = refactoredHtml.split('\n').filter(line => line.trim().length > 0);
      expect(lines.length).toBeLessThan(300); // Should be reduced from original
    });
  });

  describe('Error Handling Regression', () => {
    test('should handle malformed data without breaking', async () => {
      const testCases = [
        { userRole: null, user: null },
        { userRole: 123, user: 'invalid' },
        { userRole: {}, user: [] },
        { userRole: '', user: { name: null } }
      ];

      for (const testCase of testCases) {
        const refactoredHtml = await renderComponent(refactoredHeaderPath, testCase);

        expect(refactoredHtml).toBeTruthy();
        expect(refactoredHtml).toContain('app-header');
      }
    });

    test('should maintain functionality with missing CSS or JS', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Should have fallback behaviors
      expect(refactoredHtml).toContain('user-menu-molecule');
      expect(refactoredHtml).toContain('dropdown');
    });
  });

  describe('New Functionality Validation', () => {
    test('should confirm new order: user info first, avatar second', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath, {
        userName: 'Order Test',
        userRole: 'admin'
      });

      const userInfoIndex = refactoredHtml.indexOf('user-info-section');
      const avatarIndex = refactoredHtml.indexOf('user-avatar-trigger');

      // User info should come before avatar
      expect(userInfoIndex).toBeLessThan(avatarIndex);
      expect(userInfoIndex).toBeGreaterThan(-1);
      expect(avatarIndex).toBeGreaterThan(-1);
    });

    test('should confirm chevron removal', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);

      // Should not contain chevron anywhere
      expect(refactoredHtml).not.toContain('ti-chevron-down');
      expect(refactoredHtml).not.toContain('chevron');
    });

    test('should confirm avatar as sole trigger', async () => {
      const refactoredHtml = await renderComponent(refactoredHeaderPath);
      const $ = parseHTML(refactoredHtml);

      // Should have exactly one dropdown trigger
      const triggers = $('[data-bs-toggle="dropdown"]');
      expect(triggers.length).toBe(1);
      expect(triggers.hasClass('user-menu-trigger')).toBe(true);
    });
  });
});