/**
 * Debug Controller for tracking frontend issues
 * Handles debugging endpoints for troubleshooting client-side problems.
 */

const logger = require('../../../infrastructure/logger');

/**
 * Debug Controller for handling client-side debugging data and logging.
 * Provides endpoints for receiving and processing debug information from frontend components.
 * @class DebugController
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage in routes
 * router.post('/debug/load-vehicle-images', DebugController.logLoadVehicleImagesCall);
 */
class DebugController {
  /**
   * Log client-side debugging data for loadVehicleImages calls.
   * @param req
   * @param res
   * @example
   */
  static async logLoadVehicleImagesCall(req, res) {
    try {
      const debugData = req.body;

      // Log the debug data with structured format
      logger.info('=== CLIENT DEBUG: loadVehicleImages call tracked ===', {
        receivedVehicleId: debugData.receivedVehicleId,
        globalCurrentVehicleId: debugData.globalCurrentVehicleId,
        timestamp: debugData.timestamp,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
        ip: req.ip,
        sessionId: req.sessionID,
      });

      // Log call stack for analysis
      if (debugData.callStack) {
        logger.info('=== CLIENT DEBUG: Call stack ===', {
          callStack: debugData.callStack,
        });
      }

      // Check for patterns
      if (!debugData.receivedVehicleId || debugData.receivedVehicleId === 'null') {
        logger.warn('=== CLIENT DEBUG: NULL VEHICLE ID DETECTED ===', {
          problem: 'Null vehicleId in loadVehicleImages call',
          debugData,
        });
      }

      res.json({
        success: true,
        message: 'Debug data logged successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error in debug endpoint:', error);
      res.status(500).json({
        success: false,
        error: 'Debug logging failed',
      });
    }
  }
}

module.exports = DebugController;
