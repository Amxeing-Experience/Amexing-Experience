const path = require('path');
const databaseConfig = require('./database');

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
  
  // Schema Configuration
  schema: {
    definitions: [
      {
        className: '_User',
        fields: {
          email: { type: 'String' },
          emailVerified: { type: 'Boolean' },
          username: { type: 'String' },
          authData: { type: 'Object' },
          lastLoginAt: { type: 'Date' },
          failedLoginAttempts: { type: 'Number' },
          accountLockedUntil: { type: 'Date' },
        },
        classLevelPermissions: {
          find: { requiresAuthentication: true },
          count: { requiresAuthentication: true },
          get: { requiresAuthentication: true },
          update: { requiresAuthentication: true },
          create: { '*': true },
          delete: { requiresAuthentication: true },
          addField: {},
          protectedFields: {
            '*': ['email', 'emailVerified', 'authData'],
          },
        },
      },
      {
        className: 'TestConnection',
        fields: {
          status: { type: 'String' },
          timestamp: { type: 'Date' },
        },
        classLevelPermissions: {
          find: { '*': true },
          count: { '*': true },
          get: { '*': true },
          update: { '*': true },
          create: { '*': true },
          delete: { '*': true },
          addField: {},
        },
      },
      {
        className: 'PermissionAudit',
        fields: {
          userId: { type: 'String' },
          action: { type: 'String' },
          permission: { type: 'String' },
          timestamp: { type: 'Date' },
          metadata: { type: 'Object' },
        },
        classLevelPermissions: {
          find: { requiresAuthentication: true },
          count: { requiresAuthentication: true },
          get: { requiresAuthentication: true },
          update: { requiresAuthentication: true },
          create: { '*': true },
          delete: { requiresAuthentication: true },
          addField: {},
        },
      },
      {
        className: 'AmexingUser',
        fields: {
          username: { type: 'String' },
          email: { type: 'String' },
          emailVerified: { type: 'Boolean' },
          password: { type: 'String' },
          role: { type: 'String' },
          active: { type: 'Boolean' },
          lastLoginAt: { type: 'Date' },
          failedLoginAttempts: { type: 'Number' },
          accountLockedUntil: { type: 'Date' },
          authData: { type: 'Object' },
        },
        classLevelPermissions: {
          find: { requiresAuthentication: true },
          count: { requiresAuthentication: true },
          get: { requiresAuthentication: true },
          update: { requiresAuthentication: true },
          create: { '*': true },
          delete: { requiresAuthentication: true },
          addField: {},
        },
      },
    ],
    lockSchemas: process.env.NODE_ENV === 'production',
    strict: process.env.NODE_ENV === 'production',
    deleteExtraFields: true,
    recreateModifiedFields: false,
  },
  
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