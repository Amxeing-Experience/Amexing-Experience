/**
 * I18n Configuration Module.
 *
 * Handles internationalization setup for the Amexing Experience application.
 * Configures i18next with file system backend for loading translations
 * and middleware for Express integration.
 *
 * Created by Denisse Maldonado.
 * @module i18nConfig
 */

const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const i18nextMiddleware = require('i18next-http-middleware');
const path = require('path');

/**
 * Initialize i18next with configuration.
 * @returns {Promise<void>}
 * @example
 */
const initI18n = async () => {
  await i18next
    .use(Backend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
      backend: {
        loadPath: path.join(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
        addPath: path.join(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
      },
      fallbackLng: 'es',
      supportedLngs: ['es', 'en'],
      ns: ['translation', 'navbar', 'pages', 'faq'],
      defaultNS: 'translation',
      preload: ['es', 'en'],
      saveMissing: false,
      debug: process.env.NODE_ENV === 'development',
      detection: {
        order: ['path', 'cookie', 'header', 'querystring', 'session'],
        caches: ['cookie'],
        lookupFromPathIndex: 0,
        lookupCookie: 'i18next',
        cookieOptions: {
          sameSite: 'strict',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
        },
      },
      interpolation: {
        escapeValue: false,
        skipOnVariables: false,
      },
      load: 'languageOnly',
      returnEmptyString: false,
      returnNull: false,
      cleanCode: true,
      compatibilityJSON: 'v4',
    });
};

/**
 * Get the i18next middleware for Express.
 * @returns {Function} Express middleware.
 * @example
 */
const getMiddleware = () => i18nextMiddleware.handle(i18next);

/**
 * Helper function to change language.
 * @param {string} lang - Language code (e.g., 'es', 'en').
 * @returns {Promise<void>}
 * @example
 */
const changeLanguage = async (lang) => {
  await i18next.changeLanguage(lang);
};

/**
 * Get available languages.
 * @returns {Array<string>} Array of supported language codes.
 * @example
 */
const getLanguages = () => i18next.options.supportedLngs.filter((lng) => lng !== 'cimode');

/**
 * Get current language.
 * @returns {string} Current language code.
 * @example
 */
const getCurrentLanguage = () => i18next.language || 'es';

/**
 * Translate key with optional options.
 * @param {string} key - Translation key.
 * @param {object} options - Optional translation options.
 * @returns {string} Translated string.
 * @example
 */
const translate = (key, options = {}) => i18next.t(key, options);

module.exports = {
  initI18n,
  getMiddleware,
  changeLanguage,
  getLanguages,
  getCurrentLanguage,
  translate,
  i18next,
};
