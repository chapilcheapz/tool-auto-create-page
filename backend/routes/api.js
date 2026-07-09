const express = require('express');
const configController = require('../controllers/configController');
const pageController = require('../controllers/pageController');
const reactController = require('../controllers/reactController');

const router = express.Router();

// Config routes
router.get('/config', configController.getConfig);
router.post('/config', configController.saveConfig);

// Page routes
router.post('/get-pages', pageController.fetchPages);
router.post('/create-page', pageController.createNewPage);

// React routes
router.post('/react-post', reactController.bulkReact);

module.exports = router;
