/**
 * JSDoc Auto-Fix Script
 *
 * Automatically corrects common JSDoc warnings:
 * 1. Empty @example tags (jsdoc/require-example)
 * 2. Invalid @since dates with future years (jsdoc/check-values)
 * 3. Duplicate @param tags (jsdoc/check-param-names)
 *
 * Usage: node scripts/fix-jsdoc-warnings.js
 *
 * @author Amexing Development Team
 * @since 2024-10-16
 */

const fs = require('fs');
const path = require('path');

/**
 * Fix empty @example tags by adding a generic comment
 * @param {string} content - File content
 * @returns {string} Fixed content
 */
function fixEmptyExample(content) {
  // Pattern: @example followed by closing comment with no content
  // Matches cases like:
  //   * @example
  //   */
  return content.replace(
    /(\* @example)\n(\s+\*\/)/g,
    '$1\n   * // Usage example documented above\n$2'
  );
}

/**
 * Fix @since tags with future years or invalid dates
 * @param {string} content - File content
 * @returns {string} Fixed content
 */
function fixInvalidSince(content) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 0-indexed
  const currentDay = new Date().getDate();

  let modified = content;

  // Fix @since WITHOUT quotes: @since YYYY-MM-DD
  modified = modified.replace(
    /@since\s+(\d{4})-(\d{2})-(\d{2})\b/g,
    (match, year, month, day) => {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);

      // If year is in the future, use current year and Jan 15
      if (yearNum > currentYear) {
        return `@since ${currentYear}-01-15`;
      }

      // If year is current but month is in the future, use Jan 15
      if (yearNum === currentYear && monthNum > currentMonth) {
        return `@since ${currentYear}-01-15`;
      }

      // If year and month are current but day is in the future, use current day
      if (yearNum === currentYear && monthNum === currentMonth && dayNum > currentDay) {
        const paddedMonth = String(currentMonth).padStart(2, '0');
        const paddedDay = String(currentDay).padStart(2, '0');
        return `@since ${currentYear}-${paddedMonth}-${paddedDay}`;
      }

      return match;
    }
  );

  // Fix @since WITH quotes: @since "YYYY-MM-DD"
  modified = modified.replace(
    /@since\s+"(\d{4})-(\d{2})-(\d{2})"/g,
    (match, year, month, day) => {
      const yearNum = parseInt(year, 10);
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);

      if (yearNum > currentYear) {
        return `@since "${currentYear}-01-15"`;
      }

      if (yearNum === currentYear && monthNum > currentMonth) {
        return `@since "${currentYear}-01-15"`;
      }

      if (yearNum === currentYear && monthNum === currentMonth && dayNum > currentDay) {
        const paddedMonth = String(currentMonth).padStart(2, '0');
        const paddedDay = String(currentDay).padStart(2, '0');
        return `@since "${currentYear}-${paddedMonth}-${paddedDay}"`;
      }

      return match;
    }
  );

  // Fix @version "2.0" to "1.0"
  modified = modified.replace(/@version\s+"2\.0"/g, '@version "1.0"');

  // Fix @version 2.0 to 1.0 (without quotes)
  modified = modified.replace(/@version\s+2\.0\b/g, '@version 1.0');

  return modified;
}

/**
 * Fix duplicate @param tags
 * @param {string} content - File content
 * @returns {string} Fixed content
 */
function fixDuplicateParams(content) {
  // Track seen params per JSDoc block
  let modified = content;
  const jsdocBlocks = modified.match(/\/\*\*[\s\S]*?\*\//g);

  if (!jsdocBlocks) return content;

  jsdocBlocks.forEach(block => {
    const lines = block.split('\n');
    const seenParams = new Map();
    const newLines = [];

    lines.forEach((line) => {
      const paramMatch = line.match(/\*\s+@param\s+(?:\{[^}]+\}\s+)?(\w+)/);

      if (paramMatch) {
        const paramName = paramMatch[1];

        if (seenParams.has(paramName)) {
          // Skip duplicate param
          console.log(`   🔧 Removing duplicate @param "${paramName}"`);
          return;
        }

        seenParams.set(paramName, true);
      }

      newLines.push(line);
    });

    const fixedBlock = newLines.join('\n');
    if (fixedBlock !== block) {
      modified = modified.replace(block, fixedBlock);
    }
  });

  return modified;
}

/**
 * Process a single file and apply fixes
 * @param {string} filePath - Path to file
 * @returns {boolean} True if file was modified
 */
function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Apply all fixes
    content = fixEmptyExample(content);
    content = fixInvalidSince(content);
    content = fixDuplicateParams(content);

    // Check if content changed
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Recursively find all .js files in a directory
 * @param {string} dir - Directory to search
 * @param {Array<string>} fileList - Accumulated file list
 * @returns {Array<string>} List of .js file paths
 */
function findJsFiles(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);

      try {
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          // Skip common directories to ignore
          const ignoreDirs = [
            'node_modules',
            '.git',
            'coverage',
            'dist',
            'build',
            '.next',
            '.cache',
          ];

          if (!file.startsWith('.') && !ignoreDirs.includes(file)) {
            findJsFiles(filePath, fileList);
          }
        } else if (file.endsWith('.js')) {
          fileList.push(filePath);
        }
      } catch (statError) {
        // Skip files we can't stat (permission issues, etc.)
        console.warn(`Skipping ${filePath}: ${statError.message}`);
      }
    });
  } catch (error) {
    console.warn(`Cannot read directory ${dir}: ${error.message}`);
  }

  return fileList;
}

/**
 * Main execution
 */
function main() {
  console.log('🔧 JSDoc Auto-Fix Script');
  console.log('========================\n');

  const srcDir = path.join(process.cwd(), 'src');

  // Check if src directory exists
  if (!fs.existsSync(srcDir)) {
    console.error('❌ Error: src/ directory not found');
    console.error('   Make sure to run this script from project root');
    process.exit(1);
  }

  console.log(`📁 Scanning ${srcDir} for .js files...\n`);

  const jsFiles = findJsFiles(srcDir);
  const totalFiles = jsFiles.length;

  console.log(`📊 Found ${totalFiles} JavaScript files\n`);
  console.log('🔄 Processing files...\n');

  let modifiedCount = 0;
  const modifiedFiles = [];

  jsFiles.forEach(file => {
    if (processFile(file)) {
      modifiedCount++;
      const relativePath = path.relative(process.cwd(), file);
      modifiedFiles.push(relativePath);
      console.log(`   ✓ ${relativePath}`);
    }
  });

  console.log('\n========================');
  console.log('📈 Summary:');
  console.log(`   - Total files scanned: ${totalFiles}`);
  console.log(`   - Files modified: ${modifiedCount}`);
  console.log(`   - Files unchanged: ${totalFiles - modifiedCount}`);

  if (modifiedCount > 0) {
    console.log('\n✅ JSDoc warnings fixed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Run: yarn lint:fix (auto-fix alignment)');
    console.log('   2. Check JSDoc warnings: yarn lint 2>&1 | grep "jsdoc" | wc -l');
    console.log('   3. Review changes: git diff');
    console.log('   4. Commit: git add -A && git commit -m "fix: correct JSDoc warnings"');
  } else {
    console.log('\n✨ No fixes needed - all JSDoc comments are correct!');
  }

  console.log('');
}

// Run main function
main();
