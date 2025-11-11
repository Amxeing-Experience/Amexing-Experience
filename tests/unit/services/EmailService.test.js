/**
 * EmailService Unit Tests
 * Tests for MailerSend integration and email functionality
 * 
 * Created by Denisse Maldonado
 */

// Mock MailerSend before requiring EmailService
jest.mock('mailersend', () => {
  return {
    MailerSend: jest.fn().mockImplementation(() => ({
      email: {
        send: jest.fn()
      }
    })),
    EmailParams: jest.fn().mockImplementation(() => ({
      setFrom: jest.fn().mockReturnThis(),
      setTo: jest.fn().mockReturnThis(),
      setSubject: jest.fn().mockReturnThis(),
      setHtml: jest.fn().mockReturnThis(),
      setText: jest.fn().mockReturnThis(),
      setTags: jest.fn().mockReturnThis()
    })),
    Sender: jest.fn(),
    Recipient: jest.fn()
  };
});

describe('EmailService', () => {
  let EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables before requiring EmailService
    process.env.MAILERSEND_API_TOKEN = 'test-api-token';
    process.env.EMAIL_FROM = 'test@example.com';
    process.env.EMAIL_FROM_NAME = 'Test System';
    
    // Clear module cache and require fresh instance
    jest.resetModules();
    EmailService = require('../../../src/application/services/EmailService');
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.MAILERSEND_API_TOKEN;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    // Restore any mocks
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid API token', () => {
      // EmailService is a singleton, it's already initialized
      expect(EmailService.isAvailable()).toBe(true);
    });

    it('should handle missing API token gracefully', () => {
      // Set invalid token and reset modules
      process.env.MAILERSEND_API_TOKEN = 'your-mailersend-api-token-change-this';
      jest.resetModules();
      
      const TestEmailService = require('../../../src/application/services/EmailService');
      
      // The service should handle missing token gracefully
      expect(typeof TestEmailService).toBe('object');
      expect(TestEmailService.isAvailable()).toBe(false);
    });
  });

  describe('Email Validation', () => {
    it('should validate required email fields', async () => {
      const result = await EmailService.sendEmail({
        to: '',
        subject: '',
        html: ''
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required email fields');
    });

    it('should require either text or html content', async () => {
      const result = await EmailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required email fields');
    });
  });

  describe('Welcome Email', () => {
    it('should send welcome email successfully', async () => {
      // Create mock implementation with proper return value
      const mockSend = jest.fn().mockResolvedValue({
        body: { message_id: 'test-message-id' }
      });
      
      // Mock the EmailService sendEmail method directly
      jest.spyOn(EmailService, 'sendEmail').mockResolvedValue({
        success: true,
        messageId: 'test-message-id'
      });

      const userData = {
        email: 'newuser@example.com',
        name: 'New User',
        role: 'user'
      };

      const result = await EmailService.sendWelcomeEmail(userData);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-message-id');
    });

    it('should handle welcome email failure gracefully', async () => {
      // Mock the EmailService sendEmail method to return failure
      jest.spyOn(EmailService, 'sendEmail').mockResolvedValue({
        success: false,
        error: 'API Error'
      });

      const userData = {
        email: 'newuser@example.com',
        name: 'New User',
        role: 'user'
      };

      const result = await EmailService.sendWelcomeEmail(userData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error');
    });
  });

  describe('Password Reset Email', () => {
    it('should send password reset email', async () => {
      // Mock the EmailService sendEmail method directly
      jest.spyOn(EmailService, 'sendEmail').mockResolvedValue({
        success: true,
        messageId: 'reset-message-id'
      });

      const resetData = {
        email: 'user@example.com',
        name: 'Test User',
        resetToken: 'reset-token-123',
        resetUrl: 'https://example.com/reset?token=reset-token-123'
      };

      const result = await EmailService.sendPasswordResetEmail(resetData);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('reset-message-id');
    });
  });

  describe('Email Verification', () => {
    it('should send email verification email', async () => {
      // Mock the EmailService sendEmail method directly
      jest.spyOn(EmailService, 'sendEmail').mockResolvedValue({
        success: true,
        messageId: 'verify-message-id'
      });

      const verificationData = {
        email: 'user@example.com',
        name: 'Test User',
        verificationUrl: 'https://example.com/verify?token=verify-token-123'
      };

      const result = await EmailService.sendEmailVerification(verificationData);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('verify-message-id');
    });
  });

  describe('Email Masking (PCI DSS Compliance)', () => {
    it('should mask email addresses correctly', () => {
      expect(EmailService.maskEmail('test@example.com')).toBe('t**t@example.com');
      expect(EmailService.maskEmail('a@example.com')).toBe('*@example.com');
      expect(EmailService.maskEmail('ab@example.com')).toBe('**@example.com');
      expect(EmailService.maskEmail('abc@example.com')).toBe('a*c@example.com');
    });

    it('should handle invalid email addresses', () => {
      expect(EmailService.maskEmail('')).toBe('invalid-email');
      expect(EmailService.maskEmail('invalid')).toBe('invalid-email');
      expect(EmailService.maskEmail(null)).toBe('invalid-email');
      expect(EmailService.maskEmail(undefined)).toBe('invalid-email');
    });
  });

  describe('Email Templates', () => {
    it('should generate HTML welcome email template', () => {
      const html = EmailService.generateWelcomeEmailHTML('Test User', 'admin');
      
      expect(html).toContain('Welcome to Amexing System');
      expect(html).toContain('Test User');
      expect(html).toContain('admin');
      expect(html).toContain('DOCTYPE html');
    });

    it('should generate text welcome email template', () => {
      const text = EmailService.generateWelcomeEmailText('Test User', 'admin');
      
      expect(text).toContain('Welcome to Amexing System');
      expect(text).toContain('Test User');
      expect(text).toContain('admin');
    });

    it('should generate password reset email templates', () => {
      const resetUrl = 'https://example.com/reset?token=123';
      const html = EmailService.generatePasswordResetEmailHTML('Test User', resetUrl);
      const text = EmailService.generatePasswordResetEmailText('Test User', resetUrl);
      
      expect(html).toContain('Password Reset Request');
      expect(html).toContain('Test User');
      expect(html).toContain(resetUrl);
      
      expect(text).toContain('Password Reset Request');
      expect(text).toContain('Test User');
      expect(text).toContain(resetUrl);
    });

    it('should generate email verification templates', () => {
      const verificationUrl = 'https://example.com/verify?token=123';
      const html = EmailService.generateEmailVerificationHTML('Test User', verificationUrl);
      const text = EmailService.generateEmailVerificationText('Test User', verificationUrl);
      
      expect(html).toContain('Verify Your Email Address');
      expect(html).toContain('Test User');
      expect(html).toContain(verificationUrl);
      
      expect(text).toContain('Verify Your Email Address');
      expect(text).toContain('Test User');
      expect(text).toContain(verificationUrl);
    });
  });
});