#!/usr/bin/env node

/**
 * Inspect Development Database Schema
 * Retrieves actual schema and data from development environment
 */

require('dotenv').config({
  path: './environments/.env.development',
});

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');

async function inspect() {
  console.log('🔍 Inspecting Development Database Schema\n');

  Parse.initialize(process.env.PARSE_APP_ID);
  Parse.serverURL = process.env.PARSE_SERVER_URL;
  Parse.masterKey = process.env.PARSE_MASTER_KEY;

  console.log('====================================');
  console.log('📋 ROLES IN DEVELOPMENT');
  console.log('====================================\n');

  const roleQuery = new Parse.Query(Role);
  roleQuery.ascending('level');
  const roles = await roleQuery.find({ useMasterKey: true });

  console.log(`Found ${roles.length} roles:\n`);

  roles.forEach(role => {
    console.log(`Role: ${role.get('name')}`);
    console.log(`  - displayName: ${role.get('displayName')}`);
    console.log(`  - description: ${role.get('description')}`);
    console.log(`  - level: ${role.get('level')}`);
    console.log(`  - isSystemRole: ${role.get('isSystemRole')}`);
    console.log(`  - active: ${role.get('active')}`);
    console.log(`  - exists: ${role.get('exists')}`);
    console.log(`  - objectId: ${role.id}`);
    console.log('');
  });

  console.log('\n====================================');
  console.log('👤 AMEXING USER SCHEMA');
  console.log('====================================\n');

  const userQuery = new Parse.Query(AmexingUser);
  userQuery.limit(1);
  const users = await userQuery.find({ useMasterKey: true });

  if (users.length > 0) {
    const user = users[0];
    console.log('Sample User Fields:');
    console.log(`  - username: ${user.get('username')} (${typeof user.get('username')})`);
    console.log(`  - email: ${user.get('email')} (${typeof user.get('email')})`);
    console.log(`  - firstName: ${user.get('firstName')} (${typeof user.get('firstName')})`);
    console.log(`  - lastName: ${user.get('lastName')} (${typeof user.get('lastName')})`);
    console.log(`  - role: ${user.get('role')} (${typeof user.get('role')})`);

    const roleId = user.get('roleId');
    console.log(`  - roleId: ${roleId ? JSON.stringify(roleId) : 'null'} (${typeof roleId})`);

    if (roleId && typeof roleId === 'object') {
      console.log(`    -> Is Pointer: ${roleId.__type === 'Pointer'}`);
      console.log(`    -> className: ${roleId.className}`);
      console.log(`    -> objectId: ${roleId.objectId}`);
    }

    console.log(`  - organizationId: ${user.get('organizationId')} (${typeof user.get('organizationId')})`);
    console.log(`  - active: ${user.get('active')} (${typeof user.get('active')})`);
    console.log(`  - exists: ${user.get('exists')} (${typeof user.get('exists')})`);
    console.log(`  - emailVerified: ${user.get('emailVerified')} (${typeof user.get('emailVerified')})`);

    console.log('\n  All fields:');
    const allKeys = user.attributes;
    Object.keys(allKeys).forEach(key => {
      const value = user.get(key);
      const type = typeof value;
      if (key !== 'password' && key !== 'authData') {
        console.log(`    - ${key}: ${type === 'object' ? JSON.stringify(value) : value} (${type})`);
      }
    });
  } else {
    console.log('⚠️  No users found in development database');
  }

  console.log('\n====================================');
  console.log('📊 SCHEMA STRUCTURE');
  console.log('====================================\n');

  // Get schema from Parse Server
  try {
    const schema = await Parse.Schema.all({ useMasterKey: true });
    const userSchema = schema.find(s => s.className === 'AmexingUser' || s.className === '_User');

    if (userSchema) {
      console.log('AmexingUser Schema Fields:');
      Object.keys(userSchema.fields).forEach(fieldName => {
        const field = userSchema.fields[fieldName];
        console.log(`  - ${fieldName}: ${field.type}${field.targetClass ? ` -> ${field.targetClass}` : ''}`);
      });
    }
  } catch (error) {
    console.log('Could not retrieve schema:', error.message);
  }

  process.exit(0);
}

inspect().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
