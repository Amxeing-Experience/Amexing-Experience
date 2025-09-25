#!/usr/bin/env node

/**
 * Changelog Validation Script for AmexingWeb
 * 
 * Validates CHANGELOG.md format and ensures PCI DSS compliance
 * annotations are properly included for security-related changes.
 */

const fs = require('fs');
const path = require('path');

class ChangelogValidator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.changelogPath = path.join(this.projectRoot, 'CHANGELOG.md');
    this.errors = [];
    this.warnings = [];
  }

  log(message, level = 'info') {
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${colors[level]}${prefix} ${message}${colors.reset}`);
  }

  validateFileExists() {
    if (!fs.existsSync(this.changelogPath)) {
      this.errors.push('CHANGELOG.md file does not exist');
      return false;
    }
    return true;
  }

  validateKeepAChangelogFormat() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Check for required sections
    const requiredSections = [
      /^# Changelog/m,
      /## \[Unreleased\]/m,
      /The format is based on.*Keep a Changelog/m
    ];

    requiredSections.forEach((pattern, index) => {
      if (!pattern.test(content)) {
        const sectionNames = ['Title', 'Unreleased section', 'Keep a Changelog reference'];
        this.errors.push(`Missing required section: ${sectionNames[index]}`);
      }
    });

    // Check for proper heading hierarchy
    const headings = content.match(/^#{1,6}\s.+$/gm) || [];
    let previousLevel = 0;
    
    headings.forEach((heading, index) => {
      const level = (heading.match(/^#+/) || [''])[0].length;
      
      if (index > 0 && level > previousLevel + 1) {
        this.warnings.push(`Heading level skip detected: "${heading.trim()}"`);
      }
      
      previousLevel = level;
    });
  }

  validateSecurityClassifications() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Find all security entries
    const securityPattern = /### Security\s*\n([\s\S]*?)(?=\n### |$)/g;
    let match;
    
    while ((match = securityPattern.exec(content)) !== null) {
      const securitySection = match[1];
      
      // Check for security classifications
      const entries = securitySection.split('\n').filter(line => line.trim().startsWith('-'));
      
      entries.forEach(entry => {
        if (!entry.match(/\*\*\[(CRITICAL|HIGH|MEDIUM|LOW)\]\*\*/)) {
          this.warnings.push(`Security entry missing classification: ${entry.trim()}`);
        }
      });
    }
  }

  validatePCIDSSReferences() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Check for PCI DSS compliance notes section
    if (!content.includes('## PCI DSS Compliance Notes')) {
      this.warnings.push('Missing PCI DSS Compliance Notes section');
    }

    // Look for PCI DSS requirement references in security changes
    const securityChanges = content.match(/- \*\*\[(HIGH|CRITICAL)\]\*\*.*$/gm) || [];
    
    securityChanges.forEach(change => {
      if (!change.includes('PCI DSS') && !change.includes('Req ')) {
        this.warnings.push(`High/Critical security change missing PCI DSS reference: ${change.trim()}`);
      }
    });
  }

  validateVersionFormat() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Find version headers
    const versionPattern = /## \[(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\]/g;
    let match;
    const versions = [];
    
    while ((match = versionPattern.exec(content)) !== null) {
      const version = match[1];
      versions.push(version);
      
      // Validate semantic versioning
      if (!version.match(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)*$/)) {
        this.errors.push(`Invalid version format: ${version}`);
      }
    }

    // Check version order (should be descending)
    for (let i = 1; i < versions.length; i++) {
      const current = versions[i-1];
      const previous = versions[i];
      
      if (this.compareVersions(current, previous) < 0) {
        this.warnings.push(`Version order issue: ${current} should come after ${previous}`);
      }
    }
  }

  compareVersions(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (aParts[i] > bParts[i]) return 1;
      if (aParts[i] < bParts[i]) return -1;
    }
    
    return 0;
  }

  validateChangeTypes() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Validate that changes are properly categorized
    const validCategories = [
      'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'
    ];

    const categoryPattern = /### (Added|Changed|Deprecated|Removed|Fixed|Security)/g;
    let match;
    const foundCategories = [];
    
    while ((match = categoryPattern.exec(content)) !== null) {
      foundCategories.push(match[1]);
    }

    // Check for invalid categories
    const invalidCategories = foundCategories.filter(cat => !validCategories.includes(cat));
    if (invalidCategories.length > 0) {
      this.errors.push(`Invalid change categories: ${invalidCategories.join(', ')}`);
    }
  }

  validateUnreleasedSection() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Extract unreleased section
    const unreleasedMatch = content.match(/## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/);
    
    if (!unreleasedMatch) {
      this.errors.push('No [Unreleased] section found');
      return;
    }

    const unreleasedContent = unreleasedMatch[1];
    
    // Check if unreleased section has any content
    if (unreleasedContent.trim().length === 0) {
      this.warnings.push('Unreleased section is empty');
    }

    // Check for proper categorization in unreleased
    const hasCategories = /### (Added|Changed|Deprecated|Removed|Fixed|Security)/.test(unreleasedContent);
    if (unreleasedContent.trim().length > 0 && !hasCategories) {
      this.warnings.push('Unreleased section has content but no proper categories');
    }
  }

  validateLinks() {
    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Check for Keep a Changelog link
    if (!content.includes('https://keepachangelog.com/')) {
      this.warnings.push('Missing Keep a Changelog reference link');
    }

    // Check for Semantic Versioning link
    if (!content.includes('https://semver.org/')) {
      this.warnings.push('Missing Semantic Versioning reference link');
    }
  }

  generateReport() {
    console.log('\n📋 Changelog Validation Report');
    console.log('==============================\n');

    if (this.errors.length === 0 && this.warnings.length === 0) {
      this.log('CHANGELOG.md is properly formatted and compliant!', 'success');
      console.log('\n✨ Ready for PCI DSS compliant releases!');
      return true;
    }

    if (this.errors.length > 0) {
      console.log('🚨 Errors (must fix):');
      this.errors.forEach(error => this.log(error, 'error'));
      console.log('');
    }

    if (this.warnings.length > 0) {
      console.log('⚠️  Warnings (should fix):');
      this.warnings.forEach(warning => this.log(warning, 'warning'));
      console.log('');
    }

    console.log('📚 Changelog Best Practices:');
    console.log('   • Follow Keep a Changelog format');
    console.log('   • Include security classifications [CRITICAL|HIGH|MEDIUM|LOW]');
    console.log('   • Reference PCI DSS requirements for security changes');
    console.log('   • Use semantic versioning');
    console.log('   • Categorize changes properly (Added, Changed, Fixed, etc.)');
    console.log('   • Keep unreleased section updated');

    return this.errors.length === 0;
  }

  run() {
    try {
      this.log('🔍 Validating CHANGELOG.md for AmexingWeb...\n');
      
      if (!this.validateFileExists()) {
        this.generateReport();
        process.exit(1);
      }

      // Run all validation checks
      this.validateKeepAChangelogFormat();
      this.validateSecurityClassifications();
      this.validatePCIDSSReferences();
      this.validateVersionFormat();
      this.validateChangeTypes();
      this.validateUnreleasedSection();
      this.validateLinks();

      // Generate and display report
      const isValid = this.generateReport();
      
      if (!isValid) {
        process.exit(1);
      }

    } catch (error) {
      this.log(`Validation failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// Run validation
const validator = new ChangelogValidator();
validator.run();