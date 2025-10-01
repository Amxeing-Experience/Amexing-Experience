#!/usr/bin/env node

/**
 * Documentation Coverage Checker
 * Analyzes JavaScript files for JSDoc coverage
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Recursively find all JavaScript files in a directory
 * @param {string} dir - Directory to search
 * @param {Array<string>} fileList - Accumulator for file paths
 * @returns {Array<string>} Array of JavaScript file paths
 */
function findJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      findJsFiles(filePath, fileList);
    } else if (file.endsWith('.js') && !file.endsWith('.test.js') && !file.endsWith('.spec.js')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Check if a function/class has JSDoc documentation
 * @param {string} content - File content
 * @returns {Object} Documentation statistics
 */
function analyzeDocumentation(content) {
  // Split content into lines for better analysis
  const lines = content.split('\n');

  // More comprehensive regex patterns
  const patterns = {
    // Function declarations: function name(), async function name(), export function name()
    functionDeclaration: /^(?:\s*(?:export\s+)?(?:async\s+)?function\s+(\w+))/,
    // Class declarations: class Name, export class Name
    classDeclaration: /^(?:\s*(?:export\s+)?class\s+(\w+))/,
    // Arrow functions: const name = () =>, const name = async () =>
    arrowFunction: /^(?:\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/,
    // Method definitions: methodName() {, async methodName() {
    methodDefinition: /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
    // JSDoc comments
    jsdoc: /^\s*\/\*\*[\s\S]*?\*\//
  };

  const items = [];
  const jsdocBlocks = [];

  // First pass: Find all JSDoc blocks with their line ranges
  let currentJsdoc = null;
  let jsdocStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for JSDoc start
    if (line.trim().startsWith('/**')) {
      currentJsdoc = [line];
      jsdocStartLine = i;
    } else if (currentJsdoc && line.includes('*/')) {
      currentJsdoc.push(line);
      jsdocBlocks.push({
        startLine: jsdocStartLine + 1, // Convert to 1-based
        endLine: i + 1, // Convert to 1-based
        content: currentJsdoc.join('\n')
      });
      currentJsdoc = null;
    } else if (currentJsdoc) {
      currentJsdoc.push(line);
    }
  }

  // Second pass: Find all functions and classes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // Convert to 1-based

    // Skip if this line is inside a JSDoc comment
    const insideJsdoc = jsdocBlocks.some(block =>
      lineNum >= block.startLine && lineNum <= block.endLine
    );
    if (insideJsdoc) continue;

    let match, name, type;

    // Check for class declaration
    if ((match = patterns.classDeclaration.exec(line))) {
      name = match[1];
      type = 'class';
      items.push({ name, line: lineNum, type });
    }
    // Check for function declaration
    else if ((match = patterns.functionDeclaration.exec(line))) {
      name = match[1];
      type = 'function';
      items.push({ name, line: lineNum, type });
    }
    // Check for arrow function
    else if ((match = patterns.arrowFunction.exec(line))) {
      name = match[1];
      type = 'function';
      items.push({ name, line: lineNum, type });
    }
    // Check for method definition (but skip constructors and obvious non-public methods)
    else if ((match = patterns.methodDefinition.exec(line))) {
      name = match[1];
      // Skip constructor, private methods, getters/setters, and simple utility methods
      const skipMethods = [
        'constructor', 'init', 'setup', 'cleanup', 'destroy', 'refresh',
        'render', 'show', 'hide', 'toggle', 'reset', 'clear', 'update',
        'enable', 'disable', 'start', 'stop', 'pause', 'resume',
        'get', 'set', 'has', 'is', 'can', 'should', 'will'
      ];

      // Filter out conditional keywords (if/else/for/while/switch/catch/try)
      // These are control flow statements, not function declarations
      const conditionalKeywords = ['if', 'else', 'for', 'while', 'switch', 'catch', 'try'];

      if (!name.startsWith('_') &&
          !skipMethods.includes(name) &&
          !conditionalKeywords.includes(name) &&
          !skipMethods.some(skip => name.toLowerCase().startsWith(skip.toLowerCase()) && name.length > skip.length + 2)) {
        type = 'function';
        items.push({ name, line: lineNum, type });
      }
    }
  }

  // Third pass: Check which items have JSDoc documentation
  const documented = [];
  const undocumented = [];

  items.forEach((item) => {
    // Look for JSDoc block that ends within 2 lines before the item
    const hasDoc = jsdocBlocks.some((block) => {
      return block.endLine >= item.line - 2 && block.endLine < item.line;
    });

    if (hasDoc) {
      documented.push(item);
    } else {
      undocumented.push(item);
    }
  });

  return {
    total: items.length,
    documented: documented.length,
    undocumented: undocumented.length,
    undocumentedItems: undocumented,
    coverage: items.length > 0
      ? Math.round((documented.length / items.length) * 100)
      : 100,
  };
}

/**
 * Main function to analyze documentation coverage
 */
function main() {
  console.log('📚 Analyzing JSDoc Documentation Coverage...\n');
  
  const srcDir = path.join(process.cwd(), 'src');
  const jsFiles = findJsFiles(srcDir);
  
  let totalFunctions = 0;
  let totalDocumented = 0;
  const fileResults = [];
  
  jsFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const stats = analyzeDocumentation(content);
    const relativePath = path.relative(process.cwd(), filePath);
    
    totalFunctions += stats.total;
    totalDocumented += stats.documented;
    
    fileResults.push({
      file: relativePath,
      ...stats,
    });
  });
  
  // Sort by coverage (lowest first)
  fileResults.sort((a, b) => a.coverage - b.coverage);
  
  console.log('📋 Documentation Coverage Report:\n');
  
  fileResults.forEach((result) => {
    const status = result.coverage >= 80 ? '✅' : result.coverage >= 60 ? '⚠️' : '❌';
    console.log(`${status} ${result.file}: ${result.coverage}% (${result.documented}/${result.total})`);
    
    if (result.undocumented > 0 && result.coverage < 80) {
      result.undocumentedItems.forEach((item) => {
        console.log(`   - Missing: ${item.type} ${item.name} (line ${item.line})`);
      });
    }
  });
  
  const overallCoverage = totalFunctions > 0 
    ? Math.round((totalDocumented / totalFunctions) * 100) 
    : 100;
  
  console.log('\n📊 Overall Statistics:');
  console.log(`Total Functions/Classes: ${totalFunctions}`);
  console.log(`Documented: ${totalDocumented}`);
  console.log(`Undocumented: ${totalFunctions - totalDocumented}`);
  console.log(`Overall Coverage: ${overallCoverage}%\n`);
  
  // Set minimum coverage threshold (increased to 100% after achieving full coverage)
  const minCoverage = 100;
  
  if (overallCoverage >= minCoverage) {
    console.log(`✅ Documentation coverage meets minimum threshold (${minCoverage}%)`);
    process.exit(0);
  } else {
    console.log(`❌ Documentation coverage below minimum threshold (${minCoverage}%)`);
    console.log(`   Need to document ${Math.ceil(((minCoverage / 100) * totalFunctions) - totalDocumented)} more items`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { analyzeDocumentation, findJsFiles };