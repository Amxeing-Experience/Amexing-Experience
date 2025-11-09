#!/usr/bin/env node

require('dotenv').config({
  path: './environments/.env.production',
});

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');

async function verify() {
  console.log('🔍 Verifying Production Database\n');

  Parse.initialize(process.env.PARSE_APP_ID);
  Parse.serverURL = process.env.PARSE_SERVER_URL;
  Parse.masterKey = process.env.PARSE_MASTER_KEY;

  // Check permissions
  const permissionQuery = new Parse.Query(Permission);
  permissionQuery.ascending('name');
  const permissions = await permissionQuery.find({ useMasterKey: true });

  console.log(`✅ Found ${permissions.length} permissions`);
  const byCategory = {};
  permissions.forEach(perm => {
    const category = perm.get('category') || 'uncategorized';
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(perm.get('name'));
  });

  Object.keys(byCategory).sort().forEach(cat => {
    console.log(`  ${cat}: ${byCategory[cat].length} permissions`);
  });

  // Check roles
  const roleQuery = new Parse.Query(Role);
  roleQuery.ascending('level');
  const roles = await roleQuery.find({ useMasterKey: true });

  console.log(`\n✅ Found ${roles.length} roles`);
  roles.forEach(role => {
    console.log(`  - ${role.get('displayName')} (level: ${role.get('level')}, id: ${role.id})`);
  });

  // Check users
  const userQuery = new Parse.Query(AmexingUser);
  const users = await userQuery.find({ useMasterKey: true });

  console.log(`\n✅ Found ${users.length} user(s)`);
  users.forEach(user => {
    const roleIdObj = user.get('roleId');
    console.log(`  - ${user.get('email')}`);
    console.log(`    Username: ${user.get('username')}`);
    console.log(`    Name: ${user.get('firstName')} ${user.get('lastName')}`);
    console.log(`    RoleId: ${JSON.stringify(roleIdObj)}`);
    console.log(`    Active: ${user.get('active')}`);
    console.log(`    Exists: ${user.get('exists')}`);
    console.log(`    Email Verified: ${user.get('emailVerified')}`);
  });

  process.exit(0);
}

verify().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
