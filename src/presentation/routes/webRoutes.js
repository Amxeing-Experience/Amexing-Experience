const express = require('express');

const router = express.Router();
const homeController = require('../../application/controllers/homeController');
const authController = require('../../application/controllers/authController');
const dashboardAuth = require('../../application/middleware/dashboardAuthMiddleware');

// Home page - redirect to login until landing page is implemented
router.get('/', (req, res) => res.redirect('/login'));

// About page
router.get('/about', homeController.about);

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
