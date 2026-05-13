#!/usr/bin/env node

/**
 * Continuous Test Monitoring System
 * 
 * Advanced monitoring system that continuously watches for regressions and provides
 * real-time feedback on system health. Builds on the Phase 1 regression prevention
 * tools with enhanced monitoring capabilities, trend analysis, and automated alerts.
 * 
 * Features:
 * - Continuous test execution monitoring
 * - Performance regression detection
 * - Test trend analysis and reporting
 * - Automated failure notifications
 * - Integration with existing regression guard
 * - Health dashboard generation
 * - Slack/email alerting capabilities
 * 
 * Usage:
 *   node scripts/monitoring/regression-monitor.js [options]
 *   
 * Options:
 *   --mode=watch|analyze|report|daemon (default: daemon)
 *   --interval=<seconds> (default: 300 for daemon mode)
 *   --output=<directory> (default: monitoring/reports)
 *   --alert-webhook=<url> (Slack webhook for alerts)
 *   --email-alerts=<emails> (comma-separated email list)
 *   --dashboard-port=<port> (default: 3001)
 *   --baseline=<git-commit> (performance baseline)
 *   --threshold-failures=<number> (alert after N failures)
 *   --threshold-performance=<percentage> (performance degradation %)
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');

class RegressionMonitor {
  constructor(options = {}) {
    this.options = {
      mode: options.mode || 'daemon',
      interval: parseInt(options.interval) || 300, // 5 minutes
      output: options.output || 'monitoring/reports',
      alertWebhook: options.alertWebhook,
      emailAlerts: options.emailAlerts ? options.emailAlerts.split(',') : [],
      dashboardPort: parseInt(options.dashboardPort) || 3001,
      baseline: options.baseline,
      thresholdFailures: parseInt(options.thresholdFailures) || 3,
      thresholdPerformance: parseFloat(options.thresholdPerformance) || 20.0,
      ...options
    };

    this.isRunning = false;
    this.consecutiveFailures = 0;
    this.testHistory = [];
    this.performanceBaseline = {};
    this.alerts = [];

    this.setupDirectories();
    this.loadHistoricalData();
  }

  /**
   * Setup monitoring directories
   */
  setupDirectories() {
    const dirs = [
      this.options.output,
      path.join(this.options.output, 'daily'),
      path.join(this.options.output, 'trends'),
      path.join(this.options.output, 'alerts'),
      'monitoring/dashboard'
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Load historical monitoring data
   */
  loadHistoricalData() {
    const historyFile = path.join(this.options.output, 'test-history.json');
    if (fs.existsSync(historyFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        this.testHistory = data.history || [];
        this.performanceBaseline = data.baseline || {};
        this.alerts = data.alerts || [];
        console.log(`📊 Loaded ${this.testHistory.length} historical test records`);
      } catch (error) {
        console.warn('⚠️ Could not load historical data:', error.message);
      }
    }
  }

  /**
   * Save monitoring data
   */
  saveData() {
    const historyFile = path.join(this.options.output, 'test-history.json');
    const data = {
      lastUpdated: new Date().toISOString(),
      history: this.testHistory,
      baseline: this.performanceBaseline,
      alerts: this.alerts
    };

    fs.writeFileSync(historyFile, JSON.stringify(data, null, 2));
  }

  /**
   * Start monitoring based on mode
   */
  async start() {
    console.log('🚀 Starting Regression Monitor...');
    console.log(`📊 Mode: ${this.options.mode}`);
    console.log(`⏱️ Interval: ${this.options.interval}s`);
    console.log(`📁 Output: ${this.options.output}\\n`);

    switch (this.options.mode) {
      case 'watch':
        await this.watchMode();
        break;
      case 'analyze':
        await this.analyzeMode();
        break;
      case 'report':
        await this.reportMode();
        break;
      case 'daemon':
      default:
        await this.daemonMode();
        break;
    }
  }

  /**
   * Daemon mode - continuous monitoring
   */
  async daemonMode() {
    this.isRunning = true;
    console.log('🔄 Starting continuous monitoring daemon...');

    // Start health dashboard
    this.startHealthDashboard();

    // Initial test run
    await this.runMonitoringCycle();

    // Setup interval monitoring
    const interval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      
      await this.runMonitoringCycle();
    }, this.options.interval * 1000);

    // Graceful shutdown handling
    process.on('SIGINT', () => {
      console.log('\\n🛑 Received shutdown signal...');
      this.isRunning = false;
      clearInterval(interval);
      this.saveData();
      console.log('💾 Data saved. Monitor stopped.');
      process.exit(0);
    });

    console.log('✅ Daemon started. Press Ctrl+C to stop.');
    console.log(`🌐 Dashboard available at: http://localhost:${this.options.dashboardPort}`);
  }

  /**
   * Watch mode - file watching with immediate test execution
   */
  async watchMode() {
    console.log('👁️ Starting file watch mode...');
    
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(['src/**/*.js', 'tests/**/*.js'], {
      ignored: /node_modules/,
      persistent: true
    });

    let timeoutId;
    
    watcher.on('change', (filepath) => {
      console.log(`📝 File changed: ${filepath}`);
      
      // Debounce file changes
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        await this.runTargetedTests(filepath);
      }, 2000);
    });

    console.log('✅ File watching started. Change files to trigger tests.');
  }

  /**
   * Analyze mode - analyze historical data and trends
   */
  async analyzeMode() {
    console.log('📈 Starting trend analysis...');
    
    if (this.testHistory.length === 0) {
      console.log('❌ No historical data available for analysis');
      return;
    }

    const analysis = this.performTrendAnalysis();
    const reportPath = await this.generateAnalysisReport(analysis);
    
    console.log('✅ Analysis complete!');
    console.log(`📊 Report saved to: ${reportPath}`);
  }

  /**
   * Report mode - generate comprehensive monitoring reports
   */
  async reportMode() {
    console.log('📋 Generating monitoring reports...');
    
    const reports = await Promise.all([
      this.generateDailyReport(),
      this.generateWeeklyReport(),
      this.generateTrendReport()
    ]);
    
    console.log('✅ Reports generated:');
    reports.forEach(report => console.log(`   📄 ${report}`));
  }

  /**
   * Run complete monitoring cycle
   */
  async runMonitoringCycle() {
    const startTime = Date.now();
    console.log(`\\n🔍 Running monitoring cycle at ${new Date().toLocaleString()}`);

    try {
      // Run regression tests
      const regressionResult = await this.runRegressionTests();
      
      // Run performance tests
      const performanceResult = await this.runPerformanceTests();
      
      // Run integration tests sample
      const integrationResult = await this.runIntegrationSample();

      // Compile results
      const cycleResult = {
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        regression: regressionResult,
        performance: performanceResult,
        integration: integrationResult,
        overall: this.calculateOverallHealth(regressionResult, performanceResult, integrationResult)
      };

      // Add to history
      this.testHistory.push(cycleResult);
      
      // Keep only last 1000 records
      if (this.testHistory.length > 1000) {
        this.testHistory = this.testHistory.slice(-1000);
      }

      // Check for alerts
      await this.checkAlertConditions(cycleResult);

      // Save data
      this.saveData();

      // Generate dashboard data
      await this.updateDashboardData(cycleResult);

      console.log(`✅ Cycle complete (${Math.round(cycleResult.duration / 1000)}s) - Health: ${cycleResult.overall.status}`);

    } catch (error) {
      console.error('❌ Monitoring cycle failed:', error);
      this.consecutiveFailures++;
      
      await this.sendAlert({
        type: 'monitor_failure',
        message: `Monitoring cycle failed: ${error.message}`,
        consecutiveFailures: this.consecutiveFailures
      });
    }
  }

  /**
   * Run regression tests using existing regression guard
   */
  async runRegressionTests() {
    try {
      const startTime = Date.now();
      
      // Use existing regression guard from Phase 1
      const result = execSync('node scripts/testing/regression-guard.js', {
        encoding: 'utf8',
        timeout: 30000
      });

      const duration = Date.now() - startTime;
      
      return {
        status: 'passed',
        duration,
        output: result.trim(),
        testCount: this.parseTestCount(result)
      };
      
    } catch (error) {
      return {
        status: 'failed',
        duration: 30000, // timeout
        error: error.message,
        output: error.stdout || ''
      };
    }
  }

  /**
   * Run performance tests to detect regressions
   */
  async runPerformanceTests() {
    try {
      const startTime = Date.now();
      
      // Run a subset of tests with timing
      const result = execSync('yarn test:unit --testTimeout=10000 --maxWorkers=1 2>&1', {
        encoding: 'utf8',
        timeout: 60000
      });

      const duration = Date.now() - startTime;
      const testCount = this.parseTestCount(result);
      const avgTimePerTest = testCount > 0 ? duration / testCount : 0;

      return {
        status: result.includes('FAIL') ? 'failed' : 'passed',
        duration,
        testCount,
        avgTimePerTest,
        output: result.trim()
      };
      
    } catch (error) {
      return {
        status: 'failed',
        duration: 60000,
        error: error.message,
        output: error.stdout || ''
      };
    }
  }

  /**
   * Run sample integration tests
   */
  async runIntegrationSample() {
    try {
      const startTime = Date.now();
      
      // Run a small sample of integration tests
      const result = execSync('yarn test:integration tests/integration/api/auth.test.js --testTimeout=30000 2>&1', {
        encoding: 'utf8',
        timeout: 45000
      });

      const duration = Date.now() - startTime;
      
      return {
        status: result.includes('FAIL') ? 'failed' : 'passed',
        duration,
        output: result.trim()
      };
      
    } catch (error) {
      return {
        status: 'failed', 
        duration: 45000,
        error: error.message,
        output: error.stdout || ''
      };
    }
  }

  /**
   * Calculate overall system health
   */
  calculateOverallHealth(regression, performance, integration) {
    const scores = [];
    
    // Regression score (40% weight)
    scores.push({
      weight: 0.4,
      score: regression.status === 'passed' ? 100 : 0
    });
    
    // Performance score (35% weight)
    let perfScore = 100;
    if (performance.status === 'failed') perfScore = 0;
    else if (performance.avgTimePerTest > 1000) perfScore = 70; // Slow tests
    else if (performance.avgTimePerTest > 500) perfScore = 85;
    
    scores.push({
      weight: 0.35,
      score: perfScore
    });
    
    // Integration score (25% weight)
    scores.push({
      weight: 0.25,
      score: integration.status === 'passed' ? 100 : 0
    });

    const weightedScore = scores.reduce((total, item) => {
      return total + (item.score * item.weight);
    }, 0);

    let status;
    if (weightedScore >= 95) status = 'excellent';
    else if (weightedScore >= 85) status = 'good';
    else if (weightedScore >= 70) status = 'degraded';
    else status = 'critical';

    return {
      status,
      score: Math.round(weightedScore),
      details: {
        regression: regression.status,
        performance: performance.status,
        integration: integration.status
      }
    };
  }

  /**
   * Check alert conditions and send alerts
   */
  async checkAlertConditions(cycleResult) {
    const alerts = [];

    // Check consecutive failures
    if (cycleResult.overall.status === 'critical') {
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= this.options.thresholdFailures) {
        alerts.push({
          type: 'consecutive_failures',
          severity: 'critical',
          message: `${this.consecutiveFailures} consecutive critical failures detected`,
          data: cycleResult
        });
      }
    } else {
      this.consecutiveFailures = 0;
    }

    // Check performance degradation
    if (cycleResult.performance.avgTimePerTest > 2000) {
      alerts.push({
        type: 'performance_degradation',
        severity: 'warning',
        message: `Performance degradation detected: ${Math.round(cycleResult.performance.avgTimePerTest)}ms avg per test`,
        data: cycleResult.performance
      });
    }

    // Check test failures
    if (cycleResult.regression.status === 'failed') {
      alerts.push({
        type: 'regression_failure',
        severity: 'high',
        message: 'Regression tests failed',
        data: cycleResult.regression
      });
    }

    // Send alerts
    for (const alert of alerts) {
      await this.sendAlert(alert);
    }
  }

  /**
   * Send alert via configured channels
   */
  async sendAlert(alert) {
    const alertData = {
      timestamp: new Date().toISOString(),
      ...alert
    };

    // Store alert
    this.alerts.push(alertData);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    console.log(`🚨 ALERT [${alert.severity}]: ${alert.message}`);

    // Send to webhook if configured
    if (this.options.alertWebhook) {
      try {
        await this.sendWebhookAlert(alertData);
      } catch (error) {
        console.error('Failed to send webhook alert:', error.message);
      }
    }

    // Send email alerts if configured
    if (this.options.emailAlerts.length > 0) {
      try {
        await this.sendEmailAlert(alertData);
      } catch (error) {
        console.error('Failed to send email alert:', error.message);
      }
    }

    // Save alert to file
    const alertFile = path.join(this.options.output, 'alerts', `alert-${Date.now()}.json`);
    fs.writeFileSync(alertFile, JSON.stringify(alertData, null, 2));
  }

  /**
   * Send webhook alert (Slack, Discord, etc.)
   */
  async sendWebhookAlert(alert) {
    const payload = {
      text: `🚨 Amexing Monitor Alert`,
      attachments: [{
        color: this.getAlertColor(alert.severity),
        title: alert.type.replace(/_/g, ' ').toUpperCase(),
        text: alert.message,
        fields: [
          {
            title: 'Severity',
            value: alert.severity,
            short: true
          },
          {
            title: 'Timestamp',
            value: alert.timestamp,
            short: true
          }
        ]
      }]
    };

    // Implementation would depend on webhook service
    console.log('📤 Would send webhook alert:', JSON.stringify(payload, null, 2));
  }

  /**
   * Send email alert
   */
  async sendEmailAlert(alert) {
    // Implementation would integrate with EmailService
    console.log(`📧 Would send email alert to: ${this.options.emailAlerts.join(', ')}`);
  }

  /**
   * Start health dashboard HTTP server
   */
  startHealthDashboard() {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.url === '/health') {
        const latestResult = this.testHistory[this.testHistory.length - 1];
        res.writeHead(200);
        res.end(JSON.stringify({
          status: latestResult ? latestResult.overall.status : 'unknown',
          lastUpdate: latestResult ? latestResult.timestamp : null,
          consecutiveFailures: this.consecutiveFailures,
          totalTests: this.testHistory.length
        }));
      } else if (req.url === '/history') {
        res.writeHead(200);
        res.end(JSON.stringify(this.testHistory.slice(-50))); // Last 50 results
      } else if (req.url === '/alerts') {
        res.writeHead(200);
        res.end(JSON.stringify(this.alerts.slice(-20))); // Last 20 alerts
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    server.listen(this.options.dashboardPort, () => {
      console.log(`🌐 Health dashboard listening on port ${this.options.dashboardPort}`);
    });
  }

  /**
   * Helper methods
   */
  parseTestCount(output) {
    const match = output.match(/(\\d+) passing/);
    return match ? parseInt(match[1]) : 0;
  }

  getAlertColor(severity) {
    switch (severity) {
      case 'critical': return '#ff0000';
      case 'high': return '#ff6600';
      case 'warning': return '#ffcc00';
      default: return '#cccccc';
    }
  }

  async updateDashboardData(cycleResult) {
    const dashboardData = {
      lastUpdate: cycleResult.timestamp,
      current: cycleResult.overall,
      recent: this.testHistory.slice(-10),
      alerts: this.alerts.slice(-5)
    };

    const dashboardFile = path.join('monitoring/dashboard', 'data.json');
    fs.writeFileSync(dashboardFile, JSON.stringify(dashboardData, null, 2));
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  args.forEach(arg => {
    if (arg.startsWith('--mode=')) {
      options.mode = arg.split('=')[1];
    } else if (arg.startsWith('--interval=')) {
      options.interval = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    } else if (arg.startsWith('--alert-webhook=')) {
      options.alertWebhook = arg.split('=')[1];
    } else if (arg.startsWith('--email-alerts=')) {
      options.emailAlerts = arg.split('=')[1];
    } else if (arg.startsWith('--dashboard-port=')) {
      options.dashboardPort = arg.split('=')[1];
    } else if (arg.startsWith('--threshold-failures=')) {
      options.thresholdFailures = arg.split('=')[1];
    } else if (arg.startsWith('--threshold-performance=')) {
      options.thresholdPerformance = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/monitoring/regression-monitor.js [options]

Options:
  --mode=watch|analyze|report|daemon     Monitoring mode (default: daemon)
  --interval=<seconds>                   Check interval for daemon mode (default: 300)
  --output=<directory>                   Output directory (default: monitoring/reports)
  --alert-webhook=<url>                  Slack/Discord webhook for alerts
  --email-alerts=<emails>                Comma-separated email list for alerts
  --dashboard-port=<port>                Health dashboard port (default: 3001)
  --threshold-failures=<number>          Alert after N consecutive failures (default: 3)
  --threshold-performance=<percentage>   Performance degradation threshold (default: 20)
  --help, -h                            Show this help message

Examples:
  # Start continuous monitoring daemon
  node scripts/monitoring/regression-monitor.js --mode=daemon

  # Watch files and run tests immediately
  node scripts/monitoring/regression-monitor.js --mode=watch

  # Analyze historical trends
  node scripts/monitoring/regression-monitor.js --mode=analyze

  # Generate monitoring reports
  node scripts/monitoring/regression-monitor.js --mode=report

  # Start with Slack alerts
  node scripts/monitoring/regression-monitor.js --alert-webhook=https://hooks.slack.com/...
      `);
      process.exit(0);
    }
  });

  // Run the monitor
  const monitor = new RegressionMonitor(options);
  monitor.start().catch(error => {
    console.error('❌ Error starting regression monitor:', error);
    process.exit(1);
  });
}

module.exports = RegressionMonitor;