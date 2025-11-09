#!/usr/bin/env node

/**
 * Cleanup Production Database
 * Removes all users, roles, and permissions from the database
 * USE WITH EXTREME CAUTION!
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');
const AmexingUser = require('../../src/domain/models/AmexingUser');
const Role = require('../../src/domain/models/Role');
const Permission = require('../../src/domain/models/Permission');

async function cleanup() {
  console.log('Initializing Parse...');
  Parse.initialize(process.env.PARSE_APP_ID);
  Parse.serverURL = process.env.PARSE_SERVER_URL;
  Parse.masterKey = process.env.PARSE_MASTER_KEY;

  console.log('Deleting all users...');
  const userQuery = new Parse.Query(AmexingUser);
  const users = await userQuery.find({ useMasterKey: true });
  await Parse.Object.destroyAll(users, { useMasterKey: true });
  console.log(`Deleted ${users.length} users`);

  console.log('Deleting all roles...');
  const roleQuery = new Parse.Query(Role);
  const roles = await roleQuery.find({ useMasterKey: true });
  await Parse.Object.destroyAll(roles, { useMasterKey: true });
  console.log(`Deleted ${roles.length} roles`);

  console.log('Deleting all permissions...');
  const permissionQuery = new Parse.Query(Permission);
  const permissions = await permissionQuery.find({ useMasterKey: true });
  await Parse.Object.destroyAll(permissions, { useMasterKey: true });
  console.log(`Deleted ${permissions.length} permissions`);

  console.log('✅ Database cleaned');
  process.exit(0);
}

cleanup().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
