const { readConfig, writeConfig } = require('../services/configService');
const { clearUserCache } = require('../utils/extract-tokens');
const fs = require('fs');
const path = require('path');
const {
  verificationState,
  fbLoginService,
  getFbAvatarService,
  diagnoseCookiesService
} = require('../services/facebookAuthService');

async function getConfig(req, res) {
  try {
    const config = await readConfig();
    return res.json({ success: true, cookie: config.cookie });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function saveConfig(req, res) {
  const { cookie } = req.body;
  try {
    await writeConfig(cookie);
    clearUserCache();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function fbLogin(req, res) {
  const { username, password, twoFactorSecret } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tài khoản và mật khẩu Facebook.' });
  }

  try {
    const result = await fbLoginService(username, password, twoFactorSecret);
    return res.json(result);
  } catch (error) {
    console.error('[FB-Login ERROR]', error);
    if (error.code === 'FB_CAPTCHA_TIMEOUT') {
      return res.status(408).json({
        success: false,
        code: 'FB_CAPTCHA_TIMEOUT',
        requiresManualVerification: true,
        message: 'Hết thời gian chờ hoàn thành CAPTCHA Facebook.',
      });
    }
    if (error.code === 'FB_LOGIN_TIMEOUT' || error.code === 'FB_LOGIN_NOT_COMPLETED') {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function getVerificationStatus(req, res) {
  if (!verificationState.pending) {
    return res.json({ pending: false });
  }
  return res.json({
    pending: true,
    screenshotUrl: '/api/config/fb-verification-screenshot?t=' + Date.now(),
    viewport: { width: 1280, height: 900 }
  });
}

async function getVerificationScreenshot(req, res) {
  if (!verificationState.screenshotPath || !fs.existsSync(verificationState.screenshotPath)) {
    return res.status(404).json({ error: 'Không có ảnh xác minh.' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(verificationState.screenshotPath).pipe(res);
}

async function submitVerificationCode(req, res) {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập mã xác minh.' });
  }
  if (!verificationState.pending || !verificationState.page) {
    return res.status(400).json({ success: false, error: 'Hiện tại không có yêu cầu xác minh nào đang chờ.' });
  }

  try {
    const page = verificationState.page;
    const codeInput = page.locator(
      'input[name="approvals_code"], input[name="code"], input[type="number"], input[placeholder*="mã"], input[aria-label*="mã"], input[aria-label*="cụm từ"], input[type="text"]'
    ).first();

    await codeInput.fill(code.trim());
    await page.waitForTimeout(500);

    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("Tiếp tục"), button:has-text("Xác nhận"), button:has-text("Gửi"), [role="button"]:has-text("Tiếp tục"), [role="button"]:has-text("Xác nhận")'
    ).first();

    await submitBtn.click();
    console.log(`[FB-Login] Đã gửi mã xác minh: ${code.trim()}`);
    
    await page.waitForTimeout(2000);
    try { await page.screenshot({ path: verificationState.screenshotPath, fullPage: false }); } catch {}

    return res.json({ success: true, message: 'Mã xác minh đã được gửi.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Lỗi khi nhập mã: ' + err.message });
  }
}

async function handleVerificationClick(req, res) {
  const { x, y, viewportWidth, viewportHeight } = req.body;
  if (x === undefined || y === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu toạ độ click.' });
  }
  if (!verificationState.pending || !verificationState.page) {
    return res.status(400).json({ success: false, error: 'Không có phiên xác minh nào đang chờ.' });
  }

  try {
    const page = verificationState.page;
    const realX = Math.round((x / (viewportWidth || 1280)) * 1280);
    const realY = Math.round((y / (viewportHeight || 900)) * 900);

    await page.mouse.click(realX, realY);
    console.log(`[FB-Login] Click toạ độ (${realX}, ${realY})`);

    await page.waitForTimeout(1500);
    try { await page.screenshot({ path: verificationState.screenshotPath, fullPage: false }); } catch {}

    return res.json({ success: true, message: 'Đã click.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Lỗi click: ' + err.message });
  }
}

async function getFbAvatar(req, res) {
  try {
    const requestedUid = req.query.uid ? String(req.query.uid) : null;
    const avatar = await getFbAvatarService(requestedUid);
    
    if (avatar && avatar.bytes) {
      res.setHeader('Content-Type', avatar.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(avatar.bytes);
    }

    // Fallback
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${requestedUid || 'FB'}`;
    const https = require('https');
    https.get(fallbackUrl, (fallbackRes) => {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-cache');
      fallbackRes.pipe(res);
    }).on('error', () => {
      res.status(404).end();
    });
  } catch (err) {
    console.error('[Avatar] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function diagnoseCookies(req, res) {
  try {
    const diagnoses = await diagnoseCookiesService();
    return res.json({ success: true, diagnoses });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getConfig,
  saveConfig,
  fbLogin,
  getVerificationStatus,
  getVerificationScreenshot,
  submitVerificationCode,
  handleVerificationClick,
  getFbAvatar,
  diagnoseCookies,
};
