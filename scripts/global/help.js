#!/usr/bin/env node

/**
 * Interactive Help System for AmexingWeb Scripts
 * Provides categorized, searchable documentation for all npm scripts
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Script categories and descriptions
const scriptCategories = {
  'development': {
    emoji: '🚀',
    name: 'Development & Runtime',
    description: 'Server startup, development tools, dashboard',
    scripts: ['start', 'dev', 'dashboard', 'prod', 'pm2:dev', 'pm2:stop', 'pm2:restart', 'pm2:logs']
  },
  'testing': {
    emoji: '🧪',
    name: 'Testing & Quality Assurance', 
    description: 'Unit tests, integration tests, security validation',
    scripts: ['test', 'test:watch', 'test:coverage', 'test:unit', 'test:integration', 'test:security', 'test:startup', 'test:full-validation', 'test:ci']
  },
  'security': {
    emoji: '🔒',
    name: 'Security & Compliance',
    description: 'Security audits, vulnerability scanning, PCI DSS compliance', 
    scripts: ['security:audit', 'security:audit:fix', 'security:semgrep', 'security:check', 'security:all']
  },
  'quality': {
    emoji: '📋',
    name: 'Code Quality & Analysis',
    description: 'Linting, formatting, complexity analysis, SonarQube',
    scripts: ['lint', 'lint:fix', 'format', 'format:check', 'quality:complexity', 'quality:all']
  },
  'docs': {
    emoji: '📚',
    name: 'Documentation',
    description: 'API docs generation, JSDoc, documentation coverage',
    scripts: ['docs', 'docs:md', 'docs:coverage']
  },
  'infrastructure': {
    emoji: '🔧',
    name: 'Infrastructure & Secrets',
    description: 'Environment management, secrets handling, encryption',
    scripts: ['secrets:setup', 'secrets:generate', 'secrets:generate:dev', 'secrets:generate:staging', 'secrets:encrypt', 'secrets:decrypt']
  },
  'release': {
    emoji: '🎯',
    name: 'Git & Release Management', 
    description: 'Git hooks, changelog, versioning, conventional commits',
    scripts: ['hooks:install', 'hooks:repair', 'hooks:validate', 'hooks:test', 'changelog:generate', 'changelog:validate', 'changelog:unreleased', 'release:prepare', 'release:notes', 'release:version', 'commit:validate']
  },
  'analytics': {
    emoji: '📊',
    name: 'Analytics & Monitoring',
    description: 'SonarQube analysis, metrics, monitoring',
    scripts: ['sonar:scan', 'sonar:local', 'sonar:coverage']
  },
  'dependencies': {
    emoji: '⚙️', 
    name: 'Dependencies & Licenses',
    description: 'Dependency checking, license validation, updates',
    scripts: ['deps:check', 'deps:outdated', 'deps:licenses', 'deps:licenses:full']
  },
  'hooks': {
    emoji: '🔗',
    name: 'Git Hooks Management',
    description: 'Hook installation, validation, testing', 
    scripts: ['precommit', 'prepush', 'postinstall']
  }
};

// Script descriptions (mirrors scriptsComments in package.json)
const scriptDescriptions = {
  // Development & Runtime
  'start': 'Start production server',
  'dev': 'Start development server with hot reload using nodemon',
  'dashboard': 'Open Parse Dashboard on port 4040 for database management',
  'prod': 'Start with PM2 in production mode with ecosystem config',
  'pm2:dev': 'Start with PM2 in development mode',
  'pm2:stop': 'Stop all PM2 processes',
  'pm2:restart': 'Restart all PM2 processes', 
  'pm2:logs': 'View PM2 logs in real-time',

  // Testing & QA
  'test': 'Run all tests with Jest test runner',
  'test:watch': 'Run tests in watch mode for continuous testing',
  'test:coverage': 'Generate detailed test coverage report',
  'test:unit': 'Run unit tests only (fast execution)',
  'test:integration': 'Run integration tests only (database required)',
  'test:security': 'Run security integration tests with development environment',
  'test:startup': 'Validate complete application startup process',
  'test:full-validation': 'Complete security and startup validation suite',
  'test:ci': 'Run tests for CI/CD with coverage and no watch mode',

  // Security & Compliance  
  'security:audit': 'Check dependencies for known security vulnerabilities',
  'security:audit:fix': 'Automatically fix dependency vulnerabilities where possible',
  'security:semgrep': 'Run static security analysis (blocking - fails on issues)',
  'security:check': 'Run static security analysis (non-blocking - reports only)',
  'security:all': 'Complete security audit: dependency scan + static analysis',

  // Code Quality & Analysis
  'lint': 'Check code quality and style with ESLint rules',
  'lint:fix': 'Automatically fix ESLint errors and warnings where possible',
  'format': 'Format code with Prettier for consistent style',
  'format:check': 'Check code formatting without making changes',
  'quality:complexity': 'Analyze code complexity and identify complex functions',
  'quality:all': 'Run complete quality analysis: lint + security + deps + docs',

  // Documentation
  'docs': 'Generate HTML API documentation using JSDoc',
  'docs:md': 'Generate markdown API documentation for README',
  'docs:coverage': 'Check JSDoc documentation coverage and report missing docs',

  // Infrastructure & Secrets
  'secrets:setup': 'Initialize secrets management system and encryption keys',
  'secrets:generate': 'Generate secure environment secrets for any environment',
  'secrets:generate:dev': 'Generate development environment secrets (unencrypted)',
  'secrets:generate:staging': 'Generate encrypted staging environment secrets',
  'secrets:encrypt': 'Encrypt environment variables using dotenv-vault',
  'secrets:decrypt': 'Decrypt environment variables for deployment',

  // Git & Release Management
  'hooks:install': 'Install git hooks for PCI DSS compliance and quality enforcement',
  'hooks:repair': 'Repair git hooks installation (use --force flag)',
  'hooks:validate': 'Validate git hooks setup and functionality',  
  'hooks:test': 'Test git hooks without triggering git operations',
  'changelog:generate': 'Generate CHANGELOG.md from conventional commits',
  'changelog:validate': 'Validate changelog format and structure',
  'changelog:unreleased': 'Generate unreleased changes summary',
  'release:prepare': 'Prepare release with dry-run (preview changes)',
  'release:notes': 'Generate executive release notes for stakeholders', 
  'release:version': 'Create new version release with standard-version',
  'commit:validate': 'Validate commit messages against conventional commit format',

  // Analytics & Monitoring
  'sonar:scan': 'Run SonarQube scanner for code quality analysis',
  'sonar:local': 'Run SonarQube analysis against local SonarQube server',
  'sonar:coverage': 'Generate test coverage and run SonarQube analysis',

  // Dependencies & Licenses
  'deps:check': 'Check for unused dependencies and suggest cleanup',
  'deps:outdated': 'Check for outdated packages and available updates',
  'deps:licenses': 'Generate license summary for compliance',
  'deps:licenses:full': 'Generate detailed license report with full text',

  // Git Hooks
  'precommit': 'Pre-commit validation: lint + format check + docs coverage',
  'prepush': 'Pre-push validation: complete quality analysis',
  'postinstall': 'Post-install setup: automatic git hooks installation'
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    category: null,
    search: null,
    list: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--search' && args[i + 1]) {
      options.search = args[i + 1].toLowerCase();
      i++; // skip next argument
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (scriptCategories[arg]) {
      options.category = arg;
    }
  }

  return options;
}

/**
 * Display help for the help system
 */
function showHelpUsage() {
  console.log(`${colors.bright}${colors.blue}AmexingWeb Scripts Help System${colors.reset}\n`);
  console.log(`${colors.dim}Interactive help for all 58 npm scripts organized by category${colors.reset}\n`);
  
  console.log(`${colors.bright}Usage:${colors.reset}`);
  console.log(`  ${colors.green}yarn scripts:help${colors.reset}                    Show all scripts with descriptions`);
  console.log(`  ${colors.green}yarn scripts:help <category>${colors.reset}          Show scripts for specific category`);
  console.log(`  ${colors.green}yarn scripts:help --search <term>${colors.reset}     Search scripts containing term`);
  console.log(`  ${colors.green}yarn scripts:help --list${colors.reset}              List all available categories`);
  console.log(`  ${colors.green}yarn scripts:help --help${colors.reset}              Show this help message\n`);

  console.log(`${colors.bright}Examples:${colors.reset}`);
  console.log(`  ${colors.cyan}yarn scripts:help development${colors.reset}         # Show development scripts`);
  console.log(`  ${colors.cyan}yarn scripts:help security${colors.reset}            # Show security scripts`);
  console.log(`  ${colors.cyan}yarn scripts:help --search test${colors.reset}       # Find all scripts with 'test'`);
  console.log(`  ${colors.cyan}yarn scripts:help --list${colors.reset}              # Show all categories\n`);
}

/**
 * List all available categories
 */
function listCategories() {
  console.log(`${colors.bright}${colors.blue}Available Script Categories${colors.reset}\n`);
  
  Object.entries(scriptCategories).forEach(([key, category]) => {
    const scriptCount = category.scripts.length;
    console.log(`${colors.bright}${category.emoji} ${key}${colors.reset}`);
    console.log(`   ${colors.dim}${category.name} (${scriptCount} scripts)${colors.reset}`);
    console.log(`   ${colors.dim}${category.description}${colors.reset}\n`);
  });
  
  console.log(`${colors.dim}Use 'yarn scripts:help <category>' to see scripts in a specific category${colors.reset}`);
}

/**
 * Search scripts by term
 */
function searchScripts(searchTerm) {
  console.log(`${colors.bright}${colors.blue}Search Results for: "${searchTerm}"${colors.reset}\n`);
  
  let found = false;
  
  Object.entries(scriptCategories).forEach(([categoryKey, category]) => {
    const matchingScripts = category.scripts.filter(script => 
      script.toLowerCase().includes(searchTerm) || 
      (scriptDescriptions[script] && scriptDescriptions[script].toLowerCase().includes(searchTerm))
    );
    
    if (matchingScripts.length > 0) {
      found = true;
      console.log(`${colors.bright}${category.emoji} ${category.name}${colors.reset}`);
      
      matchingScripts.forEach(script => {
        const description = scriptDescriptions[script] || 'No description available';
        console.log(`  ${colors.green}yarn ${script}${colors.reset}`);
        console.log(`  ${colors.dim}${description}${colors.reset}\n`);
      });
    }
  });
  
  if (!found) {
    console.log(`${colors.yellow}No scripts found matching "${searchTerm}"${colors.reset}`);
    console.log(`${colors.dim}Try a broader search term or use 'yarn scripts:help --list' to see all categories${colors.reset}`);
  }
}

/**
 * Show scripts for a specific category
 */
function showCategoryScripts(categoryKey) {
  const category = scriptCategories[categoryKey];
  
  if (!category) {
    console.log(`${colors.red}Unknown category: ${categoryKey}${colors.reset}`);
    console.log(`${colors.dim}Use 'yarn scripts:help --list' to see available categories${colors.reset}`);
    return;
  }
  
  console.log(`${colors.bright}${colors.blue}${category.emoji} ${category.name}${colors.reset}`);
  console.log(`${colors.dim}${category.description}${colors.reset}\n`);
  
  category.scripts.forEach(script => {
    const description = scriptDescriptions[script] || 'No description available';
    console.log(`${colors.green}yarn ${script}${colors.reset}`);
    console.log(`${colors.dim}${description}${colors.reset}\n`);
  });
  
  console.log(`${colors.dim}📚 Full documentation: docs/reference/SCRIPTS.md${colors.reset}`);
}

/**
 * Show all scripts organized by category
 */
function showAllScripts() {
  console.log(`${colors.bright}${colors.blue}AmexingWeb Scripts Reference${colors.reset}`);
  console.log(`${colors.dim}PCI DSS 4.0 Compliant E-commerce Platform${colors.reset}\n`);
  
  let totalScripts = 0;
  Object.values(scriptCategories).forEach(category => {
    totalScripts += category.scripts.length;
  });
  
  console.log(`${colors.bright}${totalScripts} scripts across ${Object.keys(scriptCategories).length} categories${colors.reset}\n`);
  
  Object.entries(scriptCategories).forEach(([categoryKey, category]) => {
    console.log(`${colors.bright}${category.emoji} ${category.name}${colors.reset}`);
    console.log(`${colors.dim}${category.description}${colors.reset}`);
    
    // Show first 3 scripts as preview
    const previewScripts = category.scripts.slice(0, 3);
    previewScripts.forEach(script => {
      console.log(`  ${colors.green}yarn ${script}${colors.reset}`);
    });
    
    if (category.scripts.length > 3) {
      console.log(`  ${colors.dim}... and ${category.scripts.length - 3} more${colors.reset}`);
    }
    
    console.log(`  ${colors.cyan}➜ yarn scripts:help ${categoryKey}${colors.reset} ${colors.dim}(see all ${category.scripts.length} scripts)${colors.reset}\n`);
  });
  
  console.log(`${colors.dim}💡 Tips:${colors.reset}`);
  console.log(`${colors.dim}  • Use 'yarn scripts:help <category>' for detailed category help${colors.reset}`);
  console.log(`${colors.dim}  • Use 'yarn scripts:help --search <term>' to find specific scripts${colors.reset}`);
  console.log(`${colors.dim}  • Complete documentation: docs/reference/SCRIPTS.md${colors.reset}`);
}

/**
 * Main function
 */
function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelpUsage();
  } else if (options.list) {
    listCategories();
  } else if (options.search) {
    searchScripts(options.search);
  } else if (options.category) {
    showCategoryScripts(options.category);
  } else {
    showAllScripts();
  }
}

// Run the help system
if (require.main === module) {
  main();
}

module.exports = {
  scriptCategories,
  scriptDescriptions,
  parseArgs,
  showAllScripts,
  showCategoryScripts,
  searchScripts,
  listCategories
};