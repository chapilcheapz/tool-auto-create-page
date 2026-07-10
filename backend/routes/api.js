const express = require('express');
const configController = require('../controllers/configController');
const pageController = require('../controllers/pageController');
const reactController = require('../controllers/reactController');
const authController = require('../controllers/authController');
const authMiddleware = require('../utils/authMiddleware');

const router = express.Router();

// Authentication routes (unprotected)
router.post('/auth/login', authController.login);
router.post('/auth/register', authController.register);

// Protected routes using authMiddleware
router.use(authMiddleware);

// Config routes
router.get('/config', configController.getConfig);
router.post('/config', configController.saveConfig);
router.post('/config/fb-login', configController.fbLogin);

// Page routes
router.post('/get-pages', pageController.fetchPages);
router.post('/create-page', pageController.createNewPage);

// React routes
router.post('/react-post', reactController.bulkReact);

// Change password
router.post('/auth/change-password', authController.changePassword);

module.exports = router;
