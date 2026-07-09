const { readConfig, writeConfig } = require('../services/configService');
const { clearUserCache } = require('../utils/extract-tokens');

function getConfig(req, res) {
  try {
    const config = readConfig();
    return res.json({ success: true, cookie: config.cookie });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

function saveConfig(req, res) {
  const { cookie } = req.body;
  try {
    writeConfig(cookie);
    clearUserCache(); // Clear in-memory tokens cache so the new cookie takes effect instantly
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getConfig,
  saveConfig
};
