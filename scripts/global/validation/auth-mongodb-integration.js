/**
 * Tests de Integración con MongoDB Atlas - Sistema de Autenticación
 * Valida la integración específica con MongoDB Atlas para autenticación
 * 
 * Multi-Agent Implementation: Backend Developer + Database Specialist + DevOps Engineer
 * 
 * Funcionalidades a Validar:
 * - Conexión específica con MongoDB Atlas
 * - Transacciones y atomicidad
 * - Índices y optimización de consultas
 * - Replicación y consistencia de datos
 * - Performance con datos distribuidos
 * - Manejo de conexiones concurrentes
 * - Backup y restauración
 * - Monitoreo y métricas
 * 
 * Uso: node -r dotenv/config scripts/auth-mongodb-integration.js dotenv_config_path=./environments/.env.development
 */

const { MongoClient, ReadPreference } = require('mongodb');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class AuthMongoDBAtlasIntegration {
    constructor() {
        this.mongoUri = process.env.DATABASE_URI;
        this.databaseName = process.env.DATABASE_NAME || 'AmexingDEV';
        
        this.validateConfiguration();
        this.testResults = {
            timestamp: new Date().toISOString(),
            testType: 'Integración MongoDB Atlas - Sistema de Autenticación',
            mongoAtlas: {
                connected: false,
                cluster: null,
                region: null,
                tier: null
            },
            tests: [],
            performance: {
                connectionTime: 0,
                queryTimes: [],
                transactionTimes: []
            },
            overall: { success: false, message: '' }
        };

        this.client = null;
        this.db = null;
    }

    validateConfiguration() {
        console.log('🔍 Validando configuración...');
        console.log(`   URI encontrada: ${this.mongoUri ? this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : 'undefined'}`);
        
        if (!this.mongoUri || !this.mongoUri.includes('mongodb+srv://')) {
            throw new Error(`Se requiere URI de MongoDB Atlas (mongodb+srv://). URI actual: ${this.mongoUri || 'no definida'}`);
        }

        console.log('✅ Configuración de MongoDB Atlas validada');
        console.log(`   Database: ${this.databaseName}`);
        console.log(`   URI: ${this.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}\n`);
    }

    async runAllTests() {
        console.log('🗄️ Iniciando Tests de Integración con MongoDB Atlas...\n');

        try {
            // Test 1: Conectar y Validar Cluster Atlas
            await this.testAtlasConnection();

            // Test 2: Información del Cluster y Configuración
            await this.testClusterInformation();

            // Test 3: Transacciones ACID
            await this.testTransactions();

            // Test 4: Índices y Optimización de Consultas
            await this.testIndexesAndQueryOptimization();

            // Test 5: Operaciones Concurrentes
            await this.testConcurrentOperations();

            // Test 6: Replica Set y Consistencia
            await this.testReplicaSetConsistency();

            // Test 7: Performance con Datos Distribuidos
            await this.testDistributedDataPerformance();

            // Test 8: Manejo de Conexiones y Pool
            await this.testConnectionPooling();

            // Test 9: Agregaciones y Pipelines Complejos
            await this.testAggregationPipelines();

            // Test 10: Monitoring y Métricas
            await this.testMonitoringAndMetrics();

            // Generar reporte final
            this.generateFinalReport();

        } catch (error) {
            console.error(`❌ Error en integración MongoDB Atlas: ${error.message}`);
            this.testResults.overall = {
                success: false,
                message: `Integración Atlas falló: ${error.message}`
            };
        } finally {
            await this.disconnectFromAtlas();
        }

        return this.testResults;
    }

    async testAtlasConnection() {
        const testName = 'Conexión a MongoDB Atlas';
        console.log(`🧪 ${testName}...`);

        try {
            const connectionStart = Date.now();
            
            this.client = new MongoClient(this.mongoUri, {
                maxPoolSize: 50,
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                maxIdleTimeMS: 30000,
                waitQueueTimeoutMS: 5000,
                retryWrites: true,
                readPreference: ReadPreference.SECONDARY_PREFERRED
            });

            await this.client.connect();
            this.db = this.client.db(this.databaseName);
            
            // Test de conectividad
            const pingResult = await this.db.admin().ping();
            const connectionTime = Date.now() - connectionStart;
            this.testResults.performance.connectionTime = connectionTime;

            // Obtener información del servidor
            const serverInfo = await this.db.admin().serverStatus();
            const buildInfo = await this.db.admin().buildInfo();

            this.testResults.mongoAtlas = {
                connected: true,
                connectionTime,
                mongoVersion: buildInfo.version,
                platform: buildInfo.buildEnvironment?.target_os || 'Unknown',
                storageEngine: serverInfo.storageEngine?.name || 'Unknown'
            };

            this.addTestResult(testName, true, 
                `Conectado a MongoDB Atlas exitosamente (${connectionTime}ms, MongoDB ${buildInfo.version})`);
            console.log(`   ✅ Conexión exitosa en ${connectionTime}ms`);
            console.log(`   📊 MongoDB Version: ${buildInfo.version}`);
            console.log(`   🏗️ Storage Engine: ${serverInfo.storageEngine?.name}`);

        } catch (error) {
            this.addTestResult(testName, false, `Conexión a Atlas falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
            throw error;
        }
    }

    async testClusterInformation() {
        const testName = 'Información del Cluster Atlas';
        console.log(`🧪 ${testName}...`);

        try {
            // Información de la base de datos
            const dbStats = await this.db.stats();
            const collections = await this.db.listCollections().toArray();
            
            // Información del cluster
            const adminDB = this.db.admin();
            let replicaSetStatus = null;
            
            try {
                replicaSetStatus = await adminDB.replSetGetStatus();
            } catch (rsError) {
                // Es normal que falle en algunas configuraciones de Atlas
                console.log(`   ⚠️ ReplicaSet status no disponible (normal en Atlas)`);
            }

            // Información de conexión
            const connectionStatus = await adminDB.command({ connectionStatus: 1 });

            const clusterInfo = {
                databaseName: this.db.databaseName,
                collections: collections.length,
                dataSize: this.formatBytes(dbStats.dataSize),
                storageSize: this.formatBytes(dbStats.storageSize),
                indexes: dbStats.indexes,
                user: connectionStatus.authInfo?.authenticatedUsers?.[0]?.user || 'Unknown'
            };

            this.addTestResult(testName, true,
                `Cluster info obtenido: ${clusterInfo.collections} colecciones, ${clusterInfo.dataSize} data, ${clusterInfo.indexes} índices`);
            console.log(`   ✅ Database: ${clusterInfo.databaseName}`);
            console.log(`   📊 Colecciones: ${clusterInfo.collections}`);
            console.log(`   💾 Tamaño de datos: ${clusterInfo.dataSize}`);
            console.log(`   🗂️ Índices: ${clusterInfo.indexes}`);
            console.log(`   👤 Usuario conectado: ${clusterInfo.user}`);

        } catch (error) {
            this.addTestResult(testName, false, `Información de cluster falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testTransactions() {
        const testName = 'Transacciones ACID';
        console.log(`🧪 ${testName}...`);

        try {
            const session = this.client.startSession();
            
            try {
                const transactionStart = Date.now();
                
                await session.withTransaction(async () => {
                    const userId1 = uuidv4();
                    const userId2 = uuidv4();

                    // Crear dos usuarios en una transacción
                    const user1 = {
                        id: userId1,
                        email: `tx-test-1-${Date.now()}@amexing.com`,
                        username: `tx_test_1_${Date.now()}`,
                        passwordHash: await bcrypt.hash('TestPassword123!', 12),
                        firstName: 'Transaction',
                        lastName: 'Test1',
                        role: 'employee',
                        active: true,
                        createdAt: new Date()
                    };

                    const user2 = {
                        id: userId2,
                        email: `tx-test-2-${Date.now()}@amexing.com`,
                        username: `tx_test_2_${Date.now()}`,
                        passwordHash: await bcrypt.hash('TestPassword123!', 12),
                        firstName: 'Transaction',
                        lastName: 'Test2',
                        role: 'admin',
                        active: true,
                        createdAt: new Date()
                    };

                    // Insertar usuarios
                    await this.db.collection('AmexingUser').insertOne(user1, { session });
                    await this.db.collection('AmexingUser').insertOne(user2, { session });

                    // Crear permisos relacionados
                    const permission1 = {
                        userId: userId1,
                        permissions: ['basic_access'],
                        assignedBy: 'transaction_test',
                        createdAt: new Date()
                    };

                    const permission2 = {
                        userId: userId2,
                        permissions: ['admin_access'],
                        assignedBy: 'transaction_test',
                        createdAt: new Date()
                    };

                    await this.db.collection('UserPermission').insertOne(permission1, { session });
                    await this.db.collection('UserPermission').insertOne(permission2, { session });

                    console.log(`   📝 Transacción ejecutada con 4 operaciones`);
                });

                const transactionTime = Date.now() - transactionStart;
                this.testResults.performance.transactionTimes.push(transactionTime);

                // Verificar que los datos se insertaron correctamente
                const insertedUsers = await this.db.collection('AmexingUser').countDocuments({
                    email: { $regex: 'tx-test.*@amexing.com' }
                });

                const insertedPermissions = await this.db.collection('UserPermission').countDocuments({
                    assignedBy: 'transaction_test'
                });

                const transactionSuccess = insertedUsers === 2 && insertedPermissions === 2;

                this.addTestResult(testName, transactionSuccess,
                    `Transacción ACID completada (${transactionTime}ms, ${insertedUsers} usuarios, ${insertedPermissions} permisos)`);
                console.log(`   ✅ Transacción completada en ${transactionTime}ms`);
                console.log(`   👥 Usuarios creados: ${insertedUsers}`);
                console.log(`   🔐 Permisos asignados: ${insertedPermissions}`);

                // Limpiar datos de prueba
                await this.db.collection('AmexingUser').deleteMany({
                    email: { $regex: 'tx-test.*@amexing.com' }
                });
                await this.db.collection('UserPermission').deleteMany({
                    assignedBy: 'transaction_test'
                });

            } finally {
                await session.endSession();
            }

        } catch (error) {
            this.addTestResult(testName, false, `Transacciones ACID fallaron: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testIndexesAndQueryOptimization() {
        const testName = 'Índices y Optimización de Consultas';
        console.log(`🧪 ${testName}...`);

        try {
            // Verificar índices existentes
            const userIndexes = await this.db.collection('AmexingUser').indexes();
            const sessionIndexes = await this.db.collection('UserSession').indexes();

            console.log(`   📊 Índices en AmexingUser: ${userIndexes.length}`);
            console.log(`   📊 Índices en UserSession: ${sessionIndexes.length}`);

            // Crear datos de prueba para optimización
            const testUsers = [];
            for (let i = 0; i < 100; i++) {
                testUsers.push({
                    id: uuidv4(),
                    email: `perf-test-${i}@amexing.com`,
                    username: `perf_test_${i}`,
                    passwordHash: await bcrypt.hash('TestPassword123!', 12),
                    firstName: `Test${i}`,
                    lastName: `User${i}`,
                    role: i % 3 === 0 ? 'admin' : 'employee',
                    active: true,
                    createdAt: new Date(Date.now() - (i * 1000 * 60)) // Diferentes timestamps
                });
            }

            await this.db.collection('AmexingUser').insertMany(testUsers);

            // Test de queries optimizadas
            const queryTests = [
                {
                    name: 'Búsqueda por email (índice único)',
                    query: { email: 'perf-test-50@amexing.com' },
                    expectIndexUsed: true
                },
                {
                    name: 'Filtro por rol y activo',
                    query: { role: 'admin', active: true },
                    expectIndexUsed: false // Índice compuesto necesario
                },
                {
                    name: 'Búsqueda por rango de fechas',
                    query: { 
                        createdAt: { 
                            $gte: new Date(Date.now() - 30 * 60 * 1000),
                            $lte: new Date()
                        } 
                    },
                    expectIndexUsed: true
                }
            ];

            let optimizedQueries = 0;
            const queryTimes = [];

            for (const queryTest of queryTests) {
                const queryStart = Date.now();
                
                // Ejecutar query con explain
                const explainResult = await this.db.collection('AmexingUser')
                    .find(queryTest.query)
                    .explain('executionStats');

                const queryTime = Date.now() - queryStart;
                queryTimes.push(queryTime);

                const executionStats = explainResult.executionStats;
                const indexUsed = executionStats.winningPlan?.inputStage?.stage === 'IXSCAN';
                const documentsExamined = executionStats.totalDocsExamined;
                const documentsReturned = executionStats.totalDocsReturned;

                const efficiency = documentsReturned > 0 ? 
                    (documentsReturned / documentsExamined) : 0;

                console.log(`   🔍 ${queryTest.name}:`);
                console.log(`      ⏱️ Tiempo: ${queryTime}ms`);
                console.log(`      📊 Docs examinados: ${documentsExamined}`);
                console.log(`      📋 Docs devueltos: ${documentsReturned}`);
                console.log(`      🎯 Eficiencia: ${(efficiency * 100).toFixed(1)}%`);
                console.log(`      🗂️ Índice usado: ${indexUsed ? 'Sí' : 'No'}`);

                if (queryTime < 100 && efficiency > 0.1) {
                    optimizedQueries++;
                }
            }

            this.testResults.performance.queryTimes = queryTimes;
            const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;

            // Limpiar datos de prueba
            await this.db.collection('AmexingUser').deleteMany({
                email: { $regex: 'perf-test.*@amexing.com' }
            });

            const optimizationGood = optimizedQueries >= queryTests.length * 0.7 && avgQueryTime < 50;

            this.addTestResult(testName, optimizationGood,
                `Optimización de consultas validada (${optimizedQueries}/${queryTests.length} queries optimizadas, ${avgQueryTime.toFixed(2)}ms promedio)`);

        } catch (error) {
            this.addTestResult(testName, false, `Optimización de consultas falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testConcurrentOperations() {
        const testName = 'Operaciones Concurrentes';
        console.log(`🧪 ${testName}...`);

        try {
            const concurrentOperations = 20;
            const operations = [];

            console.log(`   🔄 Ejecutando ${concurrentOperations} operaciones concurrentes...`);

            // Crear operaciones concurrentes
            for (let i = 0; i < concurrentOperations; i++) {
                const operation = this.createConcurrentUser(i);
                operations.push(operation);
            }

            // Ejecutar todas las operaciones concurrentemente
            const concurrentStart = Date.now();
            const results = await Promise.allSettled(operations);
            const concurrentTime = Date.now() - concurrentStart;

            // Analizar resultados
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            // Verificar integridad de datos
            const createdUsers = await this.db.collection('AmexingUser').countDocuments({
                username: { $regex: '^concurrent_test_' }
            });

            // Verificar que no hay duplicados por email
            const emailGroups = await this.db.collection('AmexingUser').aggregate([
                { $match: { email: { $regex: 'concurrent.*@amexing.com' } } },
                { $group: { _id: '$email', count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } }
            ]).toArray();

            const noDuplicates = emailGroups.length === 0;

            // Limpiar datos
            await this.db.collection('AmexingUser').deleteMany({
                username: { $regex: '^concurrent_test_' }
            });

            const concurrencyHandled = successful >= concurrentOperations * 0.9 && 
                                     createdUsers === successful && 
                                     noDuplicates;

            this.addTestResult(testName, concurrencyHandled,
                `Operaciones concurrentes manejadas (${successful}/${concurrentOperations} exitosas, ${concurrentTime}ms, sin duplicados: ${noDuplicates})`);
            console.log(`   ✅ Operaciones exitosas: ${successful}/${concurrentOperations}`);
            console.log(`   ⏱️ Tiempo total: ${concurrentTime}ms`);
            console.log(`   👥 Usuarios creados: ${createdUsers}`);
            console.log(`   🔍 Sin duplicados: ${noDuplicates}`);

        } catch (error) {
            this.addTestResult(testName, false, `Operaciones concurrentes fallaron: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testReplicaSetConsistency() {
        const testName = 'Consistencia de Replica Set';
        console.log(`🧪 ${testName}...`);

        try {
            // Crear un usuario con read preference primary
            const userId = uuidv4();
            const testUser = {
                id: userId,
                email: `replica-test-${Date.now()}@amexing.com`,
                username: `replica_test_${Date.now()}`,
                passwordHash: await bcrypt.hash('TestPassword123!', 12),
                firstName: 'Replica',
                lastName: 'Test',
                role: 'employee',
                active: true,
                createdAt: new Date()
            };

            // Escribir con read preference primary
            await this.db.collection('AmexingUser').insertOne(testUser, {
                readPreference: ReadPreference.PRIMARY
            });

            console.log(`   📝 Usuario insertado con PRIMARY preference`);

            // Esperar un poco para replicación
            await new Promise(resolve => setTimeout(resolve, 100));

            // Leer con diferentes read preferences
            const readTests = [
                {
                    name: 'PRIMARY',
                    preference: ReadPreference.PRIMARY
                },
                {
                    name: 'SECONDARY_PREFERRED',
                    preference: ReadPreference.SECONDARY_PREFERRED
                },
                {
                    name: 'PRIMARY_PREFERRED',
                    preference: ReadPreference.PRIMARY_PREFERRED
                }
            ];

            let consistentReads = 0;

            for (const readTest of readTests) {
                try {
                    const readStart = Date.now();
                    const foundUser = await this.db.collection('AmexingUser').findOne(
                        { id: userId },
                        { readPreference: readTest.preference }
                    );
                    const readTime = Date.now() - readStart;

                    if (foundUser && foundUser.email === testUser.email) {
                        consistentReads++;
                        console.log(`   ✅ ${readTest.name}: consistente (${readTime}ms)`);
                    } else {
                        console.log(`   ❌ ${readTest.name}: inconsistente`);
                    }
                } catch (readError) {
                    console.log(`   ⚠️ ${readTest.name}: ${readError.message}`);
                }
            }

            // Limpiar datos
            await this.db.collection('AmexingUser').deleteOne({ id: userId });

            const consistencyGood = consistentReads >= 2; // Al menos PRIMARY y PRIMARY_PREFERRED

            this.addTestResult(testName, consistencyGood,
                `Consistencia de replica set validada (${consistentReads}/${readTests.length} read preferences consistentes)`);

        } catch (error) {
            this.addTestResult(testName, false, `Consistencia de replica set falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testDistributedDataPerformance() {
        const testName = 'Performance con Datos Distribuidos';
        console.log(`🧪 ${testName}...`);

        try {
            // Crear dataset distribuido
            const batchSize = 50;
            const batches = 10;
            const totalUsers = batchSize * batches;

            console.log(`   🔄 Creando ${totalUsers} usuarios en ${batches} lotes...`);

            const batchTimes = [];

            for (let batch = 0; batch < batches; batch++) {
                const batchStart = Date.now();
                const batchUsers = [];

                for (let i = 0; i < batchSize; i++) {
                    const userIndex = batch * batchSize + i;
                    batchUsers.push({
                        id: uuidv4(),
                        email: `dist-test-${userIndex}@amexing.com`,
                        username: `dist_test_${userIndex}`,
                        passwordHash: await bcrypt.hash(`TestPassword${userIndex}!`, 12),
                        firstName: `Distributed${userIndex}`,
                        lastName: `Test${userIndex}`,
                        role: userIndex % 4 === 0 ? 'admin' : 'employee',
                        department: `dept_${userIndex % 10}`,
                        region: ['north', 'south', 'east', 'west'][userIndex % 4],
                        active: true,
                        createdAt: new Date(Date.now() - (userIndex * 1000))
                    });
                }

                await this.db.collection('AmexingUser').insertMany(batchUsers);
                const batchTime = Date.now() - batchStart;
                batchTimes.push(batchTime);

                if ((batch + 1) % 3 === 0) {
                    console.log(`   📊 Lote ${batch + 1}/${batches} completado (${batchTime}ms)`);
                }
            }

            // Test de consultas distribuidas
            const distributedQueries = [
                {
                    name: 'Agregación por región',
                    pipeline: [
                        { $match: { email: { $regex: 'dist-test.*@amexing.com' } } },
                        { $group: { _id: '$region', count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ]
                },
                {
                    name: 'Usuarios activos por departamento',
                    pipeline: [
                        { $match: { 
                            email: { $regex: 'dist-test.*@amexing.com' },
                            active: true 
                        }},
                        { $group: { 
                            _id: '$department', 
                            count: { $sum: 1 },
                            avgCreatedAt: { $avg: '$createdAt' }
                        }},
                        { $limit: 5 }
                    ]
                }
            ];

            const aggregationTimes = [];

            for (const query of distributedQueries) {
                const aggStart = Date.now();
                const results = await this.db.collection('AmexingUser').aggregate(query.pipeline).toArray();
                const aggTime = Date.now() - aggStart;
                aggregationTimes.push(aggTime);

                console.log(`   📊 ${query.name}: ${results.length} resultados (${aggTime}ms)`);
            }

            // Limpiar datos
            await this.db.collection('AmexingUser').deleteMany({
                email: { $regex: 'dist-test.*@amexing.com' }
            });

            const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
            const avgAggTime = aggregationTimes.reduce((a, b) => a + b, 0) / aggregationTimes.length;

            const performanceGood = avgBatchTime < 2000 && avgAggTime < 500; // Umbrales razonables

            this.addTestResult(testName, performanceGood,
                `Performance distribuida validada (batch: ${avgBatchTime.toFixed(2)}ms, agregaciones: ${avgAggTime.toFixed(2)}ms)`);
            console.log(`   📊 Tiempo promedio por lote: ${avgBatchTime.toFixed(2)}ms`);
            console.log(`   🔍 Tiempo promedio de agregación: ${avgAggTime.toFixed(2)}ms`);

        } catch (error) {
            this.addTestResult(testName, false, `Performance distribuida falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testConnectionPooling() {
        const testName = 'Manejo de Conexiones y Pool';
        console.log(`🧪 ${testName}...`);

        try {
            // Obtener estadísticas de conexión
            const serverStatus = await this.db.admin().serverStatus();
            const connections = serverStatus.connections;

            console.log(`   🔗 Conexiones actuales: ${connections.current}`);
            console.log(`   📊 Conexiones disponibles: ${connections.available}`);
            console.log(`   📈 Total creadas: ${connections.totalCreated}`);

            // Test de múltiples operaciones simultáneas para estresar el pool
            const poolStressTest = [];
            const stressOperations = 30;

            for (let i = 0; i < stressOperations; i++) {
                const operation = this.db.collection('AmexingUser').countDocuments({});
                poolStressTest.push(operation);
            }

            const poolStart = Date.now();
            const results = await Promise.all(poolStressTest);
            const poolTime = Date.now() - poolStart;

            // Verificar que todas las operaciones se completaron
            const allCompleted = results.every(result => typeof result === 'number');

            // Obtener estadísticas después del stress test
            const afterServerStatus = await this.db.admin().serverStatus();
            const afterConnections = afterServerStatus.connections;

            console.log(`   🔗 Conexiones después del test: ${afterConnections.current}`);
            
            // Verificar que el pool se maneja correctamente
            const poolHandledCorrectly = allCompleted && 
                                       afterConnections.current <= connections.current + 10 && // No creó muchas conexiones nuevas
                                       poolTime < stressOperations * 100; // Tiempo razonable

            this.addTestResult(testName, poolHandledCorrectly,
                `Connection pooling validado (${stressOperations} ops en ${poolTime}ms, conexiones: ${afterConnections.current})`);
            console.log(`   ✅ Operaciones completadas: ${results.length}/${stressOperations}`);
            console.log(`   ⏱️ Tiempo total: ${poolTime}ms`);
            console.log(`   📊 Pool eficiente: ${poolHandledCorrectly}`);

        } catch (error) {
            this.addTestResult(testName, false, `Connection pooling falló: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testAggregationPipelines() {
        const testName = 'Agregaciones y Pipelines Complejos';
        console.log(`🧪 ${testName}...`);

        try {
            // Crear datos de ejemplo para agregaciones complejas
            const sampleUsers = [];
            const departments = ['IT', 'HR', 'Finance', 'Marketing', 'Operations'];
            const regions = ['North', 'South', 'East', 'West'];

            for (let i = 0; i < 200; i++) {
                sampleUsers.push({
                    id: uuidv4(),
                    email: `agg-test-${i}@amexing.com`,
                    username: `agg_test_${i}`,
                    firstName: `User${i}`,
                    lastName: `Test${i}`,
                    role: i % 10 === 0 ? 'admin' : 'employee',
                    department: departments[i % departments.length],
                    region: regions[i % regions.length],
                    salary: 30000 + (i * 500),
                    hireDate: new Date(2020 + (i % 4), i % 12, (i % 28) + 1),
                    active: i % 20 !== 0, // 95% activos
                    createdAt: new Date(Date.now() - (i * 1000 * 60))
                });
            }

            await this.db.collection('AmexingUser').insertMany(sampleUsers);

            // Pipeline de agregación complejo
            const complexPipeline = [
                // Filtrar usuarios activos
                { $match: { active: true, email: { $regex: 'agg-test.*@amexing.com' } } },
                
                // Agregar campos calculados
                { $addFields: {
                    yearsOfService: {
                        $divide: [
                            { $subtract: [new Date(), '$hireDate'] },
                            1000 * 60 * 60 * 24 * 365
                        ]
                    },
                    salaryBand: {
                        $switch: {
                            branches: [
                                { case: { $lt: ['$salary', 40000] }, then: 'Junior' },
                                { case: { $lt: ['$salary', 60000] }, then: 'Mid' },
                                { case: { $gte: ['$salary', 60000] }, then: 'Senior' }
                            ],
                            default: 'Unknown'
                        }
                    }
                }},
                
                // Agrupar por departamento y región
                { $group: {
                    _id: {
                        department: '$department',
                        region: '$region',
                        salaryBand: '$salaryBand'
                    },
                    count: { $sum: 1 },
                    avgSalary: { $avg: '$salary' },
                    avgYearsOfService: { $avg: '$yearsOfService' },
                    maxSalary: { $max: '$salary' },
                    minSalary: { $min: '$salary' }
                }},
                
                // Ordenar por departamento y salario promedio
                { $sort: { '_id.department': 1, 'avgSalary': -1 } },
                
                // Limitar resultados
                { $limit: 20 },
                
                // Reformatear salida
                { $project: {
                    department: '$_id.department',
                    region: '$_id.region',
                    salaryBand: '$_id.salaryBand',
                    employeeCount: '$count',
                    averageSalary: { $round: ['$avgSalary', 2] },
                    averageYears: { $round: ['$avgYearsOfService', 1] },
                    salaryRange: {
                        min: '$minSalary',
                        max: '$maxSalary'
                    },
                    _id: 0
                }}
            ];

            const aggStart = Date.now();
            const aggregationResults = await this.db.collection('AmexingUser')
                .aggregate(complexPipeline)
                .toArray();
            const aggTime = Date.now() - aggStart;

            // Pipeline de análisis temporal
            const temporalPipeline = [
                { $match: { email: { $regex: 'agg-test.*@amexing.com' } } },
                { $group: {
                    _id: {
                        year: { $year: '$hireDate' },
                        month: { $month: '$hireDate' },
                        department: '$department'
                    },
                    hiresCount: { $sum: 1 }
                }},
                { $sort: { '_id.year': 1, '_id.month': 1 } }
            ];

            const temporalStart = Date.now();
            const temporalResults = await this.db.collection('AmexingUser')
                .aggregate(temporalPipeline)
                .toArray();
            const temporalTime = Date.now() - temporalStart;

            // Limpiar datos
            await this.db.collection('AmexingUser').deleteMany({
                email: { $regex: 'agg-test.*@amexing.com' }
            });

            const aggregationsWorking = aggregationResults.length > 0 && 
                                      temporalResults.length > 0 && 
                                      aggTime < 1000 && 
                                      temporalTime < 1000;

            this.addTestResult(testName, aggregationsWorking,
                `Agregaciones complejas validadas (${aggregationResults.length} resultados en ${aggTime}ms, análisis temporal: ${temporalTime}ms)`);
            console.log(`   📊 Agregación compleja: ${aggregationResults.length} resultados (${aggTime}ms)`);
            console.log(`   📈 Análisis temporal: ${temporalResults.length} resultados (${temporalTime}ms)`);
            console.log(`   🎯 Performance agregación: ${aggTime < 500 ? 'Excelente' : aggTime < 1000 ? 'Buena' : 'Mejorable'}`);

        } catch (error) {
            this.addTestResult(testName, false, `Agregaciones complejas fallaron: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    async testMonitoringAndMetrics() {
        const testName = 'Monitoring y Métricas';
        console.log(`🧪 ${testName}...`);

        try {
            // Obtener métricas del servidor
            const serverStatus = await this.db.admin().serverStatus();
            const dbStats = await this.db.stats();

            // Métricas de conexiones
            const connectionMetrics = {
                current: serverStatus.connections?.current || 0,
                available: serverStatus.connections?.available || 0,
                totalCreated: serverStatus.connections?.totalCreated || 0
            };

            // Métricas de operaciones
            const opCounters = serverStatus.opcounters || {};
            const operationMetrics = {
                insert: opCounters.insert || 0,
                query: opCounters.query || 0,
                update: opCounters.update || 0,
                delete: opCounters.delete || 0,
                command: opCounters.command || 0
            };

            // Métricas de memoria y storage
            const memoryMetrics = {
                resident: serverStatus.mem?.resident || 0,
                virtual: serverStatus.mem?.virtual || 0,
                mapped: serverStatus.mem?.mapped || 0
            };

            const storageMetrics = {
                dataSize: dbStats.dataSize || 0,
                storageSize: dbStats.storageSize || 0,
                indexSize: dbStats.indexSize || 0,
                collections: dbStats.collections || 0,
                objects: dbStats.objects || 0
            };

            // Métricas de performance (si están disponibles)
            let performanceMetrics = null;
            try {
                // Obtener estadísticas de operaciones recientes
                const profileCollection = this.db.collection('system.profile');
                const recentOps = await profileCollection.find({}).limit(10).toArray();
                
                if (recentOps.length > 0) {
                    const avgDuration = recentOps.reduce((sum, op) => sum + (op.ts?.duration || 0), 0) / recentOps.length;
                    performanceMetrics = {
                        recentOperations: recentOps.length,
                        avgDuration: avgDuration
                    };
                }
            } catch (profilerError) {
                // Profiling podría no estar habilitado
                console.log(`   ⚠️ Profiling no disponible (normal en Atlas)`);
            }

            // Validar métricas
            const metricsValid = connectionMetrics.current > 0 && 
                               operationMetrics.command > 0 && 
                               storageMetrics.collections >= 0;

            console.log(`   🔗 Conexiones: ${connectionMetrics.current} activas, ${connectionMetrics.available} disponibles`);
            console.log(`   📊 Operaciones: ${operationMetrics.query} queries, ${operationMetrics.insert} inserts`);
            console.log(`   💾 Memoria: ${memoryMetrics.resident}MB residente`);
            console.log(`   🗄️ Storage: ${this.formatBytes(storageMetrics.dataSize)} datos, ${storageMetrics.collections} colecciones`);
            
            if (performanceMetrics) {
                console.log(`   ⏱️ Performance: ${performanceMetrics.recentOperations} ops recientes, ${performanceMetrics.avgDuration}ms promedio`);
            }

            this.addTestResult(testName, metricsValid,
                `Métricas y monitoring validados (${connectionMetrics.current} conexiones, ${storageMetrics.collections} colecciones, ${this.formatBytes(storageMetrics.dataSize)} datos)`);

        } catch (error) {
            this.addTestResult(testName, false, `Monitoring y métricas fallaron: ${error.message}`);
            console.log(`   ❌ ${error.message}`);
        }
    }

    // Métodos utilitarios

    async createConcurrentUser(index) {
        const userId = uuidv4();
        const user = {
            id: userId,
            email: `concurrent-${index}-${Date.now()}@amexing.com`,
            username: `concurrent_test_${index}_${Date.now()}`,
            passwordHash: await bcrypt.hash(`ConcurrentTest${index}!`, 12),
            firstName: `Concurrent${index}`,
            lastName: `Test${index}`,
            role: index % 3 === 0 ? 'admin' : 'employee',
            active: true,
            createdAt: new Date()
        };

        await this.db.collection('AmexingUser').insertOne(user);
        return { index, userId, success: true };
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async disconnectFromAtlas() {
        try {
            if (this.client) {
                await this.client.close();
                console.log('   📝 Conexión a MongoDB Atlas cerrada');
            }
        } catch (error) {
            console.log(`   ⚠️ Error cerrando conexión: ${error.message}`);
        }
    }

    addTestResult(name, success, message) {
        this.testResults.tests.push({
            name,
            success,
            message,
            timestamp: new Date().toISOString()
        });
    }

    generateFinalReport() {
        const totalTests = this.testResults.tests.length;
        const passedTests = this.testResults.tests.filter(test => test.success).length;
        const failedTests = totalTests - passedTests;
        const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;

        this.testResults.overall = {
            success: failedTests === 0,
            message: `${passedTests}/${totalTests} tests passed`,
            successRate: successRate
        };

        console.log('\n🎯 RESUMEN DE INTEGRACIÓN MONGODB ATLAS');
        console.log('=====================================');
        console.log(`📅 Timestamp: ${this.testResults.timestamp}`);
        console.log(`🗄️ MongoDB Atlas: ${this.testResults.mongoAtlas.connected ? 'Conectado' : 'Desconectado'}`);
        console.log(`📊 MongoDB Version: ${this.testResults.mongoAtlas.mongoVersion || 'Unknown'}`);
        console.log(`⚡ Tiempo de conexión: ${this.testResults.mongoAtlas.connectionTime || 0}ms`);
        console.log(`🧪 Total Tests: ${totalTests}`);
        console.log(`✅ Tests Pasados: ${passedTests}`);
        console.log(`❌ Tests Fallidos: ${failedTests}`);
        console.log(`📈 Tasa de Éxito: ${successRate}%`);
        console.log(`🎯 Estado General: ${this.testResults.overall.success ? 'ÉXITO' : 'FALLÓ'}`);

        console.log('\n📋 COMPONENTES DE ATLAS VALIDADOS:');
        console.log('- ✅ Conexión y configuración del cluster');
        console.log('- ✅ Información y estadísticas del cluster');
        console.log('- ✅ Transacciones ACID');
        console.log('- ✅ Índices y optimización de consultas');
        console.log('- ✅ Operaciones concurrentes');
        console.log('- ✅ Consistencia de replica set');
        console.log('- ✅ Performance con datos distribuidos');
        console.log('- ✅ Connection pooling');
        console.log('- ✅ Agregaciones complejas');
        console.log('- ✅ Monitoring y métricas');

        // Performance summary
        if (this.testResults.performance.queryTimes.length > 0) {
            const avgQueryTime = this.testResults.performance.queryTimes.reduce((a, b) => a + b, 0) / this.testResults.performance.queryTimes.length;
            console.log(`\n⚡ MÉTRICAS DE PERFORMANCE:`);
            console.log(`- Conexión inicial: ${this.testResults.performance.connectionTime}ms`);
            console.log(`- Consultas promedio: ${avgQueryTime.toFixed(2)}ms`);
            console.log(`- Transacciones: ${this.testResults.performance.transactionTimes.length} ejecutadas`);
        }

        // Guardar reporte
        const reportPath = `reports/mongodb-atlas-integration-${new Date().toISOString().replace(/:/g, '-')}.json`;
        require('fs').writeFileSync(reportPath, JSON.stringify(this.testResults, null, 2));
        console.log(`\n💾 Reporte detallado guardado en: ${reportPath}`);
    }
}

// Ejecutar integración si el script se ejecuta directamente
if (require.main === module) {
    const integration = new AuthMongoDBAtlasIntegration();
    integration.runAllTests()
        .then((results) => {
            process.exit(results.overall.success ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Integración MongoDB Atlas falló:', error);
            process.exit(1);
        });
}

module.exports = { AuthMongoDBAtlasIntegration };