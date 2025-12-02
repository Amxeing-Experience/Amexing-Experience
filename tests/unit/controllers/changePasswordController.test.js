/**
 * Change Password Controller Unit Tests
 * Tests for dashboard change password functionality
 * Created by Denisse Maldonado
 */

jest.mock('parse/node', () => ({
  User: {
    logIn: jest.fn(),
    logOut: jest.fn(),
  },
  Query: jest.fn(),
  Object: jest.fn(),
  Cloud: {
    run: jest.fn(),
  },
  initialize: jest.fn(),
  serverURL: '',
}));

jest.mock('../../../src/infrastructure/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const Parse = require('parse/node');
const bcrypt = require('bcrypt');
const RoleBasedController = require('../../../src/application/controllers/dashboard/base/RoleBasedController');
const { createMockRequest, createMockResponse, createMockNext } = require('../../helpers/testUtils');

describe('Change Password Controller', () => {
  let controller, mockReq, mockRes, mockNext;

  beforeEach(() => {
    controller = new RoleBasedController();
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockRes.locals = { csrfToken: 'test-csrf-token' };
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('changePassword', () => {
    it('should render change password page for GET request', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'admin' };
      
      // Mock the renderRoleView method
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/admin');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/admin/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for superadmin', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'superadmin' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/superadmin');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/superadmin/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for client', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'client' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/client');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/client/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for department_manager', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'department_manager' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/department_manager');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/department_manager/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for employee', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'employee' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/employee');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/employee/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for driver', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'driver' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/driver');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/driver/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle role dashboard route correctly for guest', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'guest' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/guest');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledWith(mockReq, mockRes, 'change-password', {
        title: 'Change Password',
        csrfToken: 'test-csrf-token',
        breadcrumb: {
          title: 'Change Password',
          items: [
            { name: 'Profile', href: '/dashboard/guest/profile' },
            { name: 'Change Password', active: true }
          ],
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'admin' };
      
      const error = new Error('Test error');
      controller.renderRoleView = jest.fn().mockRejectedValue(error);
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/admin');
      controller.handleError = jest.fn();

      await controller.changePassword(mockReq, mockRes);

      expect(controller.handleError).toHaveBeenCalledWith(mockRes, error);
    });

    it('should call renderRoleView with correct parameters', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'admin' };
      
      controller.renderRoleView = jest.fn().mockResolvedValue();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/admin');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalledTimes(1);
      expect(controller.renderRoleView).toHaveBeenCalledWith(
        mockReq,
        mockRes,
        'change-password',
        expect.objectContaining({
          title: 'Change Password',
          csrfToken: 'test-csrf-token',
          breadcrumb: expect.objectContaining({
            title: 'Change Password',
            items: expect.arrayContaining([
              expect.objectContaining({ name: 'Profile' }),
              expect.objectContaining({ name: 'Change Password', active: true })
            ])
          })
        })
      );
    });

    it('should construct breadcrumb correctly for profile link', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'employee' };
      
      controller.renderRoleView = jest.fn().mockResolvedValue();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/employee');

      await controller.changePassword(mockReq, mockRes);

      const renderCall = controller.renderRoleView.mock.calls[0];
      const viewData = renderCall[3];
      
      expect(viewData.breadcrumb.items[0].href).toBe('/dashboard/employee/profile');
      expect(viewData.breadcrumb.items[0].name).toBe('Profile');
      expect(viewData.breadcrumb.items[1].active).toBe(true);
    });
  });

  describe('changePassword error handling', () => {
    it('should handle missing user in request', async () => {
      mockReq.method = 'GET';
      mockReq.user = null;
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/guest');
      controller.handleError = jest.fn();

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalled();
    });

    it('should handle undefined role in user object', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id' };
      
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/guest');

      await controller.changePassword(mockReq, mockRes);

      expect(controller.renderRoleView).toHaveBeenCalled();
    });

    it('should handle renderRoleView throwing an error', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'admin' };
      
      const renderError = new Error('Render failed');
      controller.renderRoleView = jest.fn().mockRejectedValue(renderError);
      controller.getRoleDashboardRoute = jest.fn().mockReturnValue('/dashboard/admin');
      controller.handleError = jest.fn();

      await controller.changePassword(mockReq, mockRes);

      expect(controller.handleError).toHaveBeenCalledWith(mockRes, renderError);
    });

    it('should handle getRoleDashboardRoute throwing an error', async () => {
      mockReq.method = 'GET';
      mockReq.user = { id: 'test-user-id', role: 'admin' };
      
      const routeError = new Error('Route failed');
      controller.renderRoleView = jest.fn();
      controller.getRoleDashboardRoute = jest.fn().mockImplementation(() => {
        throw routeError;
      });
      controller.handleError = jest.fn();

      await controller.changePassword(mockReq, mockRes);

      expect(controller.handleError).toHaveBeenCalledWith(mockRes, routeError);
    });
  });
});