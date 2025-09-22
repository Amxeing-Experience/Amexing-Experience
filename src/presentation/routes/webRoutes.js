const express = require('express');

const router = express.Router();
const homeController = require('../../application/controllers/homeController');
const authController = require('../../application/controllers/authController');
const dashboardAuth = require('../../application/middleware/dashboardAuthMiddleware');

// Home page
router.get('/', homeController.index);

// About page
router.get('/about', homeController.about);

// Auth pages
router.get('/login', dashboardAuth.redirectIfAuthenticated, authController.showLogin);
router.get('/register', dashboardAuth.redirectIfAuthenticated, authController.showRegister);
router.post('/logout', dashboardAuth.logout, (req, res) => {
  // Force redirect to login without any middleware interference
  res.redirect(`/login?message=${encodeURIComponent('You have been logged out successfully')}`);
});
router.get('/logout', dashboardAuth.logout, (req, res) => {
  res.redirect(`/login?message=${encodeURIComponent('You have been logged out successfully')}`);
});
router.get('/auth/forgot-password', dashboardAuth.redirectIfAuthenticated, authController.showForgotPassword);
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
