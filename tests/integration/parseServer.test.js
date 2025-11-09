/**
 * Parse Server Integration Tests
 * @updated 2025-01-24 - Migrated to MongoDB Memory Server with seed system
 */

const Parse = require('parse/node');
const AuthTestHelper = require('../helpers/authTestHelper');

describe('Parse Server Integration', () => {
  beforeAll(async () => {
    // Initialize Parse SDK
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';
  }, 30000);

  afterAll(async () => {
    // No cleanup needed
  }, 15000);

  describe('User Queries', () => {
    it('should query existing seeded users', async () => {
      const AmexingUser = require('../../src/domain/models/AmexingUser');
      const query = new Parse.Query(AmexingUser);
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      expect(users.length).toBeGreaterThanOrEqual(8); // At least 8 seeded users
    });

    it('should authenticate seeded superadmin user', async () => {
      const credentials = AuthTestHelper.getCredentials('superadmin');
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', credentials.email);
      const user = await query.first({ useMasterKey: true });

      expect(user).toBeDefined();
      expect(user.get('email')).toBe(credentials.email);

      // Validate password using AuthTestHelper wrapper (handles Parse.Object and AmexingUser)
      const passwordMatch = await AuthTestHelper.validateUserPassword(user, credentials.password);
      expect(passwordMatch).toBe(true);
    });

    it('should reject authentication with incorrect password', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');
      const AmexingUser = require('../../src/domain/models/AmexingUser');

      const query = new Parse.Query(AmexingUser);
      query.equalTo('email', credentials.email);
      const user = await query.first({ useMasterKey: true });

      expect(user).toBeDefined();

      // Validate with wrong password using AuthTestHelper wrapper
      const passwordMatch = await AuthTestHelper.validateUserPassword(user, 'wrongpassword123!');
      expect(passwordMatch).toBe(false);
    });

    it('should query users by role', async () => {
      const AmexingUser = require('../../src/domain/models/AmexingUser');
      const query = new Parse.Query(AmexingUser);
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      // Verify we have multiple users
      expect(users.length).toBeGreaterThanOrEqual(8);

      // Verify users have email addresses
      const emails = users.map(u => u.get('email')).filter(Boolean);
      expect(emails.length).toBeGreaterThan(0);
    });
  });

  describe('Object Management', () => {
    it('should create and retrieve test objects', async () => {
      const Product = Parse.Object.extend('Product');
      const product = new Product();

      product.set('name', 'Test Integration Product');
      product.set('price', 99.99);
      product.set('category', 'test');
      product.set('active', true);
      product.set('exists', true);

      await product.save(null, { useMasterKey: true });

      expect(product.id).toBeDefined();
      expect(product.get('name')).toBe('Test Integration Product');

      // Retrieve the object
      const query = new Parse.Query('Product');
      query.equalTo('exists', true);
      const retrievedProduct = await query.get(product.id, { useMasterKey: true });

      expect(retrievedProduct.id).toBe(product.id);
      expect(retrievedProduct.get('name')).toBe('Test Integration Product');

      // Cleanup - logical delete
      product.set('exists', false);
      await product.save(null, { useMasterKey: true });
    });

    it('should update objects', async () => {
      const Product = Parse.Object.extend('Product');
      const product = new Product();

      product.set('name', 'Update Test Product');
      product.set('price', 99.99);
      product.set('active', true);
      product.set('exists', true);

      await product.save(null, { useMasterKey: true });

      // Update the object
      product.set('price', 149.99);
      product.set('name', 'Updated Product Name');
      await product.save(null, { useMasterKey: true });

      // Verify update
      const query = new Parse.Query('Product');
      const updatedProduct = await query.get(product.id, { useMasterKey: true });

      expect(updatedProduct.get('price')).toBe(149.99);
      expect(updatedProduct.get('name')).toBe('Updated Product Name');

      // Cleanup - logical delete
      product.set('exists', false);
      await product.save(null, { useMasterKey: true });
    });

    it('should perform logical deletion', async () => {
      const Product = Parse.Object.extend('Product');
      const product = new Product();

      product.set('name', 'Delete Test Product');
      product.set('price', 50.00);
      product.set('active', true);
      product.set('exists', true);

      await product.save(null, { useMasterKey: true });
      const productId = product.id;

      // Logical delete
      product.set('exists', false);
      await product.save(null, { useMasterKey: true });

      // Verify logical deletion
      const query = new Parse.Query('Product');
      query.equalTo('exists', true);
      const activeProducts = await query.find({ useMasterKey: true });

      expect(activeProducts.find(p => p.id === productId)).toBeUndefined();

      // Verify object still exists in database
      const deletedQuery = new Parse.Query('Product');
      const deletedProduct = await deletedQuery.get(productId, { useMasterKey: true });
      expect(deletedProduct).toBeDefined();
      expect(deletedProduct.get('exists')).toBe(false);
    });
  });

  describe('Query Operations', () => {
    it('should find seeded roles', async () => {
      const Role = Parse.Object.extend('Role');
      const query = new Parse.Query(Role);
      query.equalTo('exists', true);

      const roles = await query.find({ useMasterKey: true });

      expect(roles.length).toBe(8);
    });

    it('should find seeded permissions', async () => {
      const Permission = Parse.Object.extend('Permission');
      const query = new Parse.Query(Permission);
      query.equalTo('exists', true);

      const permissions = await query.find({ useMasterKey: true });

      expect(permissions.length).toBeGreaterThanOrEqual(30);
    });

    it('should perform complex queries on roles', async () => {
      const Role = Parse.Object.extend('Role');
      const query = new Parse.Query(Role);
      query.equalTo('exists', true);
      query.greaterThanOrEqualTo('level', 6);

      const adminRoles = await query.find({ useMasterKey: true });

      // Should find admin (6) and superadmin (7)
      expect(adminRoles.length).toBeGreaterThanOrEqual(2);
      adminRoles.forEach(role => {
        expect(role.get('level')).toBeGreaterThanOrEqual(6);
      });
    });

    it('should count objects correctly', async () => {
      const AmexingUser = require('../../src/domain/models/AmexingUser');
      const query = new Parse.Query(AmexingUser);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });

      expect(count).toBeGreaterThanOrEqual(8); // At least 8 seeded users
    });

    it('should limit and skip results', async () => {
      const Role = Parse.Object.extend('Role');
      const query = new Parse.Query(Role);
      query.equalTo('exists', true);
      query.limit(3);
      query.skip(2);
      query.ascending('level');

      const results = await query.find({ useMasterKey: true });

      expect(results.length).toBeLessThanOrEqual(3);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Parse Server Health', () => {
    it('should connect to Parse Server', async () => {
      const query = new Parse.Query('_Role');
      const roles = await query.find({ useMasterKey: true });

      // If we can query, Parse Server is working
      expect(Array.isArray(roles)).toBe(true);
    });

    it('should support masterKey operations', async () => {
      const Role = Parse.Object.extend('Role');
      const query = new Parse.Query(Role);

      const roles = await query.find({ useMasterKey: true });

      expect(roles.length).toBeGreaterThan(0);
    });
  });
});
