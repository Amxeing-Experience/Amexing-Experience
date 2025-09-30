#!/usr/bin/env node

/**
 * Console Log Cleanup Script
 *
 * Automatically removes unnecessary console.log statements from the codebase
 * while preserving critical logs (errors, security, tests).
 *
 * Usage:
 *   yarn clean:logs              # Remove all unnecessary logs
 *   yarn clean:logs:preview      # Preview changes without modifying files
 *   yarn clean:logs:backend      # Clean only backend files
 *   yarn clean:logs:frontend     # Clean only frontend files
 *   yarn clean:logs:report       # Generate report only
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

class ConsoleLogCleaner {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.scope = options.scope || 'all';
    this.reportOnly = options.reportOnly || false;
    this.stats = {
      filesScanned: 0,
      filesModified: 0,
      logsRemoved: 0,
      logsKept: 0,
      patterns: {}
    };
    this.modifiedFiles = [];
  }

  /**
   * Check if a line should be removed
   */
  shouldRemove(line, context = {}) {
    const trimmedLine = line.trim();

    // Patrones a remover con emojis
    const emojiPatterns = [
      /console\.log\([^)]*[🚀✅🔴📊🎯📍🧭📱🔔👤🆔⏰👁️📥🔄⚠️❌🟣🔵🟢🟡🟠⚪️⚫️💡🎨📋🔗🔌]/,
    ];

    // Patrones de mensajes innecesarios
    const messagePatterns = [
      /console\.log\([^)]*initialized[^)]*\)/i,
      /console\.log\([^)]*ready[^)]*\)/i,
      /console\.log\([^)]*loaded[^)]*\)/i,
      /console\.log\([^)]*Dashboard[^)]*\)/,
      /console\.log\([^)]*User.*role[^)]*\)/i,
      /console\.log\([^)]*Sidebar[^)]*\)/i,
      /console\.log\([^)]*Navigation[^)]*\)/i,
      /console\.log\([^)]*Header[^)]*\)/i,
      /console\.log\([^)]*Bootstrap[^)]*\)/i,
      /console\.log\([^)]*Notifications[^)]*\)/i,
      /console\.log\([^)]*Theme[^)]*\)/i,
      /console\.log\([^)]*layout[^)]*\)/i,
      /console\.log\([^)]*Page.*visible[^)]*\)/i,
      /console\.log\([^)]*menu.*initialized[^)]*\)/i,
    ];

    // Check emoji patterns
    for (const pattern of emojiPatterns) {
      if (pattern.test(trimmedLine)) {
        this.trackPattern('emoji');
        return true;
      }
    }

    // Check message patterns
    for (const pattern of messagePatterns) {
      if (pattern.test(trimmedLine)) {
        this.trackPattern('message');
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a line should be kept
   */
  shouldKeep(line, filePath, context = {}) {
    const trimmedLine = line.trim();

    // Mantener console.error siempre
    if (trimmedLine.includes('console.error')) {
      this.trackPattern('error-kept');
      return true;
    }

    // Mantener console.warn para warnings importantes
    if (trimmedLine.includes('console.warn')) {
      this.trackPattern('warn-kept');
      return true;
    }

    // Mantener logs en scripts/
    if (filePath.includes('/scripts/')) {
      this.trackPattern('scripts-kept');
      return true;
    }

    // Mantener logs en tests/
    if (filePath.includes('/tests/') || filePath.includes('.test.js') || filePath.includes('.spec.js')) {
      this.trackPattern('tests-kept');
      return true;
    }

    // Mantener logs de seguridad/PCI DSS
    if (trimmedLine.includes('security') || trimmedLine.includes('PCI') || trimmedLine.includes('audit')) {
      this.trackPattern('security-kept');
      return true;
    }

    return false;
  }

  /**
   * Track pattern statistics
   */
  trackPattern(patternName) {
    this.stats.patterns[patternName] = (this.stats.patterns[patternName] || 0) + 1;
  }

  /**
   * Clean a single file
   */
  cleanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      let modified = false;
      const newLines = [];
      let removedInFile = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const context = {
          lineNumber: i + 1,
          previousLine: i > 0 ? lines[i - 1] : '',
          nextLine: i < lines.length - 1 ? lines[i + 1] : ''
        };

        // Check if should keep (priority)
        if (this.shouldKeep(line, filePath, context)) {
          newLines.push(line);
          this.stats.logsKept++;
          continue;
        }

        // Check if should remove
        if (this.shouldRemove(line, context)) {
          modified = true;
          removedInFile++;
          this.stats.logsRemoved++;
          // Skip line (remove it)
          continue;
        }

        // Keep line by default
        newLines.push(line);
      }

      // Write file if modified and not in dry-run mode
      if (modified && !this.dryRun && !this.reportOnly) {
        fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
        this.stats.filesModified++;
        this.modifiedFiles.push({
          path: filePath,
          removed: removedInFile
        });
      } else if (modified) {
        this.modifiedFiles.push({
          path: filePath,
          removed: removedInFile
        });
      }

      return modified;
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Get file patterns based on scope
   */
  getFilePatterns() {
    const baseDir = process.cwd();

    if (this.scope === 'backend') {
      return [
        path.join(baseDir, 'src/application/**/*.js'),
        path.join(baseDir, 'src/domain/**/*.js'),
        path.join(baseDir, 'src/infrastructure/**/*.js'),
        path.join(baseDir, 'src/cloud/**/*.js')
      ];
    }

    if (this.scope === 'frontend') {
      return [
        path.join(baseDir, 'src/presentation/**/*.js'),
        path.join(baseDir, 'src/presentation/**/*.ejs')
      ];
    }

    // 'all' scope
    return [
      path.join(baseDir, 'src/**/*.js'),
      path.join(baseDir, 'src/**/*.ejs')
    ];
  }

  /**
   * Run the cleanup process
   */
  run() {
    console.log('\n' + '='.repeat(60));
    console.log('Console Log Cleanup Script');
    console.log('='.repeat(60));
    console.log(`Mode: ${this.dryRun || this.reportOnly ? 'DRY RUN (no changes)' : 'LIVE'}`);
    console.log(`Scope: ${this.scope}`);
    console.log('='.repeat(60) + '\n');

    // Get file patterns
    const patterns = this.getFilePatterns();

    // Find all files
    const allFiles = [];
    for (const pattern of patterns) {
      const files = glob.sync(pattern, {
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
      });
      allFiles.push(...files);
    }

    // Remove duplicates
    const uniqueFiles = [...new Set(allFiles)];
    this.stats.filesScanned = uniqueFiles.length;

    console.log(`Found ${uniqueFiles.length} files to scan...\n`);

    // Process each file
    let progress = 0;
    for (const file of uniqueFiles) {
      progress++;
      if (progress % 10 === 0) {
        process.stdout.write(`\rProcessing: ${progress}/${uniqueFiles.length}`);
      }
      this.cleanFile(file);
    }
    process.stdout.write(`\rProcessing: ${uniqueFiles.length}/${uniqueFiles.length}\n`);

    // Print report
    this.printReport();
  }

  /**
   * Print final report
   */
  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('Cleanup Report');
    console.log('='.repeat(60));

    console.log('\n📊 Statistics:');
    console.log(`  Files scanned:  ${this.stats.filesScanned}`);
    console.log(`  Files modified: ${this.stats.filesModified}`);
    console.log(`  Logs removed:   ${this.stats.logsRemoved}`);
    console.log(`  Logs kept:      ${this.stats.logsKept}`);

    if (Object.keys(this.stats.patterns).length > 0) {
      console.log('\n📋 Pattern Breakdown:');
      Object.entries(this.stats.patterns).forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count}`);
      });
    }

    if (this.modifiedFiles.length > 0) {
      console.log('\n📝 Modified Files:');
      this.modifiedFiles.slice(0, 20).forEach(file => {
        const relativePath = path.relative(process.cwd(), file.path);
        console.log(`  ${relativePath} (${file.removed} logs removed)`);
      });
      if (this.modifiedFiles.length > 20) {
        console.log(`  ... and ${this.modifiedFiles.length - 20} more files`);
      }
    }

    if (this.dryRun || this.reportOnly) {
      console.log('\n⚠️  DRY RUN MODE - No files were modified');
      console.log('   Run without --dry-run to apply changes');
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    reportOnly: args.includes('--report-only'),
    scope: 'all'
  };

  // Parse scope
  const scopeArg = args.find(a => a.startsWith('--scope='));
  if (scopeArg) {
    options.scope = scopeArg.split('=')[1];
  }

  return options;
}

// Main execution
(() => {
  try {
    const options = parseArgs();
    const cleaner = new ConsoleLogCleaner(options);
    cleaner.run();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();
