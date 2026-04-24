const express = require('express');

const router = express.Router();
const homeController = require('../../application/controllers/homeController');
const authController = require('../../application/controllers/authController');
const dashboardAuth = require('../../application/middleware/dashboardAuthMiddleware');

// Language switching endpoint
router.get('/set-language/:lang', (req, res) => {
  const { lang } = req.params;
  const validLangs = ['es', 'en'];

  if (validLangs.includes(lang)) {
    // Set language cookie
    res.cookie('i18next', lang, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    // Get the referrer URL or default to home
    const referrer = req.get('Referrer') || '/';

    // Map Spanish routes to English equivalents
    const routeMap = {
      '/nosotros': lang === 'en' ? '/en/about' : '/nosotros',
      '/servicios': lang === 'en' ? '/en/services' : '/servicios',
      '/nuestra-flota': lang === 'en' ? '/en/our-fleet' : '/nuestra-flota',
      '/contacto': lang === 'en' ? '/en/contact' : '/contacto',
      '/en/about': lang === 'es' ? '/nosotros' : '/en/about',
      '/en/services': lang === 'es' ? '/servicios' : '/en/services',
      '/en/our-fleet': lang === 'es' ? '/nuestra-flota' : '/en/our-fleet',
      '/en/contact': lang === 'es' ? '/contacto' : '/en/contact',
      '/en': lang === 'es' ? '/' : '/en',
      '/': lang === 'en' ? '/en' : '/',
    };

    // Find the corresponding route in the new language
    let redirectUrl = '/';
    for (const [route, mapping] of Object.entries(routeMap)) {
      if (referrer.includes(route)) {
        redirectUrl = mapping;
        break;
      }
    }

    // If no specific route found but switching to English, add /en prefix
    if (redirectUrl === '/' && lang === 'en' && !referrer.includes('/en')) {
      redirectUrl = '/en';
    }

    res.redirect(redirectUrl);
  } else {
    res.redirect('/');
  }
});

// Home page - Amexing Experience Landing Page
router.get('/', homeController.index.bind(homeController));
router.get('/en', async (req, res, next) => {
  // Change i18next language for this request
  if (req.i18n) {
    await req.i18n.changeLanguage('en');
  }
  req.language = 'en';
  homeController.index(req, res, next);
});

// Landing pages - Spanish routes for navigation
router.get('/nosotros', homeController.nosotros.bind(homeController));
router.get('/servicios', homeController.servicios.bind(homeController));
router.get('/nuestra-flota', homeController.fleet.bind(homeController));
router.get('/contacto', homeController.contacto.bind(homeController));

// English routes
router.get('/en/about', async (req, res, next) => {
  if (req.i18n) {
    await req.i18n.changeLanguage('en');
  }
  req.language = 'en';
  homeController.nosotros(req, res, next);
});
router.get('/en/services', async (req, res, next) => {
  if (req.i18n) {
    await req.i18n.changeLanguage('en');
  }
  req.language = 'en';
  homeController.servicios(req, res, next);
});
router.get('/en/our-fleet', async (req, res, next) => {
  if (req.i18n) {
    await req.i18n.changeLanguage('en');
  }
  req.language = 'en';
  homeController.fleet(req, res, next);
});
router.get('/en/contact', async (req, res, next) => {
  if (req.i18n) {
    await req.i18n.changeLanguage('en');
  }
  req.language = 'en';
  homeController.contacto(req, res, next);
});

// About page (English - keep for backwards compatibility - redirect to new route)
router.get('/about', (req, res) => {
  res.redirect('/en/about');
});

// Auth pages
router.get('/login', dashboardAuth.redirectIfAuthenticated, authController.showLogin);
router.get('/register', dashboardAuth.redirectIfAuthenticated, authController.showRegister);
router.get('/auth/request-access', dashboardAuth.redirectIfAuthenticated, authController.showRequestAccess);
router.get('/request-access', dashboardAuth.redirectIfAuthenticated, authController.showRequestAccess);
router.post('/logout', dashboardAuth.logout, (req, res) => {
  // Force redirect to login without any middleware interference
  res.redirect(`/login?message=${encodeURIComponent('You have been logged out successfully')}`);
});
router.get('/logout', dashboardAuth.logout, (req, res) => {
  res.redirect(`/login?message=${encodeURIComponent('You have been logged out successfully')}`);
});
router.get('/auth/forgot-password', dashboardAuth.redirectIfAuthenticated, authController.showForgotPassword);
router.get('/forgot-password', dashboardAuth.redirectIfAuthenticated, authController.showForgotPassword);

// TEST ROUTE - Remove this after debugging
router.get('/test-route', (req, res) => {
  console.log('🔥 TEST ROUTE HIT: /test-route');
  res.json({ message: 'Test route working!', timestamp: new Date().toISOString() });
});

router.post('/test-post', (req, res) => {
  console.log('🔥 TEST POST HIT: /test-post');
  console.log('🔥 Body:', req.body);
  res.json({ message: 'Test POST working!', body: req.body, timestamp: new Date().toISOString() });
});
router.post('/forgot-password', (req, res, next) => {
  console.log('🚀 ========== ROUTE HIT: POST /forgot-password ==========');
  console.log('🚀 Time:', new Date().toISOString());
  console.log('🚀 Request body:', JSON.stringify(req.body, null, 2));
  console.log('🚀 Request method:', req.method);
  console.log('🚀 Request URL:', req.originalUrl);
  console.log('🚀 Content-Type:', req.headers['content-type']);
  next();
}, async (req, res, _next) => {
  console.log('🚀 Calling authController.processForgotPassword...');
  try {
    await authController.processForgotPassword(req, res);
  } catch (error) {
    console.log('🚀 ERROR in processForgotPassword:', error.message);
    console.log('🚀 ERROR stack:', error.stack);
    // Redirect with error message
    res.redirect(`/forgot-password?error=${encodeURIComponent('An unexpected error occurred. Please try again.')}`);
  }
});
router.get('/auth/reset-password', dashboardAuth.redirectIfAuthenticated, authController.showResetPassword);

// Email verification pages
router.get('/verify-email-success', (req, res) => {
  res.render('auth/verify-success', {
    title: 'Email Verified',
    message: 'Your email has been successfully verified!',
  });
});

// Password reset pages
router.get('/choose-password', (req, res) => {
  res.render('auth/choose-password', {
    title: 'Choose New Password',
  });
});

router.get('/password-reset-success', (req, res) => {
  res.render('auth/reset-success', {
    title: 'Password Reset Successful',
    message: 'Your password has been successfully reset!',
  });
});

// Invalid link page
router.get('/invalid-link', (req, res) => {
  res.render('errors/invalid-link', {
    title: 'Invalid Link',
    message: 'This link is invalid or has expired.',
  });
});

module.exports = router;
