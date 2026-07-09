const facebookService = require('../services/facebookService');

async function fetchPages(req, res) {
  const { cookie } = req.body;
  if (!cookie || !cookie.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp cookie!' });
  }

  try {
    const pages = await facebookService.getPages(cookie);
    return res.json({ success: true, pages });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function createNewPage(req, res) {
  const { cookie, customName, customBio, category } = req.body;
  if (!cookie || !cookie.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp cookie!' });
  }

  try {
    const result = await facebookService.createPage(cookie, customName, customBio, category);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  fetchPages,
  createNewPage
};
