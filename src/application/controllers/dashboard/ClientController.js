const RoleBasedController = require('./base/RoleBasedController');

/**
 * ClientController - Implements client-specific dashboard functionality.
 */
class ClientController extends RoleBasedController {
  constructor() {
    super('client');
  }

  /**
   * Dashboard index page.
   * @function index
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await index(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async index(req, res) {
    try {
      await this.renderRoleView(req, res, 'index', {
        title: 'Client Dashboard',
        stats: await this.getClientStats(),
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Departments page.
   * @function departments
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await departments(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async departments(req, res) {
    try {
      await this.renderRoleView(req, res, 'departments', {
        title: 'Department Management',
        departments: [],
        breadcrumb: {
          title: 'Departments',
          items: [{ name: 'Departments', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Employees page.
   * @function employees
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await employees(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async employees(req, res) {
    try {
      await this.renderRoleView(req, res, 'employees', {
        title: 'Employee Management',
        employees: [],
        breadcrumb: {
          title: 'Employees',
          items: [{ name: 'Employees', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Team management page.
   * @function team
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
   */
  async team(req, res) {
    try {
      const Parse = require('parse/node');

      // Get client ID from user session
      const { user } = req;
      let clientId = '';
      let companyName = 'Company';
      let departmentManager = null;

      if (user) {
        // The user object from dashboardAuthMiddleware is a plain object, not a Parse.User
        // So we access properties directly
        clientId = user.clientId || '';

        // Fetch the actual client user data to get the correct company name
        if (clientId) {
          // The clientId points to the department manager, so let's fetch the Client record
          try {
            // First, try to get the Client record using the clientId
            const clientRecordQuery = new Parse.Query('Client');
            clientRecordQuery.equalTo('objectId', clientId);
            clientRecordQuery.equalTo('exists', true);

            const clientRecord = await clientRecordQuery.first({ useMasterKey: true });
            if (clientRecord) {
              console.log('🔍 DEBUG: Client record found, available fields:', {
                name: clientRecord.get('name'),
                companyName: clientRecord.get('companyName'),
                company: clientRecord.get('company'),
                businessName: clientRecord.get('businessName'),
                organizationName: clientRecord.get('organizationName'),
                allAttributes: Object.keys(clientRecord.attributes),
              });

              // Get company name from Client record
              companyName = clientRecord.get('name')
                           || clientRecord.get('companyName')
                           || clientRecord.get('company')
                           || clientRecord.get('businessName')
                           || clientRecord.get('organizationName')
                           || 'Mi Empresa';
              console.log('🔍 DEBUG: Got company name from Client record:', companyName);
            } else {
              console.log('🔍 DEBUG: No Client record found for clientId:', clientId);

              // Try to get from the current user record
              const clientQuery = new Parse.Query(Parse.User);
              clientQuery.equalTo('objectId', user.id);

              const clientUser = await clientQuery.first({ useMasterKey: true });
              if (clientUser) {
                // Debug: log all available fields
                console.log('🔍 DEBUG: Client user fields available:', {
                  companyName: clientUser.get('companyName'),
                  company: clientUser.get('company'),
                  organizationName: clientUser.get('organizationName'),
                  clientName: clientUser.get('clientName'),
                  businessName: clientUser.get('businessName'),
                  allAttributes: clientUser.attributes,
                });

                // Get company name from the client user - check all possible fields
                companyName = clientUser.get('companyName')
                             || clientUser.get('company')
                             || clientUser.get('organizationName')
                             || clientUser.get('clientName')
                             || clientUser.get('businessName')
                             || 'Mi Empresa';
                console.log('🔍 DEBUG: Fetched client user company name from database:', companyName);
              } else {
                console.log('🔍 DEBUG: Client user not found in database for ID:', user.id);
                companyName = 'Mi Empresa';
              }
            }
          } catch (error) {
            console.error('🔍 DEBUG: Error fetching client user data:', error);
            // Use fallback from session if available
            companyName = user.companyName || user.company || user.organizationName || 'Mi Empresa';
          }
        } else {
          // Fallback to session data if no user ID
          companyName = user.companyName || user.company || user.organizationName || 'Mi Empresa';
        }

        // Debug: Check what user data we have
        console.log('🔍 DEBUG: Current CLIENT user data:', {
          userId: user.id,
          userEmail: user.email || user.username,
          clientId,
          companyName,
          availableUserFields: Object.keys(user),
        });

        // Fetch department manager information if clientId exists
        if (clientId) {
          try {
            console.log('🔍 DEBUG: Looking for department manager with clientId:', clientId);

            const query = new Parse.Query(Parse.User);
            query.equalTo('objectId', clientId);
            query.equalTo('exists', true);
            query.select(['firstName', 'lastName', 'email', 'phone', 'role', 'active', 'companyName', 'contextualData']);

            departmentManager = await query.first({ useMasterKey: true });
            console.log('🔍 DEBUG: Query result:', departmentManager ? 'Found' : 'Not found');

            if (departmentManager) {
              // Get contextualData and extract company name from it
              const contextualData = departmentManager.get('contextualData');
              console.log('🔍 DEBUG: Department manager contextualData:', contextualData);

              // Extract company name from contextualData if it exists
              if (contextualData && contextualData.companyName) {
                const { companyName: extractedCompanyName } = contextualData;
                companyName = extractedCompanyName;
                console.log('🔍 DEBUG: Got company name from department manager contextualData:', companyName);
              }

              console.log('🔍 DEBUG: Department manager details:', {
                objectId: departmentManager.id,
                email: departmentManager.get('email'),
                username: departmentManager.get('username'),
                role: departmentManager.get('role'),
                firstName: departmentManager.get('firstName'),
                lastName: departmentManager.get('lastName'),
                hasContextualData: !!departmentManager.get('contextualData'),
              });

              // Convert Parse object to plain object for template use
              // Use the company name from contextualData
              departmentManager = {
                objectId: departmentManager.id,
                firstName: departmentManager.get('firstName') || '',
                lastName: departmentManager.get('lastName') || '',
                email: departmentManager.get('email') || departmentManager.get('username') || '',
                phone: departmentManager.get('phone') || '',
                role: departmentManager.get('role') || 'department_manager',
                active: departmentManager.get('active'),
                companyName, // Use the company name from contextualData
              };

              console.log('🔍 DEBUG: Department manager data prepared with client company name:', companyName);
            } else {
              console.log('🔍 DEBUG: No department manager found, checking alternative table...');

              // Try AmexingUser table as well
              const amexingUserQuery = new Parse.Query('AmexingUser');
              amexingUserQuery.equalTo('objectId', clientId);
              amexingUserQuery.equalTo('exists', true);
              amexingUserQuery.select(['firstName', 'lastName', 'email', 'phone', 'role', 'active', 'contextualData']);

              const amexingUser = await amexingUserQuery.first({ useMasterKey: true });
              if (amexingUser) {
                console.log('🔍 DEBUG: Found in AmexingUser table');

                // Get contextualData and extract company name from it
                const contextualData = amexingUser.get('contextualData');
                console.log('🔍 DEBUG: AmexingUser contextualData:', contextualData);

                // Extract company name from contextualData if it exists
                if (contextualData && contextualData.companyName) {
                  const { companyName: extractedCompanyName } = contextualData;
                  companyName = extractedCompanyName;
                  console.log('🔍 DEBUG: Got company name from AmexingUser contextualData:', companyName);
                }

                departmentManager = {
                  objectId: amexingUser.id,
                  firstName: amexingUser.get('firstName') || '',
                  lastName: amexingUser.get('lastName') || '',
                  email: amexingUser.get('email') || amexingUser.get('username') || '',
                  phone: amexingUser.get('phone') || '',
                  role: amexingUser.get('role') || 'department_manager',
                  active: amexingUser.get('active'),
                  companyName, // Use the company name from contextualData
                };

                console.log('🔍 DEBUG: AmexingUser data prepared with company name:', companyName);
              }
            }
          } catch (error) {
            console.error('🔍 DEBUG: Error fetching department manager:', error);
            // Continue without department manager data
          }
        } else {
          console.log('🔍 DEBUG: No clientId provided, user data:', {
            hasUser: !!user,
            userKeys: user ? Object.keys(user) : [],
            clientId: user?.clientId,
            userClientId: user?.get ? user.get('clientId') : 'N/A',
          });
        }
      }

      // Final fallback for company name - only replace if it looks like an ID or is clearly invalid
      const originalCompanyName = companyName;
      if (!companyName
          || companyName === 'Company'
          || companyName === 'undefined'
          || companyName === 'null'
          || companyName.length > 50
          || /^[a-zA-Z0-9]{10,}$/.test(companyName) // IDs are usually 10+ chars
          || /^[A-Z0-9]{8,}$/.test(companyName) // All caps IDs
          || companyName.includes('objectId')
          || companyName.includes('ObjectId')
      ) {
        companyName = 'Mi Empresa';
        console.log('🔍 DEBUG: Using fallback company name. Original:', originalCompanyName, 'New:', companyName);
      } else {
        console.log('🔍 DEBUG: Keeping original company name:', companyName);
      }

      console.log('🔍 DEBUG: Final data being passed to template:', {
        clientId,
        companyName,
        hasDepartmentManager: !!departmentManager,
        departmentManagerCompany: departmentManager?.companyName,
        currentUserId: user?.id,
      });

      await this.renderRoleView(req, res, 'team', {
        title: 'My Team',
        clientId,
        companyName,
        departmentManager,
        currentUserId: user?.id,
        contextualData: {
          companyName,
          clientId,
          departmentManager,
          currentUserId: user?.id,
        },
        breadcrumb: {
          title: 'My Team',
          items: [
            { name: 'Dashboard', url: '/dashboard/client' },
            { name: 'My Team', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Budgets page.
   * @function budgets
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await budgets(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async budgets(req, res) {
    try {
      await this.renderRoleView(req, res, 'budgets', {
        title: 'Budget Management',
        budgets: [],
        breadcrumb: {
          title: 'Budgets',
          items: [{ name: 'Budgets', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Reports page.
   * @function reports
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await reports(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async reports(req, res) {
    try {
      await this.renderRoleView(req, res, 'reports', {
        title: 'Company Reports',
        reports: [],
        breadcrumb: {
          title: 'Reports',
          items: [{ name: 'Reports', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the client vehicles page for viewing vehicle fleet.
   * Clients can view vehicle types available for their services.
   * Supports sections: 'vehicles' and 'types' for vehicle type management.
   * @function vehicles
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the vehicles view.
   * @returns {Promise<void>} - Renders the client vehicles view or handles errors.
   * @example
   * // GET /dashboard/client/vehicles
   * // GET /dashboard/client/vehicles?section=types
   * await clientController.vehicles(req, res);
   */
  async vehicles(req, res) {
    try {
      const section = req.query.section || 'types'; // Default to types

      await this.renderRoleView(req, res, 'vehicles', {
        title: 'Vehículos',
        section,
        breadcrumb: {
          title: 'Vehículos',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Vehículos', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the client services page for viewing transport services.
   * Clients can view services/transfers available for their business.
   * Supports sections: 'airport' (default), 'p2p' (punto a punto), and 'local' for service type management.
   * @function services
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the services view.
   * @returns {Promise<void>} - Renders the client services view or handles errors.
   * @example
   * // GET /dashboard/client/services
   * // GET /dashboard/client/services?section=p2p
   * // GET /dashboard/client/services?section=local
   * await clientController.services(req, res);
   */
  async services(req, res) {
    try {
      const section = req.query.section || 'airport';

      // Get clientId from user - use the clientId attribute from database
      const { user } = req;

      // req.user is a Parse Object, so use .get() to access the clientId field
      const clientId = user?.get ? user.get('clientId') : user?.clientId || '';

      // Debug logging to understand clientId
      console.log('🔍 Client Services Dashboard - User Info:', {
        userId: user?.id || user?.objectId,
        userRole: user?.get ? user.get('role') : user?.role,
        clientId,
        userClientIdField: user?.get ? user.get('clientId') : 'N/A',
        userObjectId: user?.id || user?.objectId || 'N/A',
      });

      await this.renderRoleView(req, res, 'services', {
        title: 'Traslados',
        section,
        clientId, // Pass the client organization ID, not the user's ID
        breadcrumb: {
          title: 'Traslados',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Traslados', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the client experiences page for viewing experiences.
   * Clients can view experiences available for their events.
   * Supports sections: 'experiences' (default) and 'providers' for experience providers management.
   * @function experiences
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the experiences view.
   * @returns {Promise<void>} - Renders the client experiences view or handles errors.
   * @example
   * // GET /dashboard/client/experiences
   * // GET /dashboard/client/experiences?section=providers
   * await clientController.experiences(req, res);
   */
  async experiences(req, res) {
    try {
      const section = req.query.section || 'experiences';

      await this.renderRoleView(req, res, 'experiences', {
        title: 'Experiencias',
        section,
        breadcrumb: {
          title: 'Experiencias',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Experiencias', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the client tours page for viewing tour packages.
   * Clients can view tours available for their events.
   * @function tours
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the tours view.
   * @returns {Promise<void>} - Renders the client tours view or handles errors.
   * @example
   * // GET /dashboard/client/tours
   * await clientController.tours(req, res);
   */
  async tours(req, res) {
    try {
      // Get clientId from user - use the clientId attribute from database
      const { user } = req;

      // req.user is a Parse Object, so use .get() to access the clientId field
      const clientId = user?.get ? user.get('clientId') : user?.clientId || '';

      await this.renderRoleView(req, res, 'tours', {
        title: 'Tours',
        clientId, // Pass the extracted clientId
        breadcrumb: {
          title: 'Tours',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Tours', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get client statistics.
   * @function getClientStats
   * @example
   * // GET endpoint example
   * const result = await ClientController.getClientStats();
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to client statistics object containing totalEmployees, activeDepartments, monthlyBudget, budgetUsed, activeBookings, and completedTrips.
   */
  async getClientStats() {
    return {
      totalEmployees: 250,
      activeDepartments: 8,
      monthlyBudget: 50000,
      budgetUsed: 32000,
      activeBookings: 45,
      completedTrips: 1250,
    };
  }
}

module.exports = new ClientController();
