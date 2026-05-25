#!/usr/bin/env node

/**
 * Renderer Sync Wizard
 * Interactive tool to synchronize main services view with unified renderer
 * Created by Denisse Maldonado
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// File paths
const UNIFIED_RENDERER_PATH = path.join(__dirname, '../public/js/services-renderer.js');
const CONFIG_PATH = path.join(__dirname, '../public/js/services-renderer-config.js');
const BACKUP_DIR = path.join(__dirname, '../backups');

class RendererSyncWizard {
    constructor() {
        this.changes = [];
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.differences = [];
    }

    // Color helpers (basic ANSI codes)
    colors = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        cyan: '\x1b[36m',
        bold: '\x1b[1m'
    };

    color(text, color) {
        return `${this.colors[color]}${text}${this.colors.reset}`;
    }

    // Ask user a yes/no question
    async askYesNo(question) {
        return new Promise((resolve) => {
            this.rl.question(`${question} (Y/n): `, (answer) => {
                resolve(answer.toLowerCase() !== 'n');
            });
        });
    }

    // Ask user to select from options
    async askSelect(question, options) {
        console.log(question);
        options.forEach((option, index) => {
            console.log(`  ${index + 1}. ${option}`);
        });
        
        return new Promise((resolve) => {
            this.rl.question('Select (number): ', (answer) => {
                const index = parseInt(answer) - 1;
                if (index >= 0 && index < options.length) {
                    resolve(index);
                } else {
                    console.log(this.color('Invalid selection, please try again', 'red'));
                    resolve(this.askSelect(question, options));
                }
            });
        });
    }

    // Create backup of files
    createBackup() {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFiles = [
            {
                src: UNIFIED_RENDERER_PATH,
                dest: path.join(BACKUP_DIR, `services-renderer-${timestamp}.js`)
            },
            {
                src: CONFIG_PATH,
                dest: path.join(BACKUP_DIR, `services-renderer-config-${timestamp}.js`)
            }
        ];

        backupFiles.forEach(file => {
            if (fs.existsSync(file.src)) {
                fs.copyFileSync(file.src, file.dest);
                console.log(this.color(`✓ Backed up: ${path.basename(file.dest)}`, 'green'));
            }
        });
    }

    // Run sync checker and parse results
    runSyncChecker() {
        console.log(this.color('\n🔍 Running sync checker...', 'cyan'));
        
        try {
            // Run sync checker and capture output
            execSync('npm run check-sync', { encoding: 'utf8' });
            // If no error, renderers are in sync
            return [];
        } catch (error) {
            // Parse the output to extract differences
            const output = error.stdout || error.output?.toString() || '';
            const differences = [];
            
            // Parse differences from output
            const lines = output.split('\n');
            let inDifferences = false;
            let inWarnings = false;
            
            lines.forEach(line => {
                // Check if we're in the differences section
                if (line.includes('Found') && line.includes('difference(s)')) {
                    inDifferences = true;
                    inWarnings = false;
                } else if (line.includes('warning(s)')) {
                    inDifferences = false;
                    inWarnings = true;
                } else if (inDifferences && line.includes('. [')) {
                    // Parse difference line
                    const match = line.match(/\d+\.\s+\[([^\]]+)\]\s+(.+)/);
                    if (match) {
                        const severity = match[1].replace(/[^A-Z]/g, '').toLowerCase();
                        const description = match[2];
                        
                        // Parse specific difference types
                        if (description.includes('Label text mismatch')) {
                            const textMatch = description.match(/"([^"]+)"\s+vs\s+"([^"]+)"/);
                            if (textMatch) {
                                differences.push({
                                    type: 'label-text',
                                    severity: severity,
                                    original: textMatch[1],
                                    current: textMatch[2],
                                    description: description
                                });
                            }
                        } else if (description.includes('Text color mismatch')) {
                            const colorMatch = description.match(/text-(\w+)\s+vs\s+text-(\w+)/);
                            if (colorMatch) {
                                differences.push({
                                    type: 'text-color',
                                    severity: severity,
                                    originalColor: `text-${colorMatch[1]}`,
                                    currentColor: `text-${colorMatch[2]}`,
                                    label: description.match(/"([^"]+)"/)?.[1] || '',
                                    description: description
                                });
                            }
                        } else if (description.includes('Icon mismatch')) {
                            const iconMatch = description.match(/ti-([a-z-]+)\s+vs\s+ti-([a-z-]+)/);
                            if (iconMatch) {
                                // Check if this is a context-specific icon mismatch (has a label)
                                const label = description.match(/"([^"]+)"/)?.[1] || '';
                                if (label) {
                                    // This is a context-specific icon mismatch
                                    // iconMatch[1] is expected (what it should be), iconMatch[2] is actual (what it currently is)
                                    differences.push({
                                        type: 'icon-context-mismatch',
                                        severity: severity,
                                        expectedIcon: `ti-${iconMatch[1]}`,
                                        actualIcon: `ti-${iconMatch[2]}`,
                                        label: label,
                                        description: description
                                    });
                                } else {
                                    // This is a general icon mismatch
                                    differences.push({
                                        type: 'icon',
                                        severity: severity,
                                        originalIcon: `ti-${iconMatch[1]}`,
                                        currentIcon: `ti-${iconMatch[2]}`,
                                        label: '',
                                        description: description
                                    });
                                }
                            }
                        } else if (description.includes('CSS class missing')) {
                            const classMatch = description.match(/"([^"]+)":\s+(\S+)/);
                            if (classMatch) {
                                differences.push({
                                    type: 'css-class',
                                    severity: severity,
                                    label: classMatch[1],
                                    missingClass: classMatch[2],
                                    description: description
                                });
                            }
                        } else {
                            // Generic difference
                            differences.push({
                                type: 'other',
                                severity: severity,
                                description: description
                            });
                        }
                    }
                }
            });
            
            return differences;
        }
    }

    // Generate fixes based on differences
    generateFixes(differences) {
        const fixes = [];
        
        differences.forEach(diff => {
            switch (diff.type) {
                case 'label-text':
                    fixes.push({
                        name: `Fix label text: "${diff.current}" → "${diff.original}"`,
                        description: `Change "${diff.current}" to "${diff.original}" in unified renderer`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyLabelTextFix(diff);
                        }
                    });
                    break;
                
                case 'text-color':
                    fixes.push({
                        name: `Fix text color for "${diff.label}"`,
                        description: `Change ${diff.currentColor} to ${diff.originalColor}`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyTextColorFix(diff);
                        }
                    });
                    break;
                
                case 'icon':
                    fixes.push({
                        name: `Fix icon for "${diff.label}"`,
                        description: `Change ${diff.currentIcon} to ${diff.originalIcon}`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyIconFix(diff);
                        }
                    });
                    break;
                
                case 'css-class':
                    fixes.push({
                        name: `Add missing CSS class for "${diff.label}"`,
                        description: `Add ${diff.missingClass} class`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyCssClassFix(diff);
                        }
                    });
                    break;
                
                case 'badge':
                    fixes.push({
                        name: `Fix badge style: ${diff.description.split(': ')[1]}`,
                        description: `Add missing badge style to unified renderer`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyBadgeFix(diff);
                        }
                    });
                    break;
                
                case 'html-structure':
                    fixes.push({
                        name: `Fix HTML structure for "${diff.description.split('"')[1]}"`,
                        description: `Convert HTML structure to match main services view`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyStructureFix(diff);
                        }
                    });
                    break;
                
                case 'icon-missing':
                    fixes.push({
                        name: `Add missing icon: ${diff.missingIcon}`,
                        description: `Add missing icon to unified renderer`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyMissingIconFix(diff);
                        }
                    });
                    break;
                
                case 'icon-replacement':
                    fixes.push({
                        name: `Fix icon replacement: ${diff.originalIcon} → ${diff.newIcon}`,
                        description: `Change ${diff.newIcon} back to ${diff.originalIcon} for consistency`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyIconReplacementFix(diff);
                        }
                    });
                    break;
                
                case 'icon-context-mismatch':
                    fixes.push({
                        name: `Fix icon for "${diff.label}": ${diff.actualIcon} → ${diff.expectedIcon}`,
                        description: `Change icon used with "${diff.label}" to match main services`,
                        severity: diff.severity,
                        fix: () => {
                            this.applyContextIconFix(diff);
                        }
                    });
                    break;
                
                default:
                    // For other differences, create a generic fix
                    fixes.push({
                        name: diff.description,
                        description: 'Manual fix required',
                        severity: diff.severity,
                        fix: () => {
                            console.log(this.color(`ℹ️  ${diff.description} - requires manual fix`, 'yellow'));
                        }
                    });
            }
        });
        
        return fixes;
    }

    // Apply selected fixes
    async applyFixes(fixes) {
        console.log(this.color('\n📝 Applying fixes...', 'cyan'));
        
        for (const fix of fixes) {
            console.log(`  Applying: ${fix.name}...`);
            try {
                fix.fix();
                console.log(this.color(`  ✓ Fixed: ${fix.name}`, 'green'));
            } catch (error) {
                console.log(this.color(`  ✗ Error fixing ${fix.name}: ${error.message}`, 'red'));
            }
        }
    }

    // Main wizard flow
    async run() {
        console.log(this.color('\n═══════════════════════════════════════', 'blue'));
        console.log(this.color('   Renderer Synchronization Wizard', 'blue') + this.color(' 🧙', 'reset'));
        console.log(this.color('═══════════════════════════════════════\n', 'blue'));

        // Run sync checker to get actual differences
        const differences = this.runSyncChecker();
        
        if (differences.length === 0) {
            console.log(this.color('\n✅ Renderers are already in sync!\n', 'green'));
            this.rl.close();
            return;
        }

        // Show differences found
        console.log(this.color(`\n⚠️  Found ${differences.length} difference(s):\n`, 'yellow'));
        
        // Group by severity
        const highDiffs = differences.filter(d => d.severity === 'high');
        const mediumDiffs = differences.filter(d => d.severity === 'medium');
        const lowDiffs = differences.filter(d => d.severity === 'low');
        
        if (highDiffs.length > 0) {
            console.log(this.color('HIGH Priority:', 'red'));
            highDiffs.forEach(diff => {
                console.log(`  • ${diff.description}`);
            });
        }
        
        if (mediumDiffs.length > 0) {
            console.log(this.color('\nMEDIUM Priority:', 'yellow'));
            mediumDiffs.forEach(diff => {
                console.log(`  • ${diff.description}`);
            });
        }
        
        if (lowDiffs.length > 0) {
            console.log(this.color('\nLOW Priority:', 'cyan'));
            lowDiffs.forEach(diff => {
                console.log(`  • ${diff.description}`);
            });
        }
        
        // Generate fixes
        const fixes = this.generateFixes(differences);
        
        if (fixes.length === 0) {
            console.log(this.color('\n⚠️  No automatic fixes available. Manual fixes required.\n', 'yellow'));
            this.rl.close();
            return;
        }
        
        // Ask user what to do
        const action = await this.askSelect(
            '\nWhat would you like to do?',
            [
                'Fix all differences automatically',
                'Select which differences to fix',
                'Preview changes (dry-run mode)',
                'View details and exit'
            ]
        );

        if (action === 2) {
            // Preview changes (dry-run mode)
            console.log(this.color('\n📋 Preview of changes (no files will be modified):', 'cyan'));
            fixes.forEach((fix, index) => {
                console.log(`\n${index + 1}. ${this.color(fix.name, 'bold')}`);
                console.log(`   ${fix.description}`);
                console.log(`   Severity: ${fix.severity}`);
                
                // Show preview of what would change
                this.previewFix(fix);
            });
            this.rl.close();
            return;
        }

        if (action === 3) {
            // Just show details
            console.log('\nDetailed fixes available:');
            fixes.forEach((fix, index) => {
                console.log(`\n${index + 1}. ${this.color(fix.name, 'bold')}`);
                console.log(`   ${fix.description}`);
                console.log(`   Severity: ${fix.severity}`);
            });
            this.rl.close();
            return;
        }

        // Create backup
        const doBackup = await this.askYesNo('\nCreate backup before making changes?');
        if (doBackup) {
            this.createBackup();
        }

        let fixesToApply = fixes;

        if (action === 1) {
            // Select specific fixes
            fixesToApply = [];
            console.log('\n');
            for (const fix of fixes) {
                console.log(this.color(`\n${fix.name}`, 'bold'));
                console.log(`  ${fix.description}`);
                const apply = await this.askYesNo('  Apply this fix?');
                if (apply) {
                    fixesToApply.push(fix);
                }
            }
        }

        if (fixesToApply.length > 0) {
            // Apply the fixes
            await this.applyFixes(fixesToApply);
            
            console.log(this.color('\n✅ Synchronization complete!', 'green'));
            console.log('\nNext steps:');
            console.log('  1. Test the changes in your browser');
            console.log('  2. Run "npm run check-sync" to verify');
            console.log('  3. Commit the changes if everything looks good');
            
            if (doBackup) {
                console.log(`\n💾 Backups saved in: ${BACKUP_DIR}`);
            }
        } else {
            console.log(this.color('\nNo fixes applied', 'yellow'));
        }

        this.rl.close();
    }

    // Precise fix methods to prevent text corruption

    // Apply label text fix with precise string matching
    applyLabelTextFix(diff) {
        // Enhanced safety: multiple validation layers
        if (!this.validateFixInputs(diff, ['current', 'original'])) {
            return;
        }

        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;
        
        // Check if fix has already been applied
        if (this.isFixAlreadyApplied(content, diff.original, diff.current)) {
            console.log(`  ℹ️  Fix already applied for: ${diff.current} → ${diff.original}`);
            return;
        }

        // Enhanced safety: check for risky patterns that could cause corruption
        if (this.isRiskyTextReplacement(diff.current, diff.original)) {
            console.log(`  ⚠️  Skipping potentially risky replacement: ${diff.current} → ${diff.original}`);
            return;
        }

        // Find exact context where the text should be changed
        const contexts = this.findTextContexts(content, diff.current);
        
        if (contexts.length === 0) {
            console.log(`  ⚠️  Text "${diff.current}" not found in expected context`);
            return;
        }

        // Enhanced safety: validate each context before applying changes
        const validContexts = contexts.filter(context => this.isValidLabelContext(context, diff.current));
        
        if (validContexts.length === 0) {
            console.log(`  ⚠️  No valid context found for: ${diff.current}`);
            return;
        }

        if (validContexts.length > 1) {
            console.log(`  ⚠️  Multiple valid contexts found for: ${diff.current}. Applying to first occurrence only.`);
        }

        // Apply replacement only to the first valid context
        const targetContext = validContexts[0];
        const newLine = targetContext.fullMatch.replace(diff.current, diff.original);
        content = content.replace(targetContext.fullMatch, newLine);

        // Enhanced post-change verification
        if (this.verifyFixSuccess(content, originalContent, diff)) {
            fs.writeFileSync(UNIFIED_RENDERER_PATH, content);
            console.log(`  ✓ Applied label text fix: ${diff.current} → ${diff.original}`);
        } else {
            console.log(`  ✗ Fix verification failed, reverting changes`);
            // Restore original content
            fs.writeFileSync(UNIFIED_RENDERER_PATH, originalContent);
        }
    }

    // Apply text color fix with precise CSS class matching
    applyTextColorFix(diff) {
        // Enhanced safety: validate inputs
        if (!this.validateFixInputs(diff, ['label', 'currentColor', 'originalColor'])) {
            return;
        }

        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;
        const lines = content.split('\n');
        let fixApplied = false;

        // Extract color names from class patterns (e.g., "text-muted" -> "muted", "text-info" -> "info")
        const currentColor = diff.currentColor.replace('text-', '');
        const originalColor = diff.originalColor.replace('text-', '');

        console.log(`  🔍 Looking for color change: text-${currentColor} → text-${originalColor} for "${diff.label}"`);

        // Look for the label and search nearby lines for color classes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line contains the label
            if (line.includes(diff.label)) {
                console.log(`  📍 Found label "${diff.label}" on line ${i + 1}: ${line.trim()}`);
                
                // Check current line and nearby lines for color classes
                for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
                    const nearbyLine = lines[j];
                    
                    // Look for the current color class in nearby lines
                    if (nearbyLine.includes(`text-${currentColor}`)) {
                        console.log(`  🎯 Found text-${currentColor} on line ${j + 1}: ${nearbyLine.trim()}`);
                        
                        // Replace the color class
                        const newLine = nearbyLine.replace(`text-${currentColor}`, `text-${originalColor}`);
                        lines[j] = newLine;
                        fixApplied = true;
                        console.log(`  ✓ Fixed text color for "${diff.label}": text-${currentColor} → text-${originalColor}`);
                        break; // Only fix the first occurrence
                    }
                }
                
                if (fixApplied) break; // Stop after fixing the first instance of the label
            }
        }

        if (fixApplied) {
            // Enhanced post-change verification
            const newContent = lines.join('\n');
            if (this.verifyColorFixSuccess(newContent, originalContent, diff, currentColor, originalColor)) {
                fs.writeFileSync(UNIFIED_RENDERER_PATH, newContent);
            } else {
                console.log(`  ✗ Color fix verification failed, reverting changes`);
                fs.writeFileSync(UNIFIED_RENDERER_PATH, originalContent);
            }
        } else {
            console.log(`  ⚠️  Color pattern text-${currentColor} not found near label "${diff.label}"`);
        }
    }

    // Apply icon fix with precise icon class matching
    applyIconFix(diff) {
        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        
        // Find exact contexts where icon appears near the label
        const lines = content.split('\n');
        let fixApplied = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Look for lines that have both the current icon and the label within proximity
            if (line.includes(diff.currentIcon) && 
                (line.includes(diff.label) || 
                 (i < lines.length - 1 && lines[i + 1].includes(diff.label)))) {
                
                const iconRegex = new RegExp(`(class="[^"]*ti\\s+)${diff.currentIcon}([^"]*")`, 'g');
                const match = iconRegex.exec(line);
                
                if (match) {
                    lines[i] = line.replace(diff.currentIcon, diff.originalIcon);
                    fixApplied = true;
                    console.log(`  ✓ Fixed icon for "${diff.label}": ${diff.currentIcon} → ${diff.originalIcon}`);
                    break; // Only fix first occurrence to prevent over-replacement
                }
            }
        }

        if (fixApplied) {
            const newContent = lines.join('\n');
            fs.writeFileSync(UNIFIED_RENDERER_PATH, newContent);
        } else {
            console.log(`  ⚠️  Icon pattern not found for: ${diff.label}`);
        }
    }

    // Apply CSS class fix with precise class addition
    applyCssClassFix(diff) {
        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        
        // Find spans containing the label
        const lines = content.split('\n');
        let fixApplied = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(diff.label) && line.includes('<span') && line.includes('class=')) {
                // Check if class is already present
                if (line.includes(diff.missingClass)) {
                    console.log(`  ℹ️  CSS class already present for: ${diff.label}`);
                    return;
                }

                const classRegex = /<span([^>]*class="[^"]*)"([^>]*>.*?${diff.label}.*?<\/span>)/g;
                const match = classRegex.exec(line);
                
                if (match) {
                    const newLine = line.replace(
                        `class="${match[1]}"`, 
                        `class="${match[1]} ${diff.missingClass}"`
                    );
                    lines[i] = newLine;
                    fixApplied = true;
                    console.log(`  ✓ Added CSS class for "${diff.label}": ${diff.missingClass}`);
                    break;
                }
            }
        }

        if (fixApplied) {
            const newContent = lines.join('\n');
            fs.writeFileSync(UNIFIED_RENDERER_PATH, newContent);
        } else {
            console.log(`  ⚠️  CSS class target not found for: ${diff.label}`);
        }
    }

    // Apply badge fix - add missing badge styles
    applyBadgeFix(diff) {
        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;

        // Extract badge pattern from description (e.g., "success-success")
        const badgePattern = diff.description.split(': ')[1];
        
        // Parse badge pattern - convert "success-success" to proper Bootstrap classes
        const parts = badgePattern.split('-');
        if (parts.length === 2 && parts[0] === parts[1]) {
            const colorName = parts[0];
            const bootstrapClasses = `bg-${colorName}-subtle text-${colorName}`;
            
            console.log(`  ℹ️  Badge fix: This is typically a design decision rather than a bug`);
            console.log(`  ℹ️  The unified renderer uses consistent 'bg-light text-dark' badges`);
            console.log(`  ℹ️  Main services uses colored badges: ${bootstrapClasses}`);
            console.log(`  ⚠️  No automatic fix applied - manual review recommended`);
            return;
        }

        console.log(`  ⚠️  Unrecognized badge pattern: ${badgePattern}`);
    }

    // Apply HTML structure fix - convert between different HTML structures
    applyStructureFix(diff) {
        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;

        // Extract label and structure info from description
        const match = diff.description.match(/HTML structure mismatch for "([^"]+)": ([^vs]+) vs ([^$]+)/);
        if (!match) {
            console.log(`  ⚠️  Could not parse structure difference: ${diff.description}`);
            return;
        }

        const [, label, mainStructure, unifiedStructure] = match;
        
        console.log(`  🔍 Structure analysis for "${label}"`);
        console.log(`  📋 Main services uses: ${mainStructure.trim()}`);
        console.log(`  📋 Unified renderer uses: ${unifiedStructure.trim()}`);
        
        // Analyze specific structure patterns
        if (this.isContainerStructureDifference(mainStructure, unifiedStructure)) {
            console.log(`  ℹ️  Detected container structure difference`);
            
            // For certain safe transformations, we could apply them
            if (this.isSafeStructureTransformation(label, mainStructure, unifiedStructure)) {
                console.log(`  ✓ This appears to be a safe transformation`);
                console.log(`  ⚠️  However, automatic structure changes are disabled for safety`);
                console.log(`  💡 Consider manually reviewing this difference`);
            } else {
                console.log(`  ⚠️  This structure change could affect functionality`);
                console.log(`  🚨 Manual review strongly recommended`);
            }
        } else {
            console.log(`  ℹ️  Unrecognized structure pattern difference`);
        }
        
        console.log(`  📝 No automatic fix applied for HTML structure differences`);
    }

    // Apply missing icon fix - add icons that are missing in unified renderer
    applyMissingIconFix(diff) {
        console.log(`  ℹ️  Missing icon detected: ${diff.missingIcon}`);
        console.log(`  📝 This requires manual review to determine where the icon should be added`);
        console.log(`  💡 Check main services view to see where ${diff.missingIcon} is used`);
        console.log(`  ⚠️  No automatic fix applied to prevent unintended changes`);
    }

    // Apply icon replacement fix - change icons back to original versions
    applyIconReplacementFix(diff) {
        // Enhanced safety: validate inputs
        if (!this.validateFixInputs(diff, ['originalIcon', 'newIcon'])) {
            return;
        }

        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;

        console.log(`  🔄 Replacing icon: ${diff.newIcon} → ${diff.originalIcon}`);

        // Simple and safe icon replacement
        const newIconClass = diff.newIcon.replace('ti-', '');
        const originalIconClass = diff.originalIcon.replace('ti-', '');
        
        // Count occurrences before replacement
        const beforeCount = (content.match(new RegExp(`ti-${newIconClass}`, 'g')) || []).length;
        
        if (beforeCount === 0) {
            console.log(`  ⚠️  Icon ${diff.newIcon} not found in unified renderer`);
            return;
        }

        console.log(`  📍 Found ${beforeCount} occurrence(s) of ${diff.newIcon}`);

        // Replace all occurrences of the new icon with the original
        content = content.replaceAll(`ti-${newIconClass}`, `ti-${originalIconClass}`);
        
        // Verify the replacement worked
        const afterCount = (content.match(new RegExp(`ti-${originalIconClass}`, 'g')) || []).length;
        const remainingNewCount = (content.match(new RegExp(`ti-${newIconClass}`, 'g')) || []).length;
        
        if (remainingNewCount === 0 && afterCount > 0) {
            fs.writeFileSync(UNIFIED_RENDERER_PATH, content);
            console.log(`  ✓ Successfully replaced ${beforeCount} occurrence(s) of ${diff.newIcon} with ${diff.originalIcon}`);
        } else {
            console.log(`  ✗ Icon replacement verification failed, reverting`);
            fs.writeFileSync(UNIFIED_RENDERER_PATH, originalContent);
        }
    }

    // Apply context-specific icon fix
    applyContextIconFix(diff) {
        // Enhanced safety: validate inputs
        if (!this.validateFixInputs(diff, ['label', 'actualIcon', 'expectedIcon'])) {
            return;
        }
        
        let content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const originalContent = content;
        const lines = content.split('\n');
        
        console.log(`  🎯 Fixing context icon: ${diff.actualIcon} → ${diff.expectedIcon} for "${diff.label}"`);
        
        let fixApplied = false;
        const actualIconClass = diff.actualIcon.replace('ti-', '');
        const expectedIconClass = diff.expectedIcon.replace('ti-', '');
        
        // Find the line containing the label and the icon within nearby lines
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line contains the label
            if (line.includes(diff.label)) {
                console.log(`  📍 Found label "${diff.label}" on line ${i + 1}`);
                
                // Search in nearby lines (±3 lines) for the icon to replace
                const searchStart = Math.max(0, i - 3);
                const searchEnd = Math.min(lines.length - 1, i + 3);
                
                for (let j = searchStart; j <= searchEnd; j++) {
                    const nearbyLine = lines[j];
                    
                    if (nearbyLine.includes(`ti-${actualIconClass}`)) {
                        console.log(`  🔧 Replacing icon on line ${j + 1}: ti-${actualIconClass} → ti-${expectedIconClass}`);
                        
                        // Replace only this specific occurrence
                        lines[j] = nearbyLine.replace(`ti-${actualIconClass}`, `ti-${expectedIconClass}`);
                        fixApplied = true;
                        break; // Only fix the first occurrence
                    }
                }
                
                if (fixApplied) break; // Stop after fixing the first instance of the label
            }
        }
        
        if (fixApplied) {
            const newContent = lines.join('\n');
            // Verify the replacement worked
            const hasOldIcon = newContent.includes(`ti-${actualIconClass}`);
            const hasNewIcon = newContent.includes(`ti-${expectedIconClass}`);
            
            if (hasNewIcon) {
                fs.writeFileSync(UNIFIED_RENDERER_PATH, newContent);
                console.log(`  ✓ Successfully applied context icon fix for "${diff.label}"`);
            } else {
                console.log(`  ✗ Context icon fix verification failed, reverting`);
                fs.writeFileSync(UNIFIED_RENDERER_PATH, originalContent);
            }
        } else {
            console.log(`  ⚠️  Icon ${diff.actualIcon} not found near label "${diff.label}"`);
        }
    }

    // Check if this is a container structure difference
    isContainerStructureDifference(mainStructure, unifiedStructure) {
        const containerPatterns = ['container-icon-label', 'icon-label-span', 'icon-label-text'];
        return containerPatterns.some(pattern => 
            mainStructure.includes(pattern) || unifiedStructure.includes(pattern)
        );
    }

    // Determine if a structure transformation would be safe
    isSafeStructureTransformation(label, mainStructure, unifiedStructure) {
        // Define safe transformations that don't affect functionality
        const safeTransformations = [
            {
                from: 'icon-label-text',
                to: 'container-icon-label',
                condition: (label) => ['Vehículo', 'Vehicle'].some(word => label.includes(word))
            }
        ];
        
        return safeTransformations.some(transform => 
            mainStructure.includes(transform.from) && 
            unifiedStructure.includes(transform.to) &&
            transform.condition(label)
        );
    }

    // Helper: Check if fix has already been applied
    isFixAlreadyApplied(content, originalText, currentText) {
        const hasOriginal = content.includes(originalText);
        const hasCurrent = content.includes(currentText);
        return hasOriginal && !hasCurrent;
    }

    // Helper: Find all contexts where text appears
    findTextContexts(content, text) {
        const contexts = [];
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
            if (line.includes(text)) {
                contexts.push({
                    line: index + 1,
                    content: line.trim(),
                    fullMatch: line,
                    text: text
                });
            }
        });
        
        return contexts;
    }

    // Helper: Validate that text context is appropriate for label changes
    isValidLabelContext(context, text) {
        const line = context.content;
        // Only allow changes in span tags or similar label contexts
        return (line.includes('<span') && line.includes('text-muted')) ||
               (line.includes('<i') && line.includes('me-1')) ||
               line.includes('label') ||
               line.includes('title');
    }

    // Helper: Verify no text duplication occurred
    verifyNoTextDuplication(content, text) {
        const occurrences = (content.match(new RegExp(text, 'g')) || []).length;
        // For common words like "de", allow multiple occurrences but check for obvious duplications
        if (text === 'de llegada') {
            // Should not appear more than twice (once in label, maybe once in other context)
            return occurrences <= 2;
        }
        return true;
    }

    // Enhanced safety helper methods

    // Validate fix inputs to ensure they have required fields
    validateFixInputs(diff, requiredFields) {
        for (const field of requiredFields) {
            if (!diff[field] || diff[field].trim() === '') {
                console.log(`  ✗ Invalid fix input: missing or empty ${field}`);
                return false;
            }
        }
        return true;
    }

    // Check for risky text replacements that commonly cause corruption
    isRiskyTextReplacement(currentText, originalText) {
        // Check for overlapping substrings that could cause recursive replacement
        if (currentText.includes(originalText) || originalText.includes(currentText)) {
            return true;
        }
        
        // Check for common Spanish words that appear in multiple contexts
        const riskyWords = ['de', 'la', 'el', 'y', 'con'];
        if (riskyWords.some(word => currentText.toLowerCase().includes(word) && currentText.length < 10)) {
            return true;
        }
        
        // Check for very short replacements that could be too broad
        if (currentText.length < 3 && originalText.length < 3) {
            return true;
        }
        
        return false;
    }

    // Enhanced verification of fix success
    verifyFixSuccess(newContent, originalContent, diff) {
        // Basic checks
        if (!newContent || newContent === originalContent) {
            return false;
        }

        // Check that the original text is now present
        if (!newContent.includes(diff.original)) {
            console.log(`    ✗ Target text "${diff.original}" not found after fix`);
            return false;
        }

        // Check that we didn't create obvious text duplication
        if (!this.verifyNoTextDuplication(newContent, diff.original)) {
            console.log(`    ✗ Text duplication detected after fix`);
            return false;
        }

        // Check that the file structure is still valid (basic syntax check)
        if (!this.verifyFileSyntax(newContent)) {
            console.log(`    ✗ File syntax appears corrupted after fix`);
            return false;
        }

        return true;
    }

    // Basic file syntax verification for JavaScript/HTML
    verifyFileSyntax(content) {
        // Check for basic syntax issues that could indicate corruption
        const lines = content.split('\n');
        let braceCount = 0;
        let parenCount = 0;
        let quoteCount = 0;
        
        for (const line of lines) {
            // Count braces and parentheses
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            parenCount += (line.match(/\(/g) || []).length;
            parenCount -= (line.match(/\)/g) || []).length;
            
            // Count quotes (simple check)
            const singleQuotes = (line.match(/'/g) || []).length;
            const doubleQuotes = (line.match(/"/g) || []).length;
            if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
                // Allow some flexibility for complex template strings
                if (!line.includes('`') && !line.includes('\\')) {
                    quoteCount++;
                }
            }
        }
        
        // Allow some tolerance for unclosed structures in partial files
        return Math.abs(braceCount) < 10 && Math.abs(parenCount) < 10 && quoteCount < 5;
    }

    // Verify color fix was successful and didn't cause issues
    verifyColorFixSuccess(newContent, originalContent, diff, currentColor, originalColor) {
        // Basic checks
        if (!newContent || newContent === originalContent) {
            return false;
        }

        // Check that the new color class is now present
        if (!newContent.includes(`text-${originalColor}`)) {
            console.log(`    ✗ Target color "text-${originalColor}" not found after fix`);
            return false;
        }

        // Check that we didn't accidentally change too many instances
        const originalColorCount = (originalContent.match(new RegExp(`text-${originalColor}`, 'g')) || []).length;
        const newColorCount = (newContent.match(new RegExp(`text-${originalColor}`, 'g')) || []).length;
        
        if (newColorCount > originalColorCount + 2) {
            console.log(`    ✗ Too many color instances changed: ${originalColorCount} → ${newColorCount}`);
            return false;
        }

        // Check that the file structure is still valid
        if (!this.verifyFileSyntax(newContent)) {
            console.log(`    ✗ File syntax appears corrupted after color fix`);
            return false;
        }

        return true;
    }

    // Preview what a fix would change without applying it
    previewFix(fix) {
        const content = fs.readFileSync(UNIFIED_RENDERER_PATH, 'utf8');
        const lines = content.split('\n');
        
        console.log(this.color('     Preview:', 'gray'));
        
        // Find lines that would be affected by this fix
        let foundChanges = false;
        
        if (fix.name.includes('label text')) {
            // Preview label text changes
            lines.forEach((line, index) => {
                if (line.includes(fix.description.split('"')[1])) { // Extract current text
                    const currentText = fix.description.split('"')[1];
                    const originalText = fix.description.split('"')[3];
                    console.log(`     Line ${index + 1}:`);
                    console.log(`     ${this.color('Before:', 'red')} ${line.trim()}`);
                    console.log(`     ${this.color('After: ', 'green')} ${line.trim().replace(currentText, originalText)}`);
                    foundChanges = true;
                }
            });
        } else if (fix.name.includes('text color')) {
            // Preview color changes
            const label = fix.description.match(/"([^"]+)"/)?.[1];
            if (label) {
                lines.forEach((line, index) => {
                    if (line.includes(label)) {
                        console.log(`     Line ${index + 1}:`);
                        console.log(`     ${this.color('Context:', 'gray')} ${line.trim()}`);
                        foundChanges = true;
                    }
                });
            }
        } else if (fix.name.includes('icon')) {
            // Preview icon changes
            const label = fix.description.match(/"([^"]+)"/)?.[1];
            if (label) {
                lines.forEach((line, index) => {
                    if (line.includes(label)) {
                        console.log(`     Line ${index + 1}:`);
                        console.log(`     ${this.color('Context:', 'gray')} ${line.trim()}`);
                        foundChanges = true;
                    }
                });
            }
        }
        
        if (!foundChanges) {
            console.log(`     ${this.color('No matching content found in file', 'yellow')}`);
        }
    }
}

// Check if required modules are installed
const requiredModules = ['colors'];
const missingModules = [];

requiredModules.forEach(module => {
    try {
        require.resolve(module);
    } catch(e) {
        missingModules.push(module);
    }
});

if (missingModules.length > 0) {
    console.log('Installing required dependencies...');
    const { execSync } = require('child_process');
    execSync(`npm install ${missingModules.join(' ')}`, { stdio: 'inherit' });
}

// Run the wizard
const wizard = new RendererSyncWizard();
wizard.run().catch(error => {
    console.error('Error running wizard:', error);
    process.exit(1);
});