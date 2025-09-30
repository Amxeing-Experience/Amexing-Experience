/**
 * Synthetic User Data Generator
 * Generates test users for OAuth testing
 */

class SyntheticUserGenerator {
  constructor() {
    this.roles = ['superadmin', 'admin', 'client', 'employee', 'driver'];
    this.domains = ['test.amexing.com', 'example.com', 'testcorp.com'];
  }

  generateUser(role = 'employee', options = {}) {
    const timestamp = Date.now();
    const domain = options.domain || this.domains[0];

    return {
      id: `test-${role}-${timestamp}`,
      username: `test-${role}-${timestamp}@${domain}`,
      email: `test-${role}-${timestamp}@${domain}`,
      firstName: options.firstName || `Test${role.charAt(0).toUpperCase() + role.slice(1)}`,
      lastName: options.lastName || `User${timestamp}`,
      role: role,
      active: options.active !== false,
      exists: options.exists !== false,
      emailVerified: options.emailVerified !== false,
      password: options.password || 'TestPassword123!',
      clientId: role === 'client' ? `client-${timestamp}` : null,
      departmentId: ['employee', 'driver'].includes(role) ? `dept-${timestamp}` : null
    };
  }

  generateUsers(count = 5, role = 'employee') {
    const users = [];
    for (let i = 0; i < count; i++) {
      users.push(this.generateUser(role, { firstName: `Test${i}`, lastName: `User${i}` }));
    }
    return users;
  }

  generateTestDataSet() {
    const users = {};
    for (const role of this.roles) {
      users[role] = this.generateUsers(2, role);
    }
    return users;
  }
}

module.exports = SyntheticUserGenerator;