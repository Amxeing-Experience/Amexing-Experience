/**
 * Custom test result processor for Parse Cloud Functions testing
 * Generates detailed reports and performance metrics
 */

const fs = require('fs');
const path = require('path');

module.exports = (testResults) => {
  const {
    numTotalTests,
    numPassedTests,
    numFailedTests,
    numPendingTests,
    testResults: suiteResults,
    startTime,
    success
  } = testResults;

  const reportDir = path.join(process.cwd(), 'test-results', 'cloud-functions');

  // Ensure report directory exists
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Generate summary report
  const summary = {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    totalTests: numTotalTests,
    passedTests: numPassedTests,
    failedTests: numFailedTests,
    pendingTests: numPendingTests,
    success: success,
    testSuites: {}
  };

  // Process each test suite
  suiteResults.forEach(suite => {
    const suiteName = path.basename(suite.testFilePath, '.test.js');

    summary.testSuites[suiteName] = {
      filePath: suite.testFilePath,
      numTests: suite.numPassingTests + suite.numFailingTests + suite.numPendingTests,
      passed: suite.numPassingTests,
      failed: suite.numFailingTests,
      pending: suite.numPendingTests,
      duration: suite.perfStats?.end - suite.perfStats?.start || 0,
      tests: {}
    };

    // Process individual tests
    suite.testResults.forEach(test => {
      const testKey = test.fullName.replace(/[^a-zA-Z0-9]/g, '_');

      summary.testSuites[suiteName].tests[testKey] = {
        title: test.title,
        fullName: test.fullName,
        status: test.status,
        duration: test.duration || 0,
        errors: test.failureMessages || [],
        ancestorTitles: test.ancestorTitles || []
      };

      // Extract performance metrics from test output
      if (test.status === 'passed') {
        const performanceData = extractPerformanceMetrics(test);
        if (performanceData) {
          summary.testSuites[suiteName].tests[testKey].performance = performanceData;
        }
      }
    });
  });

  // Write summary report
  const summaryPath = path.join(reportDir, 'cloud-functions-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Generate detailed HTML report
  generateHtmlReport(summary, reportDir);

  // Generate performance report
  generatePerformanceReport(summary, reportDir);

  // Generate failure analysis
  if (numFailedTests > 0) {
    generateFailureAnalysis(summary, reportDir);
  }

  // Console output summary
  console.log('\n📊 Parse Cloud Functions Test Results Summary:');
  console.log(`   Total Tests: ${numTotalTests}`);
  console.log(`   ✅ Passed: ${numPassedTests}`);
  console.log(`   ❌ Failed: ${numFailedTests}`);
  console.log(`   ⏸️  Pending: ${numPendingTests}`);
  console.log(`   ⏱️  Duration: ${summary.duration}ms`);
  console.log(`   📁 Reports: ${reportDir}`);

  // Performance insights
  const performanceInsights = analyzePerformance(summary);
  if (performanceInsights.length > 0) {
    console.log('\n⚡ Performance Insights:');
    performanceInsights.forEach(insight => {
      console.log(`   ${insight}`);
    });
  }

  return testResults;
};

function extractPerformanceMetrics(test) {
  // Try to extract performance metrics from test messages or console output
  // This is a simplified implementation
  const performancePattern = /duration[:\s]+(\d+(?:\.\d+)?)ms/i;
  const memoryPattern = /memory[:\s]+(\d+)/i;

  let duration = null;
  let memory = null;

  // Check test failure messages or console output for performance data
  if (test.failureMessages) {
    test.failureMessages.forEach(message => {
      const durationMatch = message.match(performancePattern);
      const memoryMatch = message.match(memoryPattern);

      if (durationMatch) duration = parseFloat(durationMatch[1]);
      if (memoryMatch) memory = parseInt(memoryMatch[1]);
    });
  }

  if (duration !== null || memory !== null) {
    return {
      duration,
      memory,
      timestamp: new Date().toISOString()
    };
  }

  return null;
}

function generateHtmlReport(summary, reportDir) {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parse Cloud Functions Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric .value { font-size: 2em; font-weight: bold; }
        .passed { color: #28a745; }
        .failed { color: #dc3545; }
        .pending { color: #ffc107; }
        .suite { margin-bottom: 30px; border: 1px solid #dee2e6; border-radius: 6px; }
        .suite-header { background: #e9ecef; padding: 15px; font-weight: bold; }
        .test { padding: 10px 15px; border-bottom: 1px solid #dee2e6; }
        .test:last-child { border-bottom: none; }
        .test-status { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; }
        .status-passed { background-color: #28a745; }
        .status-failed { background-color: #dc3545; }
        .status-pending { background-color: #ffc107; }
        .error-details { background: #f8d7da; padding: 10px; margin-top: 10px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
        .performance { background: #d1ecf1; padding: 8px; margin-top: 8px; border-radius: 4px; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Parse Cloud Functions Test Report</h1>
            <p>Generated on ${new Date(summary.timestamp).toLocaleString()}</p>
            <p>Total Duration: ${summary.duration}ms</p>
        </div>

        <div class="metrics">
            <div class="metric">
                <h3>Total Tests</h3>
                <div class="value">${summary.totalTests}</div>
            </div>
            <div class="metric">
                <h3>Passed</h3>
                <div class="value passed">${summary.passedTests}</div>
            </div>
            <div class="metric">
                <h3>Failed</h3>
                <div class="value failed">${summary.failedTests}</div>
            </div>
            <div class="metric">
                <h3>Pending</h3>
                <div class="value pending">${summary.pendingTests}</div>
            </div>
            <div class="metric">
                <h3>Success Rate</h3>
                <div class="value">${((summary.passedTests / summary.totalTests) * 100).toFixed(1)}%</div>
            </div>
        </div>

        ${Object.entries(summary.testSuites).map(([suiteName, suite]) => `
            <div class="suite">
                <div class="suite-header">
                    ${suiteName} (${suite.passed}/${suite.numTests} passed, ${suite.duration}ms)
                </div>
                ${Object.entries(suite.tests).map(([testKey, test]) => `
                    <div class="test">
                        <span class="test-status status-${test.status}"></span>
                        <strong>${test.title}</strong>
                        <span style="float: right; color: #666;">${test.duration}ms</span>
                        ${test.performance ? `
                            <div class="performance">
                                Performance: ${test.performance.duration}ms
                                ${test.performance.memory ? `, Memory: ${test.performance.memory} bytes` : ''}
                            </div>
                        ` : ''}
                        ${test.errors.length > 0 ? `
                            <div class="error-details">
                                ${test.errors.map(error => `<div>${error}</div>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('')}
    </div>
</body>
</html>`;

  const htmlPath = path.join(reportDir, 'cloud-functions-report.html');
  fs.writeFileSync(htmlPath, htmlContent);
}

function generatePerformanceReport(summary, reportDir) {
  const performanceData = {
    timestamp: summary.timestamp,
    totalDuration: summary.duration,
    suitePerformance: {},
    slowestTests: [],
    performanceThresholds: {
      basicFunctions: 5000, // 5 seconds
      complexFunctions: 10000, // 10 seconds
      integrationTests: 15000 // 15 seconds
    }
  };

  // Collect performance data
  Object.entries(summary.testSuites).forEach(([suiteName, suite]) => {
    performanceData.suitePerformance[suiteName] = {
      totalDuration: suite.duration,
      averageTestDuration: suite.duration / suite.numTests,
      testCount: suite.numTests
    };

    Object.entries(suite.tests).forEach(([testKey, test]) => {
      if (test.duration > 1000) { // Only include tests longer than 1 second
        performanceData.slowestTests.push({
          suite: suiteName,
          test: test.title,
          duration: test.duration
        });
      }
    });
  });

  // Sort slowest tests
  performanceData.slowestTests.sort((a, b) => b.duration - a.duration);
  performanceData.slowestTests = performanceData.slowestTests.slice(0, 10); // Top 10

  const performancePath = path.join(reportDir, 'performance-report.json');
  fs.writeFileSync(performancePath, JSON.stringify(performanceData, null, 2));
}

function generateFailureAnalysis(summary, reportDir) {
  const failureAnalysis = {
    timestamp: summary.timestamp,
    totalFailures: summary.failedTests,
    failuresByCategory: {},
    commonErrors: {},
    recommendations: []
  };

  // Analyze failures
  Object.entries(summary.testSuites).forEach(([suiteName, suite]) => {
    const failedTests = Object.values(suite.tests).filter(test => test.status === 'failed');

    if (failedTests.length > 0) {
      failureAnalysis.failuresByCategory[suiteName] = {
        count: failedTests.length,
        tests: failedTests.map(test => ({
          title: test.title,
          errors: test.errors
        }))
      };

      // Count common error patterns
      failedTests.forEach(test => {
        test.errors.forEach(error => {
          const errorKey = error.split('\n')[0]; // First line of error
          failureAnalysis.commonErrors[errorKey] = (failureAnalysis.commonErrors[errorKey] || 0) + 1;
        });
      });
    }
  });

  // Generate recommendations based on error patterns
  Object.entries(failureAnalysis.commonErrors).forEach(([error, count]) => {
    if (error.includes('timeout') || error.includes('TIMEOUT')) {
      failureAnalysis.recommendations.push('Consider increasing timeout values for cloud function calls');
    }
    if (error.includes('INVALID_SESSION_TOKEN') || error.includes('Authentication required')) {
      failureAnalysis.recommendations.push('Check authentication setup and session management');
    }
    if (error.includes('not found') || error.includes('Invalid function')) {
      failureAnalysis.recommendations.push('Verify cloud function registration and deployment');
    }
    if (error.includes('Connection') || error.includes('Network')) {
      failureAnalysis.recommendations.push('Check Parse Server connectivity and network configuration');
    }
  });

  const failurePath = path.join(reportDir, 'failure-analysis.json');
  fs.writeFileSync(failurePath, JSON.stringify(failureAnalysis, null, 2));
}

function analyzePerformance(summary) {
  const insights = [];
  const totalDuration = summary.duration;

  if (totalDuration > 300000) { // 5 minutes
    insights.push('⚠️  Test suite took longer than 5 minutes to complete');
  }

  const slowSuites = Object.entries(summary.testSuites)
    .filter(([_, suite]) => suite.duration > 60000) // 1 minute
    .map(([name, _]) => name);

  if (slowSuites.length > 0) {
    insights.push(`🐌 Slow test suites: ${slowSuites.join(', ')}`);
  }

  const highFailureRate = summary.failedTests / summary.totalTests > 0.2; // 20%
  if (highFailureRate) {
    insights.push('❌ High failure rate detected - check service dependencies');
  }

  return insights;
}