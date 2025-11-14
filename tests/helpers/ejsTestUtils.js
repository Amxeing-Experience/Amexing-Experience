/**
 * EJS Component Testing Utilities
 * Helper functions for testing EJS atomic design components
 */

const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

// Simple HTML parsing without external dependencies
const cheerio = {
  load: (html) => {
    const $ = (selector) => {
      // Very basic DOM simulation for testing without external deps
      return {
        length: html.includes(selector.replace('.', '').replace('[', '').replace(']', '')) ? 1 : 0,
        each: () => {},
        attr: () => undefined,
        text: () => '',
        html: () => '',
        hasClass: () => false
      };
    };
    return $;
  }
};

/**
 * Base path for component views
 */
const VIEWS_BASE_PATH = path.join(__dirname, '../../src/presentation/views');

/**
 * Render an EJS component with given parameters
 * @param {string} componentPath - Path relative to views directory (e.g., 'atoms/common/button')
 * @param {object} params - Parameters to pass to the component
 * @param {object} options - Additional EJS options
 * @returns {Promise<string>} Rendered HTML
 */
const renderComponent = async (componentPath, params = {}, options = {}) => {
  const fullPath = path.join(VIEWS_BASE_PATH, `${componentPath}.ejs`);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Component not found at: ${fullPath}`);
  }

  const defaultOptions = {
    views: [VIEWS_BASE_PATH],
    root: VIEWS_BASE_PATH,
    rmWhitespace: true,
    ...options
  };

  try {
    const html = await ejs.renderFile(fullPath, params, defaultOptions);
    return html.trim();
  } catch (error) {
    throw new Error(`Failed to render component ${componentPath}: ${error.message}`);
  }
};

/**
 * Parse rendered HTML for testing (with or without cheerio)
 * @param {string} html - HTML string to parse
 * @returns {Function} jQuery-like function for DOM manipulation
 */
const parseHTML = (html) => {
  // Check if we have actual cheerio (not the mock)
  if (cheerio.load && typeof cheerio.load === 'function' && cheerio.version) {
    return cheerio.load(html);
  } else {
    // Use our improved simple HTML parser
    return createSimpleHtmlParser(html);
  }
};

/**
 * Create a simple HTML parser fallback when cheerio is not available
 */
function createSimpleHtmlParser(html) {
  return function $(selector) {
    const elements = [];

    if (selector === ':first') {
      // Find first element
      const match = html.match(/<(\w+)([^>]*)>/);
      if (match) {
        const tagName = match[1];
        const attributes = match[2];
        const attribs = {};

        // Parse attributes (include hyphens for data-* attributes)
        const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*)["'])?/g);
        for (const attrMatch of attrMatches) {
          attribs[attrMatch[1]] = attrMatch[2] || '';
        }

        elements.push({
          tagName: tagName,
          attribs: attribs
        });
      }
    } else if (selector.includes('.') && !selector.startsWith('.')) {
      // Combined tag+class selector (e.g., button.country-selector)
      const parts = selector.split('.');
      const tagName = parts[0];
      const className = parts[1];

      const regex = new RegExp(`<(${tagName})([^>]*?)>`, 'gi');
      const matches = html.matchAll(regex);

      for (const match of matches) {
        const fullMatch = match[0];
        const foundTagName = match[1];
        const attributes = match[2];
        const attribs = {};

        // Parse all attributes
        if (attributes) {
          const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*?)["'])?/g);
          for (const attrMatch of attrMatches) {
            attribs[attrMatch[1]] = attrMatch[2] || '';
          }
        }

        // Check if element has the required class
        const classAttr = attribs.class || '';
        const classes = classAttr.split(/\s+/);
        if (!classes.includes(className)) {
          continue;
        }

        // Get text content
        let textContent = '';
        const startPos = html.indexOf(fullMatch) + fullMatch.length;
        const endTag = `</${foundTagName}>`;
        const endPos = html.indexOf(endTag, startPos);

        if (endPos !== -1) {
          textContent = html.substring(startPos, endPos).trim();
          textContent = textContent.replace(/<[^>]*>/g, '').trim();
          textContent = textContent
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, '/');
        }

        elements.push({
          tagName: foundTagName,
          attribs: attribs,
          textContent: textContent
        });
      }
    } else if (selector.startsWith('.')) {
      // CSS class selector (e.g., .user-info-section or .dropdown-menu.country-dropdown)
      const classNames = selector.substring(1).split('.'); // Remove first dot and split by dots
      const regex = new RegExp(`<([^>]+)\\s+class=["']([^"']*)["'][^>]*>`, 'gi');
      const matches = html.matchAll(regex);

      for (const match of matches) {
        const fullMatch = match[0];
        const tagWithAttribs = match[1];
        const classAttr = match[2];
        const classes = classAttr.split(/\s+/);

        // Check if element has ALL required classes
        const hasAllClasses = classNames.every(className => classes.includes(className));

        if (hasAllClasses) {
          // Extract tag name and all attributes
          const tagMatch = fullMatch.match(/<(\w+)([^>]*?)>/);
          if (tagMatch) {
            const tagName = tagMatch[1];
            const attributes = tagMatch[2];
            const attribs = {};

            if (attributes) {
              const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*?)["'])?/g);
              for (const attrMatch of attrMatches) {
                attribs[attrMatch[1]] = attrMatch[2] || '';
              }
            }

            // Get text content
            let textContent = '';
            const startPos = html.indexOf(fullMatch) + fullMatch.length;
            const endTag = `</${tagName}>`;
            const endPos = html.indexOf(endTag, startPos);

            if (endPos !== -1) {
              textContent = html.substring(startPos, endPos).trim();
              textContent = textContent.replace(/<[^>]*>/g, '').trim();
              textContent = textContent
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#x2F;/g, '/');
            }

            elements.push({
              tagName: tagName,
              attribs: attribs,
              textContent: textContent
            });
          }
        }
      }
    } else if (selector.includes('[') && selector.includes(']')) {
      // Combined selector (e.g., input[type="tel"])
      const selectorParts = selector.match(/^(\w+)?\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/);

      if (selectorParts) {
        const tagName = selectorParts[1] || '\\w+';
        const attrName = selectorParts[2];
        const attrValue = selectorParts[3];

        const regex = new RegExp(`<(${tagName})([^>]*?)>`, 'gi');
        const matches = html.matchAll(regex);

        for (const match of matches) {
          const fullMatch = match[0];
          const foundTagName = match[1];
          const attributes = match[2];
          const attribs = {};

          // Parse all attributes
          if (attributes) {
            const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*?)["'])?/g);
            for (const attrMatch of attrMatches) {
              attribs[attrMatch[1]] = attrMatch[2] || '';
            }
          }

          // Check if the attribute matches
          if (attrName) {
            const foundAttrValue = attribs[attrName];

            if (attrValue) {
              // Check for specific value
              if (foundAttrValue !== attrValue) {
                continue;
              }
            } else {
              // Just check attribute exists
              if (!foundAttrValue && foundAttrValue !== '') {
                continue;
              }
            }
          }

          // Get text content
          let textContent = '';
          const startPos = html.indexOf(fullMatch) + fullMatch.length;
          const endTag = `</${foundTagName}>`;
          const endPos = html.indexOf(endTag, startPos);

          if (endPos !== -1) {
            textContent = html.substring(startPos, endPos).trim();
            textContent = textContent.replace(/<[^>]*>/g, '').trim();
            textContent = textContent
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#x27;/g, "'")
              .replace(/&#x2F;/g, '/');
          }

          elements.push({
            tagName: foundTagName,
            attribs: attribs,
            textContent: textContent
          });
        }
      }
    } else if (selector.startsWith('[') && selector.endsWith(']')) {
      // Attribute-only selector (e.g., [data-bs-toggle="dropdown"])
      const attrMatch = selector.match(/\[([^=\]]+)(?:=["']([^"']*)["'])?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1];
        const attrValue = attrMatch[2];

        const regex = new RegExp(`<([^>]+)\\s+${attrName.replace('-', '\\-')}(?:=["']([^"']*)["'])?[^>]*>`, 'gi');
        const matches = html.matchAll(regex);

        for (const match of matches) {
          const fullMatch = match[0];
          const foundAttrValue = match[2];

          // If we're looking for a specific value, check it matches
          if (attrValue && foundAttrValue !== attrValue) {
            continue;
          }

          // Extract tag name and all attributes
          const tagMatch = fullMatch.match(/<(\w+)([^>]*?)>/);
          if (tagMatch) {
            const tagName = tagMatch[1];
            const attributes = tagMatch[2];
            const attribs = {};

            if (attributes) {
              const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*?)["'])?/g);
              for (const attrMatch of attrMatches) {
                attribs[attrMatch[1]] = attrMatch[2] || '';
              }
            }

            // Get text content
            let textContent = '';
            const startPos = html.indexOf(fullMatch) + fullMatch.length;
            const endTag = `</${tagName}>`;
            const endPos = html.indexOf(endTag, startPos);

            if (endPos !== -1) {
              textContent = html.substring(startPos, endPos).trim();
              textContent = textContent.replace(/<[^>]*>/g, '').trim();
              textContent = textContent
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#x2F;/g, '/');
            }

            elements.push({
              tagName: tagName,
              attribs: attribs,
              textContent: textContent
            });
          }
        }
      }
    } else if (selector.startsWith('[class]')) {
      // Find elements with class attribute
      const matches = html.matchAll(/<\w+[^>]*\sclass=["']([^"']*)["'][^>]*>/g);
      for (const match of matches) {
        elements.push({ classList: match[1].split(/\s+/) });
      }
    } else {
      // Find elements by tag name
      const tagName = selector.replace(/[^a-zA-Z]/g, '');

      // Improved regex that handles both self-closing and regular tags
      const tagRegex = new RegExp(`<(${tagName})([^>]*?)(\\/?)>`, 'gi');
      const matches = html.matchAll(tagRegex);

      for (const match of matches) {
        const fullTagName = match[1];
        const attributes = match[2];
        const isSelfClosing = match[3] === '/';
        const attribs = {};

        // Parse attributes more carefully (include hyphens for data-* attributes)
        if (attributes) {
          const attrMatches = attributes.matchAll(/([\w-]+)(?:=["']([^"']*?)["'])?/g);
          for (const attrMatch of attrMatches) {
            attribs[attrMatch[1]] = attrMatch[2] || '';
          }
        }

        let textContent = '';
        if (!isSelfClosing) {
          // Find content between opening and closing tags
          const startPos = html.indexOf(match[0]) + match[0].length;
          const endTag = `</${fullTagName}>`;
          const endPos = html.indexOf(endTag, startPos);

          if (endPos !== -1) {
            textContent = html.substring(startPos, endPos).trim();
            // Remove inner HTML tags to get just text
            textContent = textContent.replace(/<[^>]*>/g, '').trim();
            // Decode HTML entities
            textContent = textContent
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#x27;/g, "'")
              .replace(/&#x2F;/g, '/');
          }
        }

        elements.push({
          tagName: fullTagName,
          attribs: attribs,
          textContent: textContent
        });
      }
    }

    return {
      length: elements.length,
      get: (index) => elements[index] || null,
      attr: (name) => elements[0] ? elements[0].attribs[name] : undefined,
      text: () => elements[0] ? elements[0].textContent || '' : '',
      html: () => elements[0] ? html : '',
      hasClass: (className) => {
        if (elements[0] && elements[0].attribs && elements[0].attribs.class) {
          return elements[0].attribs.class.split(/\s+/).includes(className);
        }
        return false;
      },
      each: (callback) => {
        elements.forEach((el, index) => callback(index, el));
      },
      // Add some additional methods that tests might expect
      first: () => {
        return {
          length: elements.length > 0 ? 1 : 0,
          attr: (name) => elements[0] ? elements[0].attribs[name] : undefined,
          text: () => elements[0] ? elements[0].textContent || '' : '',
          hasClass: (className) => {
            if (elements[0] && elements[0].attribs && elements[0].attribs.class) {
              return elements[0].attribs.class.split(/\s+/).includes(className);
            }
            return false;
          }
        };
      },
      find: (childSelector) => {
        // Simple find implementation
        return $(childSelector);
      },
      is: (checkSelector) => {
        // Basic is() implementation for checking if element matches selector
        if (checkSelector.startsWith('.')) {
          const className = checkSelector.substring(1);
          return elements[0] && elements[0].attribs && elements[0].attribs.class &&
                 elements[0].attribs.class.split(/\s+/).includes(className);
        }
        return false;
      }
    };
  };
}

/**
 * Extract all CSS classes from rendered HTML
 * @param {string} html - HTML string
 * @returns {Array<string>} Array of unique CSS classes
 */
const extractClasses = (html) => {
  const classes = new Set();

  // Use regex to extract class attributes
  const classMatches = html.matchAll(/class=["']([^"']*)["']/g);

  for (const match of classMatches) {
    const classAttr = match[1];
    if (classAttr) {
      classAttr.split(/\s+/).forEach(cls => {
        if (cls.trim()) classes.add(cls.trim());
      });
    }
  }

  return Array.from(classes).sort();
};

/**
 * Extract all HTML attributes from rendered HTML
 * @param {string} html - HTML string
 * @param {string} selector - CSS selector (optional, defaults to first element)
 * @returns {object} Object with all attributes
 */
const extractAttributes = (html, selector = ':first') => {
  const attributes = {};

  if (selector === ':first') {
    // Find first element and extract its attributes
    const match = html.match(/<(\w+)([^>]*)>/);
    if (match) {
      const attributeString = match[2];

      // Parse attributes using regex (include hyphens for data-* attributes)
      const attrMatches = attributeString.matchAll(/([\w-]+)(?:=["']([^"']*)["'])?/g);
      for (const attrMatch of attrMatches) {
        attributes[attrMatch[1]] = attrMatch[2] || '';
      }
    }
  } else {
    // Use the HTML parser to find specific elements
    const $ = parseHTML(html);
    const element = $(selector).get(0);

    if (element && element.attribs) {
      Object.assign(attributes, element.attribs);
    }
  }

  return attributes;
};

/**
 * Check if HTML contains specific elements
 * @param {string} html - HTML string
 * @param {string} selector - CSS selector to check
 * @returns {boolean} True if elements exist
 */
const hasElements = (html, selector) => {
  const $ = parseHTML(html);
  return $(selector).length > 0;
};

/**
 * Get text content of elements
 * @param {string} html - HTML string
 * @param {string} selector - CSS selector
 * @returns {Array<string>} Array of text content from matching elements
 */
const getTextContent = (html, selector = '*') => {
  const texts = [];

  // Extract text content from HTML elements
  const textMatches = html.matchAll(/>([^<]+)</g);
  for (const match of textMatches) {
    let text = match[1].trim();
    if (text) {
      // Decode HTML entities
      text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
      texts.push(text);
    }
  }

  return texts;
};

/**
 * Validate HTML accessibility attributes
 * @param {string} html - HTML string
 * @returns {object} Validation results with warnings and errors
 */
const validateAccessibility = (html) => {
  const $ = parseHTML(html);
  const results = {
    errors: [],
    warnings: [],
    passed: []
  };

  // Check for missing alt attributes on images
  $('img').each((i, el) => {
    const alt = el.attribs ? el.attribs.alt : undefined;
    if (!alt) {
      results.errors.push('Image missing alt attribute');
    } else {
      results.passed.push('Image has alt attribute');
    }
  });

  // Check for form labels
  $('input, textarea, select').each((i, el) => {
    const id = el.attribs ? el.attribs.id : undefined;
    const ariaLabel = el.attribs ? el.attribs['aria-label'] : undefined;
    const ariaLabelledBy = el.attribs ? el.attribs['aria-labelledby'] : undefined;

    if (id && $(`label[for="${id}"]`).length > 0) {
      results.passed.push('Form control has associated label');
    } else if (ariaLabel || ariaLabelledBy) {
      results.passed.push('Form control has aria labeling');
    } else {
      results.warnings.push('Form control may be missing label');
    }
  });

  // Check for buttons with accessible text
  $('button').each((i, el) => {
    const text = el.textContent || '';
    const ariaLabel = el.attribs ? el.attribs['aria-label'] : undefined;

    if (!text && !ariaLabel) {
      results.warnings.push('Button may be missing accessible text');
    } else {
      results.passed.push('Button has accessible text');
    }
  });

  return results;
};

/**
 * Test all parameter combinations for a component
 * @param {string} componentPath - Component path
 * @param {object} parameterTests - Test cases { paramName: [value1, value2, ...] }
 * @returns {Promise<Array>} Array of test results
 */
const testParameterCombinations = async (componentPath, parameterTests) => {
  const results = [];

  // Test default (no parameters)
  try {
    const html = await renderComponent(componentPath);
    results.push({
      params: {},
      success: true,
      html: html,
      error: null
    });
  } catch (error) {
    results.push({
      params: {},
      success: false,
      html: null,
      error: error.message
    });
  }

  // Test individual parameters
  for (const [paramName, values] of Object.entries(parameterTests)) {
    for (const value of values) {
      const params = { [paramName]: value };

      try {
        const html = await renderComponent(componentPath, params);
        results.push({
          params: params,
          success: true,
          html: html,
          error: null
        });
      } catch (error) {
        results.push({
          params: params,
          success: false,
          html: null,
          error: error.message
        });
      }
    }
  }

  return results;
};

/**
 * Custom Jest matchers for component testing
 */
const customMatchers = {
  /**
   * Check if HTML contains specific CSS classes
   */
  toHaveClasses(received, expected) {
    const classes = extractClasses(received);
    const missing = expected.filter(cls => !classes.includes(cls));

    if (missing.length === 0) {
      return {
        message: () => `Expected HTML not to contain classes: ${expected.join(', ')}`,
        pass: true
      };
    } else {
      return {
        message: () => `Expected HTML to contain classes: ${missing.join(', ')}`,
        pass: false
      };
    }
  },

  /**
   * Check if HTML has specific attributes
   */
  toHaveAttributes(received, expected, selector) {
    // Default selector based on expected attributes
    let actualSelector = selector;
    if (!actualSelector) {
      // Determine selector from expected type or inputmode attribute
      if (expected.type === 'email') {
        actualSelector = 'input[type="email"]';
      } else if (expected.type === 'tel') {
        actualSelector = 'input[type="tel"]';
      } else if (expected.type === 'submit' || expected.type === 'button' || expected.type === 'reset') {
        // Button types - check for button element first
        actualSelector = 'button';
      } else if (expected.type) {
        // Other input types
        actualSelector = `input[type="${expected.type}"]`;
      } else if (expected.inputmode === 'tel') {
        // Check if it's a tel input with inputmode instead of type
        actualSelector = 'input[inputmode="tel"]';
      } else if (expected.autocomplete === 'email' || expected.autocomplete === 'work email' || expected.name || expected.id || expected.value !== undefined || expected.placeholder || expected.maxlength) {
        // If autocomplete suggests email, or generic input attributes - try to find any input
        if (expected.autocomplete && expected.autocomplete.includes('email')) {
          actualSelector = 'input[type="email"]';
        } else {
          actualSelector = 'input';
        }
      } else if (expected['data-form'] || expected['data-action']) {
        // Attributes commonly used on buttons
        actualSelector = 'button';
      } else {
        actualSelector = ':first';
      }
    }

    const attributes = extractAttributes(received, actualSelector);
    const missing = [];

    for (const [key, value] of Object.entries(expected)) {
      if (attributes[key] !== value) {
        missing.push(`${key}="${value}"`);
      }
    }

    if (missing.length === 0) {
      return {
        message: () => `Expected HTML not to have attributes: ${Object.keys(expected).join(', ')}`,
        pass: true
      };
    } else {
      return {
        message: () => `Expected HTML to have attributes: ${missing.join(', ')}. Found: ${JSON.stringify(attributes)}`,
        pass: false
      };
    }
  },

  /**
   * Check if HTML contains specific text content
   */
  toContainText(received, expected) {
    const texts = getTextContent(received);
    const allText = texts.join(' ');

    // Handle HTML entity decoding for comparison
    const decodedAllText = allText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');

    if (decodedAllText.includes(expected)) {
      return {
        message: () => `Expected HTML not to contain text: "${expected}"`,
        pass: true
      };
    } else {
      return {
        message: () => `Expected HTML to contain text: "${expected}"\nActual text: "${decodedAllText}"\nRaw text: "${allText}"`,
        pass: false
      };
    }
  },

  /**
   * Check if HTML is accessible
   */
  toBeAccessible(received) {
    const validation = validateAccessibility(received);

    if (validation.errors.length === 0) {
      return {
        message: () => `Expected HTML to have accessibility issues`,
        pass: true
      };
    } else {
      return {
        message: () => `Expected HTML to be accessible. Issues: ${validation.errors.join(', ')}`,
        pass: false
      };
    }
  }
};

module.exports = {
  renderComponent,
  parseHTML,
  extractClasses,
  extractAttributes,
  hasElements,
  getTextContent,
  validateAccessibility,
  testParameterCombinations,
  customMatchers,
  VIEWS_BASE_PATH
};