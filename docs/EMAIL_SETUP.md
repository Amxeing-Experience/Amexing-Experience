# MailerSend Email Service Setup

This document provides instructions for setting up MailerSend email integration in the Amexing System.

## Overview

The Amexing System uses MailerSend as the email service provider for sending transactional emails including:

- Welcome emails for new user registrations
- Password reset emails
- Email verification emails
- Other system notifications

## Environment Configuration

### Required Environment Variables

Add the following environment variables to your `.env` files:

```bash
# MailerSend Configuration
MAILERSEND_API_TOKEN=your-mailersend-api-token-here
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your System Name
```

### Getting Your MailerSend API Token

1. Sign up for a MailerSend account at https://www.mailersend.com/
2. Navigate to your dashboard
3. Go to Settings > API Tokens
4. Create a new API token with appropriate permissions:
   - Email: Send emails
   - Domains: View domains (if needed)
5. Copy the API token and add it to your environment configuration

### Domain Verification

Before sending emails, you need to verify your sending domain in MailerSend:

1. In your MailerSend dashboard, go to Domains
2. Add your domain (e.g., yourdomain.com)
3. Follow the DNS verification steps:
   - Add the required DNS records (TXT, MX, CNAME)
   - Wait for DNS propagation (can take up to 24 hours)
   - Verify the domain in the dashboard

## Email Templates

The EmailService includes pre-built templates for:

### Welcome Email
- **Subject**: Welcome to Amexing System
- **Usage**: Sent automatically when new users register
- **Variables**: name, role
- **Tags**: welcome, onboarding

### Password Reset Email
- **Subject**: Password Reset Request - Amexing System
- **Usage**: Sent when users request password reset
- **Variables**: name, resetUrl
- **Tags**: password-reset, security

### Email Verification Email
- **Subject**: Verify Your Email Address - Amexing System
- **Usage**: Sent for email address verification
- **Variables**: name, verificationUrl
- **Tags**: email-verification, security

## Security Features

### PCI DSS Compliance
- Email addresses are masked in logs for privacy
- No sensitive data is logged in error messages
- Secure API token handling

### Error Handling
- Graceful degradation when email service is unavailable
- Comprehensive error logging without sensitive data exposure
- Asynchronous email sending to avoid blocking user operations

## Usage Examples

### Sending a Custom Email

```javascript
const emailService = require('./src/application/services/EmailService');

const emailData = {
  to: 'user@example.com',
  toName: 'John Doe',
  subject: 'Your Custom Subject',
  html: '<h1>Hello World</h1>',
  text: 'Hello World',
  tags: ['custom', 'notification']
};

const result = await emailService.sendEmail(emailData);

if (result.success) {
  console.log('Email sent successfully:', result.messageId);
} else {
  console.error('Failed to send email:', result.error);
}
```

### Checking Service Availability

```javascript
if (emailService.isAvailable()) {
  // Email service is configured and ready
  await emailService.sendWelcomeEmail(userData);
} else {
  console.warn('Email service not available');
}
```

## Integration Points

The EmailService is automatically integrated with:

### User Registration
- **File**: `src/application/controllers/authController.js`
- **Method**: `register()`
- **Trigger**: After successful user creation
- **Email Type**: Welcome email

### User Management Service
- **File**: `src/application/services/UserManagementService.js`
- **Method**: `createUser()`
- **Trigger**: When administrators create new users
- **Email Type**: Welcome email

## Testing

### Running Email Service Tests

```bash
# Run unit tests for EmailService
yarn test:unit tests/unit/services/EmailService.test.js

# Run all tests
yarn test
```

### Test Environment

The EmailService tests use mocked MailerSend dependencies and don't require actual API credentials for testing.

## Troubleshooting

### Email Service Not Available

1. Check that `MAILERSEND_API_TOKEN` is set and not the placeholder value
2. Verify the API token is valid and has proper permissions
3. Check that your domain is verified in MailerSend dashboard
4. Review application logs for initialization errors

### Emails Not Being Received

1. Check spam/junk folders
2. Verify the recipient email address is valid
3. Check MailerSend dashboard for delivery status
4. Ensure your sending domain has proper SPF/DKIM records

### Rate Limiting

MailerSend has rate limits based on your plan. Monitor your usage in the dashboard and upgrade your plan if needed.

## Environment-Specific Configuration

### Development
```bash
MAILERSEND_API_TOKEN=your-dev-token
EMAIL_FROM=noreply@dev.yourdomain.com
EMAIL_FROM_NAME=Amexing Development System
```

### Production
```bash
MAILERSEND_API_TOKEN=your-prod-token
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Amexing System
```

## Support

For MailerSend-specific issues:
- MailerSend Documentation: https://developers.mailersend.com/
- MailerSend Support: https://www.mailersend.com/help

For integration issues, check the application logs and verify your environment configuration.

---

Created by Denisse Maldonado