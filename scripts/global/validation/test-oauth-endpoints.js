/**
 * Simple OAuth Endpoints Test Script
 * Tests OAuth functionality by making HTTP requests to running server
 */

const http = require('http');

class OAuthEndpointsTest {
    constructor() {
        this.baseUrl = 'http://localhost:1337';
        this.results = {
            timestamp: new Date().toISOString(),
            tests: [],
            summary: { passed: 0, failed: 0, total: 0 }
        };
    }

    async makeRequest(path, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: 1337,
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            if (data && method !== 'GET') {
                options.headers['Content-Length'] = Buffer.byteLength(data);
            }

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body
                    });
                });
            });

            req.on('error', reject);

            if (data && method !== 'GET') {
                req.write(data);
            }

            req.end();
        });
    }

    async testEndpoint(name, path, expectedStatus = 200) {
        try {
            console.log(`🧪 Testing: ${name}`);
            const response = await this.makeRequest(path);

            const success = response.statusCode === expectedStatus;
            const result = {
                name,
                path,
                expectedStatus,
                actualStatus: response.statusCode,
                success,
                timestamp: new Date().toISOString(),
                responseSize: response.body.length
            };

            if (success) {
                console.log(`   ✅ PASSED (${response.statusCode})`);
                this.results.summary.passed++;
            } else {
                console.log(`   ❌ FAILED (Expected: ${expectedStatus}, Got: ${response.statusCode})`);
                this.results.summary.failed++;
            }

            this.results.tests.push(result);
            this.results.summary.total++;

            return result;
        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            const result = {
                name,
                path,
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
            this.results.tests.push(result);
            this.results.summary.failed++;
            this.results.summary.total++;
            return result;
        }
    }

    async runAllTests() {
        console.log('🚀 OAuth Endpoints Testing Started\n');

        // Test OAuth providers endpoint
        await this.testEndpoint('OAuth Providers List', '/auth/oauth/providers', 200);

        // Test OAuth initiation endpoints
        await this.testEndpoint('Google OAuth Initiation', '/auth/oauth/google', 302);
        await this.testEndpoint('Microsoft OAuth Initiation', '/auth/oauth/microsoft', 302);
        await this.testEndpoint('Apple OAuth Initiation', '/auth/oauth/apple', 302);

        // Test invalid provider
        await this.testEndpoint('Invalid Provider', '/auth/oauth/invalid', 400);

        // Test basic server health
        await this.testEndpoint('Server Health Check', '/health', 200);

        // Test API endpoint
        await this.testEndpoint('API Base', '/api', 200);

        console.log('\n================================================================================');
        console.log('📋 OAUTH ENDPOINTS TEST RESULTS');
        console.log('================================================================================');
        console.log(`🕐 Timestamp: ${this.results.timestamp}`);
        console.log(`🧪 Total Tests: ${this.results.summary.total}`);
        console.log(`✅ Passed: ${this.results.summary.passed}`);
        console.log(`❌ Failed: ${this.results.summary.failed}`);
        console.log(`📊 Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        if (this.results.summary.failed > 0) {
            console.log('\n❌ FAILED TESTS:');
            this.results.tests
                .filter(test => !test.success)
                .forEach(test => {
                    console.log(`   • ${test.name}: ${test.error || `Expected ${test.expectedStatus}, got ${test.actualStatus}`}`);
                });
        }

        console.log('================================================================================');

        return this.results;
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    const tester = new OAuthEndpointsTest();
    tester.runAllTests()
        .then(results => {
            const success = results.summary.failed === 0;
            console.log(success ? '\n🎉 All OAuth endpoints working correctly!' : '\n⚠️ Some tests failed - check server configuration');
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = OAuthEndpointsTest;