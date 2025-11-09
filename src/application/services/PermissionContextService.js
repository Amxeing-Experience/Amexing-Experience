/* eslint-disable max-lines */
/**
 * Permission Context Service - Manages multi-departmental and context-specific permissions
 * Implements OAUTH-3-05: Contexto Departamental en Sesiones OAuth.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Service method usage
 * const result = await permissioncontextservice.require({ 'parse/node': 'example' });
 * // Returns: { success: true, data: {...} }
 */

const Parse = require('parse/node');
const OAuthPermissionService = require('./OAuthPermissionService');
// const AmexingUser = require('../../domain/models/AmexingUser'); // Unused import
const logger = require('../../infrastructure/logger');

/**
 * Permission Context Service - Manages context-specific permissions and access control.
 * Handles multi-departmental permissions, project-based access, and dynamic context
 * switching within OAuth sessions. Implements sophisticated context-aware authorization.
 *
 * This service provides the foundation for context-sensitive permission management,
 * allowing users to operate under different permission contexts (departments, projects,
 * clients) with appropriate access control and validation.
 *
 * Features:
 * - Multi-context permission management (department, project, client, temporary)
 * - Dynamic context switching and validation
 * - Context-specific permission inheritance
 * - Permission caching and performance optimization
 * - Audit logging for context changes
 * - Context metadata and UI integration
 * - Temporary permission elevation.
 * @class PermissionContextService
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize context service
 * const contextService = new PermissionContextService();
 *
 * // Get user's available contexts
 * const contexts = await contextService.getUserContexts(user);
 *
 * // Switch to department context
 * const departmentContext = {
 *   type: 'department',
 *   id: 'dept_sistemas',
 *   name: 'Sistemas'
 * };
 * await contextService.switchContext(user, departmentContext);
 *
 * // Validate context permissions
 * const hasAccess = await contextService.validateContextPermission(
 *   user, 'admin_access', 'department'
 * );
 *
 * // Create temporary context for specific operation
 * const tempContext = await contextService.createTemporaryContext(
 *   user, 'emergency_access', 3600
 * );
 */
class PermissionContextService {
  constructor() {
    // Context types and their metadata
    this.contextTypes = {
      department: {
        displayName: 'Departamento',
        icon: 'department',
        color: '#007bff',
        requiresValidation: true,
      },
      project: {
        displayName: 'Proyecto',
        icon: 'project',
        color: '#28a745',
        requiresValidation: true,
      },
      client: {
        displayName: 'Cliente',
        icon: 'client',
        color: '#ffc107',
        requiresValidation: true,
      },
      temporary: {
        displayName: 'Temporal',
        icon: 'clock',
        color: '#dc3545',
        requiresValidation: false,
      },
    };

    // Context permissions cache for performance
    this.contextPermissionsCache = new Map();
  }

  /**
   * Gets all available contexts for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<Array>} - Available contexts.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getAvailableContexts({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const contexts = await service.getAvailableContexts('user123');
   */
  async getAvailableContexts(userId) {
    try {
      const contexts = [];

      // Get department contexts
      const departmentContexts = await this.getDepartmentContexts(userId);
      contexts.push(...departmentContexts);

      // Get project contexts
      const projectContexts = await this.getProjectContexts(userId);
      contexts.push(...projectContexts);

      // Get client contexts (for employees with multiple client access)
      const clientContexts = await this.getClientContexts(userId);
      contexts.push(...clientContexts);

      // Get temporary contexts
      const tempContexts = await this.getTemporaryContexts(userId);
      contexts.push(...tempContexts);

      logger.logSecurityEvent('AVAILABLE_CONTEXTS_RETRIEVED', userId, {
        contextCount: contexts.length,
        contextTypes: contexts.map((c) => c.type),
      });

      return contexts;
    } catch (error) {
      logger.error('Error getting available contexts:', error);
      return [];
    }
  }

  /**
   * Gets department contexts for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<Array>} - Department contexts.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getDepartmentContexts({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const deptContexts = await service.getDepartmentContexts('user123');
   */
  async getDepartmentContexts(userId) {
    try {
      // Get user's employee records (can have multiple)
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('userId', userId);
      employeeQuery.equalTo('active', true);
      employeeQuery.include(['clientId', 'departmentId']);

      const employees = await employeeQuery.find({ useMasterKey: true });

      const departmentContexts = [];

      for (const employee of employees) {
        const client = employee.get('clientId');
        const departmentId = employee.get('departmentId');

        if (client && departmentId) {
          // Get department details
          const deptQuery = new Parse.Query('ClientDepartment');
          const department = await deptQuery.get(departmentId, {
            useMasterKey: true,
          });

          const context = {
            id: `dept_${departmentId}`,
            type: 'department',
            displayName: department.get('name'),
            description: `${client.get('name')} - ${department.get('name')}`,
            metadata: {
              clientId: client.id,
              clientName: client.get('name'),
              departmentId,
              departmentCode: department.get('departmentCode'),
              employeeId: employee.id,
              accessLevel: employee.get('accessLevel'),
            },
            permissions: await this.getDepartmentPermissions(departmentId),
            ...this.contextTypes.department,
          };

          departmentContexts.push(context);
        }
      }

      return departmentContexts;
    } catch (error) {
      logger.error('Error getting department contexts:', error);
      return [];
    }
  }

  /**
   * Gets project contexts for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<Array>} - Project contexts.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getProjectContexts({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const projectContexts = await service.getProjectContexts('user123');
   */
  async getProjectContexts(userId) {
    try {
      // Get user's project assignments
      const projectQuery = new Parse.Query('ProjectAssignment');
      projectQuery.equalTo('userId', userId);
      projectQuery.equalTo('active', true);
      projectQuery.include('projectId');

      const assignments = await projectQuery.find({ useMasterKey: true });

      const projectContexts = [];

      for (const assignment of assignments) {
        const project = assignment.get('projectId');

        if (project) {
          const context = {
            id: `project_${project.id}`,
            type: 'project',
            displayName: project.get('name'),
            description: `Proyecto: ${project.get('name')}`,
            metadata: {
              projectId: project.id,
              assignmentId: assignment.id,
              role: assignment.get('role'),
              permissions: assignment.get('permissions') || [],
            },
            permissions: assignment.get('permissions') || [],
            ...this.contextTypes.project,
          };

          projectContexts.push(context);
        }
      }

      return projectContexts;
    } catch (error) {
      logger.error('Error getting project contexts:', error);
      return [];
    }
  }

  /**
   * Gets client contexts for a user (for multi-client access).
   * @param {string} userId - User ID.
   * @returns {Promise<Array>} - Client contexts.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getClientContexts({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const clientContexts = await service.getClientContexts('user123');
   */
  async getClientContexts(userId) {
    try {
      // Get clients where user has direct access
      const clientAccessQuery = new Parse.Query('ClientAccess');
      clientAccessQuery.equalTo('userId', userId);
      clientAccessQuery.equalTo('active', true);
      clientAccessQuery.include('clientId');

      const accesses = await clientAccessQuery.find({ useMasterKey: true });

      const clientContexts = [];

      for (const access of accesses) {
        const client = access.get('clientId');

        if (client) {
          const context = {
            id: `client_${client.id}`,
            type: 'client',
            displayName: client.get('name'),
            description: `Cliente: ${client.get('name')}`,
            metadata: {
              clientId: client.id,
              accessId: access.id,
              accessLevel: access.get('accessLevel'),
              permissions: access.get('permissions') || [],
            },
            permissions: access.get('permissions') || [],
            ...this.contextTypes.client,
          };

          clientContexts.push(context);
        }
      }

      return clientContexts;
    } catch (error) {
      logger.error('Error getting client contexts:', error);
      return [];
    }
  }

  /**
   * Gets temporary contexts for a user.
   * @param {string} userId - User ID.
   * @returns {Promise<Array>} - Temporary contexts.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getTemporaryContexts({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const tempContexts = await service.getTemporaryContexts('user123');
   */
  async getTemporaryContexts(userId) {
    try {
      // Get active temporary permissions
      const tempQuery = new Parse.Query('PermissionOverride');
      tempQuery.equalTo('userId', userId);
      tempQuery.equalTo('overrideType', 'elevate');
      tempQuery.equalTo('active', true);
      tempQuery.exists('expiresAt');
      tempQuery.greaterThan('expiresAt', new Date());

      const tempPermissions = await tempQuery.find({ useMasterKey: true });

      const tempContexts = [];

      // Group temporary permissions by context if available
      const contextGroups = new Map();

      for (const tempPerm of tempPermissions) {
        const context = tempPerm.get('context') || 'general';

        if (!contextGroups.has(context)) {
          contextGroups.set(context, {
            permissions: [],
            expires: tempPerm.get('expiresAt'),
            grantedBy: tempPerm.get('grantedBy'),
            reason: tempPerm.get('reason'),
          });
        }

        contextGroups.get(context).permissions.push(tempPerm.get('permission'));

        // Use earliest expiration time
        const currentExpires = contextGroups.get(context).expires;
        const permExpires = tempPerm.get('expiresAt');
        if (permExpires < currentExpires) {
          contextGroups.get(context).expires = permExpires;
        }
      }

      // Create context objects
      for (const [contextName, data] of contextGroups) {
        const context = {
          id: `temp_${contextName}`,
          type: 'temporary',
          displayName: `Temporal: ${contextName}`,
          description: `Permisos temporales hasta ${data.expires.toLocaleString()}`,
          metadata: {
            context: contextName,
            expires: data.expires,
            grantedBy: data.grantedBy,
            reason: data.reason,
            permissionCount: data.permissions.length,
          },
          permissions: data.permissions,
          expiresAt: data.expires,
          ...this.contextTypes.temporary,
        };

        tempContexts.push(context);
      }

      return tempContexts;
    } catch (error) {
      logger.error('Error getting temporary contexts:', error);
      return [];
    }
  }

  /**
   * Switches user to a specific context.
   * @param {string} userId - User ID.
   * @param {string} contextId - Context ID to switch to.
   * @param {string} sessionId - Current session ID.
   * @returns {Promise<object>} - Context switch result.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.switchToContext({ userId: 'example' , contextId: 'example', sessionId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const result = await service.switchToContext('user123', 'dept_hr', 'session456');
   */
  async switchToContext(userId, contextId, sessionId) {
    try {
      // Get available contexts to validate the switch
      const availableContexts = await this.getAvailableContexts(userId);
      const targetContext = availableContexts.find((ctx) => ctx.id === contextId);

      if (!targetContext) {
        throw new Error(`Context ${contextId} not available for user ${userId}`);
      }

      // Validate context access if required
      if (targetContext.requiresValidation) {
        await this.validateContextAccess(userId, targetContext);
      }

      // Get or create permission context record
      const contextRecord = await this.getOrCreateContextRecord(userId, sessionId);

      // Update current context
      contextRecord.set('currentContext', contextId);
      contextRecord.set('currentContextData', targetContext);
      contextRecord.set('lastSwitched', new Date());
      contextRecord.set('sessionId', sessionId);

      // Store available contexts for quick access
      contextRecord.set(
        'availableContexts',
        availableContexts.map((ctx) => ({
          id: ctx.id,
          type: ctx.type,
          displayName: ctx.displayName,
          description: ctx.description,
        }))
      );

      await contextRecord.save(null, { useMasterKey: true });

      // Apply context-specific permissions to session
      await this.applyContextPermissions(userId, sessionId, targetContext);

      logger.logSecurityEvent('CONTEXT_SWITCHED', userId, {
        fromContext: contextRecord.previous('currentContext'),
        toContext: contextId,
        contextType: targetContext.type,
        sessionId,
        permissionCount: targetContext.permissions.length,
      });

      return {
        success: true,
        contextId,
        context: targetContext,
        sessionId,
        switchedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error switching user context:', error);
      throw error;
    }
  }

  /**
   * Gets or creates permission context record for user.
   * @param {string} userId - User ID.
   * @param {string} sessionId - Session ID.
   * @returns {Promise<Parse.Object>} - Context record.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getOrCreateContextRecord({ userId: 'example' , sessionId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const contextRecord = await service.getOrCreateContextRecord('user123', 'session456');
   */
  async getOrCreateContextRecord(userId, sessionId) {
    try {
      // Try to find existing context record
      const contextQuery = new Parse.Query('PermissionContext');
      contextQuery.equalTo('userId', userId);
      contextQuery.equalTo('sessionId', sessionId);

      let contextRecord = await contextQuery.first({ useMasterKey: true });

      if (!contextRecord) {
        // Create new context record
        const ContextClass = Parse.Object.extend('PermissionContext');
        contextRecord = new ContextClass();

        contextRecord.set('userId', userId);
        contextRecord.set('sessionId', sessionId);
        contextRecord.set('createdAt', new Date());
      }

      return contextRecord;
    } catch (error) {
      logger.error('Error getting/creating context record:', error);
      throw error;
    }
  }

  /**
   * Validates user access to a context.
   * @param {string} userId - User ID.
   * @param {object} context - Context to validate.
   * @returns {Promise<void>} - Completes when validation passes, throws if fails.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.validateContextAccess({ userId: 'example' , context: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.validateContextAccess('user123', contextObject);
   */
  async validateContextAccess(userId, context) {
    try {
      switch (context.type) {
        case 'department':
          await this.validateDepartmentAccess(userId, context.metadata.departmentId);
          break;
        case 'project':
          await this.validateProjectAccess(userId, context.metadata.projectId);
          break;
        case 'client':
          await this.validateClientAccess(userId, context.metadata.clientId);
          break;
        case 'temporary':
          await this.validateTemporaryAccess(userId, context);
          break;
        default:
          throw new Error(`Unknown context type: ${context.type}`);
      }
    } catch (error) {
      logger.error('Context access validation failed:', error);
      throw error;
    }
  }

  /**
   * Validates department access.
   * @param {string} userId - User ID.
   * @param {string} departmentId - Department ID.
   * @returns {Promise<void>} - Completes when validation passes, throws if fails.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.validateDepartmentAccess({ userId: 'example' , departmentId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.validateDepartmentAccess('user123', 'dept456');
   */
  async validateDepartmentAccess(userId, departmentId) {
    const employeeQuery = new Parse.Query('ClientEmployee');
    employeeQuery.equalTo('userId', userId);
    employeeQuery.equalTo('departmentId', departmentId);
    employeeQuery.equalTo('active', true);

    const employee = await employeeQuery.first({ useMasterKey: true });

    if (!employee) {
      throw new Error('User does not have access to this department');
    }
  }

  /**
   * Validates project access.
   * @param {string} userId - User ID.
   * @param {string} projectId - Project ID.
   * @returns {Promise<void>} - Completes when validation passes, throws if fails.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.validateProjectAccess({ userId: 'example' , projectId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.validateProjectAccess('user123', 'project456');
   */
  async validateProjectAccess(userId, projectId) {
    const assignmentQuery = new Parse.Query('ProjectAssignment');
    assignmentQuery.equalTo('userId', userId);
    assignmentQuery.equalTo('projectId', projectId);
    assignmentQuery.equalTo('active', true);

    const assignment = await assignmentQuery.first({ useMasterKey: true });

    if (!assignment) {
      throw new Error('User does not have access to this project');
    }
  }

  /**
   * Validates client access.
   * @param {string} userId - User ID.
   * @param {string} clientId - Client ID.
   * @returns {Promise<void>} - Completes when validation passes, throws if fails.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.validateClientAccess({ userId: 'example' , clientId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.validateClientAccess('user123', 'client456');
   */
  async validateClientAccess(userId, clientId) {
    const accessQuery = new Parse.Query('ClientAccess');
    accessQuery.equalTo('userId', userId);
    accessQuery.equalTo('clientId', clientId);
    accessQuery.equalTo('active', true);

    const access = await accessQuery.first({ useMasterKey: true });

    if (!access) {
      throw new Error('User does not have access to this client');
    }
  }

  /**
   * Validates temporary access.
   * @param {string} userId - User ID.
   * @param {object} context - Temporary context.
   * @returns {Promise<void>} - Completes when validation passes, throws if fails.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.validateTemporaryAccess({ userId: 'example' , context: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.validateTemporaryAccess('user123', tempContext);
   */
  async validateTemporaryAccess(userId, context) {
    if (context.expiresAt && context.expiresAt < new Date()) {
      throw new Error('Temporary permissions have expired');
    }
  }

  /**
   * Applies context-specific permissions to session.
   * @param {string} userId - User ID.
   * @param {string} sessionId - Session ID.
   * @param {object} context - Context with permissions.
   * @returns {Promise<void>} - Completes when permissions are applied.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.applyContextPermissions({ userId: 'example' , sessionId: 'example', context: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * await service.applyContextPermissions('user123', 'session456', contextObject);
   */
  async applyContextPermissions(userId, sessionId, context) {
    try {
      // Store context permissions in cache for quick access
      const cacheKey = `${userId}:${sessionId}`;
      this.contextPermissionsCache.set(cacheKey, {
        contextId: context.id,
        permissions: context.permissions,
        timestamp: Date.now(),
      });

      // Also store in database session record
      const sessionQuery = new Parse.Query('_Session');
      sessionQuery.equalTo('user', {
        __type: 'Pointer',
        className: '_User',
        objectId: userId,
      });
      sessionQuery.equalTo('sessionToken', sessionId);

      const session = await sessionQuery.first({ useMasterKey: true });

      if (session) {
        session.set('contextPermissions', context.permissions);
        session.set('currentContext', context.id);
        await session.save(null, { useMasterKey: true });
      }
    } catch (error) {
      logger.error('Error applying context permissions:', error);
      throw error;
    }
  }

  /**
   * Gets current context for a user session.
   * @param {string} userId - User ID.
   * @param {string} sessionId - Session ID.
   * @returns {Promise<object | null>} - Current context or null.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getCurrentContext({ userId: 'example' , sessionId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const currentContext = await service.getCurrentContext('user123', 'session456');
   */
  async getCurrentContext(userId, sessionId) {
    try {
      const contextQuery = new Parse.Query('PermissionContext');
      contextQuery.equalTo('userId', userId);
      contextQuery.equalTo('sessionId', sessionId);

      const contextRecord = await contextQuery.first({ useMasterKey: true });

      return contextRecord
        ? {
          contextId: contextRecord.get('currentContext'),
          contextData: contextRecord.get('currentContextData'),
          availableContexts: contextRecord.get('availableContexts'),
          lastSwitched: contextRecord.get('lastSwitched'),
        }
        : null;
    } catch (error) {
      logger.error('Error getting current context:', error);
      return null;
    }
  }

  /**
   * Gets permissions for a context.
   * @param {string} contextId - Context ID.
   * @returns {Promise<Array>} - Context permissions.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getContextPermissions({ contextId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const permissions = await service.getContextPermissions('dept_hr');
   */
  async getContextPermissions(contextId) {
    try {
      // Try cache first
      const cached = this.contextPermissionsCache.get(contextId);
      if (cached && Date.now() - cached.timestamp < 300000) {
        // 5 minute cache
        return cached.permissions;
      }

      // Extract permissions based on context type
      const [type, id] = contextId.split('_');
      let permissions = [];

      switch (type) {
        case 'dept':
          permissions = await this.getDepartmentPermissions(id);
          break;
        case 'project':
          permissions = await this.getProjectPermissions(id);
          break;
        case 'client':
          permissions = await this.getClientPermissions(id);
          break;
        case 'temp':
          permissions = await this.getTemporaryPermissions(id);
          break;
        default:
          // Unknown context type, return empty permissions
          permissions = [];
          break;
      }

      // Cache the result
      this.contextPermissionsCache.set(contextId, {
        permissions,
        timestamp: Date.now(),
      });

      return permissions;
    } catch (error) {
      logger.error('Error getting context permissions:', error);
      return [];
    }
  }

  /**
   * Gets department permissions.
   * @param {string} departmentId - Department ID.
   * @returns {Promise<Array>} - Department permissions.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getDepartmentPermissions({ departmentId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const deptPermissions = await service.getDepartmentPermissions('hr');
   */
  async getDepartmentPermissions(departmentId) {
    return OAuthPermissionService.getDepartmentPermissions(null, departmentId);
  }

  /**
   * Gets project permissions.
   * @param {string} projectId - Project ID.
   * @returns {Promise<Array>} - Project permissions.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getProjectPermissions({ projectId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const service = new PermissionContextService();
   * const projectPermissions = await service.getProjectPermissions('project123');
   */
  async getProjectPermissions(projectId) {
    try {
      const projectQuery = new Parse.Query('Project');
      const project = await projectQuery.get(projectId, { useMasterKey: true });

      return project.get('permissions') || [];
    } catch (error) {
      logger.error('Error getting project permissions:', error);
      return [];
    }
  }

  /**
   * Gets client permissions.
   * @param {string} clientId - Client ID.
   * @returns {Promise<Array>} - Client permissions.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getClientPermissions({ clientId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const clientPermissions = await service.getClientPermissions('client123');
   */
  async getClientPermissions(clientId) {
    try {
      const clientQuery = new Parse.Query('Client');
      const client = await clientQuery.get(clientId, { useMasterKey: true });

      return client.get('permissions') || [];
    } catch (error) {
      logger.error('Error getting client permissions:', error);
      return [];
    }
  }

  /**
   * Gets temporary permissions.
   * @param {string} context - Temporary context.
   * @returns {Promise<Array>} - Temporary permissions.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.getTemporaryPermissions({ context: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * const tempPermissions = await service.getTemporaryPermissions('emergency');
   */
  async getTemporaryPermissions(context) {
    try {
      const tempQuery = new Parse.Query('PermissionOverride');
      tempQuery.equalTo('context', context);
      tempQuery.equalTo('overrideType', 'elevate');
      tempQuery.equalTo('active', true);
      tempQuery.greaterThan('expiresAt', new Date());

      const tempPerms = await tempQuery.find({ useMasterKey: true });

      return tempPerms.map((perm) => perm.get('permission'));
    } catch (error) {
      logger.error('Error getting temporary permissions:', error);
      return [];
    }
  }

  /**
   * Clears context permissions cache.
   * @param {string} userId - User ID (optional, clears all if not provided).
   * @returns {void} - No return value.
   * @example
   * // Service method usage
   * const result = await permissioncontextservice.clearContextCache({ userId: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await service.methodName(parameters);
   * // Returns: Promise resolving to operation result
   * const service = new PermissionContextService();
   * service.clearContextCache('user123'); // Clear specific user cache
   * service.clearContextCache(); // Clear all cache
   */
  clearContextCache(userId = null) {
    if (userId) {
      // Clear cache entries for specific user
      for (const key of this.contextPermissionsCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.contextPermissionsCache.delete(key);
        }
      }
    } else {
      // Clear entire cache
      this.contextPermissionsCache.clear();
    }
  }
}

module.exports = { PermissionContextService };
