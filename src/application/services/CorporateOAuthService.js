/* eslint-disable max-lines */
/**
 * Corporate OAuth Service - Handles corporate domain mapping and employee auto-provisioning
 * Implements OAuth-2-01 through OAuth-2-06 user stories for Sprint 2.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 */

const Parse = require('parse/node');
const AmexingUser = require('../../domain/models/AmexingUser');
const PermissionInheritanceService = require('./PermissionInheritanceService');
const logger = require('../../infrastructure/logger');

class CorporateOAuthService {
  constructor() {
    // Known corporate domains for auto-mapping
    this.corporateDomains = new Map([
      // Universidad UTQ (Google Workspace)
      ['utq.edu.mx', {
        clientName: 'Universidad UTQ',
        type: 'education',
        primaryProvider: 'google',
        autoProvisionEmployees: true,
        departmentMapping: {
          'eventos@utq.edu.mx': 'eventos',
          'administracion@utq.edu.mx': 'administracion',
          'sistemas@utq.edu.mx': 'IT',
        },
      }],
      // Grupo NUBA (Microsoft Azure AD)
      ['nuba.com.mx', {
        clientName: 'Grupo NUBA',
        type: 'corporate',
        primaryProvider: 'microsoft',
        autoProvisionEmployees: true,
        departmentMapping: {
          IT: 'sistemas',
          HR: 'recursos-humanos',
          'Human Resources': 'recursos-humanos',
          Finance: 'finanzas',
          Operations: 'operaciones',
          'Information Technology': 'sistemas',
          Technology: 'sistemas',
          Sistemas: 'sistemas',
          'Recursos Humanos': 'recursos-humanos',
          Finanzas: 'finanzas',
          Operaciones: 'operaciones',
        },
        microsoftTenantId: process.env.MICROSOFT_OAUTH_TENANT_ID,
        enableDirectorySync: true,
      }],
      // Development domains
      ['amexing.local', {
        clientName: 'Amexing Internal',
        type: 'internal',
        primaryProvider: 'google',
        autoProvisionEmployees: true,
      }],
    ]);
  }

  /**
   * Maps OAuth user to corporate client and creates/updates AmexingUser
   * Implements OAUTH-2-02: Employee Auto-provisioning.
   * @param {object} oauthUserInfo - OAuth user profile.
   * @param {string} provider - OAuth provider.
   * @returns {Promise<object>} User and client mapping result.
   * @example
   */
  async mapCorporateUser(oauthUserInfo, provider) {
    try {
      const emailDomain = this.extractEmailDomain(oauthUserInfo.email);

      // Check if this is a known corporate domain
      const corporateConfig = this.corporateDomains.get(emailDomain);

      let client = null;

      if (corporateConfig) {
        // Find or create corporate client
        client = await this.findOrCreateCorporateClient(emailDomain, corporateConfig, provider);

        logger.logSecurityEvent('CORPORATE_DOMAIN_DETECTED', null, {
          domain: emailDomain,
          provider,
          clientName: corporateConfig.clientName,
        });
      }

      // Create or update AmexingUser
      const user = await this.createOrUpdateOAuthUser(oauthUserInfo, provider, corporateConfig);

      // Create employee relationship if corporate client exists
      if (client) {
        await this.createOrUpdateEmployeeRelationship(user, client, oauthUserInfo, corporateConfig);
      }

      // Process permission inheritance for corporate users
      if (client && corporateConfig) {
        try {
          await PermissionInheritanceService.processCompleteInheritance(user, oauthUserInfo, provider, corporateConfig);

          logger.logSecurityEvent('CORPORATE_PERMISSION_INHERITANCE_COMPLETED', user.id, {
            clientId: client.id,
            provider,
            clientName: corporateConfig.clientName,
          });
        } catch (permissionError) {
          logger.error('Error processing permission inheritance:', permissionError);
          // Don't fail the entire OAuth process for permission errors
        }
      }

      return { user, client, isCorporateUser: !!client };
    } catch (error) {
      logger.error('Corporate user mapping error:', error);
      throw error;
    }
  }

  /**
   * Extracts email domain from email address.
   * @param {string} email - Email address.
   * @returns {string} Domain part of email.
   * @example
   */
  extractEmailDomain(email) {
    if (!email || !email.includes('@')) {
      return null;
    }
    return email.split('@')[1].toLowerCase();
  }

  /**
   * Finds or creates corporate client based on domain
   * Implements OAUTH-2-01: Admin SSO Configuration.
   * @param {string} domain - Email domain.
   * @param {object} config - Corporate configuration.
   * @param {string} provider - OAuth provider.
   * @returns {Promise<Parse.Object>} Client object.
   * @example
   */
  async findOrCreateCorporateClient(domain, config, provider) {
    try {
      // First, try to find existing client by domain
      const clientQuery = new Parse.Query('Client');
      clientQuery.equalTo('corporateDomain', domain);

      let client = await clientQuery.first({ useMasterKey: true });

      if (!client) {
        // Create new corporate client
        const ClientClass = Parse.Object.extend('Client');
        client = new ClientClass();

        client.set('name', config.clientName);
        client.set('corporateDomain', domain);
        client.set('type', config.type);
        client.set('primaryOAuthProvider', provider);
        client.set('oauthEnabled', true);
        client.set('autoProvisionEmployees', config.autoProvisionEmployees);
        client.set('active', true);
        client.set('tier', 'enterprise'); // Corporate clients get enterprise tier

        // Set corporate-specific settings
        client.set('corporateSettings', {
          ssoEnabled: true,
          autoProvisionEmployees: config.autoProvisionEmployees,
          departmentMappingEnabled: !!config.departmentMapping,
          primaryProvider: provider,
          domain,
        });

        await client.save(null, { useMasterKey: true });

        logger.logSecurityEvent('CORPORATE_CLIENT_CREATED', null, {
          clientId: client.id,
          domain,
          provider,
          name: config.clientName,
        });
      } else {
        // Update existing client OAuth settings
        client.set('primaryOAuthProvider', provider);
        client.set('oauthEnabled', true);
        client.set('lastOAuthSync', new Date());

        await client.save(null, { useMasterKey: true });
      }

      return client;
    } catch (error) {
      logger.error(`Error finding/creating corporate client for domain ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Creates or updates OAuth user in AmexingUser table.
   * @param {object} oauthUserInfo - OAuth user profile.
   * @param {string} provider - OAuth provider.
   * @param {object} corporateConfig - Corporate configuration (optional).
   * @returns {Promise<AmexingUser>} User object.
   * @example
   */
  // eslint-disable-next-line complexity
  async createOrUpdateOAuthUser(oauthUserInfo, provider, corporateConfig = null) {
    try {
      // Check if user exists by OAuth ID
      const query = new Parse.Query(AmexingUser);
      query.equalTo('oauthProvider', provider);
      query.equalTo('oauthId', oauthUserInfo.sub || oauthUserInfo.id);

      let user = await query.first({ useMasterKey: true });

      if (!user) {
        // Check if user exists by email (migration case)
        const emailQuery = new Parse.Query(AmexingUser);
        emailQuery.equalTo('email', oauthUserInfo.email.toLowerCase());
        user = await emailQuery.first({ useMasterKey: true });

        if (user) {
          // Link existing user with OAuth
          user.set('oauthProvider', provider);
          user.set('oauthId', oauthUserInfo.sub || oauthUserInfo.id);
          user.set('isOAuthUser', true);
        }
      }

      if (!user) {
        // Create new OAuth user
        user = AmexingUser.create({
          username: this.generateUsernameFromEmail(oauthUserInfo.email),
          email: oauthUserInfo.email.toLowerCase(),
          firstName: oauthUserInfo.given_name || oauthUserInfo.name?.split(' ')[0] || 'Unknown',
          lastName: oauthUserInfo.family_name || oauthUserInfo.name?.split(' ').slice(1).join(' ') || 'User',
          role: corporateConfig ? 'employee' : 'user',
        });

        // Set OAuth-specific fields
        user.set('oauthProvider', provider);
        user.set('oauthId', oauthUserInfo.sub || oauthUserInfo.id);
        user.set('isOAuthUser', true);
        user.set('emailVerified', true); // OAuth providers verify email
      }

      // Update OAuth profile data (encrypted)
      user.set('oauthProfile', this.encryptOAuthProfile(oauthUserInfo));
      user.set('lastOAuthSync', new Date());
      user.set('active', true);

      // Set corporate-specific fields
      if (corporateConfig) {
        user.set('isCorporateUser', true);
        user.set('corporateDomain', this.extractEmailDomain(oauthUserInfo.email));
      }

      await user.save(null, { useMasterKey: true });

      logger.logSecurityEvent('OAUTH_USER_CREATED_OR_UPDATED', user.id, {
        provider,
        email: this.maskEmail(oauthUserInfo.email),
        isCorporateUser: !!corporateConfig,
        isNewUser: !user.existed(),
      });

      return user;
    } catch (error) {
      logger.error('Error creating/updating OAuth user:', error);
      throw error;
    }
  }

  /**
   * Creates or updates employee relationship with corporate client
   * Implements OAUTH-2-03: Department Group Mapping.
   * @param {AmexingUser} user - User object.
   * @param {Parse.Object} client - Client object.
   * @param {object} oauthUserInfo - OAuth user profile.
   * @param {object} corporateConfig - Corporate configuration.
   * @example
   * await service.createOrUpdateEmployeeRelationship(user, client, oauthInfo, config);
   */
  // eslint-disable-next-line max-params
  async createOrUpdateEmployeeRelationship(user, client, oauthUserInfo, corporateConfig) {
    try {
      // Check if employee relationship exists
      const employeeQuery = new Parse.Query('ClientEmployee');
      employeeQuery.equalTo('userId', user.id);
      employeeQuery.equalTo('clientId', client.id);

      let employee = await employeeQuery.first({ useMasterKey: true });

      if (!employee) {
        // Create new employee relationship
        const EmployeeClass = Parse.Object.extend('ClientEmployee');
        employee = new EmployeeClass();

        employee.set('userId', user.id);
        employee.set('clientId', client.id);
        employee.set('active', true);
        employee.set('onboardingMethod', 'oauth_auto_provision');
      }

      // Map department from OAuth profile
      const department = await this.mapDepartmentFromOAuth(oauthUserInfo, corporateConfig);
      if (department) {
        employee.set('departmentId', department);
      }

      // Set access level based on OAuth profile
      const accessLevel = this.determineAccessLevel(oauthUserInfo, corporateConfig);
      employee.set('accessLevel', accessLevel);

      // Set OAuth sync information
      employee.set('lastOAuthSync', new Date());
      employee.set('oauthProvider', user.get('oauthProvider'));

      await employee.save(null, { useMasterKey: true });

      logger.logSecurityEvent('EMPLOYEE_RELATIONSHIP_CREATED_OR_UPDATED', user.id, {
        clientId: client.id,
        department,
        accessLevel,
        provider: user.get('oauthProvider'),
      });
    } catch (error) {
      logger.error('Error creating/updating employee relationship:', error);
      throw error;
    }
  }

  /**
   * Maps department from OAuth profile based on corporate configuration.
   * @param {object} oauthUserInfo - OAuth user profile.
   * @param {object} corporateConfig - Corporate configuration.
   * @returns {Promise<string|null>} Department ID or name.
   * @example
   */
  // eslint-disable-next-line complexity
  async mapDepartmentFromOAuth(oauthUserInfo, corporateConfig) {
    if (!corporateConfig.departmentMapping) {
      return null;
    }

    // Try different OAuth fields that might contain department information
    const departmentFields = [
      oauthUserInfo.department, // Microsoft directory information
      oauthUserInfo.jobTitle,
      oauthUserInfo.organizationUnit, // Microsoft org unit
      oauthUserInfo.companyName, // Microsoft company
      oauthUserInfo.officeLocation, // Microsoft office
      oauthUserInfo.hd, // Google hosted domain
      oauthUserInfo.email, // For email-based mapping
    ];

    // Try exact matches first
    for (const field of departmentFields) {
      // eslint-disable-next-line security/detect-object-injection
      if (field && corporateConfig.departmentMapping[field]) {
        logger.logSecurityEvent('DEPARTMENT_MAPPING_SUCCESS', null, {
          field,
          // eslint-disable-next-line security/detect-object-injection
          mappedTo: corporateConfig.departmentMapping[field],
          provider: corporateConfig.primaryProvider,
        });
        // eslint-disable-next-line security/detect-object-injection
        return corporateConfig.departmentMapping[field];
      }
    }

    // Try partial matches for Microsoft departments (case-insensitive)
    if (corporateConfig.primaryProvider === 'microsoft') {
      for (const field of departmentFields) {
        if (field && typeof field === 'string') {
          const fieldLower = field.toLowerCase();

          for (const [mappingKey, mappingValue] of Object.entries(corporateConfig.departmentMapping)) {
            const keyLower = mappingKey.toLowerCase();

            // Check if field contains the mapping key or vice versa
            if (fieldLower.includes(keyLower) || keyLower.includes(fieldLower)) {
              logger.logSecurityEvent('DEPARTMENT_MAPPING_PARTIAL', null, {
                originalField: field,
                matchedKey: mappingKey,
                mappedTo: mappingValue,
                provider: 'microsoft',
              });
              return mappingValue;
            }
          }
        }
      }
    }

    // Log unmapped department for monitoring
    logger.logSecurityEvent('DEPARTMENT_MAPPING_FAILED', null, {
      availableFields: departmentFields.filter((f) => f),
      provider: corporateConfig.primaryProvider,
      clientName: corporateConfig.clientName,
    });

    return null;
  }

  /**
   * Determines access level based on OAuth profile.
   * @param {object} oauthUserInfo - OAuth user profile.
   * @param {object} _corporateConfig - Corporate configuration (unused).
   * @returns {string} Access level.
   * @example
   * const accessLevel = service.determineAccessLevel(oauthUser, config);
   */
  determineAccessLevel(oauthUserInfo, _corporateConfig) {
    // Default access level for corporate employees
    let accessLevel = 'standard';

    // Check for admin indicators in OAuth profile
    const adminIndicators = [
      'admin', 'administrator', 'manager', 'director', 'supervisor',
    ];

    const jobTitle = (oauthUserInfo.jobTitle || '').toLowerCase();
    const department = (oauthUserInfo.department || '').toLowerCase();

    if (adminIndicators.some((indicator) => jobTitle.includes(indicator) || department.includes(indicator))) {
      accessLevel = 'elevated';
    }

    // IT department gets elevated access by default
    if (department.includes('it') || department.includes('systems')
        || department.includes('technology')) {
      accessLevel = 'elevated';
    }

    return accessLevel;
  }

  /**
   * Generates username from email address.
   * @param {string} email - Email address.
   * @returns {string} Generated username.
   * @example
   */
  generateUsernameFromEmail(email) {
    const localPart = email.split('@')[0];
    // Replace dots and other characters with underscores
    return localPart.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }

  /**
   * Encrypts OAuth profile for secure storage.
   * @param {object} profile - OAuth profile data.
   * @returns {string} Encrypted profile.
   * @example
   */
  encryptOAuthProfile(profile) {
    const crypto = require('crypto');
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.OAUTH_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(JSON.stringify(profile), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    });
  }

  /**
   * Masks email for logging.
   * @param {string} email - Email address.
   * @returns {string} Masked email.
   * @example
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  }

  /**
   * Gets available corporate domains.
   * @returns {Array} List of corporate domains.
   * @example
   */
  getAvailableCorporateDomains() {
    return Array.from(this.corporateDomains.entries()).map(([domain, config]) => ({
      domain,
      clientName: config.clientName,
      type: config.type,
      primaryProvider: config.primaryProvider,
    }));
  }

  /**
   * Adds new corporate domain configuration
   * Implements OAUTH-2-01: Admin SSO Configuration.
   * @param {string} domain - Email domain.
   * @param {object} config - Corporate configuration.
   * @example
   */
  addCorporateDomain(domain, config) {
    this.corporateDomains.set(domain, config);

    logger.logSecurityEvent('CORPORATE_DOMAIN_CONFIGURED', null, {
      domain,
      clientName: config.clientName,
      provider: config.primaryProvider,
    });
  }
}

module.exports = { CorporateOAuthService };
