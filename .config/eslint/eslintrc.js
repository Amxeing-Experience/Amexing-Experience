module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: [
    'airbnb-base',
    'plugin:jsdoc/recommended',
  ],
  plugins: [
    'security',
    'jsdoc',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.json']
      }
    }
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
    'consistent-return': 'off', // Allow different return patterns
    'arrow-body-style': ['error', 'as-needed'],
    'prefer-destructuring': ['error', {
      array: false, // Don't force array destructuring
      object: true,
    }],
    'no-param-reassign': ['error', {
      props: true,
      ignorePropertyModificationsFor: ['req', 'res', 'session'],
    }],
    'max-len': ['error', {
      code: 120,
      ignoreComments: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
    }],
    'import/no-extraneous-dependencies': ['error', {
      devDependencies: ['**/*.test.js', '**/*.spec.js', 'tests/**/*.js'],
    }],
    'import/no-unresolved': ['error', { ignore: ['uuid', 'mailersend'] }],
    // Security plugin rules - PCI DSS Requirement 6.2.1
    'security/detect-object-injection': 'warn', // Downgraded to warning
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'error',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'error',
    'security/detect-non-literal-require': 'error',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    'class-methods-use-this': 'off', // Allow class methods that don't use this
    'global-require': 'off', // Allow require() in functions
    'func-names': 'off', // Allow anonymous functions
    'no-underscore-dangle': ['error', {
      allow: ['_cachedRole'], // Allow internal cache property for role objects
    }],
    'comma-dangle': ['error', {
      arrays: 'always-multiline',
      objects: 'always-multiline',
      imports: 'always-multiline',
      exports: 'always-multiline',
      functions: 'never',
    }],
    // Complexity Rules - Relaxed for OAuth implementation
    'complexity': 'warn', // Downgraded to warning
    'max-depth': 'warn', // Downgraded to warning
    'max-lines': 'warn', // Downgraded to warning
    'max-lines-per-function': 'warn', // Downgraded to warning
    'max-params': ['warn', 4], // Downgraded to warning
    'no-restricted-syntax': 'warn', // Downgraded to warning
    'no-await-in-loop': 'warn', // Downgraded to warning
    'no-plusplus': 'warn', // Downgraded to warning
    'radix': 'warn', // Downgraded to warning
    // JSDoc Rules - Relaxed for OAuth Sprint
    'jsdoc/require-description': 'warn', // Downgraded to warning
    'jsdoc/require-description-complete-sentence': 'warn',
    'jsdoc/require-example': 'warn',
    'jsdoc/require-param-description': 'warn', // Downgraded to warning
    'jsdoc/require-returns-description': 'warn', // Downgraded to warning
    'jsdoc/check-alignment': 'error',
    'jsdoc/check-indentation': 'error',
    'jsdoc/check-line-alignment': 'error',
    'jsdoc/check-syntax': 'error',
    'jsdoc/check-tag-names': ['error', { definedTags: ['swagger'] }],
    'jsdoc/check-types': 'error',
    // Fortified JSDoc Rules - Elevated to warnings (2024-10-16)
    // TODO: Elevate to 'error' once all @since/@version tags are standardized
    'jsdoc/check-values': 'warn', // Validate @since dates and @version tags
    'jsdoc/check-param-names': 'warn', // Validate parameter names (reduced from 78 to 59 violations)
  },
  globals: {
    Parse: 'readonly', // Make Parse available as global
  },
  overrides: [
    {
      files: ['*.test.js', '*.spec.js'],
      env: {
        jest: true,
      },
    },
    {
      files: [
        'src/views/**/*.js',
        'src/presentation/views/**/*.js',
        'public/**/*.js',
        '**/oauth-sw.js',
        '**/mobile-oauth-optimizer.js',
        '**/CorporateOAuthInterface.js',
        '**/OAuthProvider.js',
        '**/IntelligentProviderSelector.js',
        '**/AppleSignInButton.js',
        '**/PermissionContextSwitcher.js'
      ],
      env: {
        browser: true,
        es2021: true,
      },
      globals: {
        Parse: 'readonly',
        AppleID: 'readonly',
        PublicKeyCredential: 'readonly',
        logger: 'readonly',
        PermissionService: 'readonly',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        console: 'readonly',
        // Add any other frontend-specific globals here
      },
      rules: {
        'no-param-reassign': 'off',
        'no-plusplus': 'off',
        'complexity': 'off',
        'no-console': 'warn',
        'max-lines': 'off',
        'no-new': 'warn',
        'radix': 'off',
        'security/detect-object-injection': 'off'
      }
    },
    {
      files: [
        'src/application/services/*OAuth*.js',
        'src/cloud/functions/*oauth*.js',
        'src/services/*OAuth*.js',
        'src/services/PermissionService.js',
        'src/application/services/Permission*.js'
      ],
      rules: {
        'no-restricted-syntax': 'off',
        'no-await-in-loop': 'off',
        'no-plusplus': 'off',
        'complexity': 'off',
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'security/detect-object-injection': 'off',
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'jsdoc/require-example': 'off',
        'jsdoc/require-param-description': 'warn',
        'max-depth': 'off'
      }
    },
    {
      files: [
        'src/cloud/functions/*.js',
        'src/middleware/*.js',
        'src/views/components/**/*.js',
        'src/domain/models/*.js'
      ],
      rules: {
        'no-unused-vars': 'warn',
        'no-unreachable': 'warn',
        'jsdoc/check-tag-names': 'warn',
        'default-case': 'warn',
        'no-trailing-spaces': 'warn',
        'no-return-await': 'warn'
      }
    },
    {
      files: [
        'src/infrastructure/swagger/**/*.js',
        'src/presentation/routes/**/*.js'
      ],
      rules: {
        'jsdoc/check-indentation': 'off', // Swagger YAML blocks need indentation
        'max-lines': 'off' // Swagger docs can make files longer
      }
    },
  ],
};