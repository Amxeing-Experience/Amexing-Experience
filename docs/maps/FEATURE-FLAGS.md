# Feature Flags and Conditional Functionality Map

## Overview

This document maps all feature flags, conditional functionality, and environment-based behavior toggles in the Amexing Experience platform. This is part of the Phase 4 External Dependencies strategy for regression prevention.

## Table of Contents

- [1. Feature Flag Categories](#1-feature-flag-categories)
- [2. Environment-Based Feature Flags](#2-environment-based-feature-flags)
- [3. Configuration Feature Flags](#3-configuration-feature-flags)
- [4. Authentication & Security Flags](#4-authentication--security-flags)
- [5. External Service Feature Flags](#5-external-service-feature-flags)
- [6. Development & Testing Flags](#6-development--testing-flags)
- [7. Role-Based Feature Access](#7-role-based-feature-access)
- [8. Feature Flag Impact Analysis](#8-feature-flag-impact-analysis)

---

## 1. Feature Flag Categories

### Feature Flag Classification

| Category | Purpose | Impact Level | Examples |
|----------|---------|--------------|----------|
| **Environment Flags** | Control behavior per environment | HIGH | Development vs Production features |
| **Security Flags** | Enable/disable security features | CRITICAL | PCI compliance, audit logging |
| **Service Flags** | Toggle external service integration | HIGH | OAuth providers, email services |
| **Development Flags** | Development and testing features | MEDIUM | Mock modes, debug features |
| **Role Flags** | Control feature access by user role | HIGH | Admin features, dashboard access |
| **Performance Flags** | Control performance-related features | MEDIUM | Monitoring, logging levels |

---

## 2. Environment-Based Feature Flags

### NODE_ENV-Based Feature Control

#### Development Environment Features
```javascript
Environment Variable: NODE_ENV=development
Impact: Enables development-specific features

Features Enabled:
├── allowClientClassCreation: true (Parse Server)
├── Verbose logging and debugging
├── File watching for auto-restart
├── Relaxed CORS policies
├── AWS credentials in environment
├── Detailed error messages
├── Single process mode (PM2)
└── Debug endpoints access

Code Examples:
// Parse Server configuration
allowClientClassCreation: process.env.NODE_ENV === 'development'

// Cookie security
secure: process.env.NODE_ENV === 'production'

// Debug endpoints
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  // Debug routes enabled
}

Impact if Changed:
├── Production: Security hardening, performance optimization
├── Staging: Production-like behavior simulation
├── Test: Isolated testing with mocks
└── Development: Developer experience features
```

#### Production Environment Features
```javascript
Environment Variable: NODE_ENV=production
Impact: Enables production-specific security and performance

Features Enabled:
├── allowClientClassCreation: false (Parse Server security)
├── Secure cookie settings (HTTPS only)
├── Cluster mode with multiple processes
├── IAM roles instead of AWS credentials
├── Error logging without sensitive details
├── Account lockout policies
├── Session timeout enforcement
└── Strict security headers

Security Hardening:
├── HTTPS-only cookies
├── Strict CORS policies
├── Reduced error verbosity
├── Enhanced security monitoring
├── Account protection mechanisms
└── PCI DSS compliance enforcement

Impact if Misconfigured:
├── Security vulnerabilities in production
├── Performance degradation
├── Compliance violations
├── User experience issues
└── Operational difficulties
```

#### Test Environment Features
```javascript
Environment Variable: NODE_ENV=test
Impact: Enables testing-specific features and isolation

Features Enabled:
├── MongoDB Memory Server (port 27018)
├── Parse Server on port 1339
├── Mock external services
├── Seeded test data
├── Fast test execution
├── No real email delivery
├── OAuth mock mode
└── In-memory file storage

Testing Isolation:
├── No external service dependencies
├── Clean state per test run
├── Predictable test data
├── Mock service responses
├── Fast test execution
└── No side effects

Implementation:
// Parse Server initialization
if (process.env.NODE_ENV === 'test') {
  logger.info('Skipping Parse Server initialization in test mode');
  // Use test configuration
}
```

---

## 3. Configuration Feature Flags

### System Feature Flags

#### PCI DSS Compliance Toggle
```javascript
Environment Variable: ENABLE_PCI_COMPLIANCE=true|false
Default: true
Impact: Controls PCI DSS security features

Features Controlled:
├── Password complexity requirements
├── Account lockout policies
├── Session timeout enforcement
├── Audit logging mandatory
├── Data encryption requirements
├── Security header enforcement
└── Compliance monitoring

Configuration Chain:
ENABLE_PCI_COMPLIANCE → Parse Server config → Security middleware

Code Implementation:
// Environment variable check
const pciEnabled = process.env.ENABLE_PCI_COMPLIANCE === 'true';

// Password policy enforcement
passwordPolicy: pciEnabled ? strictPolicy : relaxedPolicy

Critical Impact:
├── Compliance: Legal and regulatory requirements
├── Security: Data protection and access control
├── User Experience: Authentication flow complexity
└── Operations: Audit and monitoring overhead
```

#### Audit Logging Toggle
```javascript
Environment Variable: ENABLE_AUDIT_LOGGING=true|false
Default: true
Impact: Controls comprehensive audit trail logging

Features Controlled:
├── User action logging
├── Data access logging
├── System change logging
├── Security event logging
├── Compliance reporting
└── Audit trail generation

Benefits When Enabled:
├── Complete activity tracking
├── Security incident investigation
├── Compliance requirement satisfaction
├── Forensic analysis capability
└── Regulatory audit support

Performance Impact:
├── Additional database writes
├── Log storage requirements
├── Processing overhead
└── Potential latency increase

Implementation:
// Audit middleware check
if (process.env.ENABLE_AUDIT_LOGGING === 'true') {
  // Log user actions, data access, etc.
}
```

#### Monitoring Toggle
```javascript
Environment Variable: ENABLE_MONITORING=true|false
Default: true
Impact: Controls system monitoring and metrics collection

Features Controlled:
├── Performance metrics collection
├── Health check endpoints
├── Resource utilization monitoring
├── Error rate tracking
├── Response time monitoring
└── System alerting

Monitoring Interval:
MONITOR_INTERVAL_MS=60000 (1 minute default)

Benefits When Enabled:
├── Real-time system visibility
├── Performance optimization insights
├── Proactive issue detection
├── Capacity planning data
└── SLA monitoring

Resource Usage:
├── CPU overhead for metrics collection
├── Memory usage for data storage
├── Network traffic for reporting
└── Storage for historical data
```

---

## 4. Authentication & Security Flags

### Parse Server Security Flags

#### Client Class Creation Control
```javascript
Flag: allowClientClassCreation
Environment Control: NODE_ENV === 'development'
Impact: Controls database schema modification from client

Development (true):
├── Clients can create new Parse classes
├── Schema flexibility for development
├── Rapid prototyping enabled
└── Development convenience

Production (false):
├── Prevents unauthorized schema changes
├── Database integrity protection
├── Security hardening
└── Prevents data corruption

Security Risk if Misconfigured:
├── Production with true → Schema corruption risk
├── Development with false → Development friction
├── Inconsistent environments → Deployment issues
└── Security policy violations
```

#### Anonymous Users Control
```javascript
Flag: enableAnonymousUsers
Current Setting: false (disabled)
Impact: Controls anonymous user creation and access

Currently Disabled Because:
├── RBAC system requires authenticated users
├── Audit trail requires user identification
├── PCI DSS compliance needs user tracking
├── Business logic depends on user roles
└── Security policy requires authentication

If Enabled Would Allow:
├── Unauthenticated data access
├── Anonymous user sessions
├── Public data manipulation
└── Reduced security posture

Impact on System:
├── Authentication: All users must authenticate
├── Authorization: RBAC enforced for all access
├── Audit: All actions tied to specific users
└── Compliance: PCI DSS user identification satisfied
```

#### Email Verification Control
```javascript
Flag: verifyUserEmails
Current Setting: false (disabled)
Flag: preventLoginWithUnverifiedEmail
Current Setting: false (disabled)

Current Behavior:
├── Users can register without email verification
├── Login allowed with unverified emails
├── Email verification optional
└── Streamlined onboarding process

If Enabled Would Require:
├── Email verification before account access
├── Email delivery dependency
├── Additional user onboarding steps
└── Email service reliability

Business Decision:
├── Simplified user onboarding prioritized
├── Email verification handled separately
├── Corporate OAuth reduces email verification need
└── Manual verification process for high-value users
```

---

## 5. External Service Feature Flags

### OAuth Provider Flags

#### Google OAuth Control
```javascript
Flag: GOOGLE_OAUTH_ENABLED=true|false
Current Setting: Configurable (default: true)
Impact: Enables/disables Google OAuth login

When Enabled:
├── Google Sign-In button available
├── OAuth flow functional
├── Corporate domain mapping active
├── SSO integration available
└── User profile sync enabled

Dependencies:
├── GOOGLE_OAUTH_CLIENT_ID configured
├── GOOGLE_OAUTH_CLIENT_SECRET configured
├── GOOGLE_OAUTH_REDIRECT_URI correct
└── Google OAuth service available

Fallback When Disabled:
├── Email/password authentication required
├── No SSO functionality
├── Manual user profile creation
└── Corporate integration unavailable

Mock Mode:
GOOGLE_OAUTH_MOCK_MODE=true|false
├── Development testing without real OAuth
├── Simulated OAuth responses
├── No external Google API calls
└── Predictable test scenarios
```

#### Microsoft OAuth Control (DISABLED)
```javascript
Flag: enabled: false (hardcoded)
Previous Environment: MICROSOFT_OAUTH_ENABLED
Current Status: Deliberately disabled

Disabled Because:
├── Simplified authentication flow
├── Reduced external dependencies
├── Focus on Google OAuth only
├── Fewer maintenance overhead
└── Cleaner user experience

Configuration Still Available:
├── MICROSOFT_OAUTH_CLIENT_ID (unused)
├── MICROSOFT_OAUTH_CLIENT_SECRET (unused)
├── MICROSOFT_OAUTH_TENANT_ID (unused)
└── MICROSOFT_OAUTH_MOCK_MODE (testing only)

If Re-enabled Would Require:
├── Configuration activation
├── UI button restoration
├── Testing implementation
└── Documentation updates
```

#### Apple OAuth Control (DISABLED)
```javascript
Flag: enabled: false (hardcoded)
Previous Environment: APPLE_OAUTH_ENABLED
Current Status: Deliberately disabled

Disabled Because:
├── Complex Apple OAuth implementation
├── Additional certificate management
├── Limited business use case
├── Simplified user experience
└── Development complexity reduction

Configuration Still Available:
├── APPLE_OAUTH_CLIENT_ID (unused)
├── APPLE_OAUTH_TEAM_ID (unused)
├── APPLE_OAUTH_KEY_ID (unused)
└── APPLE_OAUTH_MOCK_MODE (testing only)
```

### OAuth Mock Mode
```javascript
Global Flag: OAUTH_MOCK_MODE=true|false
Provider Flags: GOOGLE_OAUTH_MOCK_MODE, etc.
Impact: Controls OAuth testing mode

Mock Mode Features:
├── No external API calls to OAuth providers
├── Simulated user profiles
├── Predictable authentication responses
├── Fast test execution
├── No rate limiting concerns
└── Offline development capability

When Active:
├── Mock authorization URLs generated
├── Fake tokens returned
├── Simulated user information
├── No actual OAuth flow
└── Test-friendly responses

Use Cases:
├── Unit testing authentication flows
├── Integration testing without external deps
├── Development without internet
├── CI/CD pipeline testing
└── Rapid development iteration
```

---

## 6. Development & Testing Flags

### Debug and Development Features

#### Development Mode Features
```javascript
Controlled by: NODE_ENV === 'development'

Features Enabled:
├── Verbose Parse Server logging
├── Detailed error stack traces
├── File watching and auto-restart
├── Source map support
├── Development middleware
├── Debug route access
├── Console logging enabled
└── Hot reloading capabilities

Debug Routes:
// Debug endpoints only in dev/test
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  router.use('/debug', debugRoutes);
}

Development Specific Routes:
├── /debug/* → Various debug endpoints
├── Enhanced error pages
├── Development tools access
└── Testing utilities
```

#### Test Mode Features
```javascript
Controlled by: NODE_ENV === 'test'

Features Enabled:
├── MongoDB Memory Server usage
├── Mock external services
├── Seeded test data
├── Fast test execution
├── No real file uploads
├── No real email delivery
├── In-memory everything
└── Clean test isolation

Test-Specific Behavior:
├── Skip Parse Server initialization
├── Use test configuration
├── Mock OAuth responses
├── No external API calls
└── Predictable test data

Implementation:
// Test environment detection
if (process.env.NODE_ENV === 'test') {
  // Use test configuration
  return mockResponse();
}
```

### Logging Level Control
```javascript
Environment Variable: LOG_LEVEL=debug|info|warn|error
Impact: Controls logging verbosity

Log Levels:
├── debug: All messages (development)
├── info: General information (production)
├── warn: Warning messages
└── error: Error messages only

Environment Defaults:
├── Development: LOG_LEVEL=debug
├── Staging: LOG_LEVEL=info  
├── Production: LOG_LEVEL=warn
└── Test: LOG_LEVEL=error

Impact on Performance:
├── debug: High logging overhead
├── info: Moderate logging
├── warn: Low overhead
└── error: Minimal overhead

Implementation:
const logger = require('winston');
logger.level = process.env.LOG_LEVEL || 'info';
```

---

## 7. Role-Based Feature Access

### Dashboard Access Control

#### Role-Based Dashboard Features
```javascript
Control Mechanism: dashboardAuth.requireRole(roleName)
Impact: Controls access to dashboard features per role

SuperAdmin Features:
├── Full system administration
├── User management (all roles)
├── Role and permission management
├── System configuration access
├── Compliance monitoring
├── Security management
├── Analytics and reporting
└── Integration management

Admin Features:
├── Client and department management
├── Employee and driver management  
├── Booking and experience management
├── Vehicle and fleet management
├── Pricing and service configuration
├── Reports and analytics
└── System notifications

Client Features (Organization Admin):
├── Department management (own org)
├── Employee management (own org)
├── Booking management (own org)
├── Budget and reporting (own org)
└── Organization settings

Department Manager Features:
├── Team management (own dept)
├── Booking approval (own dept)
├── Service requests (own dept)
├── Department reporting
└── Employee assignment

Employee Features:
├── Profile management
├── Service requests (own)
├── Booking requests (own)
└── Service catalog access

Driver Features:
├── Profile management
├── Trip management (assigned)
├── Vehicle status updates
└── Route information access

Guest Features:
├── Service catalog viewing
├── Service requests creation
└── Quote viewing (own)
```

### Feature Visibility Control

#### Conditional UI Elements
```javascript
Implementation Pattern: Role-based visibility

Template Logic:
<%- if (user.role === 'superadmin') { %>
  <button id="admin-feature">Admin Only</button>
<% } %>

JavaScript Logic:
if (userRole.includes('admin')) {
  showAdvancedFeatures();
}

API Endpoint Protection:
router.get('/admin/*', dashboardAuth.requireRole('admin'), controller);

Features Controlled:
├── Navigation menu items
├── Action buttons
├── Data access levels
├── Configuration options
├── Administrative functions
└── Sensitive information display
```

### Permission-Based Feature Control

#### Granular Permission System
```javascript
Control Mechanism: Permission-based feature access
Implementation: RBAC permission checking

Permission Categories:
├── users.* (create, read, update, delete)
├── clients.* (management permissions)
├── departments.* (department operations)
├── bookings.* (booking operations)  
├── services.* (service management)
├── pricing.* (pricing operations)
├── reports.* (reporting access)
├── vehicles.* (fleet management)
├── system.* (system administration)
└── Custom permissions per feature

Dynamic Feature Access:
const hasPermission = await checkUserPermission(userId, 'users.create');
if (hasPermission) {
  enableUserCreationFeature();
}

Scope-Based Access:
├── own: User's own records
├── department: Department-scoped access
├── organization: Organization-scoped access
└── system: System-wide access
```

---

## 8. Feature Flag Impact Analysis

### Critical Impact Flags

#### High-Risk Feature Flags (System Breaking)
```javascript
1. NODE_ENV
   Risk Level: CRITICAL
   Impact: Complete system behavior change
   
   Scenarios:
   ├── Production with development NODE_ENV → Security vulnerabilities
   ├── Development with production NODE_ENV → Development friction  
   ├── Test with wrong NODE_ENV → Test failures
   └── Staging with wrong NODE_ENV → Inconsistent behavior
   
   Mitigation:
   ├── Environment-specific deployment scripts
   ├── Configuration validation
   ├── Health check verification
   └── Automated testing per environment

2. PARSE_APP_ID / PARSE_MASTER_KEY
   Risk Level: CRITICAL
   Impact: System initialization failure
   
   Scenarios:
   ├── Wrong APP_ID → Database connection failure
   ├── Wrong MASTER_KEY → Authentication failure
   ├── Missing values → Startup failure
   └── Environment mix-up → Data corruption risk
   
   Mitigation:
   ├── Configuration validation on startup
   ├── Environment separation
   ├── Secret management best practices
   └── Health checks for connectivity

3. ENABLE_PCI_COMPLIANCE
   Risk Level: CRITICAL
   Impact: Legal and regulatory compliance
   
   Scenarios:
   ├── Disabled in production → Compliance violation
   ├── Enabled incorrectly → System malfunction
   ├── Missing configuration → Audit failure
   └── Inconsistent enforcement → Security gaps
   
   Mitigation:
   ├── Mandatory in production environments
   ├── Compliance testing and validation
   ├── Regular audit reviews
   └── Automated compliance checking
```

#### Medium-Risk Feature Flags (Service Degradation)
```javascript
1. OAuth Provider Flags
   Risk Level: MEDIUM
   Impact: Authentication method availability
   
   Scenarios:
   ├── Google OAuth disabled → SSO unavailable
   ├── Mock mode in production → Fake authentication
   ├── Wrong configuration → OAuth failures
   └── Provider service down → Authentication issues
   
   Mitigation:
   ├── Multiple authentication methods
   ├── Email/password fallback
   ├── Provider status monitoring
   └── Configuration validation

2. Email Service Configuration  
   Risk Level: MEDIUM
   Impact: Communication capability
   
   Scenarios:
   ├── MailerSend disabled → No transactional emails
   ├── Wrong configuration → Email delivery failure
   ├── Service unavailable → Communication breakdown
   └── SMTP fallback issues → No backup
   
   Mitigation:
   ├── Service health monitoring
   ├── Multiple email providers
   ├── Email queue implementation
   └── Alternative communication methods

3. Monitoring and Logging
   Risk Level: MEDIUM
   Impact: Operational visibility
   
   Scenarios:
   ├── Monitoring disabled → No system visibility
   ├── Wrong log levels → Too much/little information
   ├── Audit logging disabled → Compliance issues
   └── Disk space issues → Log storage problems
   
   Mitigation:
   ├── Default monitoring enabled
   ├── Log rotation and management
   ├── Disk space monitoring
   └── Alert systems for failures
```

### Feature Flag Dependencies

#### Flag Interaction Matrix
```javascript
Dependent Flags:
├── NODE_ENV affects:
│   ├── allowClientClassCreation
│   ├── Cookie security settings
│   ├── Process management (PM2)
│   ├── AWS credential usage
│   ├── CORS policies
│   ├── Error verbosity
│   └── Debug feature access

├── ENABLE_PCI_COMPLIANCE affects:
│   ├── Password policy enforcement
│   ├── Session timeout settings
│   ├── Account lockout policies
│   ├── Audit logging requirements
│   ├── Data encryption settings
│   └── Security header enforcement

├── OAuth Flags affect:
│   ├── Login form options
│   ├── User registration flows
│   ├── Corporate SSO availability
│   ├── Account linking features
│   └── Profile data synchronization

└── Monitoring Flags affect:
    ├── Health check endpoints
    ├── Metrics collection
    ├── Performance monitoring
    ├── Alert generation
    └── System observability
```

### Feature Flag Testing Strategy

#### Testing Requirements per Flag
```javascript
1. Environment-Based Flags:
   ✅ Test all environment combinations
   ✅ Validate security differences
   ✅ Check performance impacts
   ✅ Verify feature availability
   ✅ Test deployment scenarios

2. Service Integration Flags:
   ✅ Test enabled/disabled states
   ✅ Verify fallback mechanisms
   ✅ Test mock modes
   ✅ Check error handling
   ✅ Validate integration flows

3. Security Flags:
   ✅ Test compliance enforcement
   ✅ Verify security policies
   ✅ Check audit logging
   ✅ Test access controls
   ✅ Validate encryption

4. Role-Based Flags:
   ✅ Test permission enforcement
   ✅ Verify feature visibility
   ✅ Check access restrictions
   ✅ Test role transitions
   ✅ Validate scope limitations
```

---

## Implementation Notes

### Feature Flag Best Practices
```javascript
1. Consistent Naming:
   ✅ Use descriptive flag names
   ✅ Follow naming conventions
   ✅ Document flag purposes
   ✅ Version flag changes
   ✅ Maintain flag registry

2. Safe Defaults:
   ✅ Set secure defaults
   ✅ Use least-privilege principle
   ✅ Enable safety features by default
   ✅ Disable experimental features
   ✅ Document default reasoning

3. Validation:
   ✅ Validate flag values on startup
   ✅ Check flag dependencies
   ✅ Verify environment consistency
   ✅ Test flag combinations
   ✅ Monitor flag impact

4. Documentation:
   ✅ Document all flags and impacts
   ✅ Explain flag interactions
   ✅ Provide change procedures
   ✅ Include troubleshooting guides
   ✅ Maintain change history
```

### Emergency Procedures
```javascript
Feature Flag Emergency Response:
1. Identify problematic flag
2. Assess impact and scope
3. Revert to safe default value
4. Restart affected services
5. Validate system restoration
6. Investigate root cause
7. Implement permanent fix
8. Update documentation and procedures
```

---

*This document should be updated whenever feature flags are added, modified, or removed. Last updated: May 2026*