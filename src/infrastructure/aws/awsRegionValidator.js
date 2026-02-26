/**
 * AWS Region Validation Utility.
 *
 * Provides region validation to mitigate AWS SDK v2 security vulnerability:
 * "JavaScript SDK v2 users should add validation to the region parameter value".
 *
 * This utility ensures only valid AWS regions are used across the application,
 * preventing potential security issues with malicious or malformed region values.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * List of valid AWS regions as of 2025.
 * This list should be periodically updated to include new regions.
 * @type {string[]}
 */
const VALID_AWS_REGIONS = [
  // US regions
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',

  // Canada
  'ca-central-1',
  'ca-west-1',

  // Europe
  'eu-central-1',
  'eu-central-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',

  // Asia Pacific
  'ap-east-1',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',

  // Middle East
  'me-south-1',
  'me-central-1',

  // Africa
  'af-south-1',

  // South America
  'sa-east-1',

  // China (requires special AWS account)
  'cn-north-1',
  'cn-northwest-1',

  // AWS GovCloud (US)
  'us-gov-east-1',
  'us-gov-west-1',
];

/**
 * Validates if a given region string is a valid AWS region.
 * @param {string} region - The AWS region to validate.
 * @returns {boolean} True if the region is valid, false otherwise.
 * @example
 * // Valid region
 * const isValid = validateRegion('us-east-1'); // returns true
 *
 * // Invalid region
 * const isValid = validateRegion('invalid-region'); // returns false
 */
function validateRegion(region) {
  if (typeof region !== 'string' || region.length === 0) {
    return false;
  }

  // Normalize region string (trim whitespace, convert to lowercase)
  const normalizedRegion = region.trim().toLowerCase();

  return VALID_AWS_REGIONS.includes(normalizedRegion);
}

/**
 * Gets a validated AWS region, with fallback to default region.
 * @param {string} [region] - The preferred AWS region.
 * @param {string} [defaultRegion] - The default region to use if validation fails.
 * @returns {string} A valid AWS region.
 * @throws {Error} If both region and defaultRegion are invalid.
 * @example
 * // With valid region
 * const region = getValidatedRegion('us-west-2'); // returns 'us-west-2'
 *
 * // With invalid region, uses default
 * const region = getValidatedRegion('invalid-region'); // returns 'us-east-2'
 *
 * // From environment variable with validation
 * const region = getValidatedRegion(process.env.AWS_REGION);
 */
function getValidatedRegion(region, defaultRegion = 'us-east-2') {
  // First, try to validate the provided region
  if (region && validateRegion(region)) {
    return region.trim().toLowerCase();
  }

  // If provided region is invalid, try the default
  if (validateRegion(defaultRegion)) {
    return defaultRegion.trim().toLowerCase();
  }

  // If even the default is invalid, throw an error
  throw new Error(
    `Invalid AWS region configuration. Both provided region '${region}' and default region '${defaultRegion}' are invalid.`
  );
}

/**
 * Gets the AWS region from environment variables with validation.
 * This is the recommended way to get the AWS region in the application.
 * @returns {string} A validated AWS region from environment or default.
 * @example
 * // In your service
 * const region = getEnvironmentRegion();
 * AWS.config.update({ region });
 */
function getEnvironmentRegion() {
  return getValidatedRegion(process.env.AWS_REGION, 'us-east-2');
}

/**
 * Validates and normalizes an AWS region string for use in configuration.
 * This function provides additional security by ensuring the region string
 * cannot contain malicious characters or payloads.
 * @param {string} region - The region to validate and normalize.
 * @returns {{valid: boolean, region: string, error?: string}} Validation result.
 * @example
 * const result = validateAndNormalizeRegion('  US-EAST-1  ');
 * // returns { valid: true, region: 'us-east-1' }
 *
 * const result = validateAndNormalizeRegion('invalid<script>');
 * // returns { valid: false, region: null, error: 'Invalid region format' }
 */
function validateAndNormalizeRegion(region) {
  // Type validation
  if (typeof region !== 'string') {
    return {
      valid: false,
      region: null,
      error: 'Region must be a string',
    };
  }

  // Length validation
  if (region.length === 0 || region.length > 50) {
    return {
      valid: false,
      region: null,
      error: 'Region length must be between 1 and 50 characters',
    };
  }

  // Format validation (AWS regions only contain lowercase letters, numbers, and hyphens)
  const regionPattern = /^[a-zA-Z0-9-]+$/;
  if (!regionPattern.test(region)) {
    return {
      valid: false,
      region: null,
      error: 'Invalid region format. Only letters, numbers, and hyphens allowed.',
    };
  }

  // Normalize and validate against known regions
  const normalizedRegion = region.trim().toLowerCase();
  if (!VALID_AWS_REGIONS.includes(normalizedRegion)) {
    return {
      valid: false,
      region: null,
      error: `Unknown AWS region: ${normalizedRegion}`,
    };
  }

  return {
    valid: true,
    region: normalizedRegion,
  };
}

module.exports = {
  validateRegion,
  getValidatedRegion,
  getEnvironmentRegion,
  validateAndNormalizeRegion,
  VALID_AWS_REGIONS,
};
