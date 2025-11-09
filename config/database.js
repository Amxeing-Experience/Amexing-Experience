const winston = require('winston');

class DatabaseConfig {
  constructor() {
    this.uri = process.env.DATABASE_URI || 'mongodb://localhost:27017/amexingdb';
    this.name = process.env.DATABASE_NAME || 'amexingdb';
    this.options = {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      authSource: 'admin',
      retryWrites: true,
      w: 'majority',
    };
  }

  getConnectionString() {
    // If DATABASE_NAME is specified, inject it into the URI
    if (this.name && this.name !== 'amexingdb') {
      // Parse the URI to inject database name before query parameters
      const uriParts = this.uri.split('?');
      const baseUri = uriParts[0];
      const queryParams = uriParts[1] || '';

      // Remove trailing slash if present
      const cleanBaseUri = baseUri.endsWith('/') ? baseUri.slice(0, -1) : baseUri;

      // Check if database name is already in URI (after last /)
      const lastSlashIndex = cleanBaseUri.lastIndexOf('/');
      const pathAfterSlash = cleanBaseUri.substring(lastSlashIndex + 1);

      // If there's already a database name in the URI, replace it
      // Otherwise, append the database name
      let finalUri;
      if (pathAfterSlash && !pathAfterSlash.includes('@')) {
        // Database name already exists, replace it
        finalUri = cleanBaseUri.substring(0, lastSlashIndex + 1) + this.name;
      } else {
        // No database name, append it
        finalUri = cleanBaseUri + '/' + this.name;
      }

      // Re-append query parameters if they exist
      return queryParams ? `${finalUri}?${queryParams}` : finalUri;
    }

    return this.uri;
  }

  getOptions() {
    return this.options;
  }

  async testConnection(mongoClient) {
    try {
      const client = new mongoClient(this.uri, this.options);
      await client.connect();
      await client.db(this.name).admin().ping();
      await client.close();
      winston.info('MongoDB connection test successful');
      return true;
    } catch (error) {
      winston.error('MongoDB connection test failed:', error);
      return false;
    }
  }
}

module.exports = new DatabaseConfig();