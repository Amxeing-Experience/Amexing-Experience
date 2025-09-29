const logger = require('../../infrastructure/logger');

/**
 * Atomic Controller - Handles Atomic Design component showcase and documentation.
 * Manages the visualization system for atoms, molecules, and organisms components
 * with interactive examples and documentation generation.
 *
 * This controller provides a comprehensive component library interface for developers,
 * showcasing all available atomic design components with live examples, configuration
 * options, and usage documentation to improve development efficiency and consistency.
 *
 * Features:
 * - Component showcase with live preview
 * - Interactive parameter configuration
 * - Auto-generated documentation from JSDoc
 * - Component search and filtering
 * - Code examples and usage patterns
 * - Responsive design testing
 * - Component isolation testing
 * - Category-based organization (dashboard, auth, common).
 * @class AtomicController
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 */

class AtomicController {
  /**
   * Main atomic design showcase index page
   * Shows overview of all component categories with statistics.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET /atomic
   * // Shows atomic design component showcase index page
   */
  static async index(req, res) {
    try {
      logger.info('Atomic showcase index accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      // Component statistics
      const componentStats = {
        dashboard: {
          atoms: 4, // styles, scripts, metric-card, stats-card
          molecules: 3, // nav-item, user-card, user-menu
          organisms: 5, // sidebar-nav, sidebar-menu, sidebar-footer, dashboard-header, datatable
          total: 12,
        },
        auth: {
          atoms: 4, // success-icon, auth-input, oauth-button, password-input
          molecules: 6, // login-form, register-form, forgot-password-form, choose-password-form, success-message, oauth-providers
          organisms: 2, // corporate-oauth-section, auth-header
          total: 12,
        },
        common: {
          atoms: 9, // icon, button, label, checkbox, radio, toggle, textarea, avatar, badge, spinner, divider
          molecules: 3, // form-field, searchbar, card
          organisms: 1, // modal
          total: 13,
        },
      };

      const totalComponents = componentStats.dashboard.total
                                  + componentStats.auth.total
                                  + componentStats.common.total;

      res.render('templates/atomic-showcase-layout', {
        title: 'Atomic Design Components - Amexing',
        headerTitle: 'Atomic Design System',
        headerSubtitle: 'Interactive component library and design system documentation',
        category: 'index',
        componentStats,
        totalComponents,
        categories: [
          {
            name: 'Dashboard',
            slug: 'dashboard',
            description: 'Components for admin dashboard interfaces',
            color: '#667eea',
            icon: 'ti-layout-dashboard',
            stats: componentStats.dashboard,
          },
          {
            name: 'Authentication',
            slug: 'auth',
            description: 'Components for login, registration and auth flows',
            color: '#764ba2',
            icon: 'ti-shield-lock',
            stats: componentStats.auth,
          },
          {
            name: 'Common',
            slug: 'common',
            description: 'Reusable components shared across contexts',
            color: '#28a745',
            icon: 'ti-components',
            stats: componentStats.common,
          },
        ],
      });
    } catch (error) {
      logger.error('Error in atomic showcase index', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
      });

      res.status(500).render('errors/error', {
        title: 'Showcase Error',
        message: 'Unable to load component showcase',
        error: process.env.NODE_ENV === 'development' ? error : null,
      });
    }
  }

  /**
   * Dashboard components showcase
   * Shows all dashboard-specific atoms, molecules, and organisms.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET /atomic/dashboard
   * // Shows dashboard-specific atomic design components
   */
  static async dashboard(req, res) {
    try {
      logger.info('Dashboard components showcase accessed', {
        ip: req.ip,
        category: 'dashboard',
      });

      const components = {
        atoms: [
          {
            name: 'Styles',
            file: 'styles.ejs',
            description: 'Role-based theming and dashboard CSS configuration',
            path: 'atoms/dashboard/styles',
            params: ['userRole', 'theme', 'customColors'],
            usage: 'Include in dashboard layout head section',
          },
          {
            name: 'Scripts',
            file: 'scripts.ejs',
            description: 'Dashboard JavaScript with WebSocket and interactions',
            path: 'atoms/dashboard/scripts',
            params: ['user', 'enableWebSocket', 'searchConfig'],
            usage: 'Include before closing body tag in dashboard',
          },
          {
            name: 'Metric Card',
            file: 'metric-card.ejs',
            description: 'Display key metrics with icons and trends',
            path: 'atoms/dashboard/metric-card',
            params: ['title', 'value', 'icon', 'trend', 'color', 'link'],
            usage: 'Show KPIs and dashboard statistics',
          },
          {
            name: 'Stats Card',
            file: 'stats-card.ejs',
            description: 'Detailed statistics card with multiple data points',
            path: 'atoms/dashboard/stats-card',
            params: ['title', 'mainValue', 'subStats', 'chartData', 'period'],
            usage: 'Comprehensive data visualization cards',
          },
        ],
        molecules: [
          {
            name: 'Navigation Item',
            file: 'nav-item.ejs',
            description: 'Sidebar navigation item with active states',
            path: 'molecules/dashboard/nav-item',
            params: ['title', 'icon', 'url', 'active', 'badge', 'submenu'],
            usage: 'Building sidebar navigation menus',
          },
          {
            name: 'User Card',
            file: 'user-card.ejs',
            description: 'User profile card with avatar and quick actions',
            path: 'molecules/dashboard/user-card',
            params: ['user', 'showActions', 'layout', 'size'],
            usage: 'Display user information in dashboard',
          },
          {
            name: 'User Menu',
            file: 'user-menu.ejs',
            description: 'Dropdown user menu with profile and navigation options. User info displays first, then avatar as clickable trigger (no chevron).',
            path: 'molecules/dashboard/user-menu',
            params: ['user', 'userRole', 'colors', 'userName', 'userEmail', 'userAvatar', 'userInitials'],
            usage: 'Header user menu dropdown with modern UX design',
          },
        ],
        organisms: [
          {
            name: 'Sidebar Navigation',
            file: 'sidebar-nav.ejs',
            description: 'Complete sidebar with role-based navigation',
            path: 'organisms/dashboard/navigation/sidebar-nav',
            params: ['user', 'currentPath', 'compactMode'],
            usage: 'Main dashboard navigation system',
          },
          {
            name: 'Sidebar Menu',
            file: 'sidebar-menu.ejs',
            description: 'Role-specific navigation menu items',
            path: 'organisms/dashboard/navigation/sidebar-menu',
            params: ['user', 'activeSection', 'permissions'],
            usage: 'Dynamic menu based on user role',
          },
          {
            name: 'Sidebar Footer',
            file: 'sidebar-footer.ejs',
            description: 'Sidebar footer with user info and controls',
            path: 'organisms/dashboard/navigation/sidebar-footer',
            params: ['user', 'showUpgrade', 'compactMode'],
            usage: 'Bottom section of sidebar navigation',
          },
          {
            name: 'Dashboard Header',
            file: 'dashboard-header.ejs',
            description: 'Top header with search, notifications and user menu',
            path: 'organisms/dashboard/header/dashboard-header',
            params: ['user', 'pageTitle', 'showSearch', 'notifications'],
            usage: 'Main dashboard header component',
          },
          {
            name: 'DataTable',
            file: 'users-table.ejs',
            description: 'Advanced data table with search, filters, and pagination',
            path: 'organisms/datatable/users-table',
            params: ['tableId', 'apiEndpoint', 'userRole', 'showActions'],
            usage: 'Comprehensive data table for any data type',
            interactive: true,
          },
        ],
      };

      res.render('templates/atomic-showcase-layout', {
        title: 'Dashboard Components - Atomic Design',
        headerTitle: 'Dashboard Components',
        headerSubtitle: 'Components designed for admin dashboard interfaces',
        category: 'dashboard',
        components,
        breadcrumbs: [
          { text: 'Atomic Design', url: '/atomic' },
          { text: 'Dashboard Components' },
        ],
      });
    } catch (error) {
      logger.error('Error in dashboard components showcase', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
      });

      res.status(500).render('errors/error', {
        title: 'Dashboard Showcase Error',
        message: 'Unable to load dashboard components',
        error: process.env.NODE_ENV === 'development' ? error : null,
      });
    }
  }

  /**
   * Auth components showcase
   * Shows all authentication-related atoms, molecules, and organisms.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET /atomic/auth
   * // Shows authentication-related atomic design components
   */
  static async auth(req, res) {
    try {
      logger.info('Auth components showcase accessed', {
        ip: req.ip,
        category: 'auth',
      });

      const components = {
        atoms: [
          {
            name: 'Success Icon',
            file: 'success-icon.ejs',
            description: 'Animated success icons for various states',
            path: 'atoms/auth/success-icon',
            params: ['type', 'size', 'color', 'animated'],
            usage: 'Success states in auth flows',
          },
          {
            name: 'Auth Input',
            file: 'auth-input.ejs',
            description: 'Enhanced form inputs with validation and Flexy styling',
            path: 'atoms/auth/auth-input',
            params: ['type', 'name', 'label', 'required', 'validation', 'icon'],
            usage: 'Form inputs in authentication pages',
          },
          {
            name: 'OAuth Button',
            file: 'oauth-button.ejs',
            description: 'Provider-specific OAuth buttons with branding',
            path: 'atoms/auth/oauth-button',
            params: ['provider', 'text', 'href', 'size', 'variant', 'corporate'],
            usage: 'OAuth authentication buttons',
          },
          {
            name: 'Password Input',
            file: 'password-input.ejs',
            description: 'Advanced password input with strength indicator',
            path: 'atoms/auth/password-input',
            params: ['name', 'label', 'showStrength', 'requirements', 'showTips'],
            usage: 'Password fields with security features',
          },
        ],
        molecules: [
          {
            name: 'Login Form',
            file: 'login-form.ejs',
            description: 'Complete login form with validation',
            path: 'molecules/auth/login-form',
            params: ['error', 'csrfToken', 'rememberMe', 'showForgotPassword'],
            usage: 'User authentication forms',
          },
          {
            name: 'Register Form',
            file: 'register-form.ejs',
            description: 'User registration form with validation',
            path: 'molecules/auth/register-form',
            params: ['error', 'csrfToken', 'requiredFields', 'showTerms'],
            usage: 'New user account creation',
          },
          {
            name: 'Forgot Password Form',
            file: 'forgot-password-form.ejs',
            description: 'Password reset request form with rate limiting',
            path: 'molecules/auth/forgot-password-form',
            params: ['error', 'success', 'csrfToken', 'email'],
            usage: 'Password recovery flows',
          },
          {
            name: 'Choose Password Form',
            file: 'choose-password-form.ejs',
            description: 'New password creation with confirmation',
            path: 'molecules/auth/choose-password-form',
            params: ['error', 'token', 'csrfToken', 'showStrength'],
            usage: 'Password reset completion',
          },
          {
            name: 'Success Message',
            file: 'success-message.ejs',
            description: 'Success states with actions and auto-redirect',
            path: 'molecules/auth/success-message',
            params: ['type', 'title', 'message', 'actions', 'autoRedirect'],
            usage: 'Success confirmations and redirects',
          },
          {
            name: 'OAuth Providers',
            file: 'oauth-providers.ejs',
            description: 'Collection of OAuth buttons with corporate support',
            path: 'molecules/auth/oauth-providers',
            params: ['providers', 'action', 'corporate', 'showDivider'],
            usage: 'OAuth provider selection',
          },
        ],
        organisms: [
          {
            name: 'Corporate OAuth Section',
            file: 'corporate-oauth-section.ejs',
            description: 'Complex corporate auth with department selection',
            path: 'organisms/auth/corporate-oauth-section',
            params: ['corporate', 'departments', 'requireDepartment', 'action'],
            usage: 'Enterprise authentication flows',
          },
          {
            name: 'Auth Header',
            file: 'auth-header.ejs',
            description: 'Authentication page headers with navigation',
            path: 'organisms/auth/auth-header',
            params: ['page', 'title', 'subtitle', 'showLogo', 'breadcrumbs'],
            usage: 'Headers for authentication pages',
          },
        ],
      };

      res.render('templates/atomic-showcase-layout', {
        title: 'Authentication Components - Atomic Design',
        headerTitle: 'Authentication Components',
        headerSubtitle: 'Components designed for login, registration and auth flows',
        category: 'auth',
        components,
        breadcrumbs: [
          { text: 'Atomic Design', url: '/atomic' },
          { text: 'Auth Components' },
        ],
      });
    } catch (error) {
      logger.error('Error in auth components showcase', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
      });

      res.status(500).render('errors/error', {
        title: 'Auth Showcase Error',
        message: 'Unable to load auth components',
        error: process.env.NODE_ENV === 'development' ? error : null,
      });
    }
  }

  /**
   * Common components showcase
   * Shows shared components used across different contexts.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // GET /atomic/common
   * // Shows common shared atomic design components
   */
  static async common(req, res) {
    try {
      logger.info('Common components showcase accessed', {
        ip: req.ip,
        category: 'common',
      });

      const components = {
        atoms: [
          {
            name: 'Icon',
            file: 'icon.ejs',
            description: 'Consistent icon rendering with Tabler Icons',
            path: 'atoms/common/icon',
            params: ['name', 'size', 'color', 'additionalClasses'],
            usage: 'Standardized iconography across the application',
          },
          {
            name: 'Button',
            file: 'button.ejs',
            description: 'Styled buttons with various states and sizes',
            path: 'atoms/common/button',
            params: ['text', 'type', 'variant', 'size', 'icon', 'disabled', 'href'],
            usage: 'Consistent button styling and behavior',
          },
          {
            name: 'Label',
            file: 'label.ejs',
            description: 'Form labels with consistent styling and required indicators',
            path: 'atoms/common/label',
            params: ['text', 'htmlFor', 'required', 'variant', 'color'],
            usage: 'Form field labels with validation states',
          },
          {
            name: 'Checkbox',
            file: 'checkbox.ejs',
            description: 'Styled checkboxes with multiple sizes and states',
            path: 'atoms/common/checkbox',
            params: ['name', 'id', 'value', 'checked', 'disabled', 'label', 'size'],
            usage: 'Form checkbox inputs with consistent styling',
          },
          {
            name: 'Radio Button',
            file: 'radio.ejs',
            description: 'Radio button inputs with consistent styling',
            path: 'atoms/common/radio',
            params: ['name', 'id', 'value', 'checked', 'disabled', 'label', 'size'],
            usage: 'Form radio button inputs',
          },
          {
            name: 'Toggle Switch',
            file: 'toggle.ejs',
            description: 'Toggle switches for on/off controls',
            path: 'atoms/common/toggle',
            params: ['name', 'id', 'checked', 'disabled', 'label', 'size', 'color'],
            usage: 'Switch controls for boolean settings',
          },
          {
            name: 'Textarea',
            file: 'textarea.ejs',
            description: 'Multi-line text input with resize controls',
            path: 'atoms/common/textarea',
            params: ['name', 'id', 'value', 'placeholder', 'rows', 'disabled', 'resize'],
            usage: 'Multi-line text input fields',
          },
          {
            name: 'Avatar',
            file: 'avatar.ejs',
            description: 'User avatar with fallback and status indicator',
            path: 'atoms/common/avatar',
            params: ['src', 'alt', 'size', 'shape', 'fallbackText', 'status'],
            usage: 'User profile images with fallback initials',
          },
          {
            name: 'Badge',
            file: 'badge.ejs',
            description: 'Status indicators and tags',
            path: 'atoms/common/badge',
            params: ['text', 'variant', 'size', 'pill', 'outline', 'icon'],
            usage: 'Status badges and content tags',
          },
          {
            name: 'Spinner',
            file: 'spinner.ejs',
            description: 'Loading spinners with various styles',
            path: 'atoms/common/spinner',
            params: ['type', 'size', 'color', 'text', 'centered'],
            usage: 'Loading states and progress indicators',
          },
          {
            name: 'Divider',
            file: 'divider.ejs',
            description: 'Section separators with optional text',
            path: 'atoms/common/divider',
            params: ['type', 'style', 'color', 'thickness', 'text'],
            usage: 'Visual content separators',
          },
        ],
        molecules: [
          {
            name: 'Form Field',
            file: 'form-field.ejs',
            description: 'Complete form field with label, input, help text and validation',
            path: 'molecules/common/form-field',
            params: ['type', 'name', 'label', 'required', 'value', 'placeholder', 'helpText', 'errorMessage'],
            usage: 'Complete form fields with all states',
          },
          {
            name: 'Search Bar',
            file: 'searchbar.ejs',
            description: 'Search input with clear and submit functionality',
            path: 'molecules/common/searchbar',
            params: ['name', 'placeholder', 'value', 'clearable', 'onSearch', 'size'],
            usage: 'Search functionality across the application',
          },
          {
            name: 'Card',
            file: 'card.ejs',
            description: 'Flexible card container with header, body and footer',
            path: 'molecules/common/card',
            params: ['title', 'subtitle', 'bodyContent', 'variant', 'shadow', 'hoverable'],
            usage: 'Content containers with flexible layouts',
          },
        ],
        organisms: [
          {
            name: 'Modal',
            file: 'modal.ejs',
            description: 'Complete modal dialog with header, body and footer',
            path: 'organisms/common/modal',
            params: ['id', 'title', 'size', 'centered', 'bodyContent', 'primaryButtonText'],
            usage: 'Modal dialogs for complex interactions',
          },
        ],
      };

      res.render('templates/atomic-showcase-layout', {
        title: 'Common Components - Atomic Design',
        headerTitle: 'Common Components',
        headerSubtitle: 'Reusable components shared across different contexts',
        category: 'common',
        components,
        breadcrumbs: [
          { text: 'Atomic Design', url: '/atomic' },
          { text: 'Common Components' },
        ],
      });
    } catch (error) {
      logger.error('Error in common components showcase', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
      });

      res.status(500).render('errors/error', {
        title: 'Common Showcase Error',
        message: 'Unable to load common components',
        error: process.env.NODE_ENV === 'development' ? error : null,
      });
    }
  }
}

module.exports = AtomicController;
