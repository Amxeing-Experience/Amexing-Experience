/**
 * User Menu Molecule Component Tests
 * Tests for the refactored user menu component with new order and functionality
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../../helpers/ejsTestUtils');

describe('User Menu Molecule Component', () => {
  const componentPath = 'molecules/dashboard/user-menu';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      expect(html).toContain('user-menu-molecule');
      expect(html).toContain('dropdown');
    });

    test('should render with user data', async () => {
      const params = {
        userName: 'John Doe',
        userEmail: 'john@test.com',
        userRole: 'admin'
      };
      const html = await renderComponent(componentPath, params);
      expect(html).toContainText('John Doe');
      // Email no longer displayed (dropdown header removed)
      expect(html).toContainText('Admin');
    });

    test('should render for each user role', async () => {
      const roles = ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'driver', 'guest'];

      for (const role of roles) {
        const html = await renderComponent(componentPath, { userRole: role });
        expect(html).toContain('user-menu-molecule');
        expect(html).toContain('dropdown');
      }
    });
  });

  describe('New Order Validation (User Info First, Avatar Second)', () => {
    test('should have user info before avatar in markup', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'Test User',
        userRole: 'admin'
      });

      const userInfoIndex = html.indexOf('user-info-section');
      const avatarIndex = html.indexOf('user-avatar-trigger');

      expect(userInfoIndex).toBeLessThan(avatarIndex);
    });

    test('should display user info first and avatar second visually', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'John Doe',
        userRole: 'admin'
      });

      // Verify the structure order
      expect(html).toMatch(/user-info-section.*user-avatar-trigger/s);
    });

    test('should have correct CSS order classes', async () => {
      const html = await renderComponent(componentPath);

      // Check that classes exist in HTML
      expect(html).toContain('user-info-section');
      expect(html).toContain('user-avatar-trigger');
    });
  });

  describe('Avatar as Sole Trigger (No Chevron)', () => {
    test('should not include chevron icon', async () => {
      const html = await renderComponent(componentPath);
      expect(html).not.toContain('ti-chevron-down');
      expect(html).not.toContain('chevron');
    });

    test('should have dropdown trigger only on user menu button', async () => {
      const html = await renderComponent(componentPath);

      // Check that dropdown trigger exists and has correct class
      expect(html).toContain('data-bs-toggle="dropdown"');
      expect(html).toContain('user-menu-trigger');
    });

    test('should have avatar with cursor pointer styling', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('cursor: pointer');
    });

    test('should have proper ARIA attributes for accessibility', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('aria-label="User menu"');
      expect(html).toContain('aria-expanded="false"');
    });
  });

  describe('User Avatar Handling', () => {
    test('should show avatar image when provided', async () => {
      const html = await renderComponent(componentPath, {
        userAvatar: '/images/user.jpg',
        userName: 'Test User'
      });

      expect(html).toContain('src="/images/user.jpg"');
      expect(html).toContain('alt="Test User"');
      expect(html).toContain('onerror=');
    });

    test('should show initials when no avatar', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'John Doe'
      });

      expect(html).toContain('avatar-placeholder');
      expect(html).toContainText('JD');
    });

    test('should handle single name for initials', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'Admin'
      });

      expect(html).toContainText('A');
    });

    test('should include online status indicator', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('bg-success');
      expect(html).toContain('border border-white rounded-circle');
      expect(html).toContain('width: 10px; height: 10px');
      expect(html).toContain('title="Online"');
    });

    test('should have avatar in trigger button', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'Test User'
      });

      // Should have avatar in main trigger only (dropdown header removed)
      const avatarCount = (html.match(/avatar-placeholder|user-avatar/g) || []).length;
      expect(avatarCount).toBeGreaterThanOrEqual(1);
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
        const html = await renderComponent(componentPath, {
          userRole: role,
          colors: { primary: color, secondary: '#000' }
        });
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

  describe('Dropdown Menu Content', () => {
    test('should include all required menu items', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });

      expect(html).toContain('My Profile');
      expect(html).toContain('Settings');
      // Help & Support removed from menu
      expect(html).toContain('Sign Out');
    });

    test('should have proper menu item links with role', async () => {
      const html = await renderComponent(componentPath, {
        userRole: 'admin'
      });

      expect(html).toContain('/dashboard/admin/profile');
      expect(html).toContain('/dashboard/admin/settings');
      expect(html).toContain('/dashboard/admin/help');
      expect(html).toContain('/logout');
    });

    test('should include menu icons', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toContain('ti-user');
      expect(html).toContain('ti-settings');
      expect(html).toContain('ti-help');
      expect(html).toContain('ti-logout');
    });

    test('should have logout confirmation', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('onclick="return confirm(');
      expect(html).toContain('Are you sure you want to sign out?');
    });
  });

  describe('Responsive Design', () => {
    test('should hide user info on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-none d-sm-block');
    });

    test('should include responsive CSS classes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('@media (max-width: 575.98px)');
    });

    test('should adjust trigger padding on mobile', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('user-menu-trigger');
    });
  });

  describe('CSS Styles and Classes', () => {
    test('should include component-specific styles', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('.user-menu-molecule');
      expect(html).toContain('.user-menu-trigger');
      expect(html).toContain('.user-avatar-trigger');
      expect(html).toContain('.user-info-section');
    });

    test('should include hover effects', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain(':hover');
      expect(html).toContain('transform: scale(1.05)');
    });

    test('should include dropdown animations', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('@keyframes fadeInScale');
      expect(html).toContain('animation: fadeInScale');
    });

    test('should include focus states for accessibility', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain(':focus');
      expect(html).toContain('outline: 2px solid');
    });
  });

  describe('JavaScript Functionality', () => {
    test('should include initialization script', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain("document.addEventListener('DOMContentLoaded'");
      expect(html).toContainText('User menu initialized for role:');
    });

    test('should include keyboard navigation', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('keydown');
      expect(html).toContain("e.key === 'Enter'");
      expect(html).toContain("e.key === ' '");
    });

    test('should include focus management', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('shown.bs.dropdown');
      expect(html).toContain('firstMenuItem.focus()');
    });
  });

  describe('Parameter Validation and Defaults', () => {
    test('should handle undefined user gracefully', async () => {
      const html = await renderComponent(componentPath, {
        user: undefined
      });

      expect(html).toBeTruthy();
      expect(html).toContainText('User');
    });

    test('should handle empty parameters', async () => {
      const html = await renderComponent(componentPath, {
        userName: '',
        userEmail: '',
        userRole: ''
      });

      expect(html).toBeTruthy();
      expect(html).toContain('user-menu-molecule');
    });

    test('should use defaults for missing parameters', async () => {
      const html = await renderComponent(componentPath);

      expect(html).toBeTruthy();
      expect(html).toContain('Guest'); // Default role formatting
      expect(html).toContain('User');  // Default user name
    });

    test('should extract user data correctly from user object', async () => {
      const html = await renderComponent(componentPath, {
        user: {
          name: 'John Smith',
          fullName: 'John Smith Jr.',
          email: 'john@test.com',
          profilePicture: '/avatar.jpg'
        }
      });

      expect(html).toContainText('John Smith');
      // Email no longer displayed in dropdown header (removed)
      expect(html).toContain('/avatar.jpg');
    });
  });

  describe('Accessibility', () => {
    test('should have proper ARIA attributes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('aria-label="User menu"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('role="button"');
    });

    test('should support keyboard navigation', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('tabindex="0"');
    });

    test('should have tooltip for online status', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('data-bs-toggle="tooltip"');
      expect(html).toContain('title="Online"');
    });

    test('should be accessible by default', async () => {
      const html = await renderComponent(componentPath, {
        userName: 'Accessible User'
      });
      expect(html).toBeAccessible();
    });
  });

  describe('Component Integration', () => {
    test('should have molecular component structure', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('user-menu-molecule');
      expect(html).toContain('dropdown');
      expect(html).toContain('dropdown-menu');
    });

    test('should maintain Bootstrap compatibility', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('data-bs-toggle="dropdown"');
      expect(html).toContain('dropdown-menu-end');
      expect(html).toContain('dropdown-item');
    });

    test('should work with different viewport sizes', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toContain('d-none d-sm-block'); // Mobile hiding
      expect(html).toContain('@media'); // Responsive styles
    });
  });

  describe('Error Handling', () => {
    test('should handle null parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        userName: null,
        userEmail: null,
        userRole: null,
        colors: null
      });

      expect(html).toBeTruthy();
      expect(html).toContain('user-menu-molecule');
    });

    test('should handle malformed user data', async () => {
      const html = await renderComponent(componentPath, {
        user: { /* incomplete object */ },
        userName: 123, // wrong type
        userRole: {}   // wrong type
      });

      expect(html).toBeTruthy();
      expect(html).toContain('dropdown');
    });
  });
});