const { readConfig, writeConfig } = require('../services/configService');
const { clearUserCache } = require('../utils/extract-tokens');
const { chromium } = require('playwright');
const crypto = require('crypto');

// Base32 decoding helper
function base32Decode(base32) {
  base32 = base32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i]);
    if (val === -1) throw new Error('Ký tự Base32 không hợp lệ: ' + base32[i]);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Generate 6-digit TOTP code
function generateTOTP(secret) {
  try {
    const key = base32Decode(secret);
    const epoch = Math.round(Date.now() / 1000);
    const time = Buffer.alloc(8);
    const counter = Math.floor(epoch / 30);
    time.writeUInt32BE(0, 0);
    time.writeUInt32BE(counter, 4);
    
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(time);
    const hmacResult = hmac.digest();
    
    const offset = hmacResult[hmacResult.length - 1] & 0xf;
    const binary = ((hmacResult[offset] & 0x7f) << 24) |
                   ((hmacResult[offset + 1] & 0xff) << 16) |
                   ((hmacResult[offset + 2] & 0xff) << 8) |
                   (hmacResult[offset + 3] & 0xff);
    
    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  } catch (err) {
    console.error('Lỗi generate TOTP:', err.message);
    return null;
  }
}

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
    clearUserCache(); // Clear in-memory tokens cache so the new cookie takes effect instantly
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

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--mute-audio',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      locale: 'vi-VN',
      viewport: { width: 375, height: 812 }
    });
    const page = await context.newPage();

    // 1. Navigate to mbasic login screen
    await page.goto('https://mbasic.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2. Fill login details
    await page.fill('input[name="email"]', username);
    await page.fill('input[name="pass"]', password);
    await page.click('input[type="submit"], input[name="login"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });

    // 3. Handle 2FA prompt
    let url = page.url();
    if (url.includes('checkpoint') || (await page.locator('input[name="approvals_code"]').count()) > 0) {
      if (!twoFactorSecret) {
        throw new Error('Tài khoản yêu cầu xác thực 2 lớp. Vui lòng điền mã khóa 2FA.');
      }
      const otpCode = generateTOTP(twoFactorSecret);
      if (!otpCode) {
        throw new Error('Không thể tạo mã OTP từ mã khóa 2FA đã nhập.');
      }
      await page.fill('input[name="approvals_code"]', otpCode);
      await page.click('input[type="submit"], input[name="submit[Submit Code]"]');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });

      // Save browser option if prompted
      if (page.url().includes('checkpoint') && (await page.locator('input[value="save_device"]').count()) > 0) {
        await page.check('input[value="save_device"]');
        await page.click('input[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      }

      // Checkpoint continue checks
      let continueBtn = page.locator('input[type="submit"], input[name="submit[Continue]"]');
      let limit = 0;
      while (page.url().includes('checkpoint') && (await continueBtn.count()) > 0 && limit < 5) {
        await continueBtn.first().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
        limit++;
      }
    }

    // 4. Retrieve cookies
    const cookies = await context.cookies();
    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    if (!cUser || !xs) {
      if (page.url().includes('checkpoint')) {
        throw new Error('Tài khoản bị yêu cầu phê duyệt checkpoint. Vui lòng tự đăng nhập trên trình duyệt để xác minh.');
      }
      throw new Error('Đăng nhập thất bại. Vui lòng kiểm tra lại tài khoản, mật khẩu hoặc mã khóa 2FA.');
    }

    // Format cookie string
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Save config & clear cache
    await writeConfig(cookieString);
    clearUserCache();

    return res.json({ success: true, cookie: cookieString });

  } catch (error) {
    console.error('Playwright auto-login error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  getConfig,
  saveConfig,
  fbLogin
};
