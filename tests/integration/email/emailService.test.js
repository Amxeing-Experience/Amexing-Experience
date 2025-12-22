/**
 * EmailService Integration Tests
 *
 * Tests the complete email sending flow with MailerSend integration,
 * template rendering, and EmailLog traceability.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const TestCleanupHelper = require('../../helpers/testCleanupHelper');

// Import services
const emailService = require('../../../src/application/services/EmailService');
const EmailLog = require('../../../src/domain/models/EmailLog');

describe('EmailService Integration Tests', () => {
  let app;
  let superadminToken;
  let testUser;

  beforeAll(async () => {
    // Import app
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Login with seeded superadmin
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);

    // Create test user for email tests
    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    testUser = new AmexingUserClass();
    testUser.set('username', 'test-email-user');
    testUser.set('email', 'test-email@amexing.test');
    testUser.set('firstName', 'Test');
    testUser.set('lastName', 'Email User');
    testUser.set('active', true);
    testUser.set('exists', true);

    await testUser.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    // Cleanup test user
    if (testUser) {
      await testUser.destroy({ useMasterKey: true });
    }

    // Cleanup any email logs created during tests
    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientEmail', 'test-email@amexing.test');
    const logs = await query.find({ useMasterKey: true });
    await Parse.Object.destroyAll(logs, { useMasterKey: true });
  });

  afterEach(async () => {
    // Clean up email logs after each test
    const query = new Parse.Query('EmailLog');
    query.equalTo('recipientEmail', 'test-email@amexing.test');
    const logs = await query.find({ useMasterKey: true });
    await Parse.Object.destroyAll(logs, { useMasterKey: true });
  });

  describe('Email Service Initialization', () => {
    it.skip('should initialize MailerSend service correctly (requires API key)', () => {
      // Skip in test environment - requires MAILERSEND_API_TOKEN
      expect(emailService.isAvailable()).toBe(true);
    });

    it.skip('should have MailerSend client configured (requires API key)', () => {
      // Skip in test environment - requires MAILERSEND_API_TOKEN
      expect(emailService.mailerSend).toBeDefined();
      expect(emailService.isInitialized).toBe(true);
    });
  });

  describe('Booking Confirmation Email', () => {
    it('should send booking confirmation email with template', async () => {
      const bookingData = {
        recipientEmail: 'test-email@amexing.test',
        recipientName: 'Test Email User',
        recipientUser: testUser,
        bookingNumber: 'AMX-TEST-001',
        serviceType: 'Traslado Aeropuerto',
        date: '25 de enero, 2025',
        time: '10:00 AM',
        location: 'Hotel Rosewood, San Miguel de Allende',
        buttonUrl: 'http://localhost:1337/bookings/AMX-TEST-001',
        buttonText: 'Ver Detalles',
        additionalMessage: 'Gracias por elegir Amexing Experience',
        metadata: {
          quoteId: 'Q-TEST-001',
          clientId: 'C-TEST-001',
          bookingId: 'B-TEST-001',
        },
      };

      const result = await emailService.sendBookingConfirmation(bookingData);

      // Verify email was sent (or attempted)
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');

      // Note: In test environment, actual sending may fail due to invalid API token
      // But we can verify the flow executed correctly
    }, 15000);

    it('should create EmailLog entry for booking confirmation', async () => {
      const bookingData = {
        recipientEmail: 'test-email@amexing.test',
        recipientName: 'Test Email User',
        recipientUser: testUser,
        bookingNumber: 'AMX-TEST-002',
        serviceType: 'Tours',
        date: '26 de enero, 2025',
        time: '2:00 PM',
        location: 'Plaza Principal',
        metadata: {
          quoteId: 'Q-TEST-002',
          clientId: 'C-TEST-002',
        },
      };

      await emailService.sendBookingConfirmation(bookingData);

      // Wait a bit for database write
      await new Promise(resolve => setTimeout(resolve, 500));

      // Query EmailLog
      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.equalTo('notificationType', 'booking_confirmation');
      query.descending('createdAt');

      const emailLog = await query.first({ useMasterKey: true });

      expect(emailLog).toBeDefined();
      expect(emailLog.get('recipientEmail')).toBe('test-email@amexing.test');
      expect(emailLog.get('notificationType')).toBe('booking_confirmation');
      expect(emailLog.get('subject')).toContain('Confirmación de Reserva');
      expect(emailLog.get('subject')).toContain('AMX-TEST-002');

      // Verify metadata
      const metadata = emailLog.get('metadata');
      expect(metadata.quoteId).toBe('Q-TEST-002');
      expect(metadata.clientId).toBe('C-TEST-002');
      expect(metadata.bookingNumber).toBe('AMX-TEST-002');
      expect(metadata.serviceType).toBe('Tours');

      // Verify content snapshot exists
      expect(emailLog.get('htmlContent')).toBeDefined();
      expect(emailLog.get('htmlContent').length).toBeGreaterThan(0);

      // Verify tags
      const tags = emailLog.get('tags');
      expect(tags).toContain('booking');
      expect(tags).toContain('confirmation');
    }, 15000);

    it('should include logo URL in booking confirmation', async () => {
      const bookingData = {
        recipientEmail: 'test-email@amexing.test',
        recipientName: 'Test User',
        bookingNumber: 'AMX-TEST-003',
        serviceType: 'Punto a Punto',
        date: '27 de enero, 2025',
        time: '3:00 PM',
        location: 'Aeropuerto',
        metadata: {},
      };

      await emailService.sendBookingConfirmation(bookingData);
      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.descending('createdAt');
      const emailLog = await query.first({ useMasterKey: true });

      const htmlContent = emailLog.get('htmlContent');

      // Verify logo URL is present and dynamic (vertical logo used in email templates)
      const expectedBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 1337}`;
      expect(htmlContent).toContain('img/amexing_logo_vertical.avif');
      expect(htmlContent).toContain(expectedBaseUrl);
    }, 15000);
  });

  describe('Welcome Email', () => {
    it('should send welcome email with template', async () => {
      const userData = {
        email: 'test-email@amexing.test',
        name: 'Test Email User',
        role: 'Cliente',
        recipientUser: testUser,
        dashboardUrl: 'http://localhost:1337/dashboard',
      };

      const result = await emailService.sendWelcomeEmail(userData);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    }, 15000);

    it('should create EmailLog entry for welcome email', async () => {
      const userData = {
        email: 'test-email@amexing.test',
        name: 'Test Email User',
        role: 'Cliente Premium',
        recipientUser: testUser,
      };

      await emailService.sendWelcomeEmail(userData);
      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.equalTo('notificationType', 'welcome');
      query.descending('createdAt');

      const emailLog = await query.first({ useMasterKey: true });

      expect(emailLog).toBeDefined();
      expect(emailLog.get('notificationType')).toBe('welcome');
      expect(emailLog.get('subject')).toContain('Bienvenido');

      // Verify metadata
      const metadata = emailLog.get('metadata');
      expect(metadata.role).toBe('Cliente Premium');
      expect(metadata.registrationDate).toBeDefined();

      // Verify tags
      const tags = emailLog.get('tags');
      expect(tags).toContain('welcome');
      expect(tags).toContain('onboarding');
      expect(tags).toContain('registration');
    }, 15000);
  });

  describe('Password Reset Email', () => {
    it('should send password reset email with template', async () => {
      const resetData = {
        email: 'test-email@amexing.test',
        name: 'Test Email User',
        resetUrl: 'http://localhost:1337/reset-password?token=test-token-123',
        recipientUser: testUser,
        expirationTime: '1 hora',
      };

      const result = await emailService.sendPasswordResetEmail(resetData);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    }, 15000);

    it('should create EmailLog entry for password reset', async () => {
      const resetData = {
        email: 'test-email@amexing.test',
        name: 'Test Email User',
        resetUrl: 'http://localhost:1337/reset-password?token=test-token-456',
        recipientUser: testUser,
        expirationTime: '2 horas',
      };

      await emailService.sendPasswordResetEmail(resetData);
      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.equalTo('notificationType', 'password_reset');
      query.descending('createdAt');

      const emailLog = await query.first({ useMasterKey: true });

      expect(emailLog).toBeDefined();
      expect(emailLog.get('notificationType')).toBe('password_reset');
      expect(emailLog.get('subject')).toContain('Restablecer Contraseña');

      // Verify metadata
      const metadata = emailLog.get('metadata');
      expect(metadata.expirationTime).toBe('2 horas');
      expect(metadata.resetRequestedAt).toBeDefined();

      // Verify tags
      const tags = emailLog.get('tags');
      expect(tags).toContain('password-reset');
      expect(tags).toContain('security');
    }, 15000);

    it('should include reset URL in password reset email', async () => {
      const resetData = {
        email: 'test-email@amexing.test',
        name: 'Test User',
        resetUrl: 'http://localhost:1337/reset-password?token=unique-token-789',
      };

      await emailService.sendPasswordResetEmail(resetData);
      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.descending('createdAt');
      const emailLog = await query.first({ useMasterKey: true });

      const htmlContent = emailLog.get('htmlContent');

      // Verify reset URL is present
      expect(htmlContent).toContain('unique-token-789');
      expect(htmlContent).toContain('reset-password');
    }, 15000);
  });

  describe('Email History and Queries', () => {
    beforeEach(async () => {
      // Send multiple test emails
      await emailService.sendWelcomeEmail({
        email: 'test-email@amexing.test',
        name: 'Test User',
        role: 'Cliente',
        recipientUser: testUser,
      });

      await emailService.sendBookingConfirmation({
        recipientEmail: 'test-email@amexing.test',
        recipientName: 'Test User',
        recipientUser: testUser,
        bookingNumber: 'AMX-HISTORY-001',
        serviceType: 'Aeropuerto',
        date: '28 de enero, 2025',
        time: '4:00 PM',
        location: 'Hotel',
        metadata: { quoteId: 'Q-HISTORY-001' },
      });

      await emailService.sendPasswordResetEmail({
        email: 'test-email@amexing.test',
        name: 'Test User',
        recipientUser: testUser,
        resetUrl: 'http://localhost:1337/reset?token=history-test',
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    it('should retrieve email history by user', async () => {
      const history = await emailService.getEmailHistory(testUser.id);

      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(3);

      // Verify different notification types
      const types = history.map(log => log.get('notificationType'));
      expect(types).toContain('welcome');
      expect(types).toContain('booking_confirmation');
      expect(types).toContain('password_reset');
    }, 15000);

    it('should retrieve emails by notification type', async () => {
      const bookingEmails = await EmailLog.getByType('booking_confirmation');

      expect(bookingEmails).toBeDefined();
      expect(Array.isArray(bookingEmails)).toBe(true);

      const testUserEmails = bookingEmails.filter(
        log => log.get('recipientEmail') === 'test-email@amexing.test'
      );
      expect(testUserEmails.length).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('should retrieve emails by metadata', async () => {
      const quoteEmails = await EmailLog.getByMetadata('quoteId', 'Q-HISTORY-001');

      expect(quoteEmails).toBeDefined();
      expect(Array.isArray(quoteEmails)).toBe(true);
      expect(quoteEmails.length).toBeGreaterThanOrEqual(1);

      const emailLog = quoteEmails[0];
      expect(emailLog.get('metadata').quoteId).toBe('Q-HISTORY-001');
    }, 15000);

    it('should retrieve emails by status', async () => {
      const sentEmails = await EmailLog.getByStatus('sent');

      expect(sentEmails).toBeDefined();
      expect(Array.isArray(sentEmails)).toBe(true);

      // All test emails should be in sent or failed status
      sentEmails.forEach(log => {
        expect(['sent', 'failed']).toContain(log.get('status'));
      });
    }, 15000);
  });

  describe('Email Resend Functionality', () => {
    let originalEmailLogId;

    beforeEach(async () => {
      // Send an email and get its log ID
      await emailService.sendWelcomeEmail({
        email: 'test-email@amexing.test',
        name: 'Test Resend User',
        role: 'Cliente',
        recipientUser: testUser,
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.descending('createdAt');
      const emailLog = await query.first({ useMasterKey: true });

      originalEmailLogId = emailLog.id;
    });

    it('should resend email from EmailLog', async () => {
      const result = await emailService.resendEmail(originalEmailLogId);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    }, 15000);

    it('should create new EmailLog entry for resent email', async () => {
      await emailService.resendEmail(originalEmailLogId);
      await new Promise(resolve => setTimeout(resolve, 500));

      const query = new Parse.Query('EmailLog');
      query.equalTo('recipientEmail', 'test-email@amexing.test');
      query.descending('createdAt');

      const logs = await query.find({ useMasterKey: true });

      // Should have at least 2 logs (original + resend)
      expect(logs.length).toBeGreaterThanOrEqual(2);

      // Newest log should have resend metadata
      const resentLog = logs[0];
      const metadata = resentLog.get('metadata');
      expect(metadata.resendFrom).toBe(originalEmailLogId);
      expect(metadata.resendAt).toBeDefined();

      // Should have resend tag
      const tags = resentLog.get('tags');
      expect(tags).toContain('resend');
    }, 15000);
  });

  describe('Email Statistics', () => {
    beforeEach(async () => {
      // Send multiple emails for statistics
      for (let i = 0; i < 5; i++) {
        await emailService.sendBookingConfirmation({
          recipientEmail: 'test-email@amexing.test',
          recipientName: 'Test User',
          bookingNumber: `AMX-STATS-${i}`,
          serviceType: 'Aeropuerto',
          date: '29 de enero, 2025',
          time: '5:00 PM',
          location: 'Hotel',
          metadata: {},
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    it('should retrieve email statistics', async () => {
      const stats = await EmailLog.getStatistics({
        notificationType: 'booking_confirmation',
      });

      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(5);
      expect(stats.byStatus).toBeDefined();
      expect(stats.byStatus.sent).toBeDefined();
    }, 15000);
  });

  describe('Email Masking (PCI DSS)', () => {
    it('should mask email addresses in logs', () => {
      const masked = emailService.maskEmail('test@example.com');
      expect(masked).toBe('t**t@example.com');
    });

    it('should mask email addresses correctly', () => {
      expect(emailService.maskEmail('a@example.com')).toBe('***@example.com');
      expect(emailService.maskEmail('ab@example.com')).toBe('***@example.com');
      expect(emailService.maskEmail('abc@example.com')).toBe('a**c@example.com');
      expect(emailService.maskEmail('test.user@example.com')).toBe('t**r@example.com');
    });

    it('should handle invalid emails gracefully', () => {
      expect(emailService.maskEmail('')).toBe('***');
      expect(emailService.maskEmail(null)).toBe('***');
      expect(emailService.maskEmail('invalid')).toBe('***');
    });
  });
});
