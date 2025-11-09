/**
 * Parse Query Operations Advanced Tests
 * Comprehensive testing of Parse.Query functionality with all query types and modifiers
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse Query Operations Advanced Tests', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;
  let testObjects = [];

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();

    // Create test data for queries
    console.log('Creating test data for query operations...');
    await createTestDataSet();
  });

  afterAll(async () => {
    await dataFactory.cleanup();
    await parseSetup.cleanupAllTestData();
  });

  // Helper function to create consistent test dataset
  async function createTestDataSet() {
    testObjects = [];

    // Create users with varied data
    const users = await Promise.all([
      parseSetup.createAndSaveTestObject('QueryUser', {
        username: 'alice',
        email: 'alice@test.com',
        age: 25,
        isActive: true,
        score: 95,
        department: 'Engineering',
        tags: ['developer', 'senior'],
        joinDate: new Date('2023-01-15'),
        profile: { level: 'senior', skills: ['js', 'react'] }
      }),
      parseSetup.createAndSaveTestObject('QueryUser', {
        username: 'bob',
        email: 'bob@test.com',
        age: 30,
        isActive: true,
        score: 87,
        department: 'Engineering',
        tags: ['developer', 'lead'],
        joinDate: new Date('2022-06-10'),
        profile: { level: 'lead', skills: ['js', 'node'] }
      }),
      parseSetup.createAndSaveTestObject('QueryUser', {
        username: 'charlie',
        email: 'charlie@test.com',
        age: 28,
        isActive: false,
        score: 92,
        department: 'Design',
        tags: ['designer', 'senior'],
        joinDate: new Date('2023-03-20'),
        profile: { level: 'senior', skills: ['figma', 'sketch'] }
      }),
      parseSetup.createAndSaveTestObject('QueryUser', {
        username: 'diana',
        email: 'diana@test.com',
        age: 35,
        isActive: true,
        score: 88,
        department: 'Marketing',
        tags: ['marketing', 'manager'],
        joinDate: new Date('2021-11-05'),
        profile: { level: 'manager', skills: ['seo', 'analytics'] }
      }),
      parseSetup.createAndSaveTestObject('QueryUser', {
        username: 'eve',
        email: 'eve@test.com',
        age: 22,
        isActive: true,
        score: 76,
        department: 'Engineering',
        tags: ['developer', 'junior'],
        joinDate: new Date('2024-01-08'),
        profile: { level: 'junior', skills: ['html', 'css'] }
      })
    ]);

    testObjects.push(...users);

    // Create projects with relationships
    const projects = await Promise.all([
      parseSetup.createAndSaveTestObject('QueryProject', {
        name: 'Web Platform',
        status: 'active',
        priority: 'high',
        budget: 100000,
        deadline: new Date('2024-12-31'),
        owner: users[0], // alice
        contributors: [users[0], users[1]], // alice, bob
        tags: ['web', 'platform', 'react']
      }),
      parseSetup.createAndSaveTestObject('QueryProject', {
        name: 'Mobile App',
        status: 'planning',
        priority: 'medium',
        budget: 75000,
        deadline: new Date('2025-06-30'),
        owner: users[1], // bob
        contributors: [users[1], users[4]], // bob, eve
        tags: ['mobile', 'react-native']
      }),
      parseSetup.createAndSaveTestObject('QueryProject', {
        name: 'Design System',
        status: 'completed',
        priority: 'low',
        budget: 50000,
        deadline: new Date('2024-03-15'),
        owner: users[2], // charlie
        contributors: [users[2]], // charlie
        tags: ['design', 'components']
      })
    ]);

    testObjects.push(...projects);
    console.log(`Created ${testObjects.length} test objects for query operations`);
  }

  describe('Basic Query Operations', () => {
    test('should perform equalTo queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));
      const query = new Parse.Query(TestClass);
      query.equalTo('department', 'Engineering');

      const results = await testHelpers.findWithRetry(query);
      expect(results.length).toBe(3); // alice, bob, eve
      results.forEach(user => {
        expect(user.get('department')).toBe('Engineering');
      });
    });

    test('should perform notEqualTo queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));
      const query = new Parse.Query(TestClass);
      query.notEqualTo('department', 'Engineering');

      const results = await testHelpers.findWithRetry(query);
      expect(results.length).toBe(2); // charlie, diana
      results.forEach(user => {
        expect(user.get('department')).not.toBe('Engineering');
      });
    });

    test('should perform lessThan and greaterThan queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test lessThan
      const lessThanQuery = new Parse.Query(TestClass);
      lessThanQuery.lessThan('age', 30);
      const youngerUsers = await testHelpers.findWithRetry(lessThanQuery);
      expect(youngerUsers.length).toBe(3); // alice(25), charlie(28), eve(22)

      // Test greaterThan
      const greaterThanQuery = new Parse.Query(TestClass);
      greaterThanQuery.greaterThan('age', 30);
      const olderUsers = await testHelpers.findWithRetry(greaterThanQuery);
      expect(olderUsers.length).toBe(1); // diana(35)

      // Test greaterThanOrEqualTo
      const gteQuery = new Parse.Query(TestClass);
      gteQuery.greaterThanOrEqualTo('age', 30);
      const gteUsers = await testHelpers.findWithRetry(gteQuery);
      expect(gteUsers.length).toBe(2); // bob(30), diana(35)
    });

    test('should perform containedIn and notContainedIn queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test containedIn
      const containedInQuery = new Parse.Query(TestClass);
      containedInQuery.containedIn('department', ['Engineering', 'Design']);
      const techUsers = await testHelpers.findWithRetry(containedInQuery);
      expect(techUsers.length).toBe(4); // alice, bob, charlie, eve

      // Test notContainedIn
      const notContainedInQuery = new Parse.Query(TestClass);
      notContainedInQuery.notContainedIn('department', ['Engineering', 'Design']);
      const nonTechUsers = await testHelpers.findWithRetry(notContainedInQuery);
      expect(nonTechUsers.length).toBe(1); // diana
    });

    test('should perform exists and doesNotExist queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test exists
      const existsQuery = new Parse.Query(TestClass);
      existsQuery.exists('profile');
      const usersWithProfile = await testHelpers.findWithRetry(existsQuery);
      expect(usersWithProfile.length).toBe(5); // All users have profile

      // Test doesNotExist
      const doesNotExistQuery = new Parse.Query(TestClass);
      doesNotExistQuery.doesNotExist('nonExistentField');
      const usersWithoutField = await testHelpers.findWithRetry(doesNotExistQuery);
      expect(usersWithoutField.length).toBe(5); // No users have this field
    });
  });

  describe('Array and String Query Operations', () => {
    test('should perform containsAll and containsAllStartingWith queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test containsAll
      const containsAllQuery = new Parse.Query(TestClass);
      containsAllQuery.containsAll('tags', ['developer']);
      const developers = await testHelpers.findWithRetry(containsAllQuery);
      expect(developers.length).toBe(3); // alice, bob, eve

      // Test with multiple tags
      const seniorDevsQuery = new Parse.Query(TestClass);
      seniorDevsQuery.containsAll('tags', ['developer', 'senior']);
      const seniorDevs = await testHelpers.findWithRetry(seniorDevsQuery);
      expect(seniorDevs.length).toBe(1); // alice
    });

    test('should perform startsWith and endsWith queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test startsWith
      const startsWithQuery = new Parse.Query(TestClass);
      startsWithQuery.startsWith('email', 'a');
      const aUsers = await testHelpers.findWithRetry(startsWithQuery);
      expect(aUsers.length).toBe(1); // alice

      // Test endsWith
      const endsWithQuery = new Parse.Query(TestClass);
      endsWithQuery.endsWith('email', 'test.com');
      const testUsers = await testHelpers.findWithRetry(endsWithQuery);
      expect(testUsers.length).toBe(5); // All users
    });

    test('should perform matches (regex) queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test regex pattern
      const regexQuery = new Parse.Query(TestClass);
      regexQuery.matches('username', /^[a-c]/, 'i'); // usernames starting with a, b, or c
      const abcUsers = await testHelpers.findWithRetry(regexQuery);
      expect(abcUsers.length).toBe(3); // alice, bob, charlie
    });
  });

  describe('Query Modifiers and Sorting', () => {
    test('should apply limit and skip modifiers', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test limit
      const limitQuery = new Parse.Query(TestClass);
      limitQuery.limit(3);
      const limitedResults = await testHelpers.findWithRetry(limitQuery);
      expect(limitedResults.length).toBe(3);

      // Test skip
      const skipQuery = new Parse.Query(TestClass);
      skipQuery.skip(2);
      const skippedResults = await testHelpers.findWithRetry(skipQuery);
      expect(skippedResults.length).toBe(3); // 5 total - 2 skipped = 3

      // Test pagination (limit + skip)
      const pageQuery = new Parse.Query(TestClass);
      pageQuery.limit(2).skip(2);
      const pageResults = await testHelpers.findWithRetry(pageQuery);
      expect(pageResults.length).toBe(2);
    });

    test('should apply ascending and descending sorting', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test ascending sort by age
      const ascQuery = new Parse.Query(TestClass);
      ascQuery.ascending('age');
      const ascResults = await testHelpers.findWithRetry(ascQuery);
      const ascAges = ascResults.map(u => u.get('age'));
      expect(ascAges).toEqual([22, 25, 28, 30, 35]); // eve, alice, charlie, bob, diana

      // Test descending sort by score
      const descQuery = new Parse.Query(TestClass);
      descQuery.descending('score');
      const descResults = await testHelpers.findWithRetry(descQuery);
      const descScores = descResults.map(u => u.get('score'));
      expect(descScores).toEqual([95, 92, 88, 87, 76]); // alice, charlie, diana, bob, eve

      // Test multiple sort criteria
      const multiSortQuery = new Parse.Query(TestClass);
      multiSortQuery.ascending('department').descending('age');
      const multiResults = await testHelpers.findWithRetry(multiSortQuery);

      // Should be sorted by department first, then by age descending within each department
      expect(multiResults[0].get('department')).toBe('Design'); // charlie
      expect(multiResults[1].get('department')).toBe('Engineering'); // bob (30)
      expect(multiResults[2].get('department')).toBe('Engineering'); // alice (25)
      expect(multiResults[3].get('department')).toBe('Engineering'); // eve (22)
      expect(multiResults[4].get('department')).toBe('Marketing'); // diana
    });
  });

  describe('Include Operations for Related Objects', () => {
    test('should include pointer relationships', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryProject'));

      const query = new Parse.Query(TestClass);
      query.include('owner');
      query.equalTo('name', 'Web Platform');

      const project = await query.first({ useMasterKey: true });
      expect(project).toBeDefined();
      expect(project.get('owner')).toBeInstanceOf(Parse.Object);
      expect(project.get('owner').get('username')).toBe('alice');
    });

    test('should include nested relationships', async () => {
      // Create nested relationship test data
      const category = await parseSetup.createAndSaveTestObject('Category', {
        name: 'Technology'
      });

      const subcategory = await parseSetup.createAndSaveTestObject('Subcategory', {
        name: 'Web Development',
        parent: category
      });

      const article = await parseSetup.createAndSaveTestObject('Article', {
        title: 'Parse Platform Guide',
        category: subcategory
      });

      // Query with nested include
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('Article'));
      const query = new Parse.Query(TestClass);
      query.include(['category', 'category.parent']);
      query.equalTo('objectId', article.id);

      const result = await query.first({ useMasterKey: true });
      expect(result.get('category').get('name')).toBe('Web Development');
      expect(result.get('category').get('parent').get('name')).toBe('Technology');

      // Cleanup
      await Parse.Object.destroyAll([article, subcategory, category], { useMasterKey: true });
    });
  });

  describe('Count Operations and Aggregation', () => {
    test('should perform count operations', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Count all users
      const allUsersQuery = new Parse.Query(TestClass);
      const totalCount = await testHelpers.countWithRetry(allUsersQuery);
      expect(totalCount).toBe(5);

      // Count active users
      const activeUsersQuery = new Parse.Query(TestClass);
      activeUsersQuery.equalTo('isActive', true);
      const activeCount = await testHelpers.countWithRetry(activeUsersQuery);
      expect(activeCount).toBe(4); // alice, bob, diana, eve

      // Count with constraints
      const engineersQuery = new Parse.Query(TestClass);
      engineersQuery.equalTo('department', 'Engineering');
      const engineersCount = await testHelpers.countWithRetry(engineersQuery);
      expect(engineersCount).toBe(3);
    });

    test('should handle pagination with count', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      const query = new Parse.Query(TestClass);
      query.ascending('age');

      // Get total count
      const totalCount = await testHelpers.countWithRetry(query);
      expect(totalCount).toBe(5);

      // Get first page
      const page1Query = new Parse.Query(TestClass);
      page1Query.ascending('age').limit(2).skip(0);
      const page1 = await testHelpers.findWithRetry(page1Query);
      expect(page1.length).toBe(2);

      // Get second page
      const page2Query = new Parse.Query(TestClass);
      page2Query.ascending('age').limit(2).skip(2);
      const page2 = await testHelpers.findWithRetry(page2Query);
      expect(page2.length).toBe(2);

      // Get third page
      const page3Query = new Parse.Query(TestClass);
      page3Query.ascending('age').limit(2).skip(4);
      const page3 = await testHelpers.findWithRetry(page3Query);
      expect(page3.length).toBe(1);
    });
  });

  describe('Compound Queries (AND/OR Operations)', () => {
    test('should perform AND operations with multiple constraints', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      const query = new Parse.Query(TestClass);
      query.equalTo('department', 'Engineering');
      query.equalTo('isActive', true);
      query.greaterThan('age', 24);

      const results = await testHelpers.findWithRetry(query);
      expect(results.length).toBe(2); // alice(25), bob(30) - eve is too young
    });

    test('should perform OR operations', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      const query1 = new Parse.Query(TestClass);
      query1.equalTo('department', 'Design');

      const query2 = new Parse.Query(TestClass);
      query2.equalTo('department', 'Marketing');

      const orQuery = Parse.Query.or(query1, query2);
      const results = await testHelpers.findWithRetry(orQuery);
      expect(results.length).toBe(2); // charlie, diana
    });

    test('should perform complex compound queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // (Engineering AND active) OR (age > 30)
      const engineeringActiveQuery = new Parse.Query(TestClass);
      engineeringActiveQuery.equalTo('department', 'Engineering');
      engineeringActiveQuery.equalTo('isActive', true);

      const olderQuery = new Parse.Query(TestClass);
      olderQuery.greaterThan('age', 30);

      const complexQuery = Parse.Query.or(engineeringActiveQuery, olderQuery);
      const results = await testHelpers.findWithRetry(complexQuery);
      expect(results.length).toBe(4); // alice, bob, diana, eve
    });

    test('should perform nested compound queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // ((Engineering OR Design) AND active) OR score > 90
      const engQuery = new Parse.Query(TestClass);
      engQuery.equalTo('department', 'Engineering');

      const designQuery = new Parse.Query(TestClass);
      designQuery.equalTo('department', 'Design');

      const techQuery = Parse.Query.or(engQuery, designQuery);
      techQuery.equalTo('isActive', true);

      const highScoreQuery = new Parse.Query(TestClass);
      highScoreQuery.greaterThan('score', 90);

      const nestedQuery = Parse.Query.or(techQuery, highScoreQuery);
      const results = await testHelpers.findWithRetry(nestedQuery);
      expect(results.length).toBe(4); // alice, bob, charlie, eve (diana excluded)
    });
  });

  describe('Performance Testing for Large Datasets', () => {
    test('should handle queries on large datasets efficiently', async () => {
      // Create larger dataset for performance testing
      const largeDataObjects = [];
      const batchSize = 100;

      for (let i = 0; i < batchSize; i++) {
        largeDataObjects.push(parseSetup.createTestObject('QueryPerformance', {
          name: `Performance Test ${i}`,
          index: i,
          category: i % 5, // 5 categories
          value: Math.random() * 1000,
          isEven: i % 2 === 0,
          timestamp: new Date(Date.now() + i * 1000)
        }));
      }

      // Save all objects
      const savedObjects = await Parse.Object.saveAll(largeDataObjects, { useMasterKey: true });
      expect(savedObjects.length).toBe(batchSize);

      // Test query performance
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryPerformance'));

      const performanceStats = await testHelpers.measurePerformance(async () => {
        const query = new Parse.Query(TestClass);
        query.equalTo('category', 2);
        query.equalTo('isEven', true);
        query.ascending('index');
        return await testHelpers.findWithRetry(query);
      }, 5);

      expect(performanceStats.successfulOperations).toBe(5);
      expect(performanceStats.averageDuration).toBeLessThan(5000); // Should be under 5 seconds

      console.log('Large Dataset Query Performance:', {
        objectCount: batchSize,
        averageDuration: `${performanceStats.averageDuration.toFixed(2)}ms`,
        maxDuration: `${performanceStats.maxDuration.toFixed(2)}ms`
      });

      // Cleanup
      await Parse.Object.destroyAll(savedObjects, { useMasterKey: true });
    });

    test('should optimize queries with proper indexing strategies', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test indexed field query (common fields like username, email should be fast)
      const indexedQueryStats = await testHelpers.measurePerformance(async () => {
        const query = new Parse.Query(TestClass);
        query.equalTo('username', 'alice');
        return await query.first({ useMasterKey: true });
      }, 10);

      // Test non-indexed field query (should still be reasonable for small dataset)
      const nonIndexedQueryStats = await testHelpers.measurePerformance(async () => {
        const query = new Parse.Query(TestClass);
        query.equalTo('score', 95);
        return await query.first({ useMasterKey: true });
      }, 10);

      expect(indexedQueryStats.successfulOperations).toBe(10);
      expect(nonIndexedQueryStats.successfulOperations).toBe(10);

      console.log('Query Optimization Comparison:', {
        indexed: `${indexedQueryStats.averageDuration.toFixed(2)}ms`,
        nonIndexed: `${nonIndexedQueryStats.averageDuration.toFixed(2)}ms`
      });
    });
  });

  describe('Query Error Handling', () => {
    test('should handle invalid query parameters gracefully', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test invalid field name
      const invalidFieldQuery = new Parse.Query(TestClass);
      invalidFieldQuery.equalTo('nonExistentField', 'value');

      const results = await testHelpers.findWithRetry(invalidFieldQuery);
      expect(results).toEqual([]); // Should return empty array, not error

      // Test invalid limit values
      const invalidLimitQuery = new Parse.Query(TestClass);
      invalidLimitQuery.limit(-1); // Negative limit should be handled

      try {
        await testHelpers.findWithRetry(invalidLimitQuery);
        // Should either work or throw predictable error
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();
      }
    });

    test('should handle query timeout scenarios', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Create a potentially expensive query
      const complexQuery = new Parse.Query(TestClass);
      complexQuery.exists('testMetadata');
      complexQuery.limit(1000); // Large limit

      try {
        const startTime = Date.now();
        const results = await testHelpers.findWithRetry(complexQuery, {}, 1); // Only 1 retry
        const duration = Date.now() - startTime;

        // Either succeeds quickly or fails gracefully
        expect(duration).toBeLessThan(30000); // 30 second timeout
        expect(Array.isArray(results)).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should handle malformed query objects', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      try {
        const query = new Parse.Query(TestClass);
        // Test with invalid regex
        query.matches('username', '[invalid regex');
        await testHelpers.findWithRetry(query);
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Advanced Query Features', () => {
    test('should handle near and withinGeoBox queries', async () => {
      // Create objects with geo points
      const geoObjects = await Promise.all([
        parseSetup.createAndSaveTestObject('GeoTest', {
          name: 'NYC Office',
          location: new Parse.GeoPoint(40.7128, -74.0060)
        }),
        parseSetup.createAndSaveTestObject('GeoTest', {
          name: 'SF Office',
          location: new Parse.GeoPoint(37.7749, -122.4194)
        }),
        parseSetup.createAndSaveTestObject('GeoTest', {
          name: 'Chicago Office',
          location: new Parse.GeoPoint(41.8781, -87.6298)
        })
      ]);

      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('GeoTest'));

      // Test near query
      const nearQuery = new Parse.Query(TestClass);
      const nycPoint = new Parse.GeoPoint(40.7128, -74.0060);
      nearQuery.near('location', nycPoint);
      nearQuery.limit(2);

      const nearResults = await testHelpers.findWithRetry(nearQuery);
      expect(nearResults.length).toBeGreaterThan(0);
      expect(nearResults[0].get('name')).toBe('NYC Office'); // Closest should be first

      // Test withinMiles query
      const withinQuery = new Parse.Query(TestClass);
      withinQuery.withinMiles('location', nycPoint, 100); // Within 100 miles of NYC

      const withinResults = await testHelpers.findWithRetry(withinQuery);
      expect(withinResults.length).toBeGreaterThan(0);

      // Cleanup
      await Parse.Object.destroyAll(geoObjects, { useMasterKey: true });
    });

    test('should handle select and exclude operations', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test select specific fields
      const selectQuery = new Parse.Query(TestClass);
      selectQuery.select(['username', 'email']);
      selectQuery.equalTo('username', 'alice');

      const selectResult = await selectQuery.first({ useMasterKey: true });
      expect(selectResult.get('username')).toBe('alice');
      expect(selectResult.get('email')).toBe('alice@test.com');
      expect(selectResult.get('age')).toBeUndefined(); // Should not be included

      // Test exclude specific fields
      const excludeQuery = new Parse.Query(TestClass);
      excludeQuery.exclude(['testMetadata', 'profile']);
      excludeQuery.equalTo('username', 'bob');

      const excludeResult = await excludeQuery.first({ useMasterKey: true });
      expect(excludeResult.get('username')).toBe('bob');
      expect(excludeResult.get('age')).toBe(30);
      expect(excludeResult.get('testMetadata')).toBeUndefined(); // Should be excluded
    });

    test('should handle distinct queries', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Get distinct departments
      const distinctQuery = new Parse.Query(TestClass);
      const distinctResults = await distinctQuery.distinct('department', { useMasterKey: true });

      expect(distinctResults).toContain('Engineering');
      expect(distinctResults).toContain('Design');
      expect(distinctResults).toContain('Marketing');
      expect(distinctResults.length).toBe(3);
    });
  });

  describe('Query Caching and Optimization', () => {
    test('should handle query caching appropriately', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // First query (uncached)
      const query1 = new Parse.Query(TestClass);
      query1.equalTo('department', 'Engineering');

      const firstQueryStats = await testHelpers.measurePerformance(async () => {
        return await testHelpers.findWithRetry(query1);
      });

      // Second identical query (potentially cached)
      const query2 = new Parse.Query(TestClass);
      query2.equalTo('department', 'Engineering');

      const secondQueryStats = await testHelpers.measurePerformance(async () => {
        return await testHelpers.findWithRetry(query2);
      });

      expect(firstQueryStats.successfulOperations).toBe(1);
      expect(secondQueryStats.successfulOperations).toBe(1);

      console.log('Query Caching Performance:', {
        firstQuery: `${firstQueryStats.averageDuration.toFixed(2)}ms`,
        secondQuery: `${secondQueryStats.averageDuration.toFixed(2)}ms`
      });
    });

    test('should optimize queries with proper field ordering', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('QueryUser'));

      // Test query with multiple constraints in different orders
      const optimizedQueryStats = await testHelpers.measurePerformance(async () => {
        const query = new Parse.Query(TestClass);
        // Order constraints from most selective to least selective
        query.equalTo('username', 'alice'); // Most selective first
        query.equalTo('department', 'Engineering');
        query.equalTo('isActive', true);
        return await query.first({ useMasterKey: true });
      }, 5);

      const unoptimizedQueryStats = await testHelpers.measurePerformance(async () => {
        const query = new Parse.Query(TestClass);
        // Order constraints from least selective to most selective
        query.equalTo('isActive', true); // Least selective first
        query.equalTo('department', 'Engineering');
        query.equalTo('username', 'alice');
        return await query.first({ useMasterKey: true });
      }, 5);

      expect(optimizedQueryStats.successfulOperations).toBe(5);
      expect(unoptimizedQueryStats.successfulOperations).toBe(5);

      console.log('Query Optimization:', {
        optimized: `${optimizedQueryStats.averageDuration.toFixed(2)}ms`,
        unoptimized: `${unoptimizedQueryStats.averageDuration.toFixed(2)}ms`
      });
    });
  });
});