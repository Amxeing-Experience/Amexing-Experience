const path = require('path');
const databaseConfig = require('./database');

/**
 * Minimal Parse Server configuration for debugging.
 * This configuration removes complex features that might cause issues.
 */
const parseServerConfig = {
  databaseURI: databaseConfig.getConnectionString(),
  cloud: process.env.CLOUD_CODE_MAIN || path.join(__dirname, '../src/cloud/main-minimal.js'),
  appId: process.env.PARSE_APP_ID || 'amexing-app-id',
  masterKey: process.env.PARSE_MASTER_KEY || 'master-key-change-in-production',
  serverURL: process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse',
  publicServerURL: process.env.PARSE_PUBLIC_SERVER_URL || 'http://localhost:1337/parse',
  
  // Essential Parse Server 6.5 options
  encodeParseObjectInCloudFunction: true,
  
  // Basic Security Configuration
  allowClientClassCreation: false,
  enableAnonymousUsers: false,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  verbose: process.env.NODE_ENV === 'development',
  
  // File Upload Configuration
  maxUploadSize: `${process.env.MAX_FILE_SIZE_MB || 10}mb`,
};

module.exports = parseServerConfig;