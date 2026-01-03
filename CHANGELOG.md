# [0.6.0](https://github.com/M4u2002/Amexing-Experience/compare/v0.4.0...v0.6.0) (2025-12-31)


### Bug Fixes

* **services:** fix some missing js ([dc5589b](https://github.com/M4u2002/Amexing-Experience/commit/dc5589beafc54ce104b1b6b93e042939ed5d9129))
* **test:** fix test in general ([86faee9](https://github.com/M4u2002/Amexing-Experience/commit/86faee9f08dd0317d034c49f07c1d9fabeb361c2))
* **test:** fix test in general ([5c639be](https://github.com/M4u2002/Amexing-Experience/commit/5c639bea01242ea60342dc470925351c3b58ddfb))


### Features

* **seed:** seed tarifarios ([a0b553f](https://github.com/M4u2002/Amexing-Experience/commit/a0b553fc20f15f122626d6be68f439c0ddae16e9))



# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2025-12-19

### Added
- Initial setup for version 0.5.0
- Email template management UI (planned)
- Bulk email sending capabilities (planned)
- Email analytics and reporting (planned)
- Advanced pricing rule engine (planned)
- Quote automation workflows (planned)

### Changed
- Repository migrated to M4u2002/Amexing-Experience

### Fixed
- (To be documented as fixes are implemented)

### Security
- (To be documented as security updates are made)

## [0.4.0] - 2025-12-19

### Added
- **Email System with MailerSend Integration**
  - Complete email service with MailerSend API integration
  - Email template system with variable substitution
  - HTML email templates: welcome, booking confirmation, password reset
  - Email logging and tracking (EmailLog model)
  - SuperAdmin email management dashboard at `/dashboard/superadmin/emails`
  - Test email functionality with template selection
  - Email usage statistics and monitoring
  - Support for Spanish characters (Ñ, Á, É, etc.) in template variables
  - Environment-aware logo URLs via EMAIL_BASE_URL configuration

- **Dynamic Pricing System**
  - Client-specific rate management (AgencyRate, TransferRate)
  - Rate prices table with multi-currency support
  - Tour prices with dynamic catalog
  - Price adjustment tracking (InflationRate, ExchangeRate)
  - Client exceptions and custom pricing rules
  - Automated price synchronization from service catalog

- **Tours Data Management**
  - Complete tour catalog with 837 services from CSV
  - Tour prices seeding for all rate classes (First Class, Green Class, Premium)
  - Tour validation scripts
  - Service type categorization (Aeropuerto, Punto a Punto, Local, Tours)

- **Database Enhancements**
  - Services table refactoring for better data organization
  - Rate prices table with comprehensive pricing structure
  - Migration scripts for price synchronization
  - Client prices tracking
  - Service catalog improvements

### Changed
- **Email Templates Styling**
  - Updated header background color to #f45355 (Amexing brand red)
  - Changed decorative line to #1a1a1a (black) for better contrast
  - Implemented table-based TripAdvisor icon (centered "T" in green circle)
  - All links and buttons use consistent #f45355 color
  - Improved email client compatibility with table-based layouts

- **Dependency Updates**
  - body-parser: 2.2.0 → 2.2.1
  - current-module-paths: 1.1.2 → 1.1.3
  - @commitlint/load: 20.1.0 → 20.2.0
  - @commitlint/parse: 20.0.0 → 20.2.0
  - @emnapi/core: 1.5.0 → 1.7.1
  - uuid: 9.0.1 → 13.0.0
  - @commitlint/cli: 18.6.1 → 20.1.0
  - husky: 8.0.3 → 9.1.7
  - mongodb-memory-server: 9.5.0 → 10.3.0
  - jsdoc-to-markdown: 9.1.2 → 9.1.3

### Fixed
- **Email Template Variables**
  - Fixed {{AÑO}} placeholder not substituting due to regex not supporting Spanish characters
  - Updated regex to `/\{\{([A-ZÁÉÍÓÚÑ_0-9]+)\}\}/gi` for full Spanish character support
  - Logo URL now uses production domain instead of localhost via EMAIL_BASE_URL

- **Merge Conflicts Resolution**
  - Resolved yarn.lock conflicts in multiple dependency update branches
  - Fixed iconv-lite version conflicts (0.6.3 and 0.7.1)
  - Fixed raw-body version references (^3.0.0 and ^3.0.1)

- **Quote Management**
  - Quote cancellation functionality
  - Client manual access improvements
  - Quote information section enhancements

### Security
- Comprehensive dependency security updates via Dependabot
- PCI DSS compliant email system with audit logging
- Secure email template rendering with XSS prevention

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

[Unreleased]: https://github.com/M4u2002/Amexing-Experience/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/M4u2002/Amexing-Experience/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/M4u2002/Amexing-Experience/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/M4u2002/Amexing-Experience/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/M4u2002/Amexing-Experience/releases/tag/v0.1.0
