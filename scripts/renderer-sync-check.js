#!/usr/bin/env node

/**
 * Renderer Sync Check Script
 * Checks synchronization between main services view and unified renderer
 * Created by Denisse Maldonado
 */

const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');

// File paths
const MAIN_SERVICES_PATH = path.join(__dirname, '../public/dashboards/admin/sections/quote-services-v2.js');
const UNIFIED_RENDERER_PATH = path.join(__dirname, '../public/js/services-renderer.js');
const CONFIG_PATH = path.join(__dirname, '../public/js/services-renderer-config.js');

class RendererSyncChecker {
    constructor() {
        this.differences = [];
        this.warnings = [];
    }

    // Read and parse file content
    readFile(filePath) {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            console.error(colors.red(`Error reading file: ${filePath}`));
            console.error(error.message);
            process.exit(1);
        }
    }

    // Extract rendering patterns from main services
    extractMainServicePatterns() {
        const content = this.readFile(MAIN_SERVICES_PATH);
        const patterns = {
            badges: [],
            labels: {},
            fields: [],
            icons: [],
            labelFormatting: []
        };

        // Extract badge patterns - capture full Bootstrap class patterns
        const badgeMatches = content.matchAll(/badge\s+(bg-\w+(?:-\w+)?)\s+(text-\w+(?:-\w+)?)[^>]*>([^<]+)</g);
        for (const match of badgeMatches) {
            patterns.badges.push({
                background: match[1], // Full bg class like "bg-success-subtle"
                text: match[2],       // Full text class like "text-success" 
                content: match[3].trim(),
                fullPattern: `${match[1]}-${match[2]}` // Combined pattern for comparison
            });
        }

        // Extract label patterns with formatting
        const labelWithFormattingPatterns = [
            { 
                regex: /<i class="ti ti-(\w+)[^"]*"[^>]*><\/i>\s*<span class="([^"]*)"[^>]*>([^<]+):<\/span>/g,
                name: 'icon-label-span'
            },
            {
                regex: /<div class="([^"]*)"[^>]*>\s*<i class="ti ti-(\w+)[^"]*"[^>]*><\/i>\s*<span class="([^"]*)"[^>]*>([^<]+):<\/span>/g,
                name: 'container-icon-label'
            }
        ];

        labelWithFormattingPatterns.forEach(pattern => {
            const matches = content.matchAll(pattern.regex);
            for (const match of matches) {
                if (pattern.name === 'icon-label-span') {
                    patterns.labelFormatting.push({
                        icon: `ti-${match[1]}`,
                        spanClasses: match[2],
                        labelText: match[3].trim(),
                        structure: 'icon-label-span'
                    });
                } else if (pattern.name === 'container-icon-label') {
                    patterns.labelFormatting.push({
                        containerClasses: match[1],
                        icon: `ti-${match[2]}`,
                        spanClasses: match[3],
                        labelText: match[4].trim(),
                        structure: 'container-icon-label'
                    });
                }
            }
        });

        // Simple icon extraction - just get all ti- icons used in the file
        const iconMatches = content.matchAll(/ti-([a-z-]+)/g);
        const iconSet = new Set();
        for (const match of iconMatches) {
            iconSet.add(match[1]);
        }
        patterns.icons = Array.from(iconSet).sort();

        // Simple label existence check
        const specificLabels = [
            'Hora de llegada',
            'Horario de salida', 
            'Dirección de llegada',
            'Aerolínea',
            'Número de vuelo'
        ];

        specificLabels.forEach(label => {
            if (content.includes(label)) {
                patterns.labels[label] = {
                    exists: true,
                    // Don't try to parse complex HTML - just note it exists
                    icon: null
                };
            }
        });

        return patterns;
    }

    // Extract patterns from unified renderer
    extractUnifiedRendererPatterns() {
        const content = this.readFile(UNIFIED_RENDERER_PATH);
        const configContent = this.readFile(CONFIG_PATH);
        
        const patterns = {
            badges: [],
            labels: {},
            fields: [],
            icons: [],
            labelFormatting: []
        };

        // Similar extraction logic for unified renderer
        const badgeMatches = content.matchAll(/badge\s+(bg-\w+(?:-\w+)?)\s+(text-\w+(?:-\w+)?)[^>]*>([^<]+)</g);
        for (const match of badgeMatches) {
            patterns.badges.push({
                background: match[1], // Full bg class like "bg-success-subtle"
                text: match[2],       // Full text class like "text-success"
                content: match[3].trim(),
                fullPattern: `${match[1]}-${match[2]}` // Combined pattern for comparison
            });
        }

        // Extract label patterns with formatting
        const labelWithFormattingPatterns = [
            { 
                regex: /<i class="ti ti-(\w+)[^"]*"[^>]*><\/i>\s*<span class="([^"]*)"[^>]*>([^<]+):<\/span>/g,
                name: 'icon-label-span'
            },
            {
                regex: /<i class="ti ti-(\w+)[^"]*"[^>]*><\/i>\s*([^<]+):/g,
                name: 'icon-label-text'
            },
            {
                regex: /<div class="([^"]*)"[^>]*>\s*<i class="ti ti-(\w+)[^"]*"[^>]*><\/i>\s*<span class="([^"]*)"[^>]*>([^<]+):<\/span>/g,
                name: 'container-icon-label'
            }
        ];

        labelWithFormattingPatterns.forEach(pattern => {
            const matches = content.matchAll(pattern.regex);
            for (const match of matches) {
                if (pattern.name === 'icon-label-span') {
                    patterns.labelFormatting.push({
                        icon: `ti-${match[1]}`,
                        spanClasses: match[2],
                        labelText: match[3].trim(),
                        structure: 'icon-label-span'
                    });
                } else if (pattern.name === 'icon-label-text') {
                    patterns.labelFormatting.push({
                        icon: `ti-${match[1]}`,
                        labelText: match[2].trim(),
                        structure: 'icon-label-text'
                    });
                } else if (pattern.name === 'container-icon-label') {
                    patterns.labelFormatting.push({
                        containerClasses: match[1],
                        icon: `ti-${match[2]}`,
                        spanClasses: match[3],
                        labelText: match[4].trim(),
                        structure: 'container-icon-label'
                    });
                }
            }
        });

        // Check for specific labels with variations
        const labelVariations = [
            ['Hora de llegada', 'Hora de llegada'],
            ['Horario de salida', 'Horario de salida'],
            ['Dirección de llegada', 'Dirección de llegada'],
            ['Aerolínea', 'Aerolínea'],
            ['Número de vuelo', 'Número de vuelo']
        ];

        // Simple icon extraction - just get all ti- icons used in the file
        const iconMatches = content.matchAll(/ti-([a-z-]+)/g);
        const iconSet = new Set();
        for (const match of iconMatches) {
            iconSet.add(match[1]);
        }
        patterns.icons = Array.from(iconSet).sort();

        // Simple label existence check with variations
        labelVariations.forEach(([mainLabel, unifiedLabel]) => {
            if (content.includes(unifiedLabel) || configContent.includes(unifiedLabel)) {
                patterns.labels[mainLabel] = {
                    exists: true,
                    actualText: unifiedLabel,
                    // Don't try to parse complex HTML - just note it exists
                    icon: null
                };
            }
        });

        return patterns;
    }

    // Compare patterns and find differences
    comparePatterns(mainPatterns, unifiedPatterns) {
        // Compare badges using full patterns
        const mainBadgeSet = new Set(mainPatterns.badges.map(b => b.fullPattern || `${b.background}-${b.text}`));
        const unifiedBadgeSet = new Set(unifiedPatterns.badges.map(b => b.fullPattern || `${b.background}-${b.text}`));

        mainBadgeSet.forEach(badge => {
            if (!unifiedBadgeSet.has(badge)) {
                // Only report if it's a meaningful difference (not just color variations)
                const mainBadge = mainPatterns.badges.find(b => (b.fullPattern || `${b.background}-${b.text}`) === badge);
                if (mainBadge && !this.isBadgeColorVariation(badge, unifiedBadgeSet)) {
                    this.differences.push({
                        type: 'badge',
                        description: `Badge style missing in unified renderer: ${mainBadge.background} ${mainBadge.text}`,
                        severity: 'medium',
                        badgePattern: badge,
                        expectedClasses: `${mainBadge.background} ${mainBadge.text}`
                    });
                }
            }
        });

        // Compare labels with formatting
        Object.keys(mainPatterns.labels).forEach(label => {
            const mainLabel = mainPatterns.labels[label];
            const unifiedLabel = unifiedPatterns.labels[label];
            
            if (!unifiedLabel || !unifiedLabel.exists) {
                this.differences.push({
                    type: 'label',
                    description: `Label missing in unified renderer: ${label}`,
                    severity: 'high'
                });
            } else {
                // Check if text matches exactly
                if (unifiedLabel.actualText && unifiedLabel.actualText !== label) {
                    this.differences.push({
                        type: 'label-text',
                        description: `Label text mismatch: "${label}" vs "${unifiedLabel.actualText}"`,
                        severity: 'medium'
                    });
                }
                
                // Check if icons match
                if (mainLabel.icon && unifiedLabel.icon && mainLabel.icon !== unifiedLabel.icon) {
                    this.differences.push({
                        type: 'label-icon',
                        description: `Icon mismatch for "${label}": ${mainLabel.icon} vs ${unifiedLabel.icon}`,
                        severity: 'medium'
                    });
                }
            }
        });

        // Compare label formatting patterns
        const mainFormattingMap = new Map();
        mainPatterns.labelFormatting.forEach(format => {
            mainFormattingMap.set(format.labelText, format);
        });

        const unifiedFormattingMap = new Map();
        unifiedPatterns.labelFormatting.forEach(format => {
            unifiedFormattingMap.set(format.labelText, format);
        });

        mainFormattingMap.forEach((mainFormat, label) => {
            const unifiedFormat = unifiedFormattingMap.get(label) || 
                                 unifiedFormattingMap.get(label.replace('Horario de salida', 'Hora sugerida de salida'));
            
            if (unifiedFormat) {
                // Check CSS classes
                if (mainFormat.spanClasses && unifiedFormat.spanClasses) {
                    const mainClasses = new Set(mainFormat.spanClasses.split(' '));
                    const unifiedClasses = new Set(unifiedFormat.spanClasses.split(' '));
                    
                    mainClasses.forEach(cls => {
                        if (cls && !unifiedClasses.has(cls)) {
                            this.differences.push({
                                type: 'css-class',
                                description: `CSS class missing for "${label}": ${cls}`,
                                severity: 'low'
                            });
                        }
                    });
                }

                // Check structure differences
                if (mainFormat.structure !== unifiedFormat.structure) {
                    this.differences.push({
                        type: 'html-structure',
                        description: `HTML structure mismatch for "${label}": ${mainFormat.structure} vs ${unifiedFormat.structure}`,
                        severity: 'medium'
                    });
                }

                // Check container classes if both have containers
                if (mainFormat.containerClasses && unifiedFormat.containerClasses) {
                    const hasTextMuted = mainFormat.containerClasses.includes('text-muted');
                    const hasTextInfo = unifiedFormat.containerClasses.includes('text-info');
                    
                    if (hasTextMuted && hasTextInfo) {
                        this.differences.push({
                            type: 'text-color',
                            description: `Text color mismatch for "${label}": text-muted vs text-info`,
                            severity: 'high',
                            label: label,
                            currentColor: 'text-info',
                            originalColor: 'text-muted'
                        });
                    }
                }
            }
        });

        // Compare icons directly - much simpler and more reliable
        console.log(`Main services icons (${mainPatterns.icons.length}):`, mainPatterns.icons);
        console.log(`Unified renderer icons (${unifiedPatterns.icons.length}):`, unifiedPatterns.icons);
        
        // Find icons missing in unified renderer
        const missingInUnified = mainPatterns.icons.filter(icon => !unifiedPatterns.icons.includes(icon));
        
        // Find icons only in unified renderer
        const extraInUnified = unifiedPatterns.icons.filter(icon => !mainPatterns.icons.includes(icon));
        
        // Report missing icons as high priority if they're service-related
        const serviceIcons = ['clock', 'user', 'users', 'car', 'plane', 'map-pin', 'ticket', 'calendar'];
        missingInUnified.forEach(icon => {
            if (serviceIcons.some(serviceIcon => icon.includes(serviceIcon))) {
                this.differences.push({
                    type: 'icon-missing',
                    description: `Icon missing in unified renderer: ti-${icon}`,
                    severity: 'high',
                    missingIcon: `ti-${icon}`,
                    context: 'unified-renderer'
                });
            } else {
                this.warnings.push({
                    type: 'icon',
                    description: `UI icon missing in unified renderer: ti-${icon}`,
                    severity: 'low'
                });
            }
        });
        
        // Report extra icons as info (might be intentional improvements)
        extraInUnified.forEach(icon => {
            if (serviceIcons.some(serviceIcon => icon.includes(serviceIcon))) {
                this.warnings.push({
                    type: 'icon',
                    description: `Extra service icon in unified renderer: ti-${icon}`,
                    severity: 'low'
                });
            }
        });
        
        // Detect likely icon replacements (like clock vs clock-check)
        this.detectIconReplacements(missingInUnified, extraInUnified);
        
        // Check context-specific icon mismatches
        this.detectContextSpecificIconMismatches(mainPatterns, unifiedPatterns);
    }

    // Check for specific rendering rules
    checkRenderingRules() {
        const unifiedContent = this.readFile(UNIFIED_RENDERER_PATH);
        
        // Check for critical rendering conditions
        const criticalChecks = [
            {
                pattern: /service\.time/,
                description: 'Checking service.time field'
            },
            {
                pattern: /service\.directionType\s*===\s*['"]arrival['"]/,
                description: 'Checking arrival direction handling'
            },
            {
                pattern: /service\.transportType\s*===\s*['"]aeropuerto['"]/,
                description: 'Checking airport transport handling'
            },
            {
                pattern: /returnOrigin|returnDestination/,
                description: 'Checking return trip fields'
            }
        ];

        criticalChecks.forEach(check => {
            if (!check.pattern.test(unifiedContent)) {
                this.warnings.push({
                    type: 'rule',
                    description: `Missing rule: ${check.description}`,
                    severity: 'medium'
                });
            }
        });
    }

    // Check if badge difference is just a color variation (design choice)
    isBadgeColorVariation(mainBadgePattern, unifiedBadgeSet) {
        // The unified renderer uses consistent "bg-light-text-dark" for most badges
        // This is a design decision, not necessarily a bug
        const unifiedConsistentPattern = 'bg-light-text-dark';
        
        // Check if unified renderer has the consistent pattern
        if (unifiedBadgeSet.has(unifiedConsistentPattern)) {
            // Extract the semantic meaning from the main badge pattern
            const isColoredBadge = mainBadgePattern.includes('success') || 
                                  mainBadgePattern.includes('info') || 
                                  mainBadgePattern.includes('warning') || 
                                  mainBadgePattern.includes('danger');
            
            // If main uses colored badges but unified uses consistent styling, 
            // this is likely a design choice, not a bug
            if (isColoredBadge) {
                return true; // It's a color variation (design choice)
            }
        }
        
        return false; // It's a real structural difference
    }

    // Detect likely icon replacements (e.g., clock → clock-check)
    detectIconReplacements(missingInUnified, extraInUnified) {
        missingInUnified.forEach(missingIcon => {
            // Look for similar icons in the extra list
            const potentialReplacements = extraInUnified.filter(extraIcon => {
                // Check if extra icon is an extended version of missing icon
                return extraIcon.startsWith(missingIcon + '-') || 
                       missingIcon.startsWith(extraIcon + '-') ||
                       this.areIconsSimilar(missingIcon, extraIcon);
            });

            potentialReplacements.forEach(replacement => {
                this.differences.push({
                    type: 'icon-replacement',
                    description: `Icon replaced in unified renderer: ti-${missingIcon} → ti-${replacement}`,
                    severity: 'medium',
                    originalIcon: `ti-${missingIcon}`,
                    newIcon: `ti-${replacement}`,
                    context: 'icon-replacement'
                });
            });
        });
    }

    // Check if two icons are semantically similar
    areIconsSimilar(icon1, icon2) {
        const similarPairs = [
            ['clock', 'clock-check'],
            ['plane', 'plane-arrival', 'plane-departure'],
            ['user', 'users'],
            ['car', 'car-crane'],
            ['map-pin', 'map-pin-filled']
        ];

        return similarPairs.some(group => 
            group.includes(icon1) && group.includes(icon2)
        );
    }

    // Detect context-specific icon mismatches (e.g., wrong icon used with specific labels)
    detectContextSpecificIconMismatches(mainPatterns, unifiedPatterns) {
        const mainContent = this.readFile(MAIN_SERVICES_PATH);
        const unifiedContent = this.readFile(UNIFIED_RENDERER_PATH);
        
        // Define specific contexts to check (label + expected icon)
        const contextChecks = [
            {
                label: 'Horario de salida',
                expectedIcon: 'ti-clock',
                description: 'Departure time suggestions should use ti-clock icon'
            },
            {
                label: 'Hora de llegada',
                expectedIcon: 'ti-clock',
                description: 'Arrival time should use ti-clock icon'
            },
            {
                label: 'Horario de salida',
                expectedIcon: 'ti-clock',
                description: 'Departure schedule should use ti-clock icon'
            }
        ];

        contextChecks.forEach(check => {
            const mainIcon = this.extractIconForLabel(mainContent, check.label);
            const unifiedIcon = this.extractIconForLabel(unifiedContent, check.label);
            
            // If both have the label but different icons
            if (mainIcon && unifiedIcon && mainIcon !== unifiedIcon) {
                this.differences.push({
                    type: 'icon-context-mismatch',
                    description: `Icon mismatch for "${check.label}": ${mainIcon} vs ${unifiedIcon}`,
                    severity: 'high',
                    label: check.label,
                    expectedIcon: mainIcon,
                    actualIcon: unifiedIcon,
                    context: 'label-icon-relationship'
                });
                
                console.log(`📍 Context mismatch: "${check.label}" uses ${mainIcon} in main, ${unifiedIcon} in unified`);
            }
        });
    }

    // Extract the icon used with a specific label in content
    extractIconForLabel(content, label) {
        // Look for the label and find the nearest icon (within a reasonable proximity)
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(label)) {
                // Search current line and nearby lines (±2) for ti- icons
                for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
                    const nearbyLine = lines[j];
                    const iconMatch = nearbyLine.match(/ti-([\w-]+)/);
                    if (iconMatch) {
                        return `ti-${iconMatch[1]}`;
                    }
                }
            }
        }
        
        return null; // No icon found for this label
    }

    // Generate report
    generateReport(format = 'console') {
        if (format === 'json') {
            return JSON.stringify({
                timestamp: new Date().toISOString(),
                differences: this.differences,
                warnings: this.warnings,
                synced: this.differences.length === 0
            }, null, 2);
        }

        // Console output
        console.log('\n' + colors.blue('═══════════════════════════════════════'));
        console.log(colors.blue.bold('   Renderer Synchronization Check'));
        console.log(colors.blue('═══════════════════════════════════════\n'));

        if (this.differences.length === 0 && this.warnings.length === 0) {
            console.log(colors.green.bold('✅ Renderers are in sync!\n'));
            return true;
        }

        if (this.differences.length > 0) {
            console.log(colors.red.bold(`⚠️  Found ${this.differences.length} difference(s):\n`));
            this.differences.forEach((diff, index) => {
                const severityColor = diff.severity === 'high' ? 'red' : 
                                    diff.severity === 'medium' ? 'yellow' : 'gray';
                console.log(`  ${index + 1}. [${colors[severityColor](diff.severity.toUpperCase())}] ${diff.description}`);
            });
        }

        if (this.warnings.length > 0) {
            console.log(colors.yellow.bold(`\n⚠️  ${this.warnings.length} warning(s):\n`));
            this.warnings.forEach((warning, index) => {
                console.log(colors.yellow(`  ${index + 1}. ${warning.description}`));
            });
        }

        console.log(colors.cyan('\n💡 Run "npm run sync-renderer" to fix these differences\n'));
        return false;
    }

    // Main check function
    check() {
        try {
            console.log(colors.gray('Analyzing main services view...'));
            const mainPatterns = this.extractMainServicePatterns();
            
            console.log(colors.gray('Analyzing unified renderer...'));
            const unifiedPatterns = this.extractUnifiedRendererPatterns();
            
            console.log(colors.gray('Comparing patterns...'));
            this.comparePatterns(mainPatterns, unifiedPatterns);
            
            console.log(colors.gray('Checking rendering rules...'));
            this.checkRenderingRules();
            
            const isSynced = this.generateReport(process.argv.includes('--json') ? 'json' : 'console');
            
            // Exit with appropriate code
            process.exit(isSynced ? 0 : 1);
            
        } catch (error) {
            console.error(colors.red('Error during sync check:'));
            console.error(error);
            process.exit(1);
        }
    }
}

// Check if colors module is installed
try {
    require.resolve('colors');
} catch(e) {
    console.log('Installing required dependencies...');
    require('child_process').execSync('npm install colors', { stdio: 'inherit' });
}

// Run the checker
const checker = new RendererSyncChecker();
checker.check();