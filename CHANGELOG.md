# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2025-11-12

### Added
- **Email Input Atomic Component** - RFC 5322 compliant email validation component with real-time validation
  - Reusable atom component with customizable parameters (name, id, label, required, value, placeholder, helpText, maxlength, autocomplete)
  - Email normalization (lowercase + trim) on blur event
  - Bootstrap 5 validation classes (is-valid/is-invalid)
  - HTML5 pattern validation with JavaScript fallback
  - Accessibility features (proper label association, ARIA attributes)
  - 43 comprehensive unit tests

- **Phone Input Atomic Component** - International phone input with country code selector
  - 40 countries supported (9 América, 16 Europa, 15 Asia y Medio Oriente)
  - Country code dropdown with flags and formatted examples
  - Intelligent paste detection with automatic country code extraction
  - Phone number sanitization (digits only, removes formatting characters)
  - E.164 format generation for international numbers
  - Real-time validation with min/max length per country
  - XSS prevention with escaped template syntax
  - 66 comprehensive unit tests

- **Enhanced EJS Testing Infrastructure** - Robust testing utilities for atomic design components
  - Support for complex CSS selectors: `input[type="tel"]`, `button.country-selector`, `.dropdown-menu.country-dropdown`
  - Smart element detection based on attributes (type, inputmode, autocomplete)
  - Multi-class selector support (`.dropdown-menu.country-dropdown`)
  - Combined tag+class selectors (`button.country-selector`)
  - Improved `toHaveAttributes` custom matcher with intelligent selector detection
  - Enhanced HTML parser supporting combined selectors and attribute matching

### Changed
- **Migrated 7 forms to email-input component** - Eliminated 87.5% code duplication
  - Register form ([molecules/auth/register-form.ejs](src/presentation/views/molecules/auth/register-form.ejs))
  - Forgot password form ([molecules/auth/forgot-password-form.ejs](src/presentation/views/molecules/auth/forgot-password-form.ejs))
  - Amexing employees table ([organisms/datatable/amexing-employees-table.ejs](src/presentation/views/organisms/datatable/amexing-employees-table.ejs))
  - Quote information section ([dashboards/admin/sections/quote-information.ejs](src/presentation/views/dashboards/admin/sections/quote-information.ejs))
  - Quote detail page ([dashboards/admin/quote-detail.ejs](src/presentation/views/dashboards/admin/quote-detail.ejs))
  - Clients dashboard ([dashboards/admin/clients.ejs](src/presentation/views/dashboards/admin/clients.ejs))
  - Client detail page ([dashboards/admin/client-detail.ejs](src/presentation/views/dashboards/admin/client-detail.ejs))

- **Migrated 4 forms to phone-input component** - International support with sanitization
  - Amexing employees table (contact phone)
  - Quote information section (contact phone and phone)
  - Clients dashboard (main phone)
  - Client detail page (main phone)

### Fixed
- **EJS Parsing Errors** - Resolved missing parameters in quote-information.ejs include
- **Invalid Email Pattern Regex** - Fixed HTML5 pattern attribute compatibility (changed `\.` to `[.]`)
- **Semgrep XSS Vulnerability** - Replaced `<%- JSON.stringify()` with escaped `<%= %>` template syntax in phone-input component
- **36 Failing Component Tests** - All email-input, phone-input, and button tests now passing
  - Enhanced HTML parser to support complex selectors
  - Fixed attribute extraction for nested components
  - Improved matcher logic for different element types
  - Corrected test expectations for region organization

### Security
- **[MEDIUM]** XSS Prevention in Phone Component - Eliminated unescaped JSON rendering (PCI-DSS: Req 6.5.7)
- **[LOW]** Input Sanitization - Phone fields now store only pure numbers (PCI-DSS: Req 6.5.1)

## PCI DSS Compliance Notes
- **Requirement 6.5.7** (Cross-site scripting): Phone input component now uses escaped template syntax to prevent XSS attacks
- **Requirement 6.5.1** (Input validation): Phone and email inputs implement comprehensive client-side and server-side validation
- All user input fields now include proper sanitization and validation controls

## [0.1.0] - 2024-12-11

### Added
- Initial release of AmexingWeb platform
- Parse Server integration with MongoDB Atlas
- Clean Architecture implementation (application, domain, infrastructure, presentation layers)
- RBAC system with 8 roles and 30+ permissions
- Multi-provider OAuth 2.0 authentication (Apple, Corporate, Username/Password)
- PCI DSS Level 1 compliant security infrastructure
- Winston structured logging with audit trails
- Comprehensive test suite (integration + unit tests with MongoDB Memory Server)
- Flexy Bootstrap dashboard templates
- S3 file storage with environment separation (dev/prod)
- Database seeding system with automatic version detection
- Git hooks for security validation (pre-commit and pre-push)
- Semgrep static security analysis
- Complete API documentation

[Unreleased]: https://github.com/AmexingExperience/amexing-web/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AmexingExperience/amexing-web/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AmexingExperience/amexing-web/releases/tag/v0.1.0
