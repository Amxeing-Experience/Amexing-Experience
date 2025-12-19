/**
 * EmailLog Model Integration Tests
 *
 * Tests EmailLog model functionality including CRUD operations,
 * queries, and email traceability features.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const EmailLog = require('../../../src/domain/models/EmailLog');

describe('EmailLog Model Integration Tests', () => {
  let app;
  let testUser;

  beforeAll(async () => {
    // Import app
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create test user
    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    testUser = new AmexingUserClass();
    testUser.set('username', 'test-emaillog-user');
    testUser.set('email', 'emaillog@amexing.test');
    testUser.set('firstName', 'EmailLog');
    testUser.set('lastName', 'Test User');
    testUser.set('active', true);
    testUser.set('exists', true);

    await testUser.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    // Cleanup test user
    if (testUser) {
      await testUser.destroy({ useMasterKey: true });
    }

    // Cleanup all email logs created during tests
    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientEmail', 'emaillog@amexing.test');
    const logs = await query.find({ useMasterKey: true });
    await Parse.Object.destroyAll(logs, { useMasterKey: true });
  });

  afterEach(async () => {
    // Clean up email logs after each test
    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientEmail', 'emaillog@amexing.test');
    const logs = await query.find({ useMasterKey: true });
    await Parse.Object.destroyAll(logs, { useMasterKey: true });
  });

  describe('EmailLog Creation', () => {
    it('should create basic email log', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        recipientUser: testUser,
        notificationType: 'test_notification',
        subject: 'Test Email Subject',
        htmlContent: '<html><body>Test</body></html>',
        textContent: 'Test',
        status: 'sent',
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.id).toBeDefined();
      expect(emailLog.get('recipientEmail')).toBe('emaillog@amexing.test');
      expect(emailLog.get('notificationType')).toBe('test_notification');
      expect(emailLog.get('status')).toBe('sent');
      expect(emailLog.get('active')).toBe(true);
      expect(emailLog.get('exists')).toBe(true);
    });

    it('should create email log with all fields', async () => {
      const emailLog = EmailLog.create({
        messageId: 'msg_test_12345',
        recipientEmail: 'emaillog@amexing.test',
        recipientUser: testUser,
        channel: 'email',
        notificationType: 'booking_confirmation',
        subject: 'Booking Confirmation',
        htmlContent: '<html><body>Booking confirmed</body></html>',
        textContent: 'Booking confirmed',
        status: 'sent',
        metadata: {
          bookingId: 'B-TEST-001',
          quoteId: 'Q-TEST-001',
          clientId: 'C-TEST-001',
        },
        tags: ['booking', 'confirmation', 'test'],
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.get('messageId')).toBe('msg_test_12345');
      expect(emailLog.get('channel')).toBe('email');
      expect(emailLog.get('metadata').bookingId).toBe('B-TEST-001');
      expect(emailLog.get('tags')).toContain('booking');
      expect(emailLog.get('sentAt')).toBeDefined();
    });

    it('should normalize email address to lowercase', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'EmailLog@Amexing.TEST',
        notificationType: 'test',
        subject: 'Test',
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.get('recipientEmail')).toBe('emaillog@amexing.test');
    });

    it('should require recipientEmail', () => {
      expect(() => {
        EmailLog.create({
          notificationType: 'test',
          subject: 'Test',
        });
      }).toThrow('recipientEmail is required');
    });

    it('should require notificationType', () => {
      expect(() => {
        EmailLog.create({
          recipientEmail: 'test@example.com',
          subject: 'Test',
        });
      }).toThrow('notificationType is required');
    });

    it('should require subject', () => {
      expect(() => {
        EmailLog.create({
          recipientEmail: 'test@example.com',
          notificationType: 'test',
        });
      }).toThrow('subject is required');
    });

    it('should set default values correctly', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        notificationType: 'test',
        subject: 'Test',
      });

      expect(emailLog.get('channel')).toBe('email');
      expect(emailLog.get('status')).toBe('sent');
      expect(emailLog.get('metadata')).toEqual({});
      expect(emailLog.get('tags')).toEqual([]);
      expect(emailLog.get('active')).toBe(true);
      expect(emailLog.get('exists')).toBe(true);
    });
  });

  describe('EmailLog Queries', () => {
    beforeEach(async () => {
      // Create multiple test email logs
      const logs = [
        {
          recipientEmail: 'emaillog@amexing.test',
          recipientUser: testUser,
          notificationType: 'welcome',
          subject: 'Welcome Email',
          status: 'sent',
          metadata: { test: 1 },
        },
        {
          recipientEmail: 'emaillog@amexing.test',
          recipientUser: testUser,
          notificationType: 'booking_confirmation',
          subject: 'Booking 1',
          status: 'sent',
          metadata: { bookingId: 'B-001', quoteId: 'Q-001' },
        },
        {
          recipientEmail: 'emaillog@amexing.test',
          recipientUser: testUser,
          notificationType: 'booking_confirmation',
          subject: 'Booking 2',
          status: 'delivered',
          metadata: { bookingId: 'B-002', clientId: 'C-001' },
        },
        {
          recipientEmail: 'emaillog@amexing.test',
          recipientUser: testUser,
          notificationType: 'password_reset',
          subject: 'Password Reset',
          status: 'failed',
          error: 'SMTP error',
        },
      ];

      for (const logData of logs) {
        const emailLog = EmailLog.create(logData);
        await emailLog.save(null, { useMasterKey: true });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should retrieve emails by recipient user', async () => {
      const logs = await EmailLog.getByRecipient(testUser.id);

      expect(logs).toBeDefined();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(4);

      logs.forEach(log => {
        expect(log.get('recipientEmail')).toBe('emaillog@amexing.test');
      });
    });

    it('should retrieve emails by email address', async () => {
      const logs = await EmailLog.getByEmail('emaillog@amexing.test');

      expect(logs).toBeDefined();
      expect(logs.length).toBe(4);
    });

    it('should retrieve emails by notification type', async () => {
      const logs = await EmailLog.getByType('booking_confirmation');

      expect(logs).toBeDefined();
      const testLogs = logs.filter(
        log => log.get('recipientEmail') === 'emaillog@amexing.test'
      );
      expect(testLogs.length).toBe(2);
    });

    it('should retrieve emails by metadata field', async () => {
      const logs = await EmailLog.getByMetadata('bookingId', 'B-001');

      expect(logs).toBeDefined();
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const log = logs.find(
        l => l.get('recipientEmail') === 'emaillog@amexing.test'
      );
      expect(log).toBeDefined();
      expect(log.get('metadata').bookingId).toBe('B-001');
    });

    it('should retrieve emails by clientId metadata', async () => {
      const logs = await EmailLog.getByMetadata('clientId', 'C-001');

      expect(logs).toBeDefined();
      const testLogs = logs.filter(
        log => log.get('recipientEmail') === 'emaillog@amexing.test'
      );
      expect(testLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve emails by status', async () => {
      const sentLogs = await EmailLog.getByStatus('sent');
      const failedLogs = await EmailLog.getByStatus('failed');

      expect(sentLogs).toBeDefined();
      expect(failedLogs).toBeDefined();

      const testFailed = failedLogs.filter(
        log => log.get('recipientEmail') === 'emaillog@amexing.test'
      );
      expect(testFailed.length).toBe(1);
      expect(testFailed[0].get('error')).toBe('SMTP error');
    });

    it('should support pagination with limit and skip', async () => {
      const page1 = await EmailLog.getByRecipient(testUser.id, {
        limit: 2,
        skip: 0,
      });
      const page2 = await EmailLog.getByRecipient(testUser.id, {
        limit: 2,
        skip: 2,
      });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should order results by sentAt descending', async () => {
      const logs = await EmailLog.getByRecipient(testUser.id);

      for (let i = 0; i < logs.length - 1; i++) {
        const current = logs[i].get('sentAt');
        const next = logs[i + 1].get('sentAt');
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });
  });

  describe('EmailLog Updates', () => {
    let emailLogId;

    beforeEach(async () => {
      const emailLog = EmailLog.create({
        messageId: 'msg_update_test',
        recipientEmail: 'emaillog@amexing.test',
        notificationType: 'test',
        subject: 'Test Update',
        status: 'sent',
      });

      await emailLog.save(null, { useMasterKey: true });
      emailLogId = emailLog.id;
    });

    it('should update email status to delivered', async () => {
      const updated = await EmailLog.updateStatus(emailLogId, 'delivered');

      expect(updated.get('status')).toBe('delivered');
      expect(updated.get('deliveredAt')).toBeDefined();
    });

    it('should update email status to failed with error', async () => {
      const updated = await EmailLog.updateStatus(emailLogId, 'failed', {
        error: 'Delivery failed',
      });

      expect(updated.get('status')).toBe('failed');
      expect(updated.get('error')).toBe('Delivery failed');
    });

    it('should update email status to bounced', async () => {
      const updated = await EmailLog.updateStatus(emailLogId, 'bounced');

      expect(updated.get('status')).toBe('bounced');
    });

    it('should set deliveredAt only once', async () => {
      const first = await EmailLog.updateStatus(emailLogId, 'delivered');
      const firstDeliveredAt = first.get('deliveredAt');

      await new Promise(resolve => setTimeout(resolve, 100));

      const second = await EmailLog.updateStatus(emailLogId, 'delivered');
      const secondDeliveredAt = second.get('deliveredAt');

      expect(firstDeliveredAt.getTime()).toBe(secondDeliveredAt.getTime());
    });
  });

  describe('EmailLog Search by MessageId', () => {
    it('should retrieve email by message ID', async () => {
      const emailLog = EmailLog.create({
        messageId: 'msg_unique_12345',
        recipientEmail: 'emaillog@amexing.test',
        notificationType: 'test',
        subject: 'Test',
      });

      await emailLog.save(null, { useMasterKey: true });

      const found = await EmailLog.getByMessageId('msg_unique_12345');

      expect(found).toBeDefined();
      expect(found.id).toBe(emailLog.id);
      expect(found.get('messageId')).toBe('msg_unique_12345');
    });

    it('should return null for non-existent message ID', async () => {
      const found = await EmailLog.getByMessageId('non_existent_id');

      expect(found).toBeNull();
    });
  });

  describe('EmailLog Statistics', () => {
    beforeEach(async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Create logs with different statuses and dates
      const logs = [
        { status: 'sent', createdAt: today },
        { status: 'sent', createdAt: today },
        { status: 'delivered', createdAt: today },
        { status: 'failed', createdAt: today },
        { status: 'sent', createdAt: yesterday },
      ];

      for (const logData of logs) {
        const emailLog = EmailLog.create({
          recipientEmail: 'emaillog@amexing.test',
          notificationType: 'test_stats',
          subject: 'Stats Test',
          status: logData.status,
        });

        const saved = await emailLog.save(null, { useMasterKey: true });

        // Manually update createdAt for testing
        if (logData.createdAt !== today) {
          saved.set('sentAt', logData.createdAt);
          await saved.save(null, { useMasterKey: true });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should retrieve overall statistics', async () => {
      const stats = await EmailLog.getStatistics({
        notificationType: 'test_stats',
      });

      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(5);
      expect(stats.byStatus).toBeDefined();
      expect(stats.byStatus.sent).toBeGreaterThanOrEqual(3);
      expect(stats.byStatus.delivered).toBeGreaterThanOrEqual(1);
      expect(stats.byStatus.failed).toBeGreaterThanOrEqual(1);
    });

    it('should filter statistics by date range', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stats = await EmailLog.getStatistics({
        startDate: today,
        notificationType: 'test_stats',
      });

      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(4); // Today's logs only
    });
  });

  describe('Email Masking (PCI DSS)', () => {
    it('should mask short emails', () => {
      expect(EmailLog.maskEmail('a@example.com')).toBe('***@example.com');
      expect(EmailLog.maskEmail('ab@example.com')).toBe('***@example.com');
    });

    it('should mask medium emails', () => {
      expect(EmailLog.maskEmail('abc@example.com')).toBe('a**c@example.com');
      expect(EmailLog.maskEmail('test@example.com')).toBe('t**t@example.com');
    });

    it('should mask long emails', () => {
      expect(EmailLog.maskEmail('longusername@example.com')).toBe(
        'l**e@example.com'
      );
    });

    it('should handle emails with dots', () => {
      expect(EmailLog.maskEmail('first.last@example.com')).toBe(
        'f**t@example.com'
      );
    });

    it('should handle invalid inputs', () => {
      expect(EmailLog.maskEmail('')).toBe('***');
      expect(EmailLog.maskEmail(null)).toBe('***');
      expect(EmailLog.maskEmail(undefined)).toBe('***');
      expect(EmailLog.maskEmail('invalid')).toBe('***');
    });
  });

  describe('Logical Deletion', () => {
    it('should exclude logically deleted records by default', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        notificationType: 'test_deletion',
        subject: 'Test Deletion',
      });

      await emailLog.save(null, { useMasterKey: true });

      // Logically delete
      emailLog.set('exists', false);
      await emailLog.save(null, { useMasterKey: true });

      // Query should exclude it
      const logs = await EmailLog.getByEmail('emaillog@amexing.test');
      const deleted = logs.find(log => log.id === emailLog.id);

      expect(deleted).toBeUndefined();
    });

    it('should include logically deleted records when requested', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        notificationType: 'test_deletion',
        subject: 'Test Deletion',
      });

      await emailLog.save(null, { useMasterKey: true });

      emailLog.set('exists', false);
      await emailLog.save(null, { useMasterKey: true });

      const logs = await EmailLog.getByEmail('emaillog@amexing.test', {
        includeDeleted: true,
      });
      const deleted = logs.find(log => log.id === emailLog.id);

      expect(deleted).toBeDefined();
      expect(deleted.get('exists')).toBe(false);
    });
  });

  describe('Multi-Channel Support', () => {
    it('should support email channel', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        channel: 'email',
        notificationType: 'test',
        subject: 'Test',
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.get('channel')).toBe('email');
    });

    it('should support future push channel', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        channel: 'push',
        notificationType: 'test',
        subject: 'Test',
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.get('channel')).toBe('push');
    });

    it('should support future SMS channel', async () => {
      const emailLog = EmailLog.create({
        recipientEmail: 'emaillog@amexing.test',
        channel: 'sms',
        notificationType: 'test',
        subject: 'Test',
      });

      await emailLog.save(null, { useMasterKey: true });

      expect(emailLog.get('channel')).toBe('sms');
    });
  });
});
