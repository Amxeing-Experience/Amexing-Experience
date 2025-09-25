const path = require('path');
const databaseConfig = require('./database');

// Verify environment variables are loaded
if (!process.env.PARSE_APP_ID || !process.env.PARSE_MASTER_KEY || !process.env.DATABASE_URI) {
  console.error('Missing required Parse Server environment variables:');
  console.error('- PARSE_APP_ID:', process.env.PARSE_APP_ID ? 'SET' : 'MISSING');
  console.error('- PARSE_MASTER_KEY:', process.env.PARSE_MASTER_KEY ? 'SET' : 'MISSING');
  console.error('- DATABASE_URI:', process.env.DATABASE_URI ? 'SET' : 'MISSING');
  throw new Error('Missing required Parse Server environment variables');
}

const parseServerConfig = {
  databaseURI: databaseConfig.getConnectionString(),
  cloud: process.env.CLOUD_CODE_MAIN || path.join(__dirname, '../src/cloud/main.js'),
  appId: process.env.PARSE_APP_ID || 'amexing-app-id',
  masterKey: process.env.PARSE_MASTER_KEY || 'master-key-change-in-production',
  serverURL: process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse',
  publicServerURL: process.env.PARSE_PUBLIC_SERVER_URL || 'http://localhost:1337/parse',
  
  // Security Configuration
  allowClientClassCreation: process.env.NODE_ENV === 'development',
  enableAnonymousUsers: false,
  verifyUserEmails: false,
  preventLoginWithUnverifiedEmail: false,
  
  // Parse Server 7.0 specific options
  encodeParseObjectInCloudFunction: true,
  
  // Session Configuration
  sessionLength: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) * 60 || 900,
  revokeSessionOnPasswordReset: true,
  
  // Account Lockout Policy - Temporarily disabled for debugging
  // accountLockout: {
  //   duration: parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES, 10) || 30,
  //   threshold: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 6,
  //   unlockOnPasswordReset: true,
  // },
  
  // Auth Configuration - Remove if causing issues
  // auth: {},
  
  // Password Policy - Temporarily simplified for debugging
  passwordPolicy: {
    validatorPattern: /^.{8,}$/,
    validationError: 'Password must be at least 8 characters long',
    doNotAllowUsername: true,
    resetTokenValidityDuration: 2 * 60 * 60,
  },
  
  // File Upload Configuration
  fileUpload: {
    enableForPublic: false,
    enableForAnonymousUser: false,
    enableForAuthenticatedUser: true,
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  verbose: process.env.NODE_ENV === 'development',
  
  // Schema Configuration - Temporarily disabled due to ACL error
  // schema: {
//     definitions: [
//       {
//         className: '_User',
//         fields: {
//           email: { type: 'String' },
//           emailVerified: { type: 'Boolean' },
//           username: { type: 'String' },
//           authData: { type: 'Object' },
//           lastLoginAt: { type: 'Date' },
//           failedLoginAttempts: { type: 'Number' },
//           accountLockedUntil: { type: 'Date' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { '*': true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//           protectedFields: {
//             '*': ['email', 'emailVerified', 'authData'],
//           },
//         },
//       },
//       {
//         className: 'TestConnection',
//         fields: {
//           status: { type: 'String' },
//           timestamp: { type: 'Date' },
//         },
//         classLevelPermissions: {
//           find: { '*': true },
//           count: { '*': true },
//           get: { '*': true },
//           update: { '*': true },
//           create: { '*': true },
//           delete: { '*': true },
//           addField: {},
//         },
//       },
//       {
//         className: 'PermissionAudit',
//         fields: {
//           userId: { type: 'String' },
//           action: { type: 'String' },
//           permission: { type: 'String' },
//           timestamp: { type: 'Date' },
//           metadata: { type: 'Object' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { '*': true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'AmexingUser',
//         fields: {
//           username: { type: 'String' },
//           email: { type: 'String' },
//           emailVerified: { type: 'Boolean' },
//           passwordHash: { type: 'String' },  // Changed from password to passwordHash
//           role: { type: 'String' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//           lastLoginAt: { type: 'Date' },
//           loginAttempts: { type: 'Number' },  // Changed from failedLoginAttempts
//           lockedUntil: { type: 'Date' },  // Changed from accountLockedUntil
//           passwordChangedAt: { type: 'Date' },
//           mustChangePassword: { type: 'Boolean' },
//           oauthAccounts: { type: 'Array' },
//           primaryOAuthProvider: { type: 'String' },
//           lastAuthMethod: { type: 'String' },
//           firstName: { type: 'String' },
//           lastName: { type: 'String' },
//           createdBy: { type: 'String' },
//           modifiedBy: { type: 'String' },
//           authData: { type: 'Object' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { '*': true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'Client',
//         fields: {
//           name: { type: 'String' },
//           email: { type: 'String' },
//           phone: { type: 'String' },
//           address: { type: 'Object' },
//           contactPerson: { type: 'String' },
//           companyType: { type: 'String' },
//           taxId: { type: 'String' },
//           website: { type: 'String' },
//           notes: { type: 'String' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//           createdBy: { type: 'String' },
//           modifiedBy: { type: 'String' },
//           isCorporate: { type: 'Boolean' },
//           oauthDomain: { type: 'String' },
//           autoProvisionEmployees: { type: 'Boolean' },
//           defaultEmployeeRole: { type: 'String' },
//           employeeAccessLevel: { type: 'String' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'Department',
//         fields: {
//           name: { type: 'String' },
//           description: { type: 'String' },
//           managerId: { type: 'String' },
//           clientId: { type: 'String' },
//           budget: { type: 'Number' },
//           costCenter: { type: 'String' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//           createdBy: { type: 'String' },
//           modifiedBy: { type: 'String' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'Order',
//         fields: {
//           orderNumber: { type: 'String' },
//           clientId: { type: 'String' },
//           departmentId: { type: 'String' },
//           requestedBy: { type: 'String' },
//           assignedDriver: { type: 'String' },
//           pickupLocation: { type: 'Object' },
//           dropoffLocation: { type: 'Object' },
//           scheduledDate: { type: 'Date' },
//           status: { type: 'String' },
//           priority: { type: 'String' },
//           vehicleType: { type: 'String' },
//           passengers: { type: 'Number' },
//           cost: { type: 'Number' },
//           currency: { type: 'String' },
//           notes: { type: 'String' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//           createdBy: { type: 'String' },
//           modifiedBy: { type: 'String' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'Vehicle',
//         fields: {
//           licensePlate: { type: 'String' },
//           make: { type: 'String' },
//           model: { type: 'String' },
//           year: { type: 'Number' },
//           vehicleType: { type: 'String' },
//           capacity: { type: 'Number' },
//           currentDriverId: { type: 'String' },
//           status: { type: 'String' },
//           mileage: { type: 'Number' },
//           lastMaintenanceDate: { type: 'Date' },
//           nextMaintenanceDate: { type: 'Date' },
//           insuranceExpiry: { type: 'Date' },
//           registrationExpiry: { type: 'Date' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//           createdBy: { type: 'String' },
//           modifiedBy: { type: 'String' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'UserSession',
//         fields: {
//           userId: { type: 'String' },
//           sessionToken: { type: 'String' },
//           authMethod: { type: 'String' },
//           oauthProvider: { type: 'String' },
//           status: { type: 'String' },
//           expiresAt: { type: 'Date' },
//           lastActivityAt: { type: 'Date' },
//           ipAddress: { type: 'String' },
//           userAgent: { type: 'String' },
//           requestCount: { type: 'Number' },
//           activityLog: { type: 'Array' },
//           securityAlerts: { type: 'Array' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//       {
//         className: 'RefreshToken',
//         fields: {
//           userId: { type: 'String' },
//           jti: { type: 'String' },
//           token: { type: 'String' },
//           expiresAt: { type: 'Date' },
//           revokedAt: { type: 'Date' },
//           active: { type: 'Boolean' },
//           exists: { type: 'Boolean' },
//         },
//         classLevelPermissions: {
//           find: { requiresAuthentication: true },
//           count: { requiresAuthentication: true },
//           get: { requiresAuthentication: true },
//           update: { requiresAuthentication: true },
//           create: { requiresAuthentication: true },
//           delete: { requiresAuthentication: true },
//           addField: {},
//         },
//       },
//     ],
    // lockSchemas: process.env.NODE_ENV === 'production',
    // strict: process.env.NODE_ENV === 'production',
    // deleteExtraFields: true,
    // recreateModifiedFields: false,
  // },
  
  // Server Configuration
  maxUploadSize: `${process.env.MAX_FILE_SIZE_MB || 10}mb`,
  
  // Security Headers
  trustProxy: process.env.NODE_ENV === 'production',
  
  // Live Query Configuration (optional, for real-time features)
  liveQuery: {
    classNames: [],
  },
  
  // Custom Pages
  customPages: {
    invalidLink: '/invalid-link',
    verifyEmailSuccess: '/verify-email-success',
    choosePassword: '/choose-password',
    passwordResetSuccess: '/password-reset-success',
  },
  
  // Idempotency
  idempotencyOptions: {
    paths: ['functions/*', 'classes/*/*'],
    ttl: 300,
  },
  
  // Request Configuration (removed deprecated maxRequestSize)
  
  // Protection
  protectedFields: {
    _User: {
      '*': ['email', 'emailVerified', 'authData'],
      'userField:userId': [],
    },
  },
};

module.exports = parseServerConfig;