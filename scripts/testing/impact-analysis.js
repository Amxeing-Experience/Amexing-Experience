#!/usr/bin/env node

/**
 * Impact Analysis Tool
 * Analyzes the potential impact of modifying a file before making changes
 * Uses mappings from Phase 2 to identify dependencies and test requirements
 * 
 * Created by Denisse Maldonado
 * Usage: node scripts/testing/impact-analysis.js <file-path>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Parse command line arguments
const args = process.argv.slice(2);
const filePath = args[0];
const verbose = args.includes('--verbose') || args.includes('-v');
const json = args.includes('--json');
const helpRequested = args.includes('--help') || args.includes('-h');

// Display help
if (helpRequested || !filePath) {
  console.log(`
${colors.bold}Impact Analysis Tool${colors.reset}
Analyzes the potential impact of modifying a file

${colors.cyan}Usage:${colors.reset}
  yarn impact:check <file-path>              # Analyze impact
  yarn impact:check <file-path> --verbose    # Detailed output
  yarn impact:check <file-path> --json       # JSON output
  
${colors.cyan}Examples:${colors.reset}
  yarn impact:check src/application/controllers/api/EmployeesController.js
  yarn impact:check src/application/middleware/jwtMiddleware.js
  
${colors.cyan}Risk Levels:${colors.reset}
  🔴 CRITICAL - Core system component, affects authentication/security
  🟠 HIGH     - Affects multiple components or business logic
  🟡 MEDIUM   - Limited scope, well-tested
  🟢 LOW      - Isolated component, good test coverage

${colors.cyan}Output includes:${colors.reset}
  • Risk assessment
  • Test coverage percentage
  • Affected test files
  • Direct dependencies
  • Suggested test commands
  • Breaking change warnings
`);
  process.exit(0);
}

class ImpactAnalyzer {
  constructor() {
    this.loadMappings();
    this.loadTestCoverage();
  }

  loadMappings() {
    // Critical file mappings with risk levels and dependencies
    this.criticalFiles = {
      // Authentication & Security - CRITICAL
      'src/application/middleware/jwtMiddleware.js': {
        risk: 'CRITICAL',
        description: 'JWT authentication middleware',
        affects: ['All authenticated API endpoints'],
        tests: [
          'tests/unit/middleware/jwtMiddleware-rbac.test.js',
          'tests/integration/api/auth.test.js',
          'tests/integration/auth/mobile-auth-flows.test.js'
        ],
        dependencies: ['authController', 'all API controllers'],
        breakingChangePotential: 'HIGH'
      },
      'src/application/middleware/authMiddleware.js': {
        risk: 'CRITICAL',
        description: 'Authentication middleware',
        affects: ['Authentication flows'],
        tests: [
          'tests/integration/api/auth.test.js',
          'tests/integration/security/security.integration.test.js'
        ],
        dependencies: ['authController', 'dashboardController'],
        breakingChangePotential: 'HIGH'
      },
      'src/application/middleware/dashboardAuthMiddleware.js': {
        risk: 'CRITICAL',
        description: 'Dashboard authentication',
        affects: ['All dashboard routes'],
        tests: [
          'tests/integration/frontend/quote-services-auto-sort.test.js',
          'tests/integration/frontend/services-edit-modal.test.js'
        ],
        dependencies: ['dashboardController', 'all dashboard pages'],
        breakingChangePotential: 'HIGH'
      },

      // Controllers - HIGH to MEDIUM risk
      'src/application/controllers/api/EmployeesController.js': {
        risk: 'HIGH',
        description: 'Employee management API',
        affects: ['Employee CRUD operations'],
        tests: [
          'tests/integration/api/employees.test.js',
          'tests/unit/controllers/api/EmployeesController.test.js'
        ],
        dependencies: ['UserManagementService', 'FileStorageService'],
        breakingChangePotential: 'MEDIUM'
      },
      'src/application/controllers/api/ClientsController.js': {
        risk: 'HIGH',
        description: 'Client management API',
        affects: ['Client CRUD operations'],
        tests: [
          'tests/integration/api/clients.test.js' // Note: Missing
        ],
        dependencies: ['Client model', 'BillingProfile'],
        breakingChangePotential: 'MEDIUM'
      },
      'src/application/controllers/api/QuotesController.js': {
        risk: 'HIGH',
        description: 'Quote management API',
        affects: ['Quote creation and management'],
        tests: [
          'tests/integration/api/quotes-duplicate.test.js'
        ],
        dependencies: ['Quote model', 'QuoteService', 'EmailService'],
        breakingChangePotential: 'HIGH'
      },
      'src/application/controllers/api/ReservationController.js': {
        risk: 'CRITICAL',
        description: 'Reservation management',
        affects: ['Booking system'],
        tests: [], // WARNING: No test coverage!
        dependencies: ['Reservation model', 'Quote', 'Invoice'],
        breakingChangePotential: 'CRITICAL'
      },
      'src/application/controllers/api/InvoiceController.js': {
        risk: 'CRITICAL',
        description: 'Invoice management',
        affects: ['Financial operations'],
        tests: [], // WARNING: No test coverage!
        dependencies: ['Invoice model', 'Reservation', 'BillingProfile'],
        breakingChangePotential: 'CRITICAL'
      },

      // Services - HIGH to MEDIUM risk
      'src/application/services/UserManagementService.js': {
        risk: 'HIGH',
        description: 'User management service',
        affects: ['User operations across system'],
        tests: [
          'tests/integration/services/UserManagementService.test.js'
        ],
        dependencies: ['AmexingUser model', 'Role', 'Permission'],
        breakingChangePotential: 'HIGH'
      },
      'src/application/services/AuthenticationService.js': {
        risk: 'CRITICAL',
        description: 'Authentication service',
        affects: ['Login, logout, password reset'],
        tests: [
          'tests/unit/services/AuthenticationService.test.js',
          'tests/integration/api/auth.test.js'
        ],
        dependencies: ['JWT', 'Parse.User', 'EmailService'],
        breakingChangePotential: 'CRITICAL'
      },
      'src/services/PermissionService.js': {
        risk: 'CRITICAL',
        description: 'RBAC permission service',
        affects: ['All authorization checks'],
        tests: [
          'tests/unit/services/PermissionService.test.js',
          'tests/integration/rbac/permission-system.integration.test.js'
        ],
        dependencies: ['Role', 'Permission', 'all controllers'],
        breakingChangePotential: 'CRITICAL'
      },

      // Parse Cloud Functions - CRITICAL
      'src/cloud/main.js': {
        risk: 'CRITICAL',
        description: 'Parse Cloud functions and hooks',
        affects: ['All database operations'],
        tests: [
          'tests/integration/cloud/beforeSave-amexinguser.test.js',
          'tests/integration/parseServer.test.js'
        ],
        dependencies: ['All models', 'All services'],
        breakingChangePotential: 'CRITICAL'
      },
      'src/cloud/hooks/auditTrailHooks.js': {
        risk: 'CRITICAL',
        description: 'Audit trail hooks',
        affects: ['Audit logging', 'Email validation'],
        tests: [
          'tests/integration/cloud/beforeSave-amexinguser.test.js'
        ],
        dependencies: ['AuditLog', '_User'],
        breakingChangePotential: 'HIGH'
      },

      // Domain Models - MEDIUM risk
      'src/domain/models/AmexingUser.js': {
        risk: 'HIGH',
        description: 'User model',
        affects: ['User data structure'],
        tests: [
          'tests/integration/cloud/beforeSave-amexinguser.test.js'
        ],
        dependencies: ['All user-related operations'],
        breakingChangePotential: 'HIGH'
      },
      'src/domain/models/Client.js': {
        risk: 'MEDIUM',
        description: 'Client model',
        affects: ['Client data structure'],
        tests: [
          'tests/unit/models/Client.test.js' // Note: May be missing
        ],
        dependencies: ['ClientsController', 'Quote'],
        breakingChangePotential: 'MEDIUM'
      },
      'src/domain/models/Quote.js': {
        risk: 'HIGH',
        description: 'Quote model',
        affects: ['Quote data structure'],
        tests: [
          'tests/integration/api/quotes-duplicate.test.js'
        ],
        dependencies: ['QuotesController', 'Reservation'],
        breakingChangePotential: 'HIGH'
      }
    };

    // File pattern mappings for unknown files
    this.filePatterns = [
      {
        pattern: /src\/application\/controllers\/api\/.*\.js$/,
        risk: 'HIGH',
        category: 'API Controller',
        suggestedTests: ['tests/integration/api/', 'yarn test:regression']
      },
      {
        pattern: /src\/application\/middleware\/.*\.js$/,
        risk: 'CRITICAL',
        category: 'Middleware',
        suggestedTests: ['tests/unit/middleware/', 'tests/integration/auth/', 'yarn test:regression']
      },
      {
        pattern: /src\/application\/services\/.*\.js$/,
        risk: 'HIGH',
        category: 'Service Layer',
        suggestedTests: ['tests/unit/services/', 'yarn test:regression']
      },
      {
        pattern: /src\/domain\/models\/.*\.js$/,
        risk: 'MEDIUM',
        category: 'Domain Model',
        suggestedTests: ['tests/unit/models/', 'tests/integration/']
      },
      {
        pattern: /src\/cloud\/.*\.js$/,
        risk: 'CRITICAL',
        category: 'Parse Cloud Function',
        suggestedTests: ['tests/integration/cloud/', 'tests/integration/parseServer.test.js']
      },
      {
        pattern: /src\/presentation\/views\/.*\.ejs$/,
        risk: 'LOW',
        category: 'View Template',
        suggestedTests: ['tests/unit/views/', 'Manual UI testing']
      },
      {
        pattern: /src\/infrastructure\/.*\.js$/,
        risk: 'HIGH',
        category: 'Infrastructure',
        suggestedTests: ['tests/integration/', 'yarn test:security']
      }
    ];
  }

  loadTestCoverage() {
    // Test coverage data from TEST-COVERAGE.md
    this.testCoverage = {
      'EmployeesController': 95,
      'ClientsController': 40,
      'ClientEmployeesController': 60,
      'QuoteController': 70,
      'ServicesController': 50,
      'ExperienceController': 20,
      'VehicleController': 30,
      'ReservationController': 0,
      'InvoiceController': 0,
      'BillingController': 0,
      'UserManagementController': 80,
      'AuthenticationService': 95,
      'UserManagementService': 85,
      'PermissionService': 90,
      'BulkImportService': 70,
      'jwtMiddleware': 95,
      'authMiddleware': 90,
      'dashboardAuthMiddleware': 40
    };
  }

  analyzeFile(filePath) {
    const normalizedPath = path.normalize(filePath);
    const fileName = path.basename(filePath, '.js');
    
    // Check if it's a known critical file
    if (this.criticalFiles[normalizedPath]) {
      return this.analyzeKnownFile(normalizedPath, this.criticalFiles[normalizedPath]);
    }
    
    // Check file patterns for unknown files
    for (const pattern of this.filePatterns) {
      if (pattern.pattern.test(normalizedPath)) {
        return this.analyzeByPattern(normalizedPath, pattern, fileName);
      }
    }
    
    // Default analysis for completely unknown files
    return this.analyzeUnknownFile(normalizedPath, fileName);
  }

  analyzeKnownFile(filePath, fileInfo) {
    const fileName = path.basename(filePath, '.js');
    const coverage = this.testCoverage[fileName] || 0;
    
    return {
      file: filePath,
      risk: fileInfo.risk,
      description: fileInfo.description,
      coverage: coverage,
      affects: fileInfo.affects,
      tests: fileInfo.tests,
      dependencies: fileInfo.dependencies,
      breakingChangePotential: fileInfo.breakingChangePotential,
      warnings: this.getWarnings(fileInfo, coverage)
    };
  }

  analyzeByPattern(filePath, pattern, fileName) {
    const coverage = this.testCoverage[fileName] || 'Unknown';
    
    // Try to find related tests
    const testDir = pattern.suggestedTests[0];
    let relatedTests = [];
    
    try {
      if (testDir.includes('tests/')) {
        const testPath = path.join(process.cwd(), testDir);
        if (fs.existsSync(testPath)) {
          const files = fs.readdirSync(testPath);
          relatedTests = files
            .filter(f => f.includes(fileName.toLowerCase()) || f.includes('test.js'))
            .slice(0, 3)
            .map(f => path.join(testDir, f));
        }
      }
    } catch (error) {
      // Ignore errors finding tests
    }
    
    return {
      file: filePath,
      risk: pattern.risk,
      description: `${pattern.category} file`,
      coverage: coverage,
      affects: [`${pattern.category} operations`],
      tests: relatedTests.length > 0 ? relatedTests : pattern.suggestedTests,
      dependencies: ['Check imports in file'],
      breakingChangePotential: this.calculateBreakingPotential(pattern.risk, coverage),
      warnings: this.getWarnings({ risk: pattern.risk }, coverage)
    };
  }

  analyzeUnknownFile(filePath, fileName) {
    return {
      file: filePath,
      risk: 'UNKNOWN',
      description: 'Unknown file - manual analysis required',
      coverage: 'Unknown',
      affects: ['Unknown - check dependencies'],
      tests: ['yarn test', 'yarn test:regression'],
      dependencies: ['Check imports in file'],
      breakingChangePotential: 'UNKNOWN',
      warnings: ['⚠️ Unknown file - proceed with caution', '⚠️ Run full test suite before committing']
    };
  }

  calculateBreakingPotential(risk, coverage) {
    if (risk === 'CRITICAL') return 'CRITICAL';
    if (coverage === 0) return 'HIGH';
    if (coverage < 50) return 'MEDIUM';
    return 'LOW';
  }

  getWarnings(fileInfo, coverage) {
    const warnings = [];
    
    if (fileInfo.risk === 'CRITICAL') {
      warnings.push('🔴 CRITICAL: Changes affect core system functionality');
    }
    
    if (coverage === 0) {
      warnings.push('❌ WARNING: No test coverage - high risk of undetected breaks');
    } else if (coverage < 50) {
      warnings.push('⚠️ WARNING: Low test coverage - careful testing required');
    }
    
    if (fileInfo.tests && fileInfo.tests.length === 0) {
      warnings.push('❌ WARNING: No tests available for this component');
    }
    
    if (fileInfo.breakingChangePotential === 'CRITICAL' || fileInfo.breakingChangePotential === 'HIGH') {
      warnings.push('⚡ HIGH BREAKING CHANGE POTENTIAL');
    }
    
    return warnings;
  }

  getRiskIcon(risk) {
    switch(risk) {
      case 'CRITICAL': return '🔴';
      case 'HIGH': return '🟠';
      case 'MEDIUM': return '🟡';
      case 'LOW': return '🟢';
      default: return '⚪';
    }
  }

  formatOutput(analysis) {
    if (json) {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    const riskIcon = this.getRiskIcon(analysis.risk);
    const riskColor = this.getRiskColor(analysis.risk);
    
    console.log(`
${colors.bold}📊 Impact Analysis Report${colors.reset}
${colors.dim}────────────────────────────────────────────${colors.reset}

${colors.cyan}File:${colors.reset} ${analysis.file}
${colors.cyan}Type:${colors.reset} ${analysis.description}
${colors.cyan}Risk Level:${colors.reset} ${riskIcon} ${riskColor}${analysis.risk}${colors.reset}
${colors.cyan}Test Coverage:${colors.reset} ${this.formatCoverage(analysis.coverage)}
${colors.cyan}Breaking Change Potential:${colors.reset} ${this.formatBreakingPotential(analysis.breakingChangePotential)}
`);

    if (analysis.warnings && analysis.warnings.length > 0) {
      console.log(`${colors.red}Warnings:${colors.reset}`);
      analysis.warnings.forEach(warning => {
        console.log(`  ${warning}`);
      });
      console.log('');
    }

    console.log(`${colors.cyan}Affects:${colors.reset}`);
    analysis.affects.forEach(item => {
      console.log(`  • ${item}`);
    });
    
    console.log(`\n${colors.cyan}Dependencies:${colors.reset}`);
    analysis.dependencies.forEach(dep => {
      console.log(`  • ${dep}`);
    });

    if (analysis.tests && analysis.tests.length > 0) {
      console.log(`\n${colors.cyan}Tests to Run:${colors.reset}`);
      analysis.tests.forEach(test => {
        if (test.includes('yarn')) {
          console.log(`  ${colors.green}▶${colors.reset} ${test}`);
        } else {
          console.log(`  • ${test}`);
        }
      });
    }

    if (verbose) {
      this.showDetailedRecommendations(analysis);
    }

    this.showQuickCommands(analysis);
  }

  getRiskColor(risk) {
    switch(risk) {
      case 'CRITICAL': return colors.red;
      case 'HIGH': return colors.yellow;
      case 'MEDIUM': return colors.blue;
      case 'LOW': return colors.green;
      default: return colors.dim;
    }
  }

  formatCoverage(coverage) {
    if (coverage === 'Unknown') return `${colors.dim}Unknown${colors.reset}`;
    
    const percent = typeof coverage === 'number' ? coverage : 0;
    let color = colors.green;
    
    if (percent === 0) color = colors.red;
    else if (percent < 50) color = colors.yellow;
    else if (percent < 80) color = colors.blue;
    
    return `${color}${percent}%${colors.reset}`;
  }

  formatBreakingPotential(potential) {
    const icons = {
      'CRITICAL': `${colors.red}🔥 CRITICAL${colors.reset}`,
      'HIGH': `${colors.red}⚡ HIGH${colors.reset}`,
      'MEDIUM': `${colors.yellow}⚠️ MEDIUM${colors.reset}`,
      'LOW': `${colors.green}✅ LOW${colors.reset}`,
      'UNKNOWN': `${colors.dim}❓ UNKNOWN${colors.reset}`
    };
    
    return icons[potential] || potential;
  }

  showDetailedRecommendations(analysis) {
    console.log(`\n${colors.bold}Recommendations:${colors.reset}`);
    
    if (analysis.risk === 'CRITICAL' || analysis.risk === 'HIGH') {
      console.log(`  1. ${colors.yellow}Review changes carefully${colors.reset} - This is a high-impact file`);
      console.log(`  2. ${colors.yellow}Run regression tests first${colors.reset}: yarn test:regression`);
      console.log(`  3. ${colors.yellow}Test in development${colors.reset} before committing`);
      console.log(`  4. ${colors.yellow}Consider pair review${colors.reset} for critical changes`);
    }
    
    if (analysis.coverage < 50) {
      console.log(`  • ${colors.red}Add tests${colors.reset} before modifying - coverage is too low`);
    }
  }

  showQuickCommands(analysis) {
    console.log(`\n${colors.bold}Quick Commands:${colors.reset}`);
    console.log(`${colors.dim}────────────────────────────────────────────${colors.reset}`);
    
    // Regression test
    console.log(`${colors.green}# Quick regression test${colors.reset}`);
    console.log(`${colors.dim}yarn test:regression${colors.reset}`);
    
    // Specific test files
    if (analysis.tests && analysis.tests.length > 0) {
      const testFile = analysis.tests.find(t => t.endsWith('.js'));
      if (testFile) {
        console.log(`\n${colors.green}# Run specific tests${colors.reset}`);
        console.log(`${colors.dim}yarn test ${testFile}${colors.reset}`);
      }
    }
    
    // Watch mode
    console.log(`\n${colors.green}# Watch mode for real-time feedback${colors.reset}`);
    console.log(`${colors.dim}yarn dev:watch${colors.reset}`);
    
    // Full test
    if (analysis.risk === 'CRITICAL' || analysis.risk === 'HIGH') {
      console.log(`\n${colors.green}# Run full test suite (recommended for ${analysis.risk} risk)${colors.reset}`);
      console.log(`${colors.dim}yarn test${colors.reset}`);
    }
  }

  checkFileExists(filePath) {
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.error(`${colors.red}❌ Error: File not found: ${filePath}${colors.reset}`);
      console.log(`${colors.dim}Tip: Use relative path from project root or absolute path${colors.reset}`);
      return false;
    }
    
    return true;
  }

  getDependentFiles(filePath) {
    // Use git to find files that import this file
    try {
      const fileName = path.basename(filePath, '.js');
      const searchPattern = `(require|import).*${fileName}`;
      const command = `git grep -l "${searchPattern}" --cached 2>/dev/null | head -10`;
      const result = execSync(command, { encoding: 'utf-8' });
      return result.split('\n').filter(f => f && f !== filePath);
    } catch (error) {
      return [];
    }
  }

  getGitStatus(filePath) {
    try {
      const command = `git status --porcelain "${filePath}" 2>/dev/null`;
      const result = execSync(command, { encoding: 'utf-8' }).trim();
      if (result.startsWith('M')) return 'modified';
      if (result.startsWith('A')) return 'added';
      if (result.startsWith('??')) return 'untracked';
      return 'unchanged';
    } catch (error) {
      return 'unknown';
    }
  }
}

// Main execution
async function main() {
  const analyzer = new ImpactAnalyzer();
  
  // Check if file exists
  if (!analyzer.checkFileExists(filePath)) {
    process.exit(1);
  }
  
  // Get file status
  const gitStatus = analyzer.getGitStatus(filePath);
  if (gitStatus === 'modified' || gitStatus === 'added') {
    console.log(`${colors.yellow}⚠️ Note: File has uncommitted changes${colors.reset}`);
  }
  
  // Perform analysis
  const analysis = analyzer.analyzeFile(filePath);
  
  // Get dependent files if verbose
  if (verbose && !json) {
    const dependents = analyzer.getDependentFiles(filePath);
    if (dependents.length > 0) {
      analysis.dependencies = analysis.dependencies.concat(
        [`${dependents.length} files import this module`]
      );
    }
  }
  
  // Output results
  analyzer.formatOutput(analysis);
  
  // Exit with appropriate code
  if (analysis.risk === 'CRITICAL' && analysis.coverage === 0) {
    process.exit(2); // High risk
  } else if (analysis.warnings && analysis.warnings.length > 2) {
    process.exit(1); // Medium risk
  }
  
  process.exit(0); // Low risk
}

if (require.main === module) {
  main();
}

module.exports = ImpactAnalyzer;