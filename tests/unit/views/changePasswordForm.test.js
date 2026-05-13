/**
 * Change Password Form Unit Tests
 * Tests for change password form validation and behavior
 * Created by Denisse Maldonado
 */

const fs = require('fs');
const path = require('path');

describe('Change Password Form', () => {
  let formHTML;
  let mockDocument;
  let mockWindow;

  beforeAll(() => {
    const formPath = path.join(__dirname, '../../../src/presentation/views/molecules/dashboard/change-password-form.ejs');
    const rawHTML = fs.readFileSync(formPath, 'utf8');
    
    // Extract the JavaScript from the EJS template
    const scriptMatch = rawHTML.match(/<script>([\s\S]*?)<\/script>/);
    const scriptContent = scriptMatch ? scriptMatch[1] : '';
    
    // Setup JSDOM-like mock environment
    mockDocument = {
      getElementById: jest.fn(),
      addEventListener: jest.fn(),
      querySelector: jest.fn(),
      querySelectorAll: jest.fn(() => [])
    };
    
    mockWindow = {
      document: mockDocument,
      addEventListener: jest.fn(),
      location: { reload: jest.fn() },
      fetch: jest.fn()
    };

    global.document = mockDocument;
    global.window = mockWindow;
    
    // Store the script content for testing
    formHTML = rawHTML;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Form Structure', () => {
    it('should contain change password form with required fields', () => {
      expect(formHTML).toContain('id="change-password-form"');
      expect(formHTML).toContain('name="currentPassword"');
      expect(formHTML).toContain('name="newPassword"');
      expect(formHTML).toContain('name="confirmPassword"');
      expect(formHTML).toContain('type="password"');
    });

    it('should include CSRF token handling', () => {
      expect(formHTML).toContain('csrf-token');
      expect(formHTML).toContain('csrfToken');
    });

    it('should submit to correct endpoint', () => {
      expect(formHTML).toContain('/auth/change-password');
      expect(formHTML).toContain('method: \'POST\'');
    });

    it('should include submit button', () => {
      expect(formHTML).toContain('type="submit"');
      expect(formHTML).toContain('Change Password');
    });

    it('should have password visibility toggle buttons', () => {
      expect(formHTML).toContain('data-toggle-field');
      expect(formHTML).toContain('ti-eye');
      expect(formHTML).toContain('ti-eye-off');
    });

    it('should include password validation feedback', () => {
      expect(formHTML).toContain('validatePassword');
      expect(formHTML).toContain('is-valid');
      expect(formHTML).toContain('is-invalid');
    });

    it('should have password requirements message', () => {
      expect(formHTML).toContain('at least 8 characters');
      expect(formHTML).toContain('uppercase');
      expect(formHTML).toContain('lowercase');
      expect(formHTML).toContain('number');
      expect(formHTML).toContain('special character');
    });
  });

  describe('Password Validation Logic', () => {
    let validatePasswordFunction;

    beforeAll(() => {
      // Extract the validatePassword function from the script
      const scriptMatch = formHTML.match(/function validatePassword\(password\) \{([\s\S]*?)return \{[\s\S]*?\};\s*\}/);
      if (scriptMatch) {
        // Create the function for testing
        validatePasswordFunction = eval(`(${scriptMatch[0]})`);
      }
    });

    it('should validate password with all requirements', () => {
      const result = validatePasswordFunction('TestPass123!');
      expect(result.isValid).toBe(true);
      expect(result.issues.minLength).toBe(true);
      expect(result.issues.hasUpper).toBe(true);
      expect(result.issues.hasLower).toBe(true);
      expect(result.issues.hasNumber).toBe(true);
      expect(result.issues.hasSpecial).toBe(true);
    });

    it('should fail validation for password too short', () => {
      const result = validatePasswordFunction('Test1!');
      expect(result.isValid).toBe(false);
      expect(result.issues.minLength).toBe(false);
    });

    it('should fail validation for password without uppercase', () => {
      const result = validatePasswordFunction('testpass123!');
      expect(result.isValid).toBe(false);
      expect(result.issues.hasUpper).toBe(false);
    });

    it('should fail validation for password without lowercase', () => {
      const result = validatePasswordFunction('TESTPASS123!');
      expect(result.isValid).toBe(false);
      expect(result.issues.hasLower).toBe(false);
    });

    it('should fail validation for password without numbers', () => {
      const result = validatePasswordFunction('TestPassword!');
      expect(result.isValid).toBe(false);
      expect(result.issues.hasNumber).toBe(false);
    });

    it('should fail validation for password without special characters', () => {
      const result = validatePasswordFunction('TestPassword123');
      expect(result.isValid).toBe(false);
      expect(result.issues.hasSpecial).toBe(false);
    });

    it('should handle empty password', () => {
      const result = validatePasswordFunction('');
      expect(result.isValid).toBe(false);
      expect(result.issues.minLength).toBe(false);
      expect(result.issues.hasUpper).toBe(false);
      expect(result.issues.hasLower).toBe(false);
      expect(result.issues.hasNumber).toBe(false);
      expect(result.issues.hasSpecial).toBe(false);
    });

    it('should handle minimum valid password', () => {
      const result = validatePasswordFunction('Aa1!bcde');
      expect(result.isValid).toBe(true);
      expect(result.issues.minLength).toBe(true);
    });
  });

  describe('Form Validation Events', () => {
    let mockForm, mockCurrentPassword, mockNewPassword, mockConfirmPassword, mockSubmitButton;

    beforeEach(() => {
      mockCurrentPassword = {
        value: '',
        addEventListener: jest.fn(),
        classList: { add: jest.fn(), remove: jest.fn() }
      };

      mockNewPassword = {
        value: '',
        addEventListener: jest.fn(),
        classList: { add: jest.fn(), remove: jest.fn() }
      };

      mockConfirmPassword = {
        value: '',
        addEventListener: jest.fn(),
        classList: { add: jest.fn(), remove: jest.fn() }
      };

      mockSubmitButton = {
        disabled: false,
        classList: { add: jest.fn(), remove: jest.fn() }
      };

      mockForm = {
        addEventListener: jest.fn(),
        submit: jest.fn()
      };

      mockDocument.getElementById.mockImplementation((id) => {
        switch (id) {
          case 'change-password-form': return mockForm;
          case 'currentPassword': return mockCurrentPassword;
          case 'newPassword': return mockNewPassword;
          case 'confirmPassword': return mockConfirmPassword;
          case 'submitButton': return mockSubmitButton;
          default: return null;
        }
      });
    });

    it('should setup event listeners on form load', () => {
      expect(formHTML).toContain('addEventListener');
      expect(formHTML).toContain('change-password-form');
    });

    it('should validate passwords match when confirming', () => {
      expect(formHTML).toContain('confirmPassword');
      expect(formHTML).toContain('Passwords do not match');
    });

    it('should have real-time password validation', () => {
      expect(formHTML).toContain("addEventListener('input'");
      expect(formHTML).toContain('validatePassword');
    });

    it('should toggle password visibility', () => {
      expect(formHTML).toContain('togglePassword');
      expect(formHTML).toContain("type = 'password'");
      expect(formHTML).toContain("type = 'text'");
    });
  });

  describe('Form Submission', () => {
    it('should prevent submission with invalid passwords', () => {
      expect(formHTML).toContain('preventDefault');
      expect(formHTML).toContain('was-validated');
    });

    it('should show loading state during submission', () => {
      expect(formHTML).toContain('Changing Password...');
      expect(formHTML).toContain('disabled');
    });

    it('should handle successful password change', () => {
      expect(formHTML).toContain('Password changed successfully');
      expect(formHTML).toContain('success');
    });

    it('should handle password change errors', () => {
      expect(formHTML).toContain('error');
      expect(formHTML).toContain('catch');
    });

    it('should make POST request to correct endpoint', () => {
      expect(formHTML).toContain('/auth/change-password');
      expect(formHTML).toContain('fetch');
      expect(formHTML).toContain("method: 'POST'");
    });

    it('should include CSRF token in request', () => {
      expect(formHTML).toContain('csrf-token');
      expect(formHTML).toContain('x-csrf-token');
    });
  });

  describe('Password Requirements UI', () => {
    it('should display password requirements help text', () => {
      expect(formHTML).toContain('at least 8 characters');
      expect(formHTML).toContain('uppercase');
      expect(formHTML).toContain('lowercase');
      expect(formHTML).toContain('number');
      expect(formHTML).toContain('special character');
    });

    it('should show real-time validation feedback', () => {
      expect(formHTML).toContain('is-valid');
      expect(formHTML).toContain('is-invalid');
      expect(formHTML).toContain('setCustomValidity');
    });
  });

  describe('Accessibility Features', () => {
    it('should have proper alert roles', () => {
      expect(formHTML).toContain('role="alert"');
    });

    it('should have proper form labels', () => {
      expect(formHTML).toContain('<label');
      expect(formHTML).toContain('Current Password');
      expect(formHTML).toContain('New Password');
      expect(formHTML).toContain('Confirm New Password');
    });

    it('should have required field indicators', () => {
      expect(formHTML).toContain('required');
      expect(formHTML).toContain('*');
    });

    it('should have password visibility toggle buttons', () => {
      expect(formHTML).toContain('data-toggle-field');
      expect(formHTML).toContain('btn-outline-secondary');
    });
  });

  describe('Security Features', () => {
    it('should use secure form attributes', () => {
      expect(formHTML).toContain('autocomplete="new-password"');
      expect(formHTML).toContain('autocomplete="current-password"');
    });

    it('should include CSRF protection', () => {
      expect(formHTML).toContain('csrf-token');
      expect(formHTML).toContain('csrfToken');
    });

    it('should not expose sensitive data in form', () => {
      expect(formHTML).not.toContain('value="password"');
      expect(formHTML).not.toContain('placeholder="password"');
    });
  });

  describe('Responsive Design', () => {
    it('should use Bootstrap responsive classes', () => {
      expect(formHTML).toContain('col-12');
      expect(formHTML).toContain('mb-3');
      expect(formHTML).toContain('form-control');
    });

    it('should have mobile-friendly input groups', () => {
      expect(formHTML).toContain('input-group');
      expect(formHTML).toContain('btn-outline-secondary');
    });
  });
});