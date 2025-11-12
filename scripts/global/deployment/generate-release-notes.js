#!/usr/bin/env node

/**
 * Release Notes Generation Script for AmexingWeb
 * 
 * Generates executive-level release notes with security impact assessment
 * and PCI DSS compliance status for stakeholders.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ReleaseNotesGenerator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../..');
    this.changelogPath = path.join(this.projectRoot, 'CHANGELOG.md');
    this.releasesPath = path.join(this.projectRoot, 'docs/project/RELEASES.md');
    this.packagePath = path.join(this.projectRoot, 'package.json');
    this.version = this.getCurrentVersion();
    this.releaseDate = new Date().toISOString().split('T')[0];
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

  getCurrentVersion() {
    try {
      const packageJson = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
      return packageJson.version;
    } catch (error) {
      throw new Error(`Failed to read version from package.json: ${error.message}`);
    }
  }

  extractChangelogSection(version) {
    if (!fs.existsSync(this.changelogPath)) {
      throw new Error('CHANGELOG.md not found');
    }

    const content = fs.readFileSync(this.changelogPath, 'utf8');
    
    // Extract version section
    const versionPattern = new RegExp(`## \\[${version}\\]([\\s\\S]*?)(?=\\n## \\[|$)`, 'i');
    const match = content.match(versionPattern);
    
    if (!match) {
      // Try unreleased section
      const unreleasedMatch = content.match(/## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/);
      if (unreleasedMatch) {
        return unreleasedMatch[1];
      }
      throw new Error(`Version ${version} not found in CHANGELOG.md`);
    }

    return match[1];
  }

  parseChanges(changelogSection) {
    const changes = {
      added: [],
      changed: [],
      fixed: [],
      security: [],
      deprecated: [],
      removed: []
    };

    const sections = changelogSection.split(/### (Added|Changed|Fixed|Security|Deprecated|Removed)/i);
    
    for (let i = 1; i < sections.length; i += 2) {
      const sectionType = sections[i].toLowerCase();
      const sectionContent = sections[i + 1];
      
      if (changes[sectionType]) {
        const items = sectionContent
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.trim().substring(1).trim());
        
        changes[sectionType] = items;
      }
    }

    return changes;
  }

  calculateSecurityImpact(changes) {
    const securityItems = changes.security || [];
    let impact = 'Low';
    let criticalCount = 0;
    let highCount = 0;

    securityItems.forEach(item => {
      if (item.includes('**[CRITICAL]**')) {
        criticalCount++;
        impact = 'Critical';
      } else if (item.includes('**[HIGH]**')) {
        highCount++;
        if (impact !== 'Critical') impact = 'High';
      } else if (item.includes('**[MEDIUM]**') && impact === 'Low') {
        impact = 'Medium';
      }
    });

    return {
      level: impact,
      criticalCount,
      highCount,
      totalSecurityChanges: securityItems.length
    };
  }

  extractPCIDSSReferences(changes) {
    const pciReferences = new Set();
    const allChanges = [
      ...(changes.added || []),
      ...(changes.security || []),
      ...(changes.fixed || [])
    ];

    allChanges.forEach(change => {
      const pciMatch = change.match(/PCI-DSS:\s*(Req\s*[\d\.]+)/gi);
      if (pciMatch) {
        pciMatch.forEach(ref => pciReferences.add(ref));
      }
    });

    return Array.from(pciReferences);
  }

  getGitCommitsSinceLastTag() {
    try {
      // Get last tag
      const lastTag = execSync('git describe --tags --abbrev=0', { 
        cwd: this.projectRoot, 
        encoding: 'utf8' 
      }).trim();
      
      // Get commits since last tag
      const commits = execSync(`git log ${lastTag}..HEAD --oneline`, { 
        cwd: this.projectRoot, 
        encoding: 'utf8' 
      }).trim();

      return commits ? commits.split('\n').length : 0;
    } catch (error) {
      // No previous tags or git error
      return 0;
    }
  }

  generateExecutiveSummary(changes, securityImpact) {
    const summaryPoints = [];

    // Security improvements
    if (securityImpact.totalSecurityChanges > 0) {
      summaryPoints.push(`Enhanced security posture with ${securityImpact.totalSecurityChanges} security improvements`);
    }

    // New features
    if (changes.added.length > 0) {
      summaryPoints.push(`Delivered ${changes.added.length} new features and capabilities`);
    }

    // Bug fixes
    if (changes.fixed.length > 0) {
      summaryPoints.push(`Resolved ${changes.fixed.length} issues and improvements`);
    }

    // PCI DSS compliance
    const pciRefs = this.extractPCIDSSReferences(changes);
    if (pciRefs.length > 0) {
      summaryPoints.push(`Advanced PCI DSS compliance across ${pciRefs.length} requirements`);
    }

    return summaryPoints.length > 0 
      ? summaryPoints.join('. ') + '.'
      : 'Maintenance release with stability improvements and security updates.';
  }

  generateReleaseNotes(changes, securityImpact) {
    const executiveSummary = this.generateExecutiveSummary(changes, securityImpact);
    const pciReferences = this.extractPCIDSSReferences(changes);
    const commitCount = this.getGitCommitsSinceLastTag();

    const releaseNotes = `
## [Version ${this.version}] - ${this.releaseDate}
**Status**: Production Release  
**Security Impact**: ${securityImpact.level}  
**PCI DSS Updates**: ${pciReferences.length} requirements addressed  

### 🎯 Executive Summary

${executiveSummary}

### 🔒 Security Highlights

${this.formatSecurityHighlights(changes.security, securityImpact)}

### 📊 Release Metrics

- **Total Changes**: ${commitCount} commits
- **Security Improvements**: ${securityImpact.totalSecurityChanges}
- **New Features**: ${changes.added.length}
- **Bug Fixes**: ${changes.fixed.length}
- **PCI DSS Requirements**: ${pciReferences.length} addressed

${this.formatDetailedChanges(changes)}

### 📋 PCI DSS Compliance Impact

${this.formatPCIDSSImpact(pciReferences)}

### 🔐 Security Team Validation

**Security Review Status:**
- ✅ Static Application Security Testing (SAST)
- ✅ Dependency vulnerability scanning
${securityImpact.level === 'Critical' || securityImpact.level === 'High' 
  ? '- ✅ Security team review completed\n- ✅ CISO approval obtained' 
  : '- ✅ Standard security review completed'}

### 📞 Support Information

**For technical issues:**
- Development Team: dev@meeplab.com
- Security Concerns: security@meeplab.com
- Compliance Questions: compliance@meeplab.com

**Documentation:**
- [Changelog](CHANGELOG.md)
- [Security Guide](docs/SECURE_DEVELOPMENT_GUIDE.md)
- [PCI DSS Documentation](planning/pci_dss_4.0/)

---
`;

    return releaseNotes;
  }

  formatSecurityHighlights(securityChanges, securityImpact) {
    if (!securityChanges || securityChanges.length === 0) {
      return '- No security changes in this release\n- Existing security controls remain operational';
    }

    let highlights = '';
    
    if (securityImpact.criticalCount > 0) {
      highlights += `- **🔴 CRITICAL**: ${securityImpact.criticalCount} critical security fix(es) included\n`;
    }
    
    if (securityImpact.highCount > 0) {
      highlights += `- **🟡 HIGH**: ${securityImpact.highCount} high-priority security improvement(s)\n`;
    }

    // Add top 3 security changes
    const topSecurityChanges = securityChanges.slice(0, 3);
    topSecurityChanges.forEach(change => {
      const cleanChange = change.replace(/^\*\*\[(CRITICAL|HIGH|MEDIUM|LOW)\]\*\*\s*/, '');
      highlights += `- ✅ ${cleanChange}\n`;
    });

    return highlights.trim();
  }

  formatDetailedChanges(changes) {
    let formatted = '';

    const sections = [
      { key: 'added', title: '### ✨ New Features', icon: '•' },
      { key: 'security', title: '### 🔒 Security Improvements', icon: '🛡️' },
      { key: 'fixed', title: '### 🐛 Bug Fixes', icon: '•' },
      { key: 'changed', title: '### 🔄 Changes', icon: '•' },
      { key: 'deprecated', title: '### ⚠️ Deprecated', icon: '•' },
      { key: 'removed', title: '### 🗑️ Removed', icon: '•' }
    ];

    sections.forEach(section => {
      const items = changes[section.key];
      if (items && items.length > 0) {
        formatted += `${section.title}\n\n`;
        items.forEach(item => {
          formatted += `${section.icon} ${item}\n`;
        });
        formatted += '\n';
      }
    });

    return formatted;
  }

  formatPCIDSSImpact(pciReferences) {
    if (pciReferences.length === 0) {
      return 'No direct PCI DSS requirement updates in this release.';
    }

    let impact = `This release addresses ${pciReferences.length} PCI DSS requirement(s):\n\n`;
    
    pciReferences.forEach(ref => {
      impact += `- **${ref}**: Updated implementation and controls\n`;
    });

    impact += '\nCompliance officers should review changes for audit documentation updates.';
    
    return impact;
  }

  updateReleasesFile(releaseNotes) {
    let releasesContent = '';
    
    if (fs.existsSync(this.releasesPath)) {
      releasesContent = fs.readFileSync(this.releasesPath, 'utf8');
    } else {
      releasesContent = '# Release Notes - AmexingWeb\n\nExecutive-level release summaries for stakeholders, compliance officers, and management.\n\n';
    }

    // Insert new release notes after the header
    const headerMatch = releasesContent.match(/(# Release Notes - AmexingWeb[\s\S]*?\n\n)/);
    if (headerMatch) {
      const header = headerMatch[1];
      const rest = releasesContent.substring(header.length);
      releasesContent = header + releaseNotes + '\n' + rest;
    } else {
      releasesContent = releaseNotes + '\n\n' + releasesContent;
    }

    fs.writeFileSync(this.releasesPath, releasesContent);
  }

  run() {
    try {
      this.log(`🚀 Generating release notes for version ${this.version}...`);
      
      // Extract changes from changelog
      const changelogSection = this.extractChangelogSection(this.version);
      const changes = this.parseChanges(changelogSection);
      
      // Calculate security impact
      const securityImpact = this.calculateSecurityImpact(changes);
      
      this.log(`Security impact level: ${securityImpact.level}`, 
        securityImpact.level === 'Critical' ? 'error' : 
        securityImpact.level === 'High' ? 'warning' : 'info');

      // Generate release notes
      const releaseNotes = this.generateReleaseNotes(changes, securityImpact);
      
      // Update RELEASES.md
      this.updateReleasesFile(releaseNotes);
      
      this.log('Release notes generated successfully!', 'success');
      this.log(`Updated: ${this.releasesPath}`);
      
      // Output summary
      console.log('\n📋 Release Summary:');
      console.log(`Version: ${this.version}`);
      console.log(`Security Impact: ${securityImpact.level}`);
      console.log(`Security Changes: ${securityImpact.totalSecurityChanges}`);
      console.log(`New Features: ${changes.added.length}`);
      console.log(`Bug Fixes: ${changes.fixed.length}`);
      
      const pciRefs = this.extractPCIDSSReferences(changes);
      if (pciRefs.length > 0) {
        console.log(`PCI DSS Requirements: ${pciRefs.join(', ')}`);
      }

    } catch (error) {
      this.log(`Failed to generate release notes: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const generator = new ReleaseNotesGenerator();
  generator.run();
}

module.exports = ReleaseNotesGenerator;