#!/usr/bin/env node

/**
 * Automated Dependency Graph Generator
 * 
 * Generates visual dependency graphs based on the comprehensive system mapping
 * from Phases 2-4 of the regression prevention strategy. Creates multiple graph
 * types: API dependencies, external services, configuration chains, and feature flags.
 * 
 * Features:
 * - Multiple output formats (DOT, Mermaid, JSON)
 * - Different graph types (API, Services, Config, Features)
 * - Interactive web viewer
 * - Risk highlighting based on criticality
 * - Filter options for focused analysis
 * 
 * Usage:
 *   node scripts/analysis/generate-dependency-graph.js [options]
 *   
 * Options:
 *   --type=api|services|config|features|all (default: all)
 *   --format=dot|mermaid|json|html (default: all)
 *   --output=<directory> (default: docs/graphs)
 *   --risk-highlight (highlight high-risk dependencies)
 *   --interactive (generate interactive HTML viewer)
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

class DependencyGraphGenerator {
  constructor(options = {}) {
    this.options = {
      type: options.type || 'all',
      format: options.format || 'all', 
      output: options.output || 'docs/graphs',
      riskHighlight: options.riskHighlight || false,
      interactive: options.interactive || false,
      ...options
    };
    
    this.dependencies = {};
    this.loadSystemData();
  }

  /**
   * Load system dependency data from our documentation
   */
  loadSystemData() {
    // API Dependencies (from Phase 2 & 3)
    this.dependencies.api = {
      controllers: [
        // Dashboard Controllers
        { name: 'SuperAdminController', type: 'dashboard', role: 'superadmin', apis: 15 },
        { name: 'AdminController', type: 'dashboard', role: 'admin', apis: 25 },
        { name: 'ClientController', type: 'dashboard', role: 'client', apis: 15 },
        { name: 'DepartmentManagerController', type: 'dashboard', role: 'department_manager', apis: 10 },
        { name: 'EmployeeController', type: 'dashboard', role: 'employee', apis: 6 },
        { name: 'DriverController', type: 'dashboard', role: 'driver', apis: 5 },
        { name: 'GuestController', type: 'dashboard', role: 'guest', apis: 3 },
        
        // API Controllers (47 total)
        { name: 'QuoteController', type: 'api', criticality: 'high', dependencies: ['ReservationController', 'BillingController'] },
        { name: 'ReservationController', type: 'api', criticality: 'high', dependencies: ['VehicleController', 'EmployeesController'] },
        { name: 'BillingController', type: 'api', criticality: 'high', dependencies: ['InvoiceController', 'PaymentInfoController'] },
        { name: 'InvoiceController', type: 'api', criticality: 'high', dependencies: ['TarifarioExportController'] },
        { name: 'ExperienceController', type: 'api', criticality: 'medium', dependencies: ['VehicleController', 'ToursController'] },
        { name: 'VehicleController', type: 'api', criticality: 'medium', dependencies: ['VehicleImageController'] },
        { name: 'EmployeesController', type: 'api', criticality: 'medium', dependencies: ['ClientEmployeesController'] },
        { name: 'ClientsController', type: 'api', criticality: 'medium', dependencies: ['OwnedClientsController'] },
        { name: 'UserManagementController', type: 'api', criticality: 'high', dependencies: ['AmexingUsersController', 'RolesController'] },
        { name: 'AuthController', type: 'auth', criticality: 'critical', dependencies: ['OAuthService'] }
      ],
      
      frontendCoupling: {
        critical: ['DataTable components', 'Modal forms', 'Authentication flow'],
        high: ['Real-time features', 'Role-based UI'],
        medium: ['Static assets', 'Template inheritance']
      }
    };

    // External Services (from Phase 4)
    this.dependencies.services = {
      critical: [
        { name: 'Parse Server', type: 'backend-as-a-service', impact: 'critical', depends: ['MongoDB Atlas', 'Cloud Functions'] },
        { name: 'MongoDB Atlas', type: 'database', impact: 'critical', depends: [] }
      ],
      high: [
        { name: 'AWS S3', type: 'file-storage', impact: 'high', depends: ['IAM Roles', 'Encryption'] },
        { name: 'MailerSend', type: 'email', impact: 'high', depends: ['SMTP Fallback'] }
      ],
      medium: [
        { name: 'Google OAuth', type: 'authentication', impact: 'medium', depends: ['OAuth Credentials'] },
        { name: 'Semgrep', type: 'security', impact: 'medium', depends: [] },
        { name: 'ESLint', type: 'quality', impact: 'medium', depends: [] }
      ]
    };

    // Configuration Dependencies (from Phase 4)
    this.dependencies.config = {
      critical: [
        { name: 'PARSE_APP_ID', type: 'core', affects: ['Parse Server', 'Database Connection'] },
        { name: 'PARSE_MASTER_KEY', type: 'core', affects: ['Parse Server', 'Authentication'] },
        { name: 'DATABASE_URI', type: 'core', affects: ['MongoDB Connection', 'Data Access'] },
        { name: 'JWT_SECRET', type: 'security', affects: ['API Authentication', 'Session Management'] },
        { name: 'SESSION_SECRET', type: 'security', affects: ['Web Sessions', 'Cookie Security'] }
      ],
      high: [
        { name: 'S3_BUCKET', type: 'storage', affects: ['File Uploads', 'Image Storage'] },
        { name: 'MAILERSEND_API_TOKEN', type: 'communication', affects: ['Email Delivery', 'Notifications'] },
        { name: 'GOOGLE_OAUTH_CLIENT_ID', type: 'authentication', affects: ['OAuth Login', 'SSO'] }
      ],
      medium: [
        { name: 'LOG_LEVEL', type: 'operational', affects: ['Debugging', 'Performance'] },
        { name: 'RATE_LIMIT_MAX_REQUESTS', type: 'performance', affects: ['API Protection', 'User Experience'] }
      ]
    };

    // Feature Flags (from Phase 4)
    this.dependencies.features = {
      critical: [
        { name: 'NODE_ENV', affects: ['Security Settings', 'Database Permissions', 'Error Handling'] },
        { name: 'ENABLE_PCI_COMPLIANCE', affects: ['Password Policy', 'Audit Logging', 'Session Timeout'] }
      ],
      high: [
        { name: 'GOOGLE_OAUTH_ENABLED', affects: ['Login Options', 'SSO Availability'] },
        { name: 'allowClientClassCreation', affects: ['Database Schema', 'Development Features'] }
      ],
      medium: [
        { name: 'ENABLE_MONITORING', affects: ['Health Checks', 'Metrics Collection'] },
        { name: 'OAUTH_MOCK_MODE', affects: ['Testing', 'Development'] }
      ]
    };

    // RBAC Permission Matrix (from Phase 3)
    this.dependencies.rbac = {
      roles: ['superadmin', 'admin', 'client', 'department_manager', 'employee', 'employee_amexing', 'driver', 'guest'],
      permissions: 30,
      scopes: ['own', 'department', 'organization', 'system'],
      categories: ['user_management', 'client_management', 'booking_management', 'service_management', 'reporting']
    };
  }

  /**
   * Generate all dependency graphs
   */
  async generate() {
    console.log('🚀 Starting dependency graph generation...');
    console.log(`📊 Type: ${this.options.type}`);
    console.log(`📄 Format: ${this.options.format}`);
    console.log(`📁 Output: ${this.options.output}\n`);

    // Ensure output directory exists
    if (!fs.existsSync(this.options.output)) {
      fs.mkdirSync(this.options.output, { recursive: true });
    }

    const types = this.options.type === 'all' 
      ? ['api', 'services', 'config', 'features']
      : [this.options.type];

    const formats = this.options.format === 'all'
      ? ['dot', 'mermaid', 'json']
      : [this.options.format];

    for (const type of types) {
      console.log(`\n📈 Generating ${type} dependency graphs...`);
      
      for (const format of formats) {
        await this.generateGraph(type, format);
      }
    }

    // Generate interactive HTML viewer if requested
    if (this.options.interactive || this.options.format === 'html' || this.options.format === 'all') {
      await this.generateInteractiveViewer();
    }

    // Generate summary report
    await this.generateSummaryReport();

    console.log('\n✅ Dependency graph generation complete!');
    console.log(`📁 Output saved to: ${this.options.output}`);
  }

  /**
   * Generate specific graph type and format
   */
  async generateGraph(type, format) {
    let graphData;
    
    switch (type) {
      case 'api':
        graphData = this.generateAPIGraph(format);
        break;
      case 'services':
        graphData = this.generateServicesGraph(format);
        break;
      case 'config':
        graphData = this.generateConfigGraph(format);
        break;
      case 'features':
        graphData = this.generateFeaturesGraph(format);
        break;
      default:
        console.error(`❌ Unknown graph type: ${type}`);
        return;
    }

    const filename = `${type}-dependencies.${format}`;
    const filepath = path.join(this.options.output, filename);
    
    fs.writeFileSync(filepath, graphData);
    console.log(`   ✅ ${filename}`);
  }

  /**
   * Generate API dependency graph
   */
  generateAPIGraph(format) {
    const { controllers, frontendCoupling } = this.dependencies.api;
    
    switch (format) {
      case 'dot':
        return this.generateDOTGraph('API Dependencies', controllers, (ctrl) => {
          const color = this.getRiskColor(ctrl.criticality);
          return `"${ctrl.name}" [fillcolor="${color}", style=filled, label="${ctrl.name}\\n(${ctrl.type})"];`;
        });
        
      case 'mermaid':
        let mermaid = 'graph TD\n';
        mermaid += '  classDef critical fill:#ff6b6b\n';
        mermaid += '  classDef high fill:#ffa726\n';
        mermaid += '  classDef medium fill:#66bb6a\n\n';
        
        controllers.forEach(ctrl => {
          if (ctrl.dependencies) {
            ctrl.dependencies.forEach(dep => {
              mermaid += `  ${ctrl.name} --> ${dep}\n`;
            });
          }
          if (ctrl.criticality) {
            mermaid += `  class ${ctrl.name} ${ctrl.criticality}\n`;
          }
        });
        
        return mermaid;
        
      case 'json':
        return JSON.stringify({
          type: 'api-dependencies',
          generated: new Date().toISOString(),
          data: { controllers, frontendCoupling }
        }, null, 2);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Generate external services dependency graph
   */
  generateServicesGraph(format) {
    const { critical, high, medium } = this.dependencies.services;
    const allServices = [...critical, ...high, ...medium];
    
    switch (format) {
      case 'dot':
        return this.generateDOTGraph('External Services', allServices, (service) => {
          const color = this.getRiskColor(service.impact);
          let dot = `"${service.name}" [fillcolor="${color}", style=filled, label="${service.name}\\n(${service.type})"];`;
          
          if (service.depends && service.depends.length > 0) {
            service.depends.forEach(dep => {
              dot += `\n"${service.name}" -> "${dep}";`;
            });
          }
          
          return dot;
        });
        
      case 'mermaid':
        let mermaid = 'graph TD\n';
        mermaid += '  classDef critical fill:#ff6b6b\n';
        mermaid += '  classDef high fill:#ffa726\n';
        mermaid += '  classDef medium fill:#66bb6a\n\n';
        
        allServices.forEach(service => {
          const nodeId = service.name.replace(/\s+/g, '');
          mermaid += `  ${nodeId}["${service.name}<br/>(${service.type})"]\n`;
          
          if (service.depends && service.depends.length > 0) {
            service.depends.forEach(dep => {
              const depId = dep.replace(/\s+/g, '');
              mermaid += `  ${depId} --> ${nodeId}\n`;
            });
          }
          
          mermaid += `  class ${nodeId} ${service.impact}\n`;
        });
        
        return mermaid;
        
      case 'json':
        return JSON.stringify({
          type: 'external-services',
          generated: new Date().toISOString(),
          data: { critical, high, medium }
        }, null, 2);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Generate configuration dependency graph
   */
  generateConfigGraph(format) {
    const { critical, high, medium } = this.dependencies.config;
    const allConfigs = [...critical, ...high, ...medium];
    
    switch (format) {
      case 'dot':
        return this.generateDOTGraph('Configuration Dependencies', allConfigs, (config) => {
          const color = this.getRiskColor(config.type === 'core' ? 'critical' : 'medium');
          let dot = `"${config.name}" [fillcolor="${color}", style=filled, label="${config.name}\\n(${config.type})"];`;
          
          if (config.affects) {
            config.affects.forEach(affected => {
              dot += `\n"${config.name}" -> "${affected}";`;
            });
          }
          
          return dot;
        });
        
      case 'mermaid':
        let mermaid = 'graph LR\n';
        mermaid += '  classDef core fill:#ff6b6b\n';
        mermaid += '  classDef security fill:#ffa726\n';
        mermaid += '  classDef operational fill:#66bb6a\n\n';
        
        allConfigs.forEach(config => {
          const nodeId = config.name.replace(/[^A-Za-z0-9]/g, '');
          mermaid += `  ${nodeId}["${config.name}<br/>(${config.type})"]\n`;
          
          if (config.affects) {
            config.affects.forEach(affected => {
              const affectedId = affected.replace(/[^A-Za-z0-9]/g, '');
              mermaid += `  ${nodeId} --> ${affectedId}["${affected}"]\n`;
            });
          }
          
          mermaid += `  class ${nodeId} ${config.type}\n`;
        });
        
        return mermaid;
        
      case 'json':
        return JSON.stringify({
          type: 'configuration-dependencies',
          generated: new Date().toISOString(),
          data: { critical, high, medium }
        }, null, 2);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Generate feature flags dependency graph
   */
  generateFeaturesGraph(format) {
    const { critical, high, medium } = this.dependencies.features;
    const allFeatures = [...critical, ...high, ...medium];
    
    switch (format) {
      case 'dot':
        return this.generateDOTGraph('Feature Flags', allFeatures, (feature) => {
          const priority = critical.includes(feature) ? 'critical' : high.includes(feature) ? 'high' : 'medium';
          const color = this.getRiskColor(priority);
          let dot = `"${feature.name}" [fillcolor="${color}", style=filled, label="${feature.name}"];`;
          
          if (feature.affects) {
            feature.affects.forEach(affected => {
              dot += `\n"${feature.name}" -> "${affected}";`;
            });
          }
          
          return dot;
        });
        
      case 'mermaid':
        let mermaid = 'flowchart TD\n';
        mermaid += '  classDef critical fill:#ff6b6b\n';
        mermaid += '  classDef high fill:#ffa726\n';
        mermaid += '  classDef medium fill:#66bb6a\n\n';
        
        allFeatures.forEach(feature => {
          const nodeId = feature.name.replace(/[^A-Za-z0-9]/g, '');
          const priority = critical.includes(feature) ? 'critical' : high.includes(feature) ? 'high' : 'medium';
          
          mermaid += `  ${nodeId}["${feature.name}"]\n`;
          
          if (feature.affects) {
            feature.affects.forEach(affected => {
              const affectedId = affected.replace(/[^A-Za-z0-9]/g, '');
              mermaid += `  ${nodeId} --> ${affectedId}["${affected}"]\n`;
            });
          }
          
          mermaid += `  class ${nodeId} ${priority}\n`;
        });
        
        return mermaid;
        
      case 'json':
        return JSON.stringify({
          type: 'feature-flags',
          generated: new Date().toISOString(),
          data: { critical, high, medium, rbac: this.dependencies.rbac }
        }, null, 2);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Generate DOT format graph
   */
  generateDOTGraph(title, items, nodeFormatter) {
    let dot = `digraph "${title}" {\n`;
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=rectangle, style=filled];\n';
    dot += '  edge [color=gray];\n\n';
    
    items.forEach(item => {
      dot += '  ' + nodeFormatter(item) + '\n';
    });
    
    dot += '}';
    return dot;
  }

  /**
   * Get color based on risk level
   */
  getRiskColor(risk) {
    if (!this.options.riskHighlight) return '#e3f2fd';
    
    switch (risk) {
      case 'critical': return '#ff6b6b';
      case 'high': return '#ffa726';
      case 'medium': return '#66bb6a';
      case 'low': return '#e3f2fd';
      default: return '#f5f5f5';
    }
  }

  /**
   * Generate interactive HTML viewer
   */
  async generateInteractiveViewer() {
    console.log('\n🌐 Generating interactive HTML viewer...');
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Amexing Dependency Graphs - Interactive Viewer</title>
    <script src="https://unpkg.com/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f8f9fa;
            color: #333;
        }
        
        .header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        .graph-container {
            background: white;
            margin: 20px 0;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .graph-header {
            background: #2196F3;
            color: white;
            padding: 15px 20px;
            font-weight: bold;
            font-size: 1.1em;
        }
        
        .graph-content {
            padding: 20px;
            min-height: 400px;
        }
        
        .controls {
            background: #f0f0f0;
            padding: 10px 20px;
            border-bottom: 1px solid #ddd;
        }
        
        .controls button {
            background: #2196F3;
            color: white;
            border: none;
            padding: 8px 16px;
            margin: 0 5px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .controls button:hover {
            background: #1976D2;
        }
        
        .controls button.active {
            background: #FF9800;
        }
        
        .legend {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            margin-top: 15px;
        }
        
        .legend-item {
            display: inline-block;
            margin: 5px 15px 5px 0;
        }
        
        .legend-color {
            display: inline-block;
            width: 20px;
            height: 20px;
            border-radius: 3px;
            vertical-align: middle;
            margin-right: 8px;
        }
        
        .mermaid {
            text-align: center;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.5em;
            font-weight: bold;
            color: #2196F3;
        }
        
        .stat-label {
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔗 Amexing Dependency Graphs</h1>
        <p>Interactive visualization of system dependencies, external services, configuration chains, and feature flags.</p>
        <p><strong>Generated:</strong> ${new Date().toISOString()} | <strong>Phase:</strong> 5 - Advanced Tooling</p>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-number">47</div>
            <div class="stat-label">API Controllers</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">8</div>
            <div class="stat-label">External Services</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">50+</div>
            <div class="stat-label">Configuration Variables</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">15+</div>
            <div class="stat-label">Feature Flags</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">8</div>
            <div class="stat-label">User Roles</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">30</div>
            <div class="stat-label">RBAC Permissions</div>
        </div>
    </div>

    <div class="graph-container">
        <div class="graph-header">
            🏗️ API Dependencies & Frontend Coupling
        </div>
        <div class="controls">
            <button onclick="showGraph('api')" class="active" id="api-btn">API Controllers</button>
            <button onclick="showGraph('services')" id="services-btn">External Services</button>
            <button onclick="showGraph('config')" id="config-btn">Configuration</button>
            <button onclick="showGraph('features')" id="features-btn">Feature Flags</button>
        </div>
        <div class="graph-content">
            <div id="api-graph" class="mermaid">
                graph TD
                    classDef critical fill:#ff6b6b
                    classDef high fill:#ffa726
                    classDef medium fill:#66bb6a
                    
                    SuperAdminController --> AdminController
                    AdminController --> ClientController
                    ClientController --> DepartmentManagerController
                    DepartmentManagerController --> EmployeeController
                    EmployeeController --> DriverController
                    DriverController --> GuestController
                    
                    QuoteController --> ReservationController
                    QuoteController --> BillingController
                    ReservationController --> VehicleController
                    ReservationController --> EmployeesController
                    BillingController --> InvoiceController
                    BillingController --> PaymentInfoController
                    
                    ExperienceController --> VehicleController
                    ExperienceController --> ToursController
                    VehicleController --> VehicleImageController
                    EmployeesController --> ClientEmployeesController
                    ClientsController --> OwnedClientsController
                    UserManagementController --> AmexingUsersController
                    UserManagementController --> RolesController
                    
                    AuthController --> OAuthService
                    
                    class QuoteController critical
                    class ReservationController critical
                    class BillingController critical
                    class AuthController critical
                    class ExperienceController high
                    class VehicleController high
                    class EmployeesController high
                    class ClientsController high
            </div>
            
            <div id="services-graph" class="mermaid" style="display: none;">
                graph TD
                    classDef critical fill:#ff6b6b
                    classDef high fill:#ffa726
                    classDef medium fill:#66bb6a
                    
                    ParseServer["Parse Server<br/>(Backend-as-a-Service)"]
                    MongoDB["MongoDB Atlas<br/>(Database)"]
                    S3["AWS S3<br/>(File Storage)"]
                    MailerSend["MailerSend<br/>(Email Service)"]
                    GoogleOAuth["Google OAuth<br/>(Authentication)"]
                    Semgrep["Semgrep<br/>(Security Analysis)"]
                    
                    MongoDB --> ParseServer
                    CloudFunctions["Cloud Functions"] --> ParseServer
                    IAMRoles["IAM Roles"] --> S3
                    Encryption["Encryption"] --> S3
                    SMTPFallback["SMTP Fallback"] --> MailerSend
                    OAuthCredentials["OAuth Credentials"] --> GoogleOAuth
                    
                    class ParseServer critical
                    class MongoDB critical
                    class S3 high
                    class MailerSend high
                    class GoogleOAuth medium
                    class Semgrep medium
            </div>
            
            <div id="config-graph" class="mermaid" style="display: none;">
                graph LR
                    classDef core fill:#ff6b6b
                    classDef security fill:#ffa726
                    classDef operational fill:#66bb6a
                    
                    PARSEAPPID["PARSE_APP_ID"] --> ParseConnection["Parse Server"]
                    PARSEMASTERKEY["PARSE_MASTER_KEY"] --> Authentication["Authentication"]
                    DATABASEURI["DATABASE_URI"] --> MongoConnection["MongoDB Connection"]
                    JWTSECRET["JWT_SECRET"] --> APIAuth["API Authentication"]
                    SESSIONSECRET["SESSION_SECRET"] --> WebSessions["Web Sessions"]
                    
                    S3BUCKET["S3_BUCKET"] --> FileUploads["File Uploads"]
                    MAILERTOKEN["MAILERSEND_API_TOKEN"] --> EmailDelivery["Email Delivery"]
                    GOOGLECLIENT["GOOGLE_OAUTH_CLIENT_ID"] --> OAuthLogin["OAuth Login"]
                    
                    LOGLEVEL["LOG_LEVEL"] --> Debugging["Debugging"]
                    RATELIMIT["RATE_LIMIT_MAX_REQUESTS"] --> APIProtection["API Protection"]
                    
                    class PARSEAPPID core
                    class PARSEMASTERKEY core
                    class DATABASEURI core
                    class JWTSECRET security
                    class SESSIONSECRET security
                    class S3BUCKET operational
                    class MAILERTOKEN operational
                    class GOOGLECLIENT operational
                    class LOGLEVEL operational
                    class RATELIMIT operational
            </div>
            
            <div id="features-graph" class="mermaid" style="display: none;">
                flowchart TD
                    classDef critical fill:#ff6b6b
                    classDef high fill:#ffa726
                    classDef medium fill:#66bb6a
                    
                    NODEENV["NODE_ENV"] --> SecuritySettings["Security Settings"]
                    NODEENV --> DatabasePermissions["Database Permissions"]
                    NODEENV --> ErrorHandling["Error Handling"]
                    
                    PCICOMPLIANCE["ENABLE_PCI_COMPLIANCE"] --> PasswordPolicy["Password Policy"]
                    PCICOMPLIANCE --> AuditLogging["Audit Logging"]
                    PCICOMPLIANCE --> SessionTimeout["Session Timeout"]
                    
                    GOOGLEENABLED["GOOGLE_OAUTH_ENABLED"] --> LoginOptions["Login Options"]
                    GOOGLEENABLED --> SSOAvailability["SSO Availability"]
                    
                    CLIENTCLASS["allowClientClassCreation"] --> DatabaseSchema["Database Schema"]
                    CLIENTCLASS --> DevFeatures["Development Features"]
                    
                    MONITORING["ENABLE_MONITORING"] --> HealthChecks["Health Checks"]
                    MONITORING --> MetricsCollection["Metrics Collection"]
                    
                    MOCKMODE["OAUTH_MOCK_MODE"] --> Testing["Testing"]
                    MOCKMODE --> Development["Development"]
                    
                    class NODEENV critical
                    class PCICOMPLIANCE critical
                    class GOOGLEENABLED high
                    class CLIENTCLASS high
                    class MONITORING medium
                    class MOCKMODE medium
            </div>
        </div>
        
        <div class="legend">
            <strong>Risk Level Legend:</strong>
            <div class="legend-item">
                <span class="legend-color" style="background: #ff6b6b;"></span>
                Critical Impact
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: #ffa726;"></span>
                High Impact
            </div>
            <div class="legend-item">
                <span class="legend-color" style="background: #66bb6a;"></span>
                Medium Impact
            </div>
        </div>
    </div>

    <script>
        // Initialize Mermaid
        mermaid.initialize({ 
            startOnLoad: true,
            theme: 'default',
            flowchart: {
                curve: 'basis',
                padding: 20
            },
            themeVariables: {
                fontSize: '14px',
                fontFamily: 'Segoe UI, sans-serif'
            }
        });

        // Graph switching functionality
        function showGraph(type) {
            // Hide all graphs
            document.getElementById('api-graph').style.display = 'none';
            document.getElementById('services-graph').style.display = 'none';
            document.getElementById('config-graph').style.display = 'none';
            document.getElementById('features-graph').style.display = 'none';
            
            // Remove active class from all buttons
            document.querySelectorAll('.controls button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Show selected graph and activate button
            document.getElementById(type + '-graph').style.display = 'block';
            document.getElementById(type + '-btn').classList.add('active');
        }

        // Add export functionality
        function exportGraph(format) {
            const activeGraph = document.querySelector('.mermaid[style="display: block;"]');
            if (format === 'png') {
                // Would need additional libraries for PNG export
                alert('PNG export would require additional setup with puppeteer or similar');
            } else if (format === 'svg') {
                // Extract SVG content
                const svg = activeGraph.querySelector('svg');
                if (svg) {
                    const svgData = new XMLSerializer().serializeToString(svg);
                    const blob = new Blob([svgData], {type: 'image/svg+xml'});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'dependency-graph.svg';
                    a.click();
                }
            }
        }

        console.log('🔗 Amexing Dependency Graph Viewer loaded successfully!');
        console.log('📊 Use the buttons to switch between different dependency views');
    </script>
</body>
</html>`;

    const filepath = path.join(this.options.output, 'interactive-viewer.html');
    fs.writeFileSync(filepath, html);
    console.log('   ✅ interactive-viewer.html');
  }

  /**
   * Generate summary report
   */
  async generateSummaryReport() {
    console.log('\n📋 Generating dependency summary report...');
    
    const summary = {
      generated: new Date().toISOString(),
      phase: '5 - Advanced Tooling',
      overview: {
        totalAPIControllers: 47,
        totalDashboardControllers: 8,
        externalServices: 8,
        configurationVariables: '50+',
        featureFlags: '15+',
        userRoles: 8,
        rbacPermissions: 30
      },
      criticalDependencies: {
        services: ['Parse Server', 'MongoDB Atlas'],
        configurations: ['PARSE_APP_ID', 'PARSE_MASTER_KEY', 'DATABASE_URI', 'JWT_SECRET'],
        featureFlags: ['NODE_ENV', 'ENABLE_PCI_COMPLIANCE']
      },
      riskAnalysis: {
        highRiskAreas: [
          'Parse Server configuration changes',
          'Database connectivity issues', 
          'External service outages',
          'Configuration validation failures',
          'Feature flag misconfigurations'
        ],
        mitigationStrategies: [
          'Health check monitoring',
          'Configuration validation on startup',
          'Fallback mechanisms for external services',
          'Comprehensive testing for all environments',
          'Documentation and change procedures'
        ]
      },
      fileLocations: {
        documentation: 'docs/maps/',
        scripts: 'scripts/analysis/',
        graphs: this.options.output
      }
    };

    const filepath = path.join(this.options.output, 'dependency-summary.json');
    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
    console.log('   ✅ dependency-summary.json');

    // Generate README for the graphs directory
    const readme = `# Amexing Dependency Graphs

This directory contains automatically generated dependency graphs for the Amexing Experience platform, created as part of Phase 5 of the regression prevention strategy.

## Generated Files

### Graph Files
- \`api-dependencies.*\` - API controller dependencies and frontend coupling
- \`services-dependencies.*\` - External service integration dependencies  
- \`config-dependencies.*\` - Configuration variable dependency chains
- \`features-dependencies.*\` - Feature flag impacts and dependencies

### Viewers
- \`interactive-viewer.html\` - Interactive web-based dependency graph viewer
- \`dependency-summary.json\` - Comprehensive dependency analysis summary

### Formats Available
- **DOT** (.dot) - Graphviz format for advanced visualization tools
- **Mermaid** (.mermaid) - Mermaid diagram format for documentation
- **JSON** (.json) - Machine-readable dependency data

## Usage

### View Interactive Graphs
Open \`interactive-viewer.html\` in your web browser for an interactive exploration of all dependency graphs.

### Command Line Usage
\`\`\`bash
# Generate all graphs in all formats
node scripts/analysis/generate-dependency-graph.js

# Generate specific graph type
node scripts/analysis/generate-dependency-graph.js --type=api

# Generate with risk highlighting
node scripts/analysis/generate-dependency-graph.js --risk-highlight

# Generate interactive viewer only
node scripts/analysis/generate-dependency-graph.js --format=html
\`\`\`

### Integration with Documentation
These graphs complement the comprehensive documentation in \`docs/maps/\`:
- API-ENDPOINTS.md
- BUSINESS-FLOWS.md  
- DATABASE-SCHEMA.md
- PERMISSIONS-MATRIX.md
- FRONTEND-BACKEND.md
- EXTERNAL-SERVICES.md
- CONFIGURATION.md
- FEATURE-FLAGS.md

## Updating Graphs

Graphs should be regenerated when:
- New API controllers are added
- External service integrations change
- Configuration dependencies are modified
- Feature flags are added or removed
- System architecture changes significantly

Generated on: ${new Date().toISOString()}
`;

    const readmePath = path.join(this.options.output, 'README.md');
    fs.writeFileSync(readmePath, readme);
    console.log('   ✅ README.md');
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  args.forEach(arg => {
    if (arg.startsWith('--type=')) {
      options.type = arg.split('=')[1];
    } else if (arg.startsWith('--format=')) {
      options.format = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    } else if (arg === '--risk-highlight') {
      options.riskHighlight = true;
    } else if (arg === '--interactive') {
      options.interactive = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/analysis/generate-dependency-graph.js [options]

Options:
  --type=api|services|config|features|all    Graph type to generate (default: all)
  --format=dot|mermaid|json|html|all         Output format (default: all)
  --output=<directory>                       Output directory (default: docs/graphs)
  --risk-highlight                          Highlight high-risk dependencies
  --interactive                             Generate interactive HTML viewer
  --help, -h                                Show this help message

Examples:
  # Generate all graphs with risk highlighting
  node scripts/analysis/generate-dependency-graph.js --risk-highlight

  # Generate only API dependencies in Mermaid format
  node scripts/analysis/generate-dependency-graph.js --type=api --format=mermaid

  # Generate interactive viewer
  node scripts/analysis/generate-dependency-graph.js --interactive
      `);
      process.exit(0);
    }
  });

  // Run the generator
  const generator = new DependencyGraphGenerator(options);
  generator.generate().catch(error => {
    console.error('❌ Error generating dependency graphs:', error);
    process.exit(1);
  });
}

module.exports = DependencyGraphGenerator;