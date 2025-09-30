/**
 * Component Test Results Processor
 * Processes test results to generate component-specific reports
 */

const fs = require('fs');
const path = require('path');

module.exports = (testResults) => {
  // Create component-specific statistics
  const componentStats = {
    atoms: { total: 0, passed: 0, failed: 0 },
    molecules: { total: 0, passed: 0, failed: 0 },
    organisms: { total: 0, passed: 0, failed: 0 }
  };

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  // Process test results
  testResults.testResults.forEach(testFile => {
    const filePath = testFile.testFilePath;

    // Determine component type from path
    let componentType = 'unknown';
    if (filePath.includes('/atoms/')) componentType = 'atoms';
    else if (filePath.includes('/molecules/')) componentType = 'molecules';
    else if (filePath.includes('/organisms/')) componentType = 'organisms';

    if (componentType !== 'unknown') {
      componentStats[componentType].total++;

      if (testFile.numFailingTests === 0) {
        componentStats[componentType].passed++;
        passedTests++;
      } else {
        componentStats[componentType].failed++;
        failedTests++;
      }
      totalTests++;
    }
  });

  // Generate summary report
  const summary = {
    timestamp: new Date().toISOString(),
    totalFiles: testResults.numTotalTestSuites,
    totalTests: totalTests,
    passedTests: passedTests,
    failedTests: failedTests,
    successRate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) : 0,
    componentStats: componentStats,
    duration: testResults.testResults.reduce((acc, test) => acc + (test.perfStats?.end - test.perfStats?.start || 0), 0)
  };

  // Write summary to file
  const reportPath = path.join(process.cwd(), 'coverage', 'components', 'component-summary.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log('\n🧪 Component Test Summary:');
  console.log(`   Total Components Tested: ${totalTests}`);
  console.log(`   ✅ Passed: ${passedTests} (${summary.successRate}%)`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log('\n📊 By Component Type:');
  Object.entries(componentStats).forEach(([type, stats]) => {
    const rate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : 0;
    console.log(`   ${type.toUpperCase()}: ${stats.passed}/${stats.total} (${rate}%)`);
  });
  console.log(`\n📄 Detailed report: ${reportPath}`);

  return testResults;
};