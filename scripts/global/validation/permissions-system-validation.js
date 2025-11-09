/**
 * Validación del Sistema de Permisos con Usuarios Reales
 * Prueba el sistema de permisos y roles usando datos reales en MongoDB Atlas
 * 
 * Categorías de validación:
 * - Creación de usuarios con diferentes roles
 * - Validación de permisos por rol
 * - Sistema de autorización
 * - Escalamiento de permisos
 * - Validación de acceso a recursos
 * - Auditoria de permisos
 * 
 * Uso: node -r dotenv/config scripts/permissions-system-validation.js dotenv_config_path=./environments/.env.development
 */

const { MongoClient } = require('mongodb');
const AmexingAuthService = require('../src/services/AmexingAuthService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class PermissionsSystemValidation {
    constructor() {
        this.mongoUri = process.env.DATABASE_URI;
        this.databaseName = process.env.DATABASE_NAME || 'AmexingDEV';
        this.jwtSecret = process.env.JWT_SECRET;
        
        this.validateEnvironment();
        
        this.client = null;
        this.db = null;
        this.authService = null;
        
        this.testUsers = [];
        this.testRoles = [
            {
                code: 'guest',
                name: 'Invitado',
                level: 1,
                permissions: [
                    { resource: 'profile', actions: ['read'] }
                ]
            },
            {
                code: 'client',
                name: 'Cliente',
                level: 2,
                permissions: [
                    { resource: 'profile', actions: ['read', 'update'] },
                    { resource: 'orders', actions: ['read', 'create'] },
                    { resource: 'invoices', actions: ['read'] }
                ]
            },
            {
                code: 'employee',
                name: 'Empleado',
                level: 3,
                permissions: [
                    { resource: 'profile', actions: ['read', 'update'] },
                    { resource: 'orders', actions: ['read', 'create', 'update'] },
                    { resource: 'clients', actions: ['read'] },
                    { resource: 'reports', actions: ['read'] }
                ]
            },
            {
                code: 'admin',
                name: 'Administrador',
                level: 4,
                permissions: [
                    { resource: '*', actions: ['*'] }
                ]
            }
        ];
        
        this.testResults = {
            timestamp: new Date().toISOString(),
            testType: 'Validación Sistema de Permisos con Usuarios Reales',
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

        console.log('✅ Variables de entorno validadas para sistema de permisos');
        console.log(`   Database: ${this.databaseName}`);
        console.log(`   JWT Secret: ${this.jwtSecret ? 'configurado' : 'no configurado'}`);
    }

    async initialize() {
        try {
            console.log('\\n🔧 Inicializando validación del sistema de permisos...');
            
            // Conectar a MongoDB
            this.client = new MongoClient(this.mongoUri);
            await this.client.connect();
            this.db = this.client.db(this.databaseName);
            
            console.log('✅ Conexión a MongoDB establecida');
            
            // Inicializar AmexingAuthService
            this.authService = new AmexingAuthService();
            this.authService.initialize(this.db);
            
            console.log('✅ AmexingAuthService inicializado');
            
            // Crear usuarios de prueba
            await this.createTestUsers();
            
            console.log('✅ Usuarios de prueba creados\\n');
            
        } catch (error) {
            console.error('❌ Error en inicialización:', error.message);
            throw error;
        }
    }

    async createTestUsers() {
        for (const role of this.testRoles) {
            const testUser = {
                email: `permissions.test.${role.code}@system.validation`,
                password: `Permission${role.code}2024!`,
                firstName: 'Permission',
                lastName: `Test${role.code.charAt(0).toUpperCase() + role.code.slice(1)}`,
                role: role.code
            };
            
            try {
                // Limpiar usuario existente si existe
                await this.db.collection('AmexingUser').deleteMany({ 
                    email: testUser.email 
                });
                
                // Crear nuevo usuario
                const result = await this.authService.createUser(testUser);
                this.testUsers.push({
                    ...testUser,
                    id: result.user.id,
                    tokens: result
                });
                
                console.log(`   👤 Usuario ${role.code} creado: ${testUser.email}`);
                
            } catch (error) {
                console.error(`   ❌ Error creando usuario ${role.code}:`, error.message);
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
    // TESTS DE SISTEMA DE PERMISOS
    // ============================================

    async testRolePermissionsAssignment() {
        const results = [];
        
        for (const testUser of this.testUsers) {
            const dbUser = await this.db.collection('AmexingUser').findOne({
                email: testUser.email
            });
            
            if (!dbUser) {
                throw new Error(`Usuario ${testUser.email} no encontrado en BD`);
            }
            
            if (!dbUser.permissions || !Array.isArray(dbUser.permissions)) {
                throw new Error(`Usuario ${testUser.role} no tiene permisos asignados`);
            }
            
            const expectedRole = this.testRoles.find(r => r.code === testUser.role);
            if (!expectedRole) {
                throw new Error(`Rol ${testUser.role} no encontrado en configuración`);
            }
            
            // Validar que tiene los permisos esperados para su rol
            const hasAllPermissions = expectedRole.permissions.every(expectedPerm => {
                return dbUser.permissions.some(userPerm => 
                    userPerm.resource === expectedPerm.resource &&
                    expectedPerm.actions.every(action => 
                        userPerm.actions.includes(action) || userPerm.actions.includes('*')
                    )
                );
            });
            
            if (!hasAllPermissions) {
                throw new Error(`Usuario ${testUser.role} no tiene todos los permisos esperados`);
            }
            
            results.push(`${testUser.role}: ${dbUser.permissions.length} permisos`);
        }
        
        return {
            details: `Permisos validados: ${results.join(', ')}`
        };
    }

    async testPermissionHierarchy() {
        const roleHierarchy = ['guest', 'client', 'employee', 'admin'];
        const results = [];
        
        for (let i = 0; i < roleHierarchy.length; i++) {
            const currentRole = roleHierarchy[i];
            const currentUser = this.testUsers.find(u => u.role === currentRole);
            
            if (!currentUser) {
                throw new Error(`Usuario con rol ${currentRole} no encontrado`);
            }
            
            const dbUser = await this.db.collection('AmexingUser').findOne({
                id: currentUser.id
            });
            
            // Validar que roles superiores tienen al menos los permisos de roles inferiores
            if (i > 0) {
                const lowerRole = roleHierarchy[i - 1];
                const lowerUser = this.testUsers.find(u => u.role === lowerRole);
                const lowerDbUser = await this.db.collection('AmexingUser').findOne({
                    id: lowerUser.id
                });
                
                // Admin tiene permisos especiales (*)
                if (currentRole === 'admin') {
                    const hasAdminPerms = dbUser.permissions.some(perm => 
                        perm.resource === '*' && perm.actions.includes('*')
                    );
                    if (!hasAdminPerms) {
                        throw new Error('Admin no tiene permisos globales (*)');
                    }
                } else {
                    // Para otros roles, verificar que tienen al menos tantos permisos como el rol anterior
                    if (dbUser.permissions.length < lowerDbUser.permissions.length) {
                        throw new Error(`${currentRole} tiene menos permisos que ${lowerRole}`);
                    }
                }
            }
            
            results.push(`${currentRole}: ${dbUser.permissions.length} permisos`);
        }
        
        return {
            details: `Jerarquía validada: ${results.join(' → ')}`
        };
    }

    async testResourceAccessValidation() {
        const testCases = [
            {
                role: 'guest',
                resource: 'orders',
                action: 'create',
                shouldHaveAccess: false
            },
            {
                role: 'client',
                resource: 'orders',
                action: 'create',
                shouldHaveAccess: true
            },
            {
                role: 'client',
                resource: 'reports',
                action: 'read',
                shouldHaveAccess: false
            },
            {
                role: 'employee',
                resource: 'reports',
                action: 'read',
                shouldHaveAccess: true
            },
            {
                role: 'admin',
                resource: 'anything',
                action: 'delete',
                shouldHaveAccess: true
            }
        ];
        
        const results = [];
        
        for (const testCase of testCases) {
            const testUser = this.testUsers.find(u => u.role === testCase.role);
            const dbUser = await this.db.collection('AmexingUser').findOne({
                id: testUser.id
            });
            
            const hasAccess = this.checkResourceAccess(
                dbUser.permissions,
                testCase.resource,
                testCase.action
            );
            
            if (hasAccess !== testCase.shouldHaveAccess) {
                throw new Error(
                    `${testCase.role} ${hasAccess ? 'tiene' : 'no tiene'} acceso a ${testCase.resource}:${testCase.action}, ` +
                    `pero ${testCase.shouldHaveAccess ? 'debería' : 'no debería'} tenerlo`
                );
            }
            
            results.push(`${testCase.role}→${testCase.resource}:${testCase.action}=${hasAccess ? '✓' : '✗'}`);
        }
        
        return {
            details: `${testCases.length} casos validados: ${results.join(', ')}`
        };
    }

    checkResourceAccess(permissions, resource, action) {
        if (!permissions || !Array.isArray(permissions)) {
            return false;
        }
        
        return permissions.some(permission => {
            // Permiso global
            if (permission.resource === '*' && permission.actions.includes('*')) {
                return true;
            }
            
            // Recurso específico
            if (permission.resource === resource) {
                return permission.actions.includes(action) || permission.actions.includes('*');
            }
            
            return false;
        });
    }

    async testJWTTokenPermissions() {
        const results = [];
        
        for (const testUser of this.testUsers) {
            if (!testUser.tokens || !testUser.tokens.accessToken) {
                throw new Error(`Usuario ${testUser.role} no tiene access token`);
            }
            
            // Decodificar JWT
            const decoded = jwt.verify(testUser.tokens.accessToken, this.jwtSecret);
            
            if (!decoded.permissions) {
                throw new Error(`Token de ${testUser.role} no contiene permisos`);
            }
            
            if (!Array.isArray(decoded.permissions)) {
                throw new Error(`Permisos en token de ${testUser.role} no son un array`);
            }
            
            // Verificar que los permisos en el token coinciden con los de la BD
            const dbUser = await this.db.collection('AmexingUser').findOne({
                id: testUser.id
            });
            
            if (decoded.permissions.length !== dbUser.permissions.length) {
                throw new Error(`Permisos en token de ${testUser.role} no coinciden con BD`);
            }
            
            results.push(`${testUser.role}: ${decoded.permissions.length} permisos en JWT`);
        }
        
        return {
            details: `JWT validados: ${results.join(', ')}`
        };
    }

    async testPermissionModification() {
        // Tomar el usuario client para modificar sus permisos
        const clientUser = this.testUsers.find(u => u.role === 'client');
        
        // Obtener permisos actuales
        const originalUser = await this.db.collection('AmexingUser').findOne({
            id: clientUser.id
        });
        const originalPermissionsCount = originalUser.permissions.length;
        
        // Agregar un permiso adicional
        const newPermission = { resource: 'dashboard', actions: ['read'] };
        await this.db.collection('AmexingUser').updateOne(
            { id: clientUser.id },
            { 
                $push: { permissions: newPermission },
                $set: { updatedAt: new Date() }
            }
        );
        
        // Verificar que se agregó
        const updatedUser = await this.db.collection('AmexingUser').findOne({
            id: clientUser.id
        });
        
        if (updatedUser.permissions.length !== originalPermissionsCount + 1) {
            throw new Error('Permiso no se agregó correctamente');
        }
        
        const hasNewPermission = updatedUser.permissions.some(p => 
            p.resource === 'dashboard' && p.actions.includes('read')
        );
        
        if (!hasNewPermission) {
            throw new Error('Nuevo permiso no se encuentra en la lista');
        }
        
        // Restaurar permisos originales
        await this.db.collection('AmexingUser').updateOne(
            { id: clientUser.id },
            { 
                $pull: { permissions: newPermission },
                $set: { updatedAt: new Date() }
            }
        );
        
        return {
            details: `Permiso agregado y removido exitosamente para ${clientUser.role}`
        };
    }

    async testAuthorizationMiddleware() {
        // Simular validación de autorización usando los JWT tokens
        const testCases = [
            {
                user: this.testUsers.find(u => u.role === 'guest'),
                requestedResource: 'profile',
                requestedAction: 'read',
                shouldAllow: true
            },
            {
                user: this.testUsers.find(u => u.role === 'guest'),
                requestedResource: 'orders',
                requestedAction: 'create',
                shouldAllow: false
            },
            {
                user: this.testUsers.find(u => u.role === 'admin'),
                requestedResource: 'sensitive-data',
                requestedAction: 'delete',
                shouldAllow: true
            }
        ];
        
        const results = [];
        
        for (const testCase of testCases) {
            const decoded = jwt.verify(testCase.user.tokens.accessToken, this.jwtSecret);
            
            const hasAuthorization = this.checkResourceAccess(
                decoded.permissions,
                testCase.requestedResource,
                testCase.requestedAction
            );
            
            if (hasAuthorization !== testCase.shouldAllow) {
                throw new Error(
                    `Autorización incorrecta para ${testCase.user.role}: ` +
                    `${testCase.requestedResource}:${testCase.requestedAction}`
                );
            }
            
            results.push(`${testCase.user.role}→${testCase.requestedResource}=${hasAuthorization ? 'Autorizado' : 'Denegado'}`);
        }
        
        return {
            details: `${testCases.length} casos de autorización validados: ${results.join(', ')}`
        };
    }

    // ============================================
    // EJECUCIÓN Y REPORTE
    // ============================================

    async runAllTests() {
        console.log('🚀 Iniciando validación del sistema de permisos con usuarios reales\\n');
        
        await this.initialize();
        
        // Ejecutar tests
        await this.runTest('Asignación de Permisos por Rol', () => this.testRolePermissionsAssignment());
        await this.runTest('Jerarquía de Permisos', () => this.testPermissionHierarchy());
        await this.runTest('Validación de Acceso a Recursos', () => this.testResourceAccessValidation());
        await this.runTest('Permisos en Tokens JWT', () => this.testJWTTokenPermissions());
        await this.runTest('Modificación de Permisos', () => this.testPermissionModification());
        await this.runTest('Middleware de Autorización', () => this.testAuthorizationMiddleware());
        
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
            usersCreated: this.testUsers.length,
            rolesValidated: this.testRoles.length,
            categories: {
                permissions: this.testResults.tests.filter(t => 
                    t.name.includes('Permisos') || t.name.includes('Jerarquía')
                ).length,
                authorization: this.testResults.tests.filter(t => 
                    t.name.includes('Acceso') || t.name.includes('Autorización')
                ).length,
                tokens: this.testResults.tests.filter(t => 
                    t.name.includes('JWT') || t.name.includes('Token')
                ).length,
                management: this.testResults.tests.filter(t => 
                    t.name.includes('Modificación')
                ).length
            }
        };
        
        // Mostrar reporte
        console.log('\\n' + '='.repeat(80));
        console.log('📋 REPORTE DE VALIDACIÓN - SISTEMA DE PERMISOS');
        console.log('='.repeat(80));
        console.log(`🕐 Fecha: ${this.testResults.timestamp}`);
        console.log(`🗄️ Base de Datos: ${this.databaseName}`);
        console.log(`👥 Usuarios Creados: ${this.testResults.summary.usersCreated}`);
        console.log(`🔐 Roles Validados: ${this.testResults.summary.rolesValidated}`);
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
        
        console.log('\\n👥 USUARIOS DE PRUEBA CREADOS:');
        this.testUsers.forEach(user => {
            console.log(`   • ${user.role}: ${user.email}`);
        });
        
        console.log('\\n' + '='.repeat(80));
        
        // Guardar reporte
        const reportPath = `./logs/permissions-system-validation-${Date.now()}.json`;
        require('fs').writeFileSync(reportPath, JSON.stringify(this.testResults, null, 2));
        console.log(`💾 Reporte detallado guardado en: ${reportPath}`);
        
        return this.testResults;
    }

    async cleanup() {
        // Limpiar usuarios de prueba
        if (this.db && this.testUsers.length > 0) {
            const emails = this.testUsers.map(u => u.email);
            await this.db.collection('AmexingUser').deleteMany({ 
                email: { $in: emails }
            });
            
            console.log(`🧹 ${this.testUsers.length} usuarios de prueba eliminados`);
        }
        
        if (this.client) {
            await this.client.close();
        }
        
        console.log('🧹 Limpieza completada');
    }
}

// Ejecutar validación
(async () => {
    const validator = new PermissionsSystemValidation();
    
    try {
        await validator.runAllTests();
        
        console.log('\\n🎉 Validación del sistema de permisos completada exitosamente');
        
    } catch (error) {
        console.error('\\n💥 Error durante la validación:', error.message);
        process.exit(1);
        
    } finally {
        await validator.cleanup();
    }
})();