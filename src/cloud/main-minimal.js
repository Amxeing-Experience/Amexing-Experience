// Minimal Cloud Code for Parse Server 7.0
// This file is loaded by Parse Server and has access to Parse.Cloud global

const Parse = require('parse/node');
const logger = require('../infrastructure/logger');

// Simple hello function
Parse.Cloud.define('hello', async (request) => {
  const { params } = request;
  const name = params.name || 'World';

  logger.info('Hello function called', { name });

  return {
    message: `Hello ${name} from Parse Cloud!`,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  };
});

// Simple test function
Parse.Cloud.define('test', async (request) => {
  const { params } = request;

  logger.info('Test function called', { params });

  return {
    success: true,
    message: 'Test function executed successfully',
    echo: params,
    timestamp: new Date().toISOString(),
  };
});

logger.info('Minimal Cloud Code loaded successfully');
