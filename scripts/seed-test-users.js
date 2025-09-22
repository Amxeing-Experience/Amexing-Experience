#!/usr/bin/env node

/**
 * Seed Test Users Script for Amexing Development Database
 * Creates test users for all roles using Parse Objects
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');
const AmexingUser = require('../src/domain/models/AmexingUser');

const testUsers = [
  {
    username: 'dev.superadmin',
    email: 'superadmin@dev.amexing.com',
    password: 'DevSuper2024!@#',
    firstName: 'Super',
    lastName: 'Administrator',
    role: 'superadmin',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.admin',
    email: 'admin@dev.amexing.com',
    password: 'DevAdmin2024!@#',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.client',
    email: 'client@dev.amexing.com',
    password: 'DevClient2024!@#',
    firstName: 'Client',
    lastName: 'Manager',
    role: 'client',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.department_manager',
    email: 'manager@dev.amexing.com',
    password: 'DevManager2024!@#',
    firstName: 'Department',
    lastName: 'Manager',
    role: 'department_manager',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.employee',
    email: 'employee@dev.amexing.com',
    password: 'DevEmployee2024!@#',
    firstName: 'Test',
    lastName: 'Employee',
    role: 'employee',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.driver',
    email: 'driver@dev.amexing.com',
    password: 'DevDriver2024!@#',
    firstName: 'Test',
    lastName: 'Driver',
    role: 'driver',
    active: true,
    emailVerified: true
  },
  {
    username: 'dev.guest',
    email: 'guest@dev.amexing.com',
    password: 'DevGuest2024!@#',
    firstName: 'Guest',
    lastName: 'User',
    role: 'guest',
    active: true,
    emailVerified: true
  }
];

async function seedTestUsers() {
  try {
    console.log('🔗 Initializing Parse SDK...');

    // Initialize Parse SDK (same as main application)
    Parse.initialize(
      process.env.PARSE_APP_ID || 'amexing-app-id',
      null,
      process.env.PARSE_MASTER_KEY || 'amexing-master-key'
    );
    Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

    console.log('✅ Parse SDK initialized');

    console.log('🧹 Cleaning existing test users...');

    // Delete existing test users using Parse Query
    const query = new Parse.Query(AmexingUser);
    query.startsWith('username', 'dev.');

    const existingUsers = await query.find({ useMasterKey: true });
    if (existingUsers.length > 0) {
      await Parse.Object.destroyAll(existingUsers, { useMasterKey: true });
      console.log(`🗑️  Deleted ${existingUsers.length} existing test users`);
    }

    console.log('👥 Creating test users with Parse Objects...');

    for (const userData of testUsers) {
      try {
        // Create user using AmexingUser model
        const user = AmexingUser.create(userData);

        // Set password using proper Parse Object method
        await user.setPassword(userData.password, false); // Skip validation for dev passwords

        // Set emailVerified flag
        user.set('emailVerified', userData.emailVerified);

        // Save the user
        await user.save(null, { useMasterKey: true });

        console.log(`✅ Created user: ${userData.username} (${userData.role})`);
      } catch (userError) {
        console.error(`❌ Failed to create user ${userData.username}:`, userError.message);
      }
    }

    console.log('🎉 All test users created successfully!');
    console.log('\n📋 Test Users Summary:');
    console.log('┌─────────────────────────┬─────────────────────────┬──────────────────────┐');
    console.log('│ Username               │ Password                │ Role                 │');
    console.log('├─────────────────────────┼─────────────────────────┼──────────────────────┤');

    testUsers.forEach(user => {
      console.log(`│ ${user.username.padEnd(22)} │ ${user.password.padEnd(23)} │ ${user.role.padEnd(20)} │`);
    });

    console.log('└─────────────────────────┴─────────────────────────┴──────────────────────┘');
    console.log('\n🌐 Access the login page at: http://localhost:1337/login');
    console.log('💡 Click the test user buttons in development mode for quick login');

  } catch (error) {
    console.error('❌ Error seeding test users:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  seedTestUsers()
    .then(() => {
      console.log('✨ Test user seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { seedTestUsers, testUsers };