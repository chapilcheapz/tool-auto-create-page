const express = require('express');
const configController = require('../controllers/configController');
const pageController = require('../controllers/pageController');
const reactController = require('../controllers/reactController');
const authController = require('../controllers/authController');
const authMiddleware = require('../utils/authMiddleware');

const router = express.Router();

// Unprotected routes for browser image tags
router.post('/auth/login', authController.login);
router.post('/auth/refresh', authController.refresh);
router.get('/config/fb-avatar', configController.getFbAvatar);
router.get('/config/fb-verification-screenshot', configController.getVerificationScreenshot);

// Protected routes using authMiddleware
router.use(authMiddleware);

// Config routes
router.get('/config', configController.getConfig);
router.post('/config', configController.saveConfig);
router.post('/config/fb-login', configController.fbLogin);
router.get('/config/fb-verification-status', configController.getVerificationStatus);
router.post('/config/fb-verification-submit', configController.submitVerificationCode);
router.post('/config/fb-verification-click', configController.handleVerificationClick);


// Page routes
router.post('/get-pages', pageController.fetchPages);
router.post('/create-page', pageController.createNewPage);

// React routes
router.post('/react-post', reactController.bulkReact);

// Change password
router.post('/auth/change-password', authController.changePassword);

module.exports = router;
