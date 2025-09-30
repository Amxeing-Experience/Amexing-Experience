#!/usr/bin/env node
/**
 * Component Completeness Check
 * Validates that all EJS components have corresponding test files
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const minimatch = require('minimatch');

// Configuration
const VIEWS_PATH = path.join(__dirname, '../../src/presentation/views');
const TESTS_PATH = path.join(__dirname, '../../tests/unit/components');
const EXCLUDED_PATTERNS = [
  '**/assets/**',
  '**/atomic/**',
  '**/dashboards/**',
  '**/errors/**',
  '**/landing/**',
  '**/auth/*.ejs', // These are pages, not components
  '**/templates/**'
];

/**
 * Get all EJS component files
 */
function getComponentFiles() {
  const patterns = [
    'atoms/**/*.ejs',
    'molecules/**/*.ejs',
    'organisms/**/*.ejs'
  ];

  const files = [];

  patterns.forEach(pattern => {
    const fullPattern = path.join(VIEWS_PATH, pattern);
    const matchedFiles = glob.sync(fullPattern);

    matchedFiles.forEach(file => {
      const relativePath = path.relative(VIEWS_PATH, file);

      // Skip excluded patterns
      const shouldExclude = EXCLUDED_PATTERNS.some(excludePattern => {
        return minimatch(relativePath, excludePattern);
      });

      if (!shouldExclude) {
        files.push({
          fullPath: file,
          relativePath: relativePath,
          testPath: getExpectedTestPath(relativePath)
        });
      }
    });
  });

  return files;
}

/**
 * Get expected test path for a component
 */
function getExpectedTestPath(componentPath) {
  const testPath = componentPath.replace('.ejs', '.test.js');
  return path.join(TESTS_PATH, testPath);
}

/**
 * Check if test file exists for component
 */
function checkTestExists(testPath) {
  return fs.existsSync(testPath);
}

/**
 * Analyze component test coverage
 */
function analyzeTestCoverage() {
  const components = getComponentFiles();
  const stats = {
    total: components.length,
    withTests: 0,
    withoutTests: 0,
    byCategory: {
      atoms: { total: 0, withTests: 0, withoutTests: 0 },
      molecules: { total: 0, withTests: 0, withoutTests: 0 },
      organisms: { total: 0, withTests: 0, withoutTests: 0 }
    }
  };

  const missingTests = [];
  const existingTests = [];

  components.forEach(component => {
    const hasTest = checkTestExists(component.testPath);
    const category = component.relativePath.split('/')[0]; // atoms, molecules, organisms

    stats.byCategory[category].total++;

    if (hasTest) {
      stats.withTests++;
      stats.byCategory[category].withTests++;
      existingTests.push(component);
    } else {
      stats.withoutTests++;
      stats.byCategory[category].withoutTests++;
      missingTests.push(component);
    }
  });

  return {
    stats,
    missingTests,
    existingTests,
    components
  };
}

/**
 * Generate detailed report
 */
function generateReport(analysis) {
  const { stats, missingTests, existingTests } = analysis;

  console.log('\n🧪 Component Test Coverage Report');
  console.log('='.repeat(50));

  // Overall stats
  const overallCoverage = stats.total > 0 ?
    ((stats.withTests / stats.total) * 100).toFixed(1) : 0;

  console.log(`\n📊 Overall Coverage: ${stats.withTests}/${stats.total} (${overallCoverage}%)`);
  console.log(`   ✅ With Tests: ${stats.withTests}`);
  console.log(`   ❌ Missing Tests: ${stats.withoutTests}`);

  // By category
  console.log('\n📂 By Category:');
  Object.entries(stats.byCategory).forEach(([category, categoryStats]) => {
    const coverage = categoryStats.total > 0 ?
      ((categoryStats.withTests / categoryStats.total) * 100).toFixed(1) : 0;

    console.log(`   ${category.toUpperCase()}: ${categoryStats.withTests}/${categoryStats.total} (${coverage}%)`);
  });

  // Missing tests
  if (missingTests.length > 0) {
    console.log('\n❌ Components Missing Tests:');
    missingTests.forEach(component => {
      console.log(`   - ${component.relativePath}`);
      console.log(`     Expected test: ${path.relative(process.cwd(), component.testPath)}`);
    });
  }

  // Existing tests
  if (existingTests.length > 0) {
    console.log('\n✅ Components with Tests:');
    existingTests.forEach(component => {
      console.log(`   - ${component.relativePath}`);
    });
  }

  return analysis;
}

/**
 * Generate test template for missing components
 */
function generateTestTemplate(componentPath) {
  const relativePath = path.relative(VIEWS_PATH, componentPath);
  const componentName = path.basename(componentPath, '.ejs');
  const category = relativePath.split('/')[0];
  const subcategory = relativePath.split('/')[1];

  const template = `/**
 * ${componentName} ${category.charAt(0).toUpperCase() + category.slice(0, -1)} Component Tests
 * Tests for the ${componentName} component
 */

const { renderComponent, parseHTML, extractClasses, extractAttributes } = require('../../../helpers/ejsTestUtils');

describe('${componentName.charAt(0).toUpperCase() + componentName.slice(1)} ${category.charAt(0).toUpperCase() + category.slice(0, -1)} Component', () => {
  const componentPath = '${relativePath.replace('.ejs', '')}';

  describe('Basic Rendering', () => {
    test('should render with default parameters', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeTruthy();
      // Add specific assertions for this component
    });

    test('should render correct HTML structure', async () => {
      const html = await renderComponent(componentPath);
      const $ = parseHTML(html);
      // Add specific structure tests
    });
  });

  describe('Parameters', () => {
    // Add parameter-specific tests based on component documentation
    test('should handle required parameters', async () => {
      // Add tests for required parameters
    });

    test('should handle optional parameters', async () => {
      // Add tests for optional parameters
    });
  });

  describe('Accessibility', () => {
    test('should be accessible', async () => {
      const html = await renderComponent(componentPath);
      expect(html).toBeAccessible();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid parameters gracefully', async () => {
      const html = await renderComponent(componentPath, {
        // Add invalid parameter tests
      });
      expect(html).toBeTruthy();
    });
  });
});
`;

  return template;
}

/**
 * Create missing test files
 */
function createMissingTests(missingTests, options = {}) {
  if (!options.create) {
    console.log('\n💡 To create missing test files, run with --create flag');
    return;
  }

  console.log('\n🚧 Creating missing test files...');

  let created = 0;
  let failed = 0;

  missingTests.forEach(component => {
    try {
      const testDir = path.dirname(component.testPath);

      // Create directories if they don't exist
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      // Generate and write test template
      const template = generateTestTemplate(component.fullPath);
      fs.writeFileSync(component.testPath, template);

      console.log(`   ✅ Created: ${path.relative(process.cwd(), component.testPath)}`);
      created++;
    } catch (error) {
      console.log(`   ❌ Failed: ${component.relativePath} - ${error.message}`);
      failed++;
    }
  });

  console.log(`\n📄 Test Creation Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Failed: ${failed}`);
}

/**
 * Save report to file
 */
function saveReportToFile(analysis) {
  const reportData = {
    timestamp: new Date().toISOString(),
    ...analysis.stats,
    missingTests: analysis.missingTests.map(c => c.relativePath),
    existingTests: analysis.existingTests.map(c => c.relativePath)
  };

  const reportPath = path.join(process.cwd(), 'coverage', 'component-completeness-report.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}`);
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const options = {
    create: args.includes('--create'),
    save: args.includes('--save') || true, // Default to saving
    verbose: args.includes('--verbose')
  };

  try {
    console.log('🔍 Analyzing component test coverage...');

    const analysis = analyzeTestCoverage();
    generateReport(analysis);

    if (analysis.missingTests.length > 0) {
      createMissingTests(analysis.missingTests, options);
    }

    if (options.save) {
      saveReportToFile(analysis);
    }

    // Exit with error code if tests are missing
    const exitCode = analysis.missingTests.length > 0 ? 1 : 0;
    process.exit(exitCode);

  } catch (error) {
    console.error('❌ Error analyzing components:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  analyzeTestCoverage,
  generateReport,
  createMissingTests,
  getComponentFiles
};