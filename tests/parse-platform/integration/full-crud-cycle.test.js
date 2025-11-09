/**
 * Parse Platform Integration Tests - Full CRUD Cycle
 * Comprehensive integration testing of complete workflows with related objects
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse Platform Integration Tests - Full CRUD Cycle', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;
  let testObjects = [];

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();

    console.log('Initializing Parse Platform integration tests...');
  });

  afterAll(async () => {
    await cleanupAllTestObjects();
    await dataFactory.cleanup();
    await parseSetup.cleanupAllTestData();
  });

  async function cleanupAllTestObjects() {
    console.log(`Cleaning up ${testObjects.length} integration test objects...`);
    for (const obj of testObjects) {
      try {
        if (obj && obj.id) {
          await obj.destroy({ useMasterKey: true });
        }
      } catch (error) {
        console.warn(`Failed to cleanup object ${obj.id}:`, error.message);
      }
    }
    testObjects = [];
  }

  describe('Complete CRUD Workflows with Related Objects', () => {
    test('should handle complete user-event-notification workflow', async () => {
      let user, event, notification, eventRegistration;

      try {
        // CREATE Phase - Create related objects
        console.log('Creating user-event-notification workflow...');

        // 1. Create User
        user = new Parse.User();
        user.set('username', `integration_user_${Date.now()}`);
        user.set('password', 'IntegrationTest123!');
        user.set('email', `integration.${Date.now()}@test.com`);
        user.set('firstName', 'Integration');
        user.set('lastName', 'Test');
        user.set('role', 'participant');

        await user.signUp();
        testObjects.push(user);
        console.log(`Created user: ${user.id}`);

        // 2. Create Event
        event = await parseSetup.createAndSaveTestObject('Event', {
          title: 'Integration Test Event',
          description: 'This is an integration test event',
          startDate: new Date(Date.now() + 86400000), // Tomorrow
          endDate: new Date(Date.now() + 90000000), // Day after tomorrow
          location: 'Integration Test Location',
          capacity: 50,
          currentAttendees: 0,
          isActive: true,
          organizer: user,
          createdBy: user.id
        });
        testObjects.push(event);
        console.log(`Created event: ${event.id}`);

        // 3. Create Event Registration (Many-to-Many relationship)
        eventRegistration = await parseSetup.createAndSaveTestObject('EventRegistration', {
          user: user,
          event: event,
          registrationDate: new Date(),
          status: 'confirmed',
          paymentStatus: 'paid',
          specialRequests: 'No special requirements'
        });
        testObjects.push(eventRegistration);
        console.log(`Created registration: ${eventRegistration.id}`);

        // 4. Create Notification
        notification = await parseSetup.createAndSaveTestObject('Notification', {
          title: 'Event Registration Confirmed',
          message: `Your registration for ${event.get('title')} has been confirmed.`,
          type: 'confirmation',
          priority: 'normal',
          recipient: user,
          relatedEvent: event,
          isRead: false,
          sentAt: new Date()
        });
        testObjects.push(notification);
        console.log(`Created notification: ${notification.id}`);

        // READ Phase - Verify relationships and query related data
        console.log('Testing READ operations with relationships...');

        // Query user with related events
        const userQuery = new Parse.Query(Parse.User);
        userQuery.include('eventRegistrations');
        userQuery.equalTo('objectId', user.id);
        const userWithEvents = await userQuery.first({ useMasterKey: true });

        expect(userWithEvents.id).toBe(user.id);
        expect(userWithEvents.get('firstName')).toBe('Integration');

        // Query events with participants
        const EventClass = Parse.Object.extend(testHelpers.getFullClassName('Event'));
        const eventQuery = new Parse.Query(EventClass);
        eventQuery.include(['organizer', 'registrations']);
        eventQuery.equalTo('objectId', event.id);
        const eventWithDetails = await eventQuery.first({ useMasterKey: true });

        expect(eventWithDetails.id).toBe(event.id);
        expect(eventWithDetails.get('organizer').id).toBe(user.id);

        // Query registrations
        const RegistrationClass = Parse.Object.extend(testHelpers.getFullClassName('EventRegistration'));
        const registrationQuery = new Parse.Query(RegistrationClass);
        registrationQuery.include(['user', 'event']);
        registrationQuery.equalTo('user', user);
        registrationQuery.equalTo('event', event);
        const registrations = await registrationQuery.find({ useMasterKey: true });

        expect(registrations).toHaveLength(1);
        expect(registrations[0].get('status')).toBe('confirmed');

        // Query notifications for user
        const NotificationClass = Parse.Object.extend(testHelpers.getFullClassName('Notification'));
        const notificationQuery = new Parse.Query(NotificationClass);
        notificationQuery.include(['recipient', 'relatedEvent']);
        notificationQuery.equalTo('recipient', user);
        const userNotifications = await notificationQuery.find({ useMasterKey: true });

        expect(userNotifications).toHaveLength(1);
        expect(userNotifications[0].get('type')).toBe('confirmation');
        expect(userNotifications[0].get('relatedEvent').id).toBe(event.id);

        // UPDATE Phase - Modify related objects
        console.log('Testing UPDATE operations with relationship integrity...');

        // Update event details
        event.set('title', 'Updated Integration Test Event');
        event.set('description', 'Updated description for integration testing');
        event.increment('currentAttendees'); // Increment attendees
        await event.save(null, { useMasterKey: true });

        // Update user profile
        user.set('lastName', 'Updated');
        user.set('lastActivity', new Date());
        await user.save(null, { useMasterKey: true });

        // Update registration status
        eventRegistration.set('status', 'attended');
        eventRegistration.set('attendedAt', new Date());
        await eventRegistration.save(null, { useMasterKey: true });

        // Update notification as read
        notification.set('isRead', true);
        notification.set('readAt', new Date());
        await notification.save(null, { useMasterKey: true });

        // Verify updates maintained relationships
        await event.fetch({ useMasterKey: true });
        await user.fetch({ useMasterKey: true });
        await eventRegistration.fetch({ useMasterKey: true });
        await notification.fetch({ useMasterKey: true });

        expect(event.get('title')).toBe('Updated Integration Test Event');
        expect(event.get('currentAttendees')).toBe(1);
        expect(user.get('lastName')).toBe('Updated');
        expect(eventRegistration.get('status')).toBe('attended');
        expect(notification.get('isRead')).toBe(true);

        // Complex query after updates
        const complexQuery = new Parse.Query(RegistrationClass);
        complexQuery.include(['user', 'event']);
        complexQuery.equalTo('status', 'attended');
        complexQuery.greaterThanOrEqualTo('attendedAt', new Date(Date.now() - 60000));
        const recentAttendees = await complexQuery.find({ useMasterKey: true });

        expect(recentAttendees).toHaveLength(1);
        expect(recentAttendees[0].get('user').get('lastName')).toBe('Updated');

        console.log('CRUD operations completed successfully');

      } catch (error) {
        console.error('Integration test failed:', error);
        throw error;
      }

      // DELETE Phase will be handled by afterAll cleanup
    });

    test('should handle complex business logic scenarios', async () => {
      console.log('Testing complex business logic scenarios...');

      // Scenario: Multi-user project collaboration
      const users = [];
      const project = await parseSetup.createAndSaveTestObject('Project', {
        name: 'Complex Integration Project',
        description: 'Testing complex relationships and business logic',
        status: 'active',
        priority: 'high',
        budget: 100000,
        deadline: new Date(Date.now() + 30 * 86400000), // 30 days from now
        startDate: new Date(),
        progress: 0
      });
      testObjects.push(project);

      // Create multiple users with different roles
      for (let i = 0; i < 3; i++) {
        const user = new Parse.User();
        user.set('username', `project_user_${i}_${Date.now()}`);
        user.set('password', 'ProjectTest123!');
        user.set('email', `project.user.${i}.${Date.now()}@test.com`);
        user.set('firstName', `User${i}`);
        user.set('role', i === 0 ? 'manager' : 'developer');

        await user.signUp();
        users.push(user);
        testObjects.push(user);

        // Log out after each user creation
        await Parse.User.logOut();
      }

      // Create project assignments
      const assignments = [];
      for (let i = 0; i < users.length; i++) {
        const assignment = await parseSetup.createAndSaveTestObject('ProjectAssignment', {
          project: project,
          user: users[i],
          role: users[i].get('role'),
          assignedAt: new Date(),
          isActive: true,
          permissions: users[i].get('role') === 'manager' ? ['read', 'write', 'admin'] : ['read', 'write']
        });
        assignments.push(assignment);
        testObjects.push(assignment);
      }

      // Create tasks for the project
      const tasks = [];
      const taskData = [
        { title: 'Setup Infrastructure', priority: 'high', estimatedHours: 16, assignedTo: users[0] },
        { title: 'Develop Core Features', priority: 'medium', estimatedHours: 40, assignedTo: users[1] },
        { title: 'Write Tests', priority: 'medium', estimatedHours: 24, assignedTo: users[2] },
        { title: 'Deploy to Production', priority: 'high', estimatedHours: 8, assignedTo: users[0] }
      ];

      for (const taskInfo of taskData) {
        const task = await parseSetup.createAndSaveTestObject('Task', {
          title: taskInfo.title,
          description: `Task: ${taskInfo.title}`,
          priority: taskInfo.priority,
          status: 'pending',
          project: project,
          assignedTo: taskInfo.assignedTo,
          estimatedHours: taskInfo.estimatedHours,
          actualHours: 0,
          progress: 0,
          createdAt: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000) // 7 days from now
        });
        tasks.push(task);
        testObjects.push(task);
      }

      // Test complex queries and business logic
      console.log('Testing complex queries and aggregations...');

      // 1. Query project with all related data
      const ProjectClass = Parse.Object.extend(testHelpers.getFullClassName('Project'));
      const projectQuery = new Parse.Query(ProjectClass);
      projectQuery.include(['assignments', 'tasks']);
      projectQuery.equalTo('objectId', project.id);
      const fullProject = await projectQuery.first({ useMasterKey: true });

      expect(fullProject.id).toBe(project.id);

      // 2. Query high-priority tasks across all projects
      const TaskClass = Parse.Object.extend(testHelpers.getFullClassName('Task'));
      const highPriorityQuery = new Parse.Query(TaskClass);
      highPriorityQuery.include(['project', 'assignedTo']);
      highPriorityQuery.equalTo('priority', 'high');
      const highPriorityTasks = await highPriorityQuery.find({ useMasterKey: true });

      expect(highPriorityTasks.length).toBe(2);
      highPriorityTasks.forEach(task => {
        expect(task.get('priority')).toBe('high');
      });

      // 3. Query user workload (tasks assigned to each user)
      const AssignmentClass = Parse.Object.extend(testHelpers.getFullClassName('ProjectAssignment'));
      for (const user of users) {
        const userTasksQuery = new Parse.Query(TaskClass);
        userTasksQuery.equalTo('assignedTo', user);
        userTasksQuery.include('project');
        const userTasks = await userTasksQuery.find({ useMasterKey: true });

        console.log(`User ${user.get('firstName')} has ${userTasks.length} tasks assigned`);
        expect(userTasks.length).toBeGreaterThan(0);
      }

      // 4. Calculate project statistics
      const allProjectTasksQuery = new Parse.Query(TaskClass);
      allProjectTasksQuery.equalTo('project', project);
      const allProjectTasks = await allProjectTasksQuery.find({ useMasterKey: true });

      const totalEstimatedHours = allProjectTasks.reduce((sum, task) => sum + task.get('estimatedHours'), 0);
      const totalActualHours = allProjectTasks.reduce((sum, task) => sum + task.get('actualHours'), 0);
      const averageProgress = allProjectTasks.reduce((sum, task) => sum + task.get('progress'), 0) / allProjectTasks.length;

      expect(totalEstimatedHours).toBe(88); // Sum of all estimated hours
      expect(totalActualHours).toBe(0); // No actual hours recorded yet
      expect(averageProgress).toBe(0); // No progress made yet

      // Simulate task progress updates
      console.log('Simulating task progress updates...');

      // Update first task to 50% complete with 8 hours worked
      tasks[0].set('progress', 50);
      tasks[0].set('actualHours', 8);
      tasks[0].set('status', 'in_progress');
      tasks[0].set('lastUpdated', new Date());
      await tasks[0].save(null, { useMasterKey: true });

      // Update second task to 25% complete with 10 hours worked
      tasks[1].set('progress', 25);
      tasks[1].set('actualHours', 10);
      tasks[1].set('status', 'in_progress');
      tasks[1].set('lastUpdated', new Date());
      await tasks[1].save(null, { useMasterKey: true });

      // Recalculate project progress
      await Promise.all(allProjectTasks.map(task => task.fetch({ useMasterKey: true })));
      const updatedProgress = allProjectTasks.reduce((sum, task) => sum + task.get('progress'), 0) / allProjectTasks.length;
      const updatedActualHours = allProjectTasks.reduce((sum, task) => sum + task.get('actualHours'), 0);

      // Update project with calculated progress
      project.set('progress', updatedProgress);
      project.set('totalActualHours', updatedActualHours);
      project.set('lastUpdated', new Date());
      await project.save(null, { useMasterKey: true });

      expect(project.get('progress')).toBeCloseTo(18.75); // (50 + 25 + 0 + 0) / 4
      expect(project.get('totalActualHours')).toBe(18);

      console.log('Complex business logic scenarios completed successfully');
    });
  });

  describe('Bulk Operations and Batch Processing', () => {
    test('should handle bulk create, update, and delete operations', async () => {
      console.log('Testing bulk operations and batch processing...');

      const batchSize = 50;
      const objects = [];

      // Bulk CREATE
      console.log(`Creating ${batchSize} objects in bulk...`);
      const startCreateTime = Date.now();

      for (let i = 0; i < batchSize; i++) {
        objects.push(parseSetup.createTestObject('BulkTest', {
          name: `Bulk Test Object ${i}`,
          index: i,
          category: i % 5, // 5 categories
          value: Math.random() * 1000,
          isEven: i % 2 === 0,
          timestamp: new Date(),
          metadata: {
            batch: 'integration_test',
            position: i
          }
        }));
      }

      const savedObjects = await Parse.Object.saveAll(objects, { useMasterKey: true });
      const createDuration = Date.now() - startCreateTime;
      testObjects.push(...savedObjects);

      expect(savedObjects).toHaveLength(batchSize);
      savedObjects.forEach((obj, index) => {
        expect(obj.id).toBeDefined();
        expect(obj.get('index')).toBe(index);
      });

      console.log(`Bulk create completed in ${createDuration}ms (${(batchSize / createDuration * 1000).toFixed(2)} objects/sec)`);

      // Bulk READ with pagination
      console.log('Testing bulk read with pagination...');
      const BulkTestClass = Parse.Object.extend(testHelpers.getFullClassName('BulkTest'));

      let allFetchedObjects = [];
      let skip = 0;
      const pageSize = 10;

      while (true) {
        const query = new Parse.Query(BulkTestClass);
        query.exists('testMetadata');
        query.ascending('index');
        query.limit(pageSize);
        query.skip(skip);

        const page = await query.find({ useMasterKey: true });
        if (page.length === 0) break;

        allFetchedObjects.push(...page);
        skip += pageSize;
      }

      expect(allFetchedObjects.length).toBe(batchSize);
      expect(allFetchedObjects[0].get('index')).toBe(0);
      expect(allFetchedObjects[batchSize - 1].get('index')).toBe(batchSize - 1);

      // Bulk UPDATE
      console.log('Testing bulk update operations...');
      const startUpdateTime = Date.now();

      // Update all even-indexed objects
      savedObjects.forEach((obj, index) => {
        if (index % 2 === 0) {
          obj.set('updated', true);
          obj.set('updateTimestamp', new Date());
          obj.set('newValue', obj.get('value') * 2);
        }
      });

      const updatedObjects = await Parse.Object.saveAll(savedObjects, { useMasterKey: true });
      const updateDuration = Date.now() - startUpdateTime;

      expect(updatedObjects).toHaveLength(batchSize);
      updatedObjects.forEach((obj, index) => {
        if (index % 2 === 0) {
          expect(obj.get('updated')).toBe(true);
          expect(obj.get('newValue')).toBe(objects[index].get('value') * 2);
        } else {
          expect(obj.get('updated')).toBeUndefined();
        }
      });

      console.log(`Bulk update completed in ${updateDuration}ms`);

      // Bulk QUERY with complex filters
      console.log('Testing complex bulk queries...');

      // Query updated objects
      const updatedQuery = new Parse.Query(BulkTestClass);
      updatedQuery.equalTo('updated', true);
      updatedQuery.exists('updateTimestamp');
      const updatedResults = await updatedQuery.find({ useMasterKey: true });

      expect(updatedResults.length).toBe(Math.ceil(batchSize / 2));

      // Query by category with aggregation
      const categoryStats = {};
      for (let category = 0; category < 5; category++) {
        const categoryQuery = new Parse.Query(BulkTestClass);
        categoryQuery.equalTo('category', category);
        categoryQuery.exists('testMetadata');

        const count = await categoryQuery.count({ useMasterKey: true });
        const objects = await categoryQuery.find({ useMasterKey: true });
        const avgValue = objects.reduce((sum, obj) => sum + obj.get('value'), 0) / objects.length;

        categoryStats[category] = { count, avgValue };
      }

      // Verify category distribution
      Object.keys(categoryStats).forEach(category => {
        expect(categoryStats[category].count).toBe(10); // batchSize / 5
        expect(categoryStats[category].avgValue).toBeGreaterThan(0);
      });

      // Bulk DELETE
      console.log('Testing bulk delete operations...');
      const startDeleteTime = Date.now();

      // Delete objects in batches (Parse has limits on bulk operations)
      const deletePromises = [];
      for (let i = 0; i < savedObjects.length; i += 20) {
        const batch = savedObjects.slice(i, i + 20);
        deletePromises.push(Parse.Object.destroyAll(batch, { useMasterKey: true }));
      }

      await Promise.all(deletePromises);
      const deleteDuration = Date.now() - startDeleteTime;

      console.log(`Bulk delete completed in ${deleteDuration}ms`);

      // Verify deletion
      const verifyQuery = new Parse.Query(BulkTestClass);
      verifyQuery.exists('testMetadata');
      const remainingObjects = await verifyQuery.find({ useMasterKey: true });

      expect(remainingObjects.length).toBe(0);

      // Remove from test cleanup list since they're already deleted
      testObjects = testObjects.filter(obj => !savedObjects.some(saved => saved.id === obj.id));

      console.log('Bulk operations completed successfully');
    });
  });

  describe('Concurrent Operations and Conflict Resolution', () => {
    test('should handle concurrent modifications with proper conflict resolution', async () => {
      console.log('Testing concurrent operations and conflict resolution...');

      // Create a shared object that multiple operations will modify
      const sharedObject = await parseSetup.createAndSaveTestObject('ConcurrentTest', {
        counter: 0,
        version: 1,
        lastModified: new Date(),
        modificationLog: []
      });
      testObjects.push(sharedObject);

      // Simulate multiple concurrent operations
      const concurrentOperations = [];
      const operationCount = 10;

      for (let i = 0; i < operationCount; i++) {
        concurrentOperations.push((async (operationId) => {
          try {
            // Fetch fresh copy of the object
            const obj = await sharedObject.fetch({ useMasterKey: true });

            // Simulate some processing time
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

            // Modify the object
            obj.increment('counter');
            obj.increment('version');
            obj.set('lastModified', new Date());

            // Add to modification log
            const currentLog = obj.get('modificationLog') || [];
            currentLog.push({
              operationId: operationId,
              timestamp: new Date(),
              threadId: `thread_${operationId}`
            });
            obj.set('modificationLog', currentLog);

            // Save with retry logic for conflicts
            let retries = 3;
            while (retries > 0) {
              try {
                await obj.save(null, { useMasterKey: true });
                console.log(`Operation ${operationId} completed successfully`);
                return { operationId, success: true };
              } catch (error) {
                retries--;
                if (retries === 0) {
                  console.warn(`Operation ${operationId} failed after retries:`, error.message);
                  return { operationId, success: false, error: error.message };
                }

                // Refetch and retry
                await obj.fetch({ useMasterKey: true });
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            }
          } catch (error) {
            console.error(`Operation ${operationId} error:`, error);
            return { operationId, success: false, error: error.message };
          }
        })(i));
      }

      // Execute all operations concurrently
      const results = await Promise.all(concurrentOperations);

      // Analyze results
      const successfulOps = results.filter(r => r.success);
      const failedOps = results.filter(r => !r.success);

      console.log(`Concurrent operations completed: ${successfulOps.length} successful, ${failedOps.length} failed`);

      // Verify final state
      await sharedObject.fetch({ useMasterKey: true });
      const finalCounter = sharedObject.get('counter');
      const finalVersion = sharedObject.get('version');
      const modificationLog = sharedObject.get('modificationLog');

      expect(finalCounter).toBeGreaterThan(0);
      expect(finalVersion).toBeGreaterThan(1);
      expect(modificationLog.length).toBeGreaterThan(0);
      expect(finalCounter).toBeLessThanOrEqual(operationCount); // Some operations might have failed

      console.log(`Final state: counter=${finalCounter}, version=${finalVersion}, logs=${modificationLog.length}`);

      // Test optimistic locking pattern
      console.log('Testing optimistic locking pattern...');

      const lockObject = await parseSetup.createAndSaveTestObject('OptimisticLock', {
        data: 'initial',
        version: 1
      });
      testObjects.push(lockObject);

      // Simulate conflicting updates with version checking
      const update1Promise = (async () => {
        const obj1 = await lockObject.fetch({ useMasterKey: true });
        const originalVersion = obj1.get('version');

        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing

        obj1.set('data', 'updated_by_operation_1');
        obj1.set('version', originalVersion + 1);

        // Check version before saving
        const currentObj = await lockObject.fetch({ useMasterKey: true });
        if (currentObj.get('version') !== originalVersion) {
          throw new Error('Version conflict detected');
        }

        await obj1.save(null, { useMasterKey: true });
        return 'operation_1_success';
      })();

      const update2Promise = (async () => {
        await new Promise(resolve => setTimeout(resolve, 50)); // Start slightly later

        const obj2 = await lockObject.fetch({ useMasterKey: true });
        const originalVersion = obj2.get('version');

        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing

        obj2.set('data', 'updated_by_operation_2');
        obj2.set('version', originalVersion + 1);

        // Check version before saving
        const currentObj = await lockObject.fetch({ useMasterKey: true });
        if (currentObj.get('version') !== originalVersion) {
          throw new Error('Version conflict detected');
        }

        await obj2.save(null, { useMasterKey: true });
        return 'operation_2_success';
      })();

      const lockResults = await Promise.allSettled([update1Promise, update2Promise]);

      // One should succeed, one should fail due to version conflict
      const lockSuccesses = lockResults.filter(r => r.status === 'fulfilled');
      const lockFailures = lockResults.filter(r => r.status === 'rejected');

      expect(lockSuccesses.length + lockFailures.length).toBe(2);
      expect(lockFailures.length).toBeGreaterThan(0); // At least one should fail

      console.log(`Optimistic locking: ${lockSuccesses.length} succeeded, ${lockFailures.length} failed`);
    });
  });

  describe('Data Consistency Validation', () => {
    test('should maintain data consistency across related objects', async () => {
      console.log('Testing data consistency across related objects...');

      // Create a complex relationship structure
      const organization = await parseSetup.createAndSaveTestObject('Organization', {
        name: 'Test Organization',
        type: 'company',
        status: 'active'
      });
      testObjects.push(organization);

      const department = await parseSetup.createAndSaveTestObject('Department', {
        name: 'Engineering',
        organization: organization,
        budget: 100000,
        employeeCount: 0
      });
      testObjects.push(department);

      const employees = [];
      for (let i = 0; i < 5; i++) {
        const employee = await parseSetup.createAndSaveTestObject('Employee', {
          name: `Employee ${i}`,
          email: `employee${i}@test.com`,
          department: department,
          organization: organization,
          salary: 50000 + (i * 10000),
          isActive: true
        });
        employees.push(employee);
        testObjects.push(employee);
      }

      // Update department employee count
      department.set('employeeCount', employees.length);
      await department.save(null, { useMasterKey: true });

      // Test consistency - department count should match actual employees
      const DepartmentClass = Parse.Object.extend(testHelpers.getFullClassName('Department'));
      const EmployeeClass = Parse.Object.extend(testHelpers.getFullClassName('Employee'));

      const deptQuery = new Parse.Query(DepartmentClass);
      deptQuery.equalTo('objectId', department.id);
      const dept = await deptQuery.first({ useMasterKey: true });

      const empQuery = new Parse.Query(EmployeeClass);
      empQuery.equalTo('department', department);
      empQuery.equalTo('isActive', true);
      const actualEmployees = await empQuery.find({ useMasterKey: true });

      expect(dept.get('employeeCount')).toBe(actualEmployees.length);
      expect(actualEmployees.length).toBe(5);

      // Test referential integrity - when department is deleted, employees should handle it
      console.log('Testing referential integrity...');

      // Deactivate department
      department.set('status', 'inactive');
      await department.save(null, { useMasterKey: true });

      // Employees should still reference the department
      await Promise.all(employees.map(emp => emp.fetch({ useMasterKey: true })));
      employees.forEach(emp => {
        expect(emp.get('department').id).toBe(department.id);
      });

      // Test cascade updates
      console.log('Testing cascade updates...');

      // Update organization status - should affect all related objects
      organization.set('status', 'suspended');
      await organization.save(null, { useMasterKey: true });

      // Update all related objects to reflect organization status
      department.set('status', 'suspended');
      await department.save(null, { useMasterKey: true });

      for (const employee of employees) {
        employee.set('isActive', false);
        employee.set('suspensionReason', 'Organization suspended');
        await employee.save(null, { useMasterKey: true });
      }

      // Verify cascade was applied
      const OrganizationClass = Parse.Object.extend(testHelpers.getFullClassName('Organization'));
      const orgQuery = new Parse.Query(OrganizationClass);
      orgQuery.include(['departments', 'employees']);
      orgQuery.equalTo('objectId', organization.id);
      const orgWithRelations = await orgQuery.first({ useMasterKey: true });

      expect(orgWithRelations.get('status')).toBe('suspended');

      // Verify all employees are inactive
      const suspendedEmpQuery = new Parse.Query(EmployeeClass);
      suspendedEmpQuery.equalTo('organization', organization);
      suspendedEmpQuery.equalTo('isActive', false);
      const suspendedEmployees = await suspendedEmpQuery.find({ useMasterKey: true });

      expect(suspendedEmployees.length).toBe(5);

      console.log('Data consistency validation completed successfully');
    });
  });

  describe('Performance Benchmarking', () => {
    test('should benchmark complex operations and provide performance metrics', async () => {
      console.log('Starting performance benchmarking...');

      const performanceResults = {};

      // Benchmark 1: Object Creation Performance
      console.log('Benchmarking object creation...');
      const createStats = await testHelpers.measurePerformance(async () => {
        const obj = parseSetup.createTestObject('PerformanceBench', {
          name: 'Performance Test',
          timestamp: new Date(),
          data: { test: 'performance', nested: { value: Math.random() } }
        });
        const saved = await obj.save(null, { useMasterKey: true });
        testObjects.push(saved);
        return saved;
      }, 20);

      performanceResults.objectCreation = createStats;

      // Benchmark 2: Query Performance
      console.log('Benchmarking query operations...');
      const queryStats = await testHelpers.measurePerformance(async () => {
        const PerfClass = Parse.Object.extend(testHelpers.getFullClassName('PerformanceBench'));
        const query = new Parse.Query(PerfClass);
        query.exists('testMetadata');
        query.limit(10);
        return await query.find({ useMasterKey: true });
      }, 15);

      performanceResults.queryOperations = queryStats;

      // Benchmark 3: Complex Query with Relationships
      console.log('Benchmarking complex queries...');

      // Create some related objects for complex query testing
      const parentObj = await parseSetup.createAndSaveTestObject('PerfParent', {
        name: 'Performance Parent',
        category: 'benchmark'
      });
      testObjects.push(parentObj);

      const childObjects = [];
      for (let i = 0; i < 10; i++) {
        const child = await parseSetup.createAndSaveTestObject('PerfChild', {
          name: `Performance Child ${i}`,
          parent: parentObj,
          value: i * 10
        });
        childObjects.push(child);
        testObjects.push(child);
      }

      const complexQueryStats = await testHelpers.measurePerformance(async () => {
        const ParentClass = Parse.Object.extend(testHelpers.getFullClassName('PerfParent'));
        const query = new Parse.Query(ParentClass);
        query.include('children');
        query.equalTo('category', 'benchmark');
        return await query.find({ useMasterKey: true });
      }, 10);

      performanceResults.complexQueries = complexQueryStats;

      // Benchmark 4: Bulk Operations
      console.log('Benchmarking bulk operations...');
      const bulkStats = await testHelpers.measurePerformance(async () => {
        const bulkObjects = [];
        for (let i = 0; i < 25; i++) {
          bulkObjects.push(parseSetup.createTestObject('BulkPerf', {
            name: `Bulk Performance ${i}`,
            index: i,
            timestamp: new Date()
          }));
        }
        const saved = await Parse.Object.saveAll(bulkObjects, { useMasterKey: true });
        testObjects.push(...saved);
        return saved;
      }, 5);

      performanceResults.bulkOperations = bulkStats;

      // Benchmark 5: User Authentication
      console.log('Benchmarking user authentication...');
      const authTestUser = new Parse.User();
      authTestUser.set('username', `perfuser_${Date.now()}`);
      authTestUser.set('password', 'PerfTest123!');
      authTestUser.set('email', `perf.${Date.now()}@test.com`);

      await authTestUser.signUp();
      testObjects.push(authTestUser);
      await Parse.User.logOut();

      const authStats = await testHelpers.measurePerformance(async () => {
        const loggedIn = await Parse.User.logIn(authTestUser.get('username'), 'PerfTest123!');
        await Parse.User.logOut();
        return loggedIn;
      }, 10);

      performanceResults.authentication = authStats;

      // Generate Performance Report
      console.log('\n=== PERFORMANCE BENCHMARK RESULTS ===');
      console.log('┌─────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────┐');
      console.log('│ Operation               │ Avg (ms)     │ Min (ms)     │ Max (ms)     │ P95 (ms)     │');
      console.log('├─────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┤');

      Object.entries(performanceResults).forEach(([operation, stats]) => {
        const avg = stats.averageDuration.toFixed(2).padStart(11);
        const min = stats.minDuration.toFixed(2).padStart(11);
        const max = stats.maxDuration.toFixed(2).padStart(11);
        const p95 = stats.p95Duration.toFixed(2).padStart(11);
        const opName = operation.padEnd(23);

        console.log(`│ ${opName} │${avg} │${min} │${max} │${p95} │`);
      });

      console.log('└─────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘');

      // Performance Assertions
      expect(performanceResults.objectCreation.averageDuration).toBeLessThan(5000); // 5 seconds
      expect(performanceResults.queryOperations.averageDuration).toBeLessThan(3000); // 3 seconds
      expect(performanceResults.complexQueries.averageDuration).toBeLessThan(10000); // 10 seconds
      expect(performanceResults.bulkOperations.averageDuration).toBeLessThan(15000); // 15 seconds
      expect(performanceResults.authentication.averageDuration).toBeLessThan(5000); // 5 seconds

      // Success Rate Assertions
      Object.values(performanceResults).forEach(stats => {
        expect(stats.successfulOperations).toBeGreaterThan(0);
        expect(stats.successfulOperations / stats.totalOperations).toBeGreaterThanOrEqual(0.8); // 80% success rate
      });

      console.log('\nPerformance benchmarking completed successfully');
    });
  });
});