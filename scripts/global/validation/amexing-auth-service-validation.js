/**
 * Validación Completa del AmexingAuthService
 * Prueba todas las funcionalidades del servicio de autenticación
 * 
 * Categorías de validación:
 * - Inicialización y configuración
 * - Gestión de usuarios (crear, buscar, validar)
 * - Autenticación con email/password
 * - Generación y validación de tokens JWT
 * - Gestión de sesiones
 * - Validación de permisos y roles
 * - Manejo de errores y seguridad
 * - Integración con MongoDB
 * 
 * Uso: node -r dotenv/config scripts/amexing-auth-service-validation.js dotenv_config_path=./environments/.env.development
 */

const { MongoClient } = require('mongodb');
const AmexingAuthService = require('../src/services/AmexingAuthService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class AmexingAuthServiceValidation {
    constructor() {
        this.mongoUri = process.env.DATABASE_URI;
        this.databaseName = process.env.DATABASE_NAME || 'AmexingDEV';
        this.jwtSecret = process.env.JWT_SECRET;
        
        this.validateEnvironment();
        
        this.client = null;
        this.db = null;
        this.authService = null;
        
        this.testResults = {
            timestamp: new Date().toISOString(),
            testType: 'Validación AmexingAuthService Completo',
            environment: process.env.NODE_ENV || 'development',
            mongoUri: this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            tests: [],
            summary: {}
        };
    }

    validateEnvironment() {
        const required = ['DATABASE_URI', 'JWT_SECRET', 'ENCRYPTION_KEY'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
        }

        console.log('✅ Variables de entorno validadas');
        console.log(`   Database: ${this.databaseName}`);
        console.log(`   JWT Secret: ${this.jwtSecret ? 'configurado' : 'no configurado'}`);
    }

    async initialize() {
        try {
            console.log('\n🔧 Inicializando validación del AmexingAuthService...');
            
            // Conectar a MongoDB
            this.client = new MongoClient(this.mongoUri);
            await this.client.connect();
            this.db = this.client.db(this.databaseName);
            
            console.log('✅ Conexión a MongoDB establecida');
            
            // Inicializar AmexingAuthService
            this.authService = new AmexingAuthService();
            this.authService.initialize(this.db);
            
            console.log('✅ AmexingAuthService inicializado\n');
            
        } catch (error) {
            console.error('❌ Error en inicialización:', error.message);
            throw error;
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
    // TESTS DE FUNCIONALIDAD
    // ============================================

    async testServiceInitialization() {
        // Verificar que el servicio se inicializó correctamente
        if (!this.authService) {
            throw new Error('AmexingAuthService no está inicializado');
        }
        
        if (!this.authService.db) {
            throw new Error('Base de datos no está conectada al servicio');
        }
        
        if (!this.authService.jwtSecret) {
            throw new Error('JWT Secret no está configurado');
        }
        
        return {
            details: 'Servicio inicializado con conexión a BD y configuración JWT'
        };
    }

    async testUserCreation() {
        const testUser = {
            email: 'test.user@amexingauth.dev',
            password: 'TestPassword123!',
            firstName: 'Test',
            lastName: 'User',
            role: 'client'
        };

        // Limpiar usuario si existe
        await this.db.collection('AmexingUser').deleteMany({ 
            email: testUser.email 
        });
        
        // Crear usuario
        const result = await this.authService.createUser(testUser);
        
        if (!result.user || !result.accessToken) {
            throw new Error('Resultado de creación incompleto');
        }
        
        // Verificar que se creó en la BD
        const dbUser = await this.db.collection('AmexingUser').findOne({ 
            email: testUser.email 
        });
        
        if (!dbUser) {
            throw new Error('Usuario no encontrado en la base de datos');
        }
        
        // Verificar campos requeridos
        const requiredFields = ['id', 'email', 'passwordHash', 'firstName', 'lastName', 'role'];
        const missingFields = requiredFields.filter(field => !dbUser[field]);
        
        if (missingFields.length > 0) {
            throw new Error(`Campos faltantes: ${missingFields.join(', ')}`);
        }
        
        // Verificar hash de contraseña
        const isValidHash = await bcrypt.compare(testUser.password, dbUser.passwordHash);
        if (!isValidHash) {
            throw new Error('Hash de contraseña inválido');
        }
        
        return {
            details: `Usuario creado: ${result.user.email}, Token generado: ${result.accessToken ? 'Sí' : 'No'}`
        };
    }

    async testUserAuthentication() {
        const testCredentials = {
            email: 'test.user@amexingauth.dev',
            password: 'TestPassword123!'
        };
        
        // Autenticar usuario
        const result = await this.authService.authenticateUser(
            testCredentials.email, 
            testCredentials.password
        );
        
        if (!result.user || !result.accessToken) {
            throw new Error('Resultado de autenticación incompleto');
        }
        
        // Verificar token JWT
        const decoded = jwt.verify(result.accessToken, this.jwtSecret);
        if (!decoded.sub || decoded.email !== testCredentials.email) {
            throw new Error('Token JWT inválido');
        }
        
        return {
            details: `Usuario autenticado: ${result.user.email}, JWT válido con expiración`
        };
    }

    async testTokenGeneration() {
        const testUser = await this.db.collection('AmexingUser').findOne({ 
            email: 'test.user@amexingauth.dev' 
        });
        
        if (!testUser) {
            throw new Error('Usuario de prueba no encontrado');
        }
        
        // Generar tokens
        const tokens = await this.authService.generateTokens(testUser);
        
        if (!tokens.accessToken || !tokens.refreshToken) {
            throw new Error('Tokens no generados correctamente');
        }
        
        // Validar estructura del access token
        const accessDecoded = jwt.verify(tokens.accessToken, this.jwtSecret);
        const requiredClaims = ['sub', 'email', 'role', 'permissions', 'iat', 'exp', 'jti'];
        const missingClaims = requiredClaims.filter(claim => !accessDecoded[claim]);
        
        if (missingClaims.length > 0) {
            throw new Error(`Claims faltantes en access token: ${missingClaims.join(', ')}`);
        }
        
        // Validar refresh token (debe tener estructura diferente)
        const refreshDecoded = jwt.decode(tokens.refreshToken);
        if (!refreshDecoded.type || refreshDecoded.type !== 'refresh') {
            throw new Error('Refresh token no tiene la estructura correcta');
        }
        
        return {
            details: `Access token y refresh token generados con claims correctos`
        };
    }

    async testPermissionsValidation() {
        const testUser = await this.db.collection('AmexingUser').findOne({ 
            email: 'test.user@amexingauth.dev' 
        });
        
        if (!testUser || !testUser.permissions) {
            throw new Error('Usuario o permisos no encontrados');
        }
        
        // Verificar que tiene permisos por defecto según su rol
        const expectedPermissionsCount = testUser.role === 'client' ? 3 : 1;
        if (!Array.isArray(testUser.permissions) || testUser.permissions.length < expectedPermissionsCount) {
            throw new Error(`Permisos insuficientes para rol ${testUser.role}`);
        }
        
        // Verificar estructura de permisos
        const hasValidPermissions = testUser.permissions.every(permission => 
            permission.resource && permission.actions && Array.isArray(permission.actions)
        );
        
        if (!hasValidPermissions) {
            throw new Error('Estructura de permisos inválida');
        }
        
        return {
            details: `${testUser.permissions.length} permisos validados para rol ${testUser.role}`
        };
    }

    async testPasswordSecurity() {
        const weakPasswords = [
            'password123',
            '12345678',
            'qwerty',
            'admin'
        ];
        
        const strongPassword = 'SecurePass123!@#';
        
        // Verificar que contraseñas débiles son rechazadas
        for (const weakPassword of weakPasswords) {
            try {
                await this.authService.createUser({
                    email: `weak.${Date.now()}@test.dev`,
                    password: weakPassword,
                    firstName: 'Weak',
                    lastName: 'Test',
                    role: 'guest'
                });
                
                // Si llegamos aquí, la contraseña débil fue aceptada (malo)
                throw new Error(`Contraseña débil aceptada: ${weakPassword}`);
                
            } catch (error) {
                // Si falla por validación de contraseña, es bueno
                if (error.message.includes('password') || error.message.includes('contraseña')) {
                    continue; // Esperado
                }
                // Si falla por otra razón, re-lanzar
                throw error;
            }
        }
        
        // Verificar que contraseña fuerte es aceptada
        const strongUser = await this.authService.createUser({
            email: `strong.${Date.now()}@test.dev`,
            password: strongPassword,
            firstName: 'Strong',
            lastName: 'Test',
            role: 'guest'
        });
        
        if (!strongUser.user) {
            throw new Error('Contraseña fuerte fue rechazada');
        }
        
        // Limpiar usuario de prueba
        await this.db.collection('AmexingUser').deleteOne({ 
            id: strongUser.user.id 
        });
        
        return {
            details: `${weakPasswords.length} contraseñas débiles rechazadas, contraseña fuerte aceptada`
        };
    }

    async testSessionManagement() {
        const testUser = await this.db.collection('AmexingUser').findOne({ 
            email: 'test.user@amexingauth.dev' 
        });
        
        if (!testUser) {
            throw new Error('Usuario de prueba no encontrado');
        }
        
        // Generar tokens
        const tokens = await this.authService.generateTokens(testUser);
        
        // Verificar que se puede crear sesión
        const sessionData = {
            userId: testUser.id,
            authMethod: 'password',
            tokens: tokens.accessToken
        };
        
        await this.authService.createSession(sessionData);
        
        // Verificar que la sesión existe en BD
        const session = await this.db.collection('UserSession').findOne({ 
            userId: testUser.id 
        });
        
        if (!session) {
            throw new Error('Sesión no creada en la base de datos');
        }
        
        // Verificar campos de sesión
        const requiredSessionFields = ['userId', 'authMethod', 'createdAt', 'active'];
        const missingSessionFields = requiredSessionFields.filter(field => session[field] === undefined);
        
        if (missingSessionFields.length > 0) {
            throw new Error(`Campos de sesión faltantes: ${missingSessionFields.join(', ')}`);
        }
        
        return {
            details: `Sesión creada y almacenada con todos los campos requeridos`
        };
    }

    async testErrorHandling() {
        const errors = [];
        
        // Test 1: Crear usuario con email duplicado
        try {
            await this.authService.createUser({
                email: 'test.user@amexingauth.dev', // Ya existe
                password: 'TestPassword123!',
                firstName: 'Duplicate',
                lastName: 'User',
                role: 'client'
            });
            errors.push('Error no lanzado para email duplicado');
        } catch (error) {
            if (!error.message.includes('already exists')) {
                errors.push(`Error incorrecto para email duplicado: ${error.message}`);
            }
        }
        
        // Test 2: Autenticar con credenciales inválidas
        try {
            await this.authService.authenticateUser(
                'test.user@amexingauth.dev',
                'WrongPassword123!'
            );
            errors.push('Error no lanzado para contraseña incorrecta');
        } catch (error) {
            if (!error.message.includes('Invalid credentials')) {
                errors.push(`Error incorrecto para contraseña incorrecta: ${error.message}`);
            }
        }
        
        // Test 3: Crear usuario con datos incompletos
        try {
            await this.authService.createUser({
                email: 'incomplete@test.dev'
                // Faltan firstName, lastName
            });
            errors.push('Error no lanzado para datos incompletos');
        } catch (error) {
            if (!error.message.includes('required')) {
                errors.push(`Error incorrecto para datos incompletos: ${error.message}`);
            }
        }
        
        if (errors.length > 0) {
            throw new Error(`Manejo de errores falló: ${errors.join('; ')}`);
        }
        
        return {
            details: 'Manejo correcto de 3 tipos de errores: email duplicado, credenciales inválidas, datos incompletos'
        };
    }

    async testDatabaseOperations() {
        const testEmail = `dbtest.${Date.now()}@amexingauth.dev`;
        
        // Test CRUD operations
        const userData = {
            email: testEmail,
            password: 'DatabaseTest123!',
            firstName: 'Database',
            lastName: 'Test',
            role: 'employee'
        };
        
        // CREATE
        const createResult = await this.authService.createUser(userData);
        if (!createResult.user) {
            throw new Error('Operación CREATE falló');
        }
        
        // READ
        const foundUser = await this.authService.findUserByEmail(testEmail);
        if (!foundUser) {
            throw new Error('Operación READ falló');
        }
        
        // UPDATE (verificar que el usuario puede ser encontrado y modificado en BD)
        await this.db.collection('AmexingUser').updateOne(
            { id: foundUser.id },
            { $set: { lastName: 'Updated', updatedAt: new Date() } }
        );
        
        const updatedUser = await this.authService.findUserByEmail(testEmail);
        if (updatedUser.lastName !== 'Updated') {
            throw new Error('Operación UPDATE falló');
        }
        
        // DELETE
        await this.db.collection('AmexingUser').deleteOne({ id: foundUser.id });
        const deletedUser = await this.authService.findUserByEmail(testEmail);
        if (deletedUser) {
            throw new Error('Operación DELETE falló');
        }
        
        return {
            details: 'Operaciones CRUD validadas: CREATE, READ, UPDATE, DELETE'
        };
    }

    // ============================================
    // EJECUCIÓN Y REPORTE
    // ============================================

    async runAllTests() {
        console.log('🚀 Iniciando validación completa del AmexingAuthService\n');
        
        await this.initialize();
        
        // Ejecutar tests
        await this.runTest('Inicialización del Servicio', () => this.testServiceInitialization());
        await this.runTest('Creación de Usuarios', () => this.testUserCreation());
        await this.runTest('Autenticación de Usuarios', () => this.testUserAuthentication());
        await this.runTest('Generación de Tokens JWT', () => this.testTokenGeneration());
        await this.runTest('Validación de Permisos', () => this.testPermissionsValidation());
        await this.runTest('Seguridad de Contraseñas', () => this.testPasswordSecurity());
        await this.runTest('Gestión de Sesiones', () => this.testSessionManagement());
        await this.runTest('Manejo de Errores', () => this.testErrorHandling());
        await this.runTest('Operaciones de Base de Datos', () => this.testDatabaseOperations());
        
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
                initialization: this.testResults.tests.filter(t => t.name.includes('Inicialización')).length,
                userManagement: this.testResults.tests.filter(t => t.name.includes('Usuarios') || t.name.includes('Creación')).length,
                authentication: this.testResults.tests.filter(t => t.name.includes('Autenticación')).length,
                tokenManagement: this.testResults.tests.filter(t => t.name.includes('Tokens') || t.name.includes('JWT')).length,
                security: this.testResults.tests.filter(t => t.name.includes('Seguridad') || t.name.includes('Contraseñas')).length,
                database: this.testResults.tests.filter(t => t.name.includes('Base de Datos')).length
            }
        };
        
        // Mostrar reporte
        console.log('\n' + '='.repeat(80));
        console.log('📋 REPORTE DE VALIDACIÓN - AMEXING AUTH SERVICE');
        console.log('='.repeat(80));
        console.log(`🕐 Fecha: ${this.testResults.timestamp}`);
        console.log(`🗄️ Base de Datos: ${this.databaseName}`);
        console.log(`🧪 Tests Ejecutados: ${this.testResults.totalTests}`);
        console.log(`✅ Tests Exitosos: ${this.testResults.passedTests}`);
        console.log(`❌ Tests Fallidos: ${this.testResults.failedTests}`);
        console.log(`📊 Tasa de Éxito: ${successRate}%`);
        console.log(`⏱️ Duración Total: ${this.testResults.summary.totalDuration}`);
        
        console.log('\n📈 RESUMEN POR CATEGORÍAS:');
        Object.entries(this.testResults.summary.categories).forEach(([category, count]) => {
            if (count > 0) {
                console.log(`   ${category}: ${count} tests`);
            }
        });
        
        if (this.testResults.failedTests > 0) {
            console.log('\n❌ TESTS FALLIDOS:');
            this.testResults.tests
                .filter(test => test.status === 'FAILED')
                .forEach(test => {
                    console.log(`   • ${test.name}: ${test.error}`);
                });
        }
        
        console.log('\n✅ TESTS EXITOSOS:');
        this.testResults.tests
            .filter(test => test.status === 'PASSED')
            .forEach(test => {
                console.log(`   • ${test.name} (${test.duration})`);
            });
        
        console.log('\n' + '='.repeat(80));
        
        // Guardar reporte
        const reportPath = `./logs/amexing-auth-service-validation-${Date.now()}.json`;
        require('fs').writeFileSync(reportPath, JSON.stringify(this.testResults, null, 2));
        console.log(`💾 Reporte detallado guardado en: ${reportPath}`);
        
        return this.testResults;
    }

    async cleanup() {
        // Limpiar datos de prueba
        if (this.db) {
            await this.db.collection('AmexingUser').deleteMany({ 
                email: { $regex: /@amexingauth\.dev|@test\.dev/ }
            });
            
            await this.db.collection('UserSession').deleteMany({ 
                authMethod: 'password'
            });
        }
        
        if (this.client) {
            await this.client.close();
        }
        
        console.log('🧹 Limpieza completada');
    }
}

// Ejecutar validación
(async () => {
    const validator = new AmexingAuthServiceValidation();
    
    try {
        await validator.runAllTests();
        
        console.log('\n🎉 Validación del AmexingAuthService completada exitosamente');
        
    } catch (error) {
        console.error('\n💥 Error durante la validación:', error.message);
        process.exit(1);
        
    } finally {
        await validator.cleanup();
    }
})();