/**
 * EJS Transformer for Jest
 * Transforms EJS files for testing purposes
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  process(sourceText, sourcePath, options) {
    // For EJS files, we'll return a module that exports the template content
    // and metadata for testing purposes
    const templateContent = sourceText;
    const componentName = path.basename(sourcePath, '.ejs');

    const transformedCode = `
      module.exports = {
        templateContent: ${JSON.stringify(templateContent)},
        componentName: ${JSON.stringify(componentName)},
        filePath: ${JSON.stringify(sourcePath)},
        // Method to render with parameters (for testing)
        render: function(params) {
          const ejs = require('ejs');
          return ejs.render(this.templateContent, params || {});
        }
      };
    `;

    // Jest 28+ requires returning an object with 'code' property
    return {
      code: transformedCode
    };
  },

  getCacheKey(fileData, filePath, configStr, options) {
    return filePath + configStr + fileData;
  }
};