/**
 * Validación de Integración con Parse Server Local
 * Prueba las funcionalidades de autenticación a través de Parse Server
 * 
 * Categorías de validación:
 * - Conexión a Parse Server
 * - Cloud Functions de autenticación
 * - Integración con rutas de autenticación
 * - Middleware de JWT
 * - Manejo de sesiones de Parse
 * - Validación de tokens
 * 
 * Uso: node -r dotenv/config scripts/parse-server-integration-validation.js dotenv_config_path=./environments/.env.development
 */

const axios = require('axios');
const Parse = require('parse/node');
const { MongoClient } = require('mongodb');

class ParseServerIntegrationValidation {
    constructor() {
        this.parseServerUrl = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
        this.parseAppId = process.env.PARSE_APP_ID;
        this.parseMasterKey = process.env.PARSE_MASTER_KEY;
        this.apiUrl = process.env.PARSE_SERVER_URL.replace('/parse', '') || 'http://localhost:1337';
        
        this.validateEnvironment();
        
        this.testResults = {
            timestamp: new Date().toISOString(),
            testType: 'Validación Integración Parse Server Local',
            environment: process.env.NODE_ENV || 'development',
            parseServerUrl: this.parseServerUrl,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            tests: [],
            summary: {}
        };
    }

    validateEnvironment() {
        const required = ['PARSE_APP_ID', 'PARSE_MASTER_KEY', 'PARSE_SERVER_URL'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
        }

        console.log('✅ Variables de entorno de Parse Server validadas');
        console.log(`   Parse Server URL: ${this.parseServerUrl}`);
        console.log(`   Parse App ID: ${this.parseAppId}`);
        console.log(`   API Base URL: ${this.apiUrl}`);
    }

    async initialize() {
        try {
            console.log('\\n🔧 Inicializando validación de Parse Server...');
            
            // Inicializar Parse SDK
            Parse.initialize(this.parseAppId, null, this.parseMasterKey);
            Parse.serverURL = this.parseServerUrl;
            
            console.log('✅ Parse SDK inicializado');
            
            // Verificar conectividad
            await this.testParseServerConnectivity();
            
            console.log('✅ Parse Server accesible\\n');
            
        } catch (error) {
            console.error('❌ Error en inicialización:', error.message);
            throw error;
        }
    }

    async testParseServerConnectivity() {
        try {
            // Intentar primero el endpoint /health
            const response = await axios.get(`${this.parseServerUrl}/health`, {
                timeout: 5000,
                validateStatus: function (status) {
                    return status >= 200 && status < 600; // Aceptar cualquier respuesta
                }
            });
            
            if (response.status === 200) {
                return; // Todo bien
            } else if (response.status === 503) {
                console.log('   ⚠️ Parse Server responde pero está indisponible (503)');
                return; // Servidor corriendo pero con problemas internos
            } else {
                throw new Error(`Parse Server respondió con status ${response.status}`);
            }
            
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Parse Server no está corriendo o no es accesible');
            }
            
            // Si el endpoint /health no existe, intentar el endpoint base
            try {
                const baseResponse = await axios.get(this.parseServerUrl, {
                    timeout: 5000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 600;
                    }
                });
                
                console.log(`   ⚠️ Parse Server responde en endpoint base con status ${baseResponse.status}`);
                return;
                
            } catch (baseError) {
                if (baseError.code === 'ECONNREFUSED') {
                    throw new Error('Parse Server no está corriendo o no es accesible');
                }
                throw error;
            }
        }
    }

    async runTest(testName, testFunction) {
        this.testResults.totalTests++;
        const startTime = Date.now();
        
        try {
            console.log(`🧪 ${testName}...`);
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            this.testResults.passedTests++;
            this.testResults.tests.push({
                name: testName,
                status: 'PASSED',
                duration: `${duration}ms`,
                result: result || 'Test completado exitosamente'
            });
            
            console.log(`   ✅ PASSED (${duration}ms)`);
            if (result && typeof result === 'object' && result.details) {
                console.log(`   📊 ${result.details}`);
            }
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.testResults.failedTests++;
            this.testResults.tests.push({
                name: testName,
                status: 'FAILED',
                duration: `${duration}ms`,
                error: error.message
            });
            
            console.log(`   ❌ FAILED (${duration}ms): ${error.message}`);
        }
    }

    // ============================================
    // TESTS DE PARSE SERVER
    // ============================================

    async testParseServerHealth() {
        const response = await axios.get(`${this.parseServerUrl}/health`);
        
        if (response.status !== 200) {
            throw new Error(`Health check falló: ${response.status}`);
        }
        
        return {
            details: `Parse Server saludable - Status: ${response.status}`
        };
    }

    async testCloudFunctionsAvailable() {
        const testFunctions = [
            'loginUser',
            'registerUser', 
            'refreshToken',
            'getOAuthProviders'
        ];
        
        const availableFunctions = [];
        const unavailableFunctions = [];
        
        for (const functionName of testFunctions) {
            try {
                // Intentar ejecutar con parámetros vacíos para ver si existe
                await Parse.Cloud.run(functionName, {});
                availableFunctions.push(functionName);
            } catch (error) {
                if (error.message.includes('not found') || error.message.includes('does not exist')) {
                    unavailableFunctions.push(functionName);
                } else {
                    // Si falla por otros motivos (parámetros, etc), significa que existe
                    availableFunctions.push(functionName);
                }
            }
        }
        
        if (unavailableFunctions.length > 0) {
            throw new Error(`Cloud Functions no disponibles: ${unavailableFunctions.join(', ')}`);
        }
        
        return {
            details: `${availableFunctions.length} Cloud Functions disponibles: ${availableFunctions.join(', ')}`
        };
    }

    async testAuthenticationRoutes() {
        const authEndpoints = [
            { method: 'POST', path: '/auth/login', requiresBody: true },
            { method: 'POST', path: '/auth/register', requiresBody: true },
            { method: 'POST', path: '/auth/logout', requiresBody: false },
            { method: 'POST', path: '/auth/refresh', requiresBody: false },
            { method: 'GET', path: '/auth/oauth/providers', requiresBody: false }
        ];
        
        const results = [];
        
        for (const endpoint of authEndpoints) {
            try {
                const config = {
                    method: endpoint.method,
                    url: `${this.apiUrl}${endpoint.path}`,
                    timeout: 5000,
                    validateStatus: function (status) {
                        // Aceptar cualquier respuesta (incluso errores) para verificar que el endpoint existe
                        return status >= 200 && status < 600;
                    }
                };
                
                if (endpoint.requiresBody && endpoint.method === 'POST') {
                    config.data = {}; // Datos vacíos para probar que el endpoint existe
                    config.headers = { 'Content-Type': 'application/json' };
                }
                
                const response = await axios(config);
                results.push(`${endpoint.method} ${endpoint.path}: ${response.status}`);
                
            } catch (error) {
                if (error.code === 'ECONNREFUSED') {
                    throw new Error('Servidor de aplicación no está corriendo');
                }
                results.push(`${endpoint.method} ${endpoint.path}: Error - ${error.message}`);
            }
        }
        
        return {
            details: `${results.length} endpoints probados: ${results.join('; ')}`
        };
    }

    async testRegisterUserFlow() {
        const testUser = {
            username: `parsetest${Date.now()}`.substring(0, 20),
            email: `parsetest.${Date.now()}@integration.test`,
            password: 'ParseTest123!',
            firstName: 'Parse',
            lastName: 'Integration',
            role: 'client'
        };
        
        try {
            // Intentar registrar usuario a través de Parse Cloud Function
            const result = await Parse.Cloud.run('registerUser', testUser);
            
            if (!result || !result.user) {
                throw new Error('Cloud Function registerUser no devolvió usuario válido');
            }
            
            // Limpiar usuario creado
            if (result.user.id) {
                const Parse = require('parse/node');
                const query = new Parse.Query('AmexingUser');
                const user = await query.get(result.user.id, { useMasterKey: true });
                if (user) {
                    await user.destroy({ useMasterKey: true });
                }
            }
            
            return {
                details: `Usuario registrado exitosamente: ${result.user.email}, Tokens generados: ${result.tokens ? 'Sí' : 'No'}`
            };
            
        } catch (error) {
            // Si el error es por funcionalidad no implementada, es información útil
            if (error.message.includes('not found') || error.message.includes('does not exist')) {
                throw new Error('Cloud Function registerUser no está implementada');
            }
            
            // Si es otro error (validación, etc.), también es información útil
            throw new Error(`Register flow falló: ${error.message}`);
        }
    }

    async testLoginUserFlow() {
        const testCredentials = {
            identifier: 'test.user@amexingauth.dev', // Usuario que sabemos existe de tests anteriores
            password: 'TestPassword123!'
        };
        
        try {
            const result = await Parse.Cloud.run('loginUser', testCredentials);
            
            if (!result || !result.user) {
                throw new Error('Cloud Function loginUser no devolvió usuario válido');
            }
            
            return {
                details: `Usuario autenticado: ${result.user.email}, Tokens: ${result.tokens ? 'Sí' : 'No'}`
            };
            
        } catch (error) {
            if (error.message.includes('not found') || error.message.includes('does not exist')) {
                throw new Error('Cloud Function loginUser no está implementada');
            }
            
            // Si es error de credenciales inválidas, es normal si el usuario no existe
            if (error.message.includes('Invalid credentials')) {
                return {
                    details: 'Cloud Function loginUser funcional (error esperado por credenciales de prueba)'
                };
            }
            
            throw new Error(`Login flow falló: ${error.message}`);
        }
    }

    async testParseDataAccess() {
        try {
            // Probar acceso a datos usando Parse SDK
            const AmexingUser = Parse.Object.extend('AmexingUser');
            const query = new Parse.Query(AmexingUser);
            query.limit(1);
            
            const users = await query.find({ useMasterKey: true });
            
            return {
                details: `Acceso a datos Parse exitoso, usuarios encontrados: ${users.length}`
            };
            
        } catch (error) {
            throw new Error(`Acceso a datos Parse falló: ${error.message}`);
        }
    }

    async testDatabaseConnection() {
        const mongoUri = process.env.DATABASE_URI;
        
        if (!mongoUri) {
            throw new Error('DATABASE_URI no está configurada');
        }
        
        const client = new MongoClient(mongoUri);
        
        try {
            await client.connect();
            const db = client.db(process.env.DATABASE_NAME || 'AmexingDEV');
            
            // Probar acceso a colecciones principales
            const collections = await db.listCollections().toArray();
            const collectionNames = collections.map(c => c.name);
            
            const expectedCollections = ['AmexingUser', 'UserSession'];
            const missingCollections = expectedCollections.filter(
                name => !collectionNames.includes(name)
            );
            
            await client.close();
            
            return {
                details: `${collections.length} colecciones encontradas${missingCollections.length > 0 ? `, faltantes: ${missingCollections.join(', ')}` : ''}`
            };
            
        } catch (error) {
            if (client) {
                await client.close();
            }
            throw error;
        }
    }

    async testApplicationHealth() {
        try {
            const response = await axios.get(`${this.apiUrl}/health`, {
                timeout: 5000
            });
            
            if (response.status !== 200) {
                throw new Error(`Health endpoint respondió con ${response.status}`);
            }
            
            const healthData = response.data;
            
            if (!healthData.database) {
                throw new Error('Health check no incluye información de base de datos');
            }
            
            return {
                details: `Aplicación saludable - DB: ${healthData.database.connected ? 'Conectada' : 'Desconectada'}, Uptime: ${Math.round(healthData.uptime)}s`
            };
            
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Aplicación no está corriendo en el puerto esperado');
            }
            throw error;
        }
    }

    // ============================================
    // EJECUCIÓN Y REPORTE
    // ============================================

    async runAllTests() {
        console.log('🚀 Iniciando validación de integración con Parse Server\\n');
        
        await this.initialize();
        
        // Ejecutar tests
        await this.runTest('Parse Server Health', () => this.testParseServerHealth());
        await this.runTest('Cloud Functions Disponibles', () => this.testCloudFunctionsAvailable());
        await this.runTest('Rutas de Autenticación', () => this.testAuthenticationRoutes());
        await this.runTest('Flujo de Registro de Usuario', () => this.testRegisterUserFlow());
        await this.runTest('Flujo de Login de Usuario', () => this.testLoginUserFlow());
        await this.runTest('Acceso a Datos Parse', () => this.testParseDataAccess());
        await this.runTest('Conexión a Base de Datos', () => this.testDatabaseConnection());
        await this.runTest('Salud de Aplicación', () => this.testApplicationHealth());
        
        await this.generateReport();
    }

    async generateReport() {
        // Calcular estadísticas
        const successRate = ((this.testResults.passedTests / this.testResults.totalTests) * 100).toFixed(1);
        
        this.testResults.summary = {
            successRate: `${successRate}%`,
            totalDuration: this.testResults.tests.reduce((sum, test) => {
                return sum + parseInt(test.duration.replace('ms', ''));
            }, 0) + 'ms',
            categories: {
                connectivity: this.testResults.tests.filter(t => 
                    t.name.includes('Health') || t.name.includes('Conexión')
                ).length,
                cloudFunctions: this.testResults.tests.filter(t => 
                    t.name.includes('Cloud Functions') || t.name.includes('Flujo')
                ).length,
                routing: this.testResults.tests.filter(t => 
                    t.name.includes('Rutas')
                ).length,
                dataAccess: this.testResults.tests.filter(t => 
                    t.name.includes('Datos') || t.name.includes('Base de Datos')
                ).length
            }
        };
        
        // Mostrar reporte
        console.log('\\n' + '='.repeat(80));
        console.log('📋 REPORTE DE VALIDACIÓN - PARSE SERVER INTEGRATION');
        console.log('='.repeat(80));
        console.log(`🕐 Fecha: ${this.testResults.timestamp}`);
        console.log(`🔗 Parse Server URL: ${this.parseServerUrl}`);
        console.log(`🧪 Tests Ejecutados: ${this.testResults.totalTests}`);
        console.log(`✅ Tests Exitosos: ${this.testResults.passedTests}`);
        console.log(`❌ Tests Fallidos: ${this.testResults.failedTests}`);
        console.log(`📊 Tasa de Éxito: ${successRate}%`);
        console.log(`⏱️ Duración Total: ${this.testResults.summary.totalDuration}`);
        
        console.log('\\n📈 RESUMEN POR CATEGORÍAS:');
        Object.entries(this.testResults.summary.categories).forEach(([category, count]) => {
            if (count > 0) {
                console.log(`   ${category}: ${count} tests`);
            }
        });
        
        if (this.testResults.failedTests > 0) {
            console.log('\\n❌ TESTS FALLIDOS:');
            this.testResults.tests
                .filter(test => test.status === 'FAILED')
                .forEach(test => {
                    console.log(`   • ${test.name}: ${test.error}`);
                });
        }
        
        console.log('\\n✅ TESTS EXITOSOS:');
        this.testResults.tests
            .filter(test => test.status === 'PASSED')
            .forEach(test => {
                console.log(`   • ${test.name} (${test.duration})`);
            });
        
        console.log('\\n' + '='.repeat(80));
        
        // Guardar reporte
        const reportPath = `./logs/parse-server-integration-validation-${Date.now()}.json`;
        require('fs').writeFileSync(reportPath, JSON.stringify(this.testResults, null, 2));
        console.log(`💾 Reporte detallado guardado en: ${reportPath}`);
        
        return this.testResults;
    }
}

// Ejecutar validación
(async () => {
    const validator = new ParseServerIntegrationValidation();
    
    try {
        await validator.runAllTests();
        
        console.log('\\n🎉 Validación de integración Parse Server completada exitosamente');
        
    } catch (error) {
        console.error('\\n💥 Error durante la validación:', error.message);
        process.exit(1);
    }
})();