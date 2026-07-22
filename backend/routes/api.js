const express = require('express');
const configController = require('../controllers/configController');
const pageController = require('../controllers/pageController');
const reactController = require('../controllers/reactController');
const authController = require('../controllers/authController');
const mediaController = require('../controllers/mediaController');
const authMiddleware = require('../utils/authMiddleware');

const router = express.Router();

// Unprotected routes for browser image tags & direct downloads
router.post('/auth/login', authController.login);
router.post('/auth/refresh', authController.refresh);
router.get('/config/fb-avatar', configController.getFbAvatar);
router.get('/config/fb-verification-screenshot', configController.getVerificationScreenshot);
router.get('/campaigns/:id/stream', pageController.streamCampaignLogs);
// Audio/video tags cannot attach the app's Bearer header. This route only serves
// generated random filenames and still applies strict basename validation.
router.get('/media/local/:filename', mediaController.serveLocalMedia);

// Protected routes using authMiddleware
router.use(authMiddleware);

// Config routes
router.get('/config', configController.getConfig);
router.get('/config/diagnose-cookies', configController.diagnoseCookies);
router.post('/config', configController.saveConfig);
router.post('/config/fb-login', configController.fbLogin);
router.get('/config/fb-verification-status', configController.getVerificationStatus);
router.post('/config/fb-verification-submit', configController.submitVerificationCode);
router.post('/config/fb-verification-click', configController.handleVerificationClick);


// Page routes
router.post('/get-pages', pageController.fetchPages);
router.post('/create-page', pageController.createNewPage);
router.post('/post-to-facebook', pageController.postToFacebook);

// React routes
router.post('/react-post', reactController.bulkReact);

// Media studio routes (all processing and library mutations require login)
router.post('/media/audio/extract', mediaController.extractAudio);
router.post('/media/audio/remove-segment', mediaController.removeAudioSegment);
router.get('/media/videos', mediaController.listVideos);
// The controller streams the binary request to a temporary file and enforces
// MEDIA_MAX_UPLOAD_BYTES without buffering a large video in Node.js memory.
router.post('/media/videos/upload', mediaController.uploadVideo);
router.post('/media/merge', mediaController.mergeMedia);

// Change password
router.post('/auth/change-password', authController.changePassword);

module.exports = router;
