/**
 * Jest Test Sequencer
 * Controls the order of test execution to minimize port conflicts and setup/teardown issues
 */

const Sequencer = require('@jest/test-sequencer').default;

class CustomTestSequencer extends Sequencer {
  sort(tests) {
    // Sort tests by priority to minimize conflicts
    const testOrder = [
      // Unit tests first (no external dependencies)
      /unit.*test\.js$/,
      /components.*test\.js$/,
      /helpers.*test\.js$/,
      /models.*test\.js$/,
      /services.*test\.js$/,
      /middleware.*test\.js$/,

      // Integration tests
      /integration.*test\.js$/,
      /parse-platform.*test\.js$/,

      // API tests
      /api.*test\.js$/,

      // Application startup tests last (they start the full server)
      /application\.startup.*test\.js$/,
    ];

    return tests.sort((testA, testB) => {
      const pathA = testA.path;
      const pathB = testB.path;

      // Find the priority index for each test
      const priorityA = testOrder.findIndex(pattern => pattern.test(pathA));
      const priorityB = testOrder.findIndex(pattern => pattern.test(pathB));

      // If both tests match patterns, use their priority order
      if (priorityA >= 0 && priorityB >= 0) {
        return priorityA - priorityB;
      }

      // If only one test matches a pattern, prioritize it
      if (priorityA >= 0) return -1;
      if (priorityB >= 0) return 1;

      // If neither matches, maintain alphabetical order
      return pathA.localeCompare(pathB);
    });
  }
}

module.exports = CustomTestSequencer;