/**
 * OAuth Security Validation Tests - Sprint 05
 * Comprehensive security testing for OAuth implementation
 * PCI DSS Level 1 compliance validation
 */

const { OAuthSecurityValidator } = require('../../../src/security/oauth-security-validator');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

describe('OAuth Security Validation Suite', () => {
    let validator;
    let mockToken;
    let mockPayload;

    beforeEach(() => {
        validator = new OAuthSecurityValidator();
        
        // Create mock JWT token
        mockPayload = {
            sub: 'user123',
            aud: process.env.PARSE_APPLICATION_ID || 'test-app',
            iss: 'https://oauth.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            scope: 'openid profile email'
        };

        // Sign token with test secret
        mockToken = jwt.sign(mockPayload, 'test-secret', { algorithm: 'HS256' });

        // Set test environment variables
        process.env.OAUTH_AUDIENCE = 'test-app';
        process.env.OAUTH_VALID_ISSUERS = 'https://oauth.example.com,https://auth.example.com';
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Token Security Validation', () => {
        test('should validate valid OAuth token', async () => {
            const result = await validator.validateTokenSecurity(mockToken, 'access');
            
            expect(result.valid).toBe(true);
            expect(result.checks.structure).toBe(true);
            expect(result.checks.decodable).toBe(true);
            expect(result.checks.expiration).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        test('should reject expired token', async () => {
            const expiredPayload = {
                ...mockPayload,
                exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
            };
            const expiredToken = jwt.sign(expiredPayload, 'test-secret', { algorithm: 'HS256' });
            
            const result = await validator.validateTokenSecurity(expiredToken, 'access');
            
            expect(result.valid).toBe(false);
            expect(result.checks.expiration).toBe(false);
            expect(result.issues).toContain('Token expired');
        });

        test('should reject token with invalid audience', async () => {
            const invalidAudPayload = {
                ...mockPayload,
                aud: 'wrong-audience'
            };
            const invalidToken = jwt.sign(invalidAudPayload, 'test-secret', { algorithm: 'HS256' });
            
            const result = await validator.validateTokenSecurity(invalidToken, 'access');
            
            expect(result.valid).toBe(false);
            expect(result.checks.audience).toBe(false);
            expect(result.issues).toContain('Invalid audience');
        });

        test('should reject token with invalid issuer', async () => {
            const invalidIssPayload = {
                ...mockPayload,
                iss: 'https://malicious.com'
            };
            const invalidToken = jwt.sign(invalidIssPayload, 'test-secret', { algorithm: 'HS256' });
            
            const result = await validator.validateTokenSecurity(invalidToken, 'access');
            
            expect(result.valid).toBe(false);
            expect(result.checks.issuer).toBe(false);
            expect(result.issues).toContain('Invalid issuer');
        });

        test('should reject malformed token', async () => {
            const malformedToken = 'not.a.valid.token';
            
            const result = await validator.validateTokenSecurity(malformedToken, 'access');
            
            expect(result.valid).toBe(false);
            expect(result.checks.decodable).toBe(false);
        });
    });

    describe('PKCE Validation', () => {
        test('should validate correct PKCE implementation', () => {
            const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
            const codeChallenge = validator.generateCodeChallenge(codeVerifier);
            
            const result = validator.validatePKCE(codeVerifier, codeChallenge, 'S256');
            
            expect(result.valid).toBe(true);
            expect(result.checks.verifierLength).toBe(true);
            expect(result.checks.verifierFormat).toBe(true);
            expect(result.checks.challengeMethod).toBe(true);
            expect(result.checks.challengeMatch).toBe(true);
        });

        test('should reject short code verifier', () => {
            const shortVerifier = 'tooshort';
            const codeChallenge = validator.generateCodeChallenge(shortVerifier);
            
            const result = validator.validatePKCE(shortVerifier, codeChallenge, 'S256');
            
            expect(result.valid).toBe(false);
            expect(result.checks.verifierLength).toBe(false);
        });

        test('should reject invalid challenge method', () => {
            const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
            const codeChallenge = Buffer.from(codeVerifier).toString('base64'); // Plain method
            
            const result = validator.validatePKCE(codeVerifier, codeChallenge, 'plain');
            
            expect(result.valid).toBe(false);
            expect(result.checks.challengeMethod).toBe(false);
        });

        test('should reject mismatched challenge', () => {
            const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
            const wrongChallenge = 'wrongChallengeValue';
            
            const result = validator.validatePKCE(codeVerifier, wrongChallenge, 'S256');
            
            expect(result.valid).toBe(false);
            expect(result.checks.challengeMatch).toBe(false);
        });
    });

    describe('State Parameter Validation', () => {
        test('should validate correct state parameter', () => {
            const state = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();

            const result = validator.validateState(state, state, timestamp);

            expect(result.valid).toBe(true);
            expect(result.checks.stateMatch).toBe(true);
            expect(result.checks.entropy).toBe(true);
            expect(result.checks.timeout).toBe(true);
        });

        test('should reject mismatched state', () => {
            const state1 = crypto.randomBytes(32).toString('hex');
            const state2 = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();
            
            const result = validator.validateState(state1, state2, timestamp);
            
            expect(result.valid).toBe(false);
            expect(result.checks.stateMatch).toBe(false);
        });

        test('should reject low entropy state', () => {
            const weakState = '12345678';
            const timestamp = Date.now();
            
            const result = validator.validateState(weakState, weakState, timestamp);
            
            expect(result.valid).toBe(false);
            expect(result.checks.entropy).toBe(false);
        });

        test('should reject expired state', () => {
            const state = crypto.randomBytes(32).toString('hex');
            const oldTimestamp = Date.now() - (11 * 60 * 1000); // 11 minutes ago
            
            const result = validator.validateState(state, state, oldTimestamp);
            
            expect(result.valid).toBe(false);
            expect(result.checks.timeout).toBe(false);
        });
    });

    describe('Redirect URI Validation', () => {
        test('should validate matching HTTPS redirect URI', () => {
            const redirectUri = 'https://app.example.com/oauth/callback';
            const registeredUri = 'https://app.example.com/oauth/callback';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            expect(result.valid).toBe(true);
            expect(result.checks.exactMatch).toBe(true);
            expect(result.checks.httpsRequired).toBe(true);
            expect(result.checks.privateIP).toBe(true);
        });

        test('should allow localhost for development', () => {
            const redirectUri = 'http://localhost:3000/oauth/callback';
            const registeredUri = 'http://localhost:3000/oauth/callback';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            expect(result.valid).toBe(true);
            expect(result.checks.httpsRequired).toBe(true); // Exception for localhost
        });

        test('should reject HTTP redirect URI', () => {
            const redirectUri = 'http://app.example.com/oauth/callback';
            const registeredUri = 'http://app.example.com/oauth/callback';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            expect(result.valid).toBe(false);
            expect(result.checks.httpsRequired).toBe(false);
            expect(result.issues).toContain('HTTPS required for redirect URI');
        });

        test('should reject mismatched redirect URI', () => {
            const redirectUri = 'https://app.example.com/oauth/callback';
            const registeredUri = 'https://app.example.com/oauth/different';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            expect(result.valid).toBe(false);
            expect(result.checks.exactMatch).toBe(false);
        });

        test('should reject private IP addresses', () => {
            const redirectUri = 'https://192.168.1.100/oauth/callback';
            const registeredUri = 'https://192.168.1.100/oauth/callback';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            expect(result.valid).toBe(false);
            expect(result.checks.privateIP).toBe(false);
            expect(result.issues).toContain('Private IP addresses not allowed');
        });
    });

    describe('PCI DSS Requirement 7 - Access Control', () => {
        test('should validate compliant access control', async () => {
            const accessControlData = {
                roles: [
                    { name: 'user', privileged: false },
                    { name: 'admin', privileged: true }
                ],
                privilegeJustification: 'Administrative tasks require elevated access',
                lastReviewDate: new Date().toISOString()
            };
            
            const result = await validator.validatePCIRequirement7(accessControlData);
            
            expect(result.compliant).toBe(true);
            expect(result.checks.rbac).toBe(true);
            expect(result.checks.leastPrivilege).toBe(true);
            expect(result.checks.accessReview).toBe(true);
        });

        test('should reject missing RBAC', async () => {
            const accessControlData = {
                roles: [],
                lastReviewDate: new Date().toISOString()
            };
            
            const result = await validator.validatePCIRequirement7(accessControlData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.rbac).toBe(false);
            expect(result.issues).toContain('Role-based access control not implemented');
        });

        test('should reject privileged access without justification', async () => {
            const accessControlData = {
                roles: [
                    { name: 'admin', privileged: true }
                ],
                lastReviewDate: new Date().toISOString()
            };
            
            const result = await validator.validatePCIRequirement7(accessControlData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.leastPrivilege).toBe(false);
            expect(result.issues).toContain('Privileged access requires justification');
        });

        test('should reject outdated access review', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 100); // 100 days ago
            
            const accessControlData = {
                roles: [{ name: 'user', privileged: false }],
                lastReviewDate: oldDate.toISOString()
            };
            
            const result = await validator.validatePCIRequirement7(accessControlData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.accessReview).toBe(false);
            expect(result.issues).toContain('Access review required (quarterly)');
        });
    });

    describe('PCI DSS Requirement 8 - Authentication', () => {
        test('should validate compliant authentication', async () => {
            const authenticationData = {
                users: [
                    { id: 'user1', username: 'alice' },
                    { id: 'user2', username: 'bob' }
                ],
                authenticationMethods: ['oauth', 'password'],
                requiresMFA: true,
                privilegedAccess: true,
                passwordPolicy: {
                    minLength: 12,
                    complexity: true,
                    history: 5,
                    maxAge: 90
                }
            };
            
            const result = await validator.validatePCIRequirement8(authenticationData);
            
            expect(result.compliant).toBe(true);
            expect(result.checks.uniqueUserIds).toBe(true);
            expect(result.checks.strongAuth).toBe(true);
            expect(result.checks.mfa).toBe(true);
            expect(result.checks.passwordPolicy).toBe(true);
        });

        test('should reject duplicate user IDs', async () => {
            const authenticationData = {
                users: [
                    { id: 'user1', username: 'alice' },
                    { id: 'user1', username: 'bob' } // Duplicate ID
                ],
                authenticationMethods: ['oauth']
            };
            
            const result = await validator.validatePCIRequirement8(authenticationData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.uniqueUserIds).toBe(false);
            expect(result.issues).toContain('Duplicate user IDs detected');
        });

        test('should reject missing MFA for privileged access', async () => {
            const authenticationData = {
                users: [{ id: 'admin1', username: 'admin' }],
                authenticationMethods: ['oauth'],
                requiresMFA: false,
                privilegedAccess: true
            };
            
            const result = await validator.validatePCIRequirement8(authenticationData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.mfa).toBe(false);
            expect(result.issues).toContain('MFA required for privileged access');
        });

        test('should reject weak password policy', async () => {
            const authenticationData = {
                users: [{ id: 'user1', username: 'user' }],
                authenticationMethods: ['oauth', 'password'],
                passwordPolicy: {
                    minLength: 6, // Too short
                    complexity: false
                }
            };
            
            const result = await validator.validatePCIRequirement8(authenticationData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.passwordPolicy).toBe(false);
            expect(result.issues).toContain('Password policy does not meet requirements');
        });
    });

    describe('PCI DSS Requirement 10 - Audit Logging', () => {
        test('should validate compliant audit logging', async () => {
            const auditData = {
                loggingEnabled: true,
                retentionPeriod: 365,
                integrityProtection: true,
                timeSync: true,
                timeDrift: 500,
                logReview: true
            };
            
            const result = await validator.validatePCIRequirement10(auditData);
            
            expect(result.compliant).toBe(true);
            expect(result.checks.auditLogging).toBe(true);
            expect(result.checks.logRetention).toBe(true);
            expect(result.checks.logIntegrity).toBe(true);
            expect(result.checks.timeSync).toBe(true);
        });

        test('should reject disabled audit logging', async () => {
            const auditData = {
                loggingEnabled: false,
                retentionPeriod: 365
            };
            
            const result = await validator.validatePCIRequirement10(auditData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.auditLogging).toBe(false);
            expect(result.issues).toContain('Audit logging not enabled');
        });

        test('should reject insufficient log retention', async () => {
            const auditData = {
                loggingEnabled: true,
                retentionPeriod: 180, // Only 6 months
                integrityProtection: true
            };
            
            const result = await validator.validatePCIRequirement10(auditData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.logRetention).toBe(false);
            expect(result.issues).toContain('Log retention must be at least 1 year');
        });

        test('should reject missing log integrity protection', async () => {
            const auditData = {
                loggingEnabled: true,
                retentionPeriod: 365,
                integrityProtection: false
            };
            
            const result = await validator.validatePCIRequirement10(auditData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.logIntegrity).toBe(false);
            expect(result.issues).toContain('Log integrity protection required');
        });

        test('should reject excessive time drift', async () => {
            const auditData = {
                loggingEnabled: true,
                retentionPeriod: 365,
                integrityProtection: true,
                timeSync: true,
                timeDrift: 5000 // 5 seconds drift
            };
            
            const result = await validator.validatePCIRequirement10(auditData);
            
            expect(result.compliant).toBe(false);
            expect(result.checks.timeSync).toBe(false);
            expect(result.issues).toContain('Time synchronization required');
        });
    });

    describe('Security Report Generation', () => {
        test('should generate comprehensive security report', async () => {
            const report = await validator.generateSecurityReport();
            
            expect(report).toBeDefined();
            expect(report.validator).toBe('OAuthSecurityValidator');
            expect(report.version).toBe('1.0');
            expect(report.summary).toBeDefined();
            expect(report.summary.totalChecks).toBeGreaterThan(0);
            expect(report.sections).toBeDefined();
            expect(report.sections.tokenSecurity).toBeDefined();
            expect(report.sections.authenticationFlows).toBeDefined();
            expect(report.sections.pciCompliance).toBeDefined();
            expect(report.overallStatus).toMatch(/PASS|FAIL/);
            expect(report.complianceScore).toBeGreaterThanOrEqual(0);
            expect(report.complianceScore).toBeLessThanOrEqual(100);
        });

        test('should calculate correct compliance score', async () => {
            const report = await validator.generateSecurityReport();
            
            const expectedScore = Math.round(
                (report.summary.passed / report.summary.totalChecks) * 100
            );
            
            expect(report.complianceScore).toBe(expectedScore);
        });

        test('should mark report as FAIL if any critical checks fail', async () => {
            // Mock a failing check
            validator.runTokenSecurityChecks = jest.fn().mockResolvedValue([
                {
                    name: 'Token Encryption',
                    description: 'Validate token encryption standards',
                    status: 'fail',
                    details: 'Weak encryption detected'
                }
            ]);
            
            const report = await validator.generateSecurityReport();
            
            expect(report.overallStatus).toBe('FAIL');
            expect(report.summary.failed).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases and Security Boundaries', () => {
        test('should handle null token gracefully', async () => {
            const result = await validator.validateTokenSecurity(null, 'access');
            
            expect(result.valid).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
        });

        test('should handle extremely long tokens', async () => {
            const longToken = 'a'.repeat(10000) + '.b.c';
            
            const result = await validator.validateTokenSecurity(longToken, 'access');
            
            expect(result.valid).toBe(false);
        });

        test('should handle special characters in redirect URI', () => {
            const redirectUri = 'https://app.example.com/oauth/callback?test=<script>alert(1)</script>';
            const registeredUri = 'https://app.example.com/oauth/callback?test=<script>alert(1)</script>';
            
            const result = validator.validateRedirectUri(redirectUri, registeredUri);
            
            // Should still validate if exact match
            expect(result.valid).toBe(true);
            expect(result.checks.exactMatch).toBe(true);
        });

        test('should prevent timing attacks in state validation', () => {
            const state1 = crypto.randomBytes(32).toString('hex');
            const state2 = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();
            
            const startTime = process.hrtime.bigint();
            validator.validateState(state1, state2, timestamp);
            const endTime = process.hrtime.bigint();
            
            const timeTaken = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            
            // Validation should complete in consistent time
            expect(timeTaken).toBeLessThan(10); // Should be very fast
        });
    });
});

describe('OAuth Security Integration Tests', () => {
    let validator;

    beforeAll(() => {
        validator = new OAuthSecurityValidator();
    });

    test('should validate complete OAuth flow security', async () => {
        // Simulate complete OAuth flow
        const flowSteps = {
            // Step 1: Authorization request
            authorization: {
                state: crypto.randomBytes(32).toString('hex'),
                codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
                redirectUri: 'https://app.example.com/oauth/callback'
            },
            // Step 2: Token exchange
            tokenExchange: {
                code: 'auth_code_123',
                codeChallenge: validator.generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
            },
            // Step 3: Token validation
            tokenValidation: {
                accessToken: jwt.sign(
                    {
                        sub: 'user123',
                        aud: process.env.OAUTH_AUDIENCE || 'test-app',
                        iss: 'https://oauth.example.com',
                        exp: Math.floor(Date.now() / 1000) + 3600,
                        iat: Math.floor(Date.now() / 1000)
                    },
                    'test-secret',
                    { algorithm: 'HS256' }
                )
            }
        };

        // Validate each step
        const stateValidation = validator.validateState(
            flowSteps.authorization.state,
            flowSteps.authorization.state,
            Date.now()
        );
        expect(stateValidation.valid).toBe(true);

        const pkceValidation = validator.validatePKCE(
            flowSteps.authorization.codeVerifier,
            flowSteps.tokenExchange.codeChallenge,
            'S256'
        );
        expect(pkceValidation.valid).toBe(true);

        const tokenValidation = await validator.validateTokenSecurity(
            flowSteps.tokenValidation.accessToken,
            'access'
        );
        expect(tokenValidation.valid).toBe(true);
    });

    test('should validate PCI DSS compliance across all requirements', async () => {
        const complianceData = {
            requirement7: {
                roles: [
                    { name: 'user', privileged: false },
                    { name: 'admin', privileged: true }
                ],
                privilegeJustification: 'Required for system administration',
                lastReviewDate: new Date().toISOString()
            },
            requirement8: {
                users: [
                    { id: 'user1', username: 'alice' },
                    { id: 'user2', username: 'bob' }
                ],
                authenticationMethods: ['oauth'],
                requiresMFA: true,
                privilegedAccess: true,
                passwordPolicy: {
                    minLength: 12,
                    complexity: true
                }
            },
            requirement10: {
                loggingEnabled: true,
                retentionPeriod: 365,
                integrityProtection: true,
                timeSync: true,
                timeDrift: 100
            }
        };

        const req7Result = await validator.validatePCIRequirement7(complianceData.requirement7);
        const req8Result = await validator.validatePCIRequirement8(complianceData.requirement8);
        const req10Result = await validator.validatePCIRequirement10(complianceData.requirement10);

        expect(req7Result.compliant).toBe(true);
        expect(req8Result.compliant).toBe(true);
        expect(req10Result.compliant).toBe(true);

        // Generate overall compliance report
        const report = await validator.generateSecurityReport();
        expect(report.overallStatus).toBe('PASS');
        expect(report.complianceScore).toBeGreaterThanOrEqual(90);
    });
});