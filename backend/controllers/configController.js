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

async function waitForFacebookAuthentication(page, context) {
  const timeout = 300000;
  const startedAt = Date.now();

  let captchaDetected = false;

  while (Date.now() - startedAt < timeout) {
    const captchaVisible = await page
      .locator('iframe#captcha-recaptcha')
      .isVisible()
      .catch(() => false);

    if (captchaVisible && !captchaDetected) {
      captchaDetected = true;

      console.log(
        '[FB-Login] Facebook yêu cầu CAPTCHA hình ảnh.'
      );

      console.log(
        '[FB-Login] Hãy tự hoàn thành CAPTCHA trong cửa sổ trình duyệt.'
      );

      await page.bringToFront();
    }

    const cookies = await context.cookies(
      'https://www.facebook.com'
    );

    const cUser = cookies.find(
      cookie => cookie.name === 'c_user'
    );

    const xs = cookies.find(
      cookie => cookie.name === 'xs'
    );

    if (cUser && xs) {
      console.log(
        '[FB-Login] Facebook đã tạo phiên đăng nhập.'
      );

      return {
        success: true,
        captchaDetected,
        cookies,
      };
    }

    const currentUrl = new URL(page.url());

    const isLoginPage =
      currentUrl.pathname.includes('/login');

    const isCheckpoint =
      currentUrl.pathname.includes('/checkpoint');

    const isVerification =
      currentUrl.pathname.includes(
        '/two_step_verification'
      );

    if (
      !captchaVisible &&
      !isLoginPage &&
      !isCheckpoint &&
      !isVerification
    ) {
      await page.waitForTimeout(2000);

      const updatedCookies =
        await context.cookies(
          'https://www.facebook.com'
        );

      const updatedCUser =
        updatedCookies.find(
          cookie => cookie.name === 'c_user'
        );

      const updatedXs =
        updatedCookies.find(
          cookie => cookie.name === 'xs'
        );

      if (updatedCUser && updatedXs) {
        return {
          success: true,
          captchaDetected,
          cookies: updatedCookies,
        };
      }
    }

    console.log(
      '[FB-Login] Đang chờ xác minh tại:',
      currentUrl.pathname
    );

    await page.waitForTimeout(1000);
  }

  const error = new Error(
    captchaDetected
      ? 'Hết thời gian chờ người dùng hoàn thành CAPTCHA.'
      : 'Hết thời gian chờ Facebook hoàn tất đăng nhập.'
  );

  error.code = captchaDetected
    ? 'FB_CAPTCHA_TIMEOUT'
    : 'FB_LOGIN_TIMEOUT';

  throw error;
}

async function fbLogin(req, res) {
  const { username, password, twoFactorSecret } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tài khoản và mật khẩu Facebook.' });
  }

  console.log(`[FB-Login] Bắt đầu tiến trình đăng nhập cho tài khoản: ${username}`);
  
  const email = username;
  const path = require('path');
  const profilePath = path.resolve(process.cwd(), 'storage/facebook-browser-profile');
  
  let context = null;
  try {
    console.log('[FB-Login] Đang khởi động trình duyệt giả lập với Persistent Context...');
    context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-gpu',
        '--mute-audio',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      viewport: { width: 1280, height: 900 }
    });

    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    console.log('[FB-Login] Đang điều hướng đến trang facebook.com...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1. Kiểm tra xem phiên cũ đã đăng nhập sẵn chưa (cơ chế Persistent Context có thể giữ session)
    const initialCookies = await context.cookies('https://www.facebook.com');
    const hasCUser = initialCookies.find(c => c.name === 'c_user');
    const hasXs = initialCookies.find(c => c.name === 'xs');

    if (hasCUser && hasXs) {
      console.log(`[FB-Login] Trình duyệt đã đăng nhập sẵn! c_user = ${hasCUser.value}`);
      const cookieString = initialCookies.map(c => `${c.name}=${c.value}`).join('; ');
      
      await writeConfig(cookieString);
      clearUserCache();
      
      console.log('[FB-Login] Đã tự động nhận diện và lưu cấu hình cookie từ phiên cũ.');
      return res.json({ success: true, cookie: cookieString });
    }

    console.log('[FB-Login] Đang kiểm tra hộp thoại Cookie Consent...');
    try {
      const cookieAcceptBtn = page.locator('button[data-cookiebanner="accept_button"], button[data-testid="cookie-policy-manage-dialog-accept-button"]');
      if (await cookieAcceptBtn.count() > 0) {
        console.log('[FB-Login] Phát hiện banner chấp nhận Cookie. Đang click đồng ý...');
        await cookieAcceptBtn.first().click();
        await page.waitForTimeout(1000);
      } else {
        console.log('[FB-Login] Không phát hiện banner Cookie.');
      }
    } catch (e) {
      console.log('[FB-Login] Lỗi khi xử lý banner Cookie:', e.message);
    }

    console.log('[FB-Login] Đang điền thông tin đăng nhập (email và password)...');
    
    // Đợi ô nhập email xuất hiện (giới hạn 10s đề phòng trường hợp tải chậm hoặc tự động đăng nhập sau chuyển hướng)
    const emailInput = page.locator('input[name="email"]');
    let loginResult;
    try {
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await emailInput.fill(email);
      await page.locator('input[name="pass"]').fill(password);

      console.log('[FB-Login] Đang tìm kiếm nút Đăng nhập...');
      const loginButton = page.getByRole('button', {
        name: 'Đăng nhập',
        exact: true,
      });

      if (await loginButton.isVisible().catch(() => false)) {
        await loginButton.click();
      } else {
        await page.locator('input[name="pass"]').press('Enter');
      }

      console.log('[FB-Login] Bắt đầu luồng kiểm tra và chờ xác thực...');
      loginResult = await waitForFacebookAuthentication(page, context);
    } catch (e) {
      // Nếu không tìm thấy ô nhập email, kiểm tra lại cookie lần cuối để xem đã tự đăng nhập thành công hay chưa
      const checkCookies = await context.cookies('https://www.facebook.com');
      const finalCUser = checkCookies.find(c => c.name === 'c_user');
      const finalXs = checkCookies.find(c => c.name === 'xs');
      
      if (finalCUser && finalXs) {
        console.log(`[FB-Login] Phát hiện đã đăng nhập tự động thành công! c_user = ${finalCUser.value}`);
        loginResult = {
          success: true,
          cookies: checkCookies
        };
      } else {
        // Nếu thực sự chưa đăng nhập và không thấy ô nhập email, quăng lỗi
        throw new Error('Không tìm thấy giao diện đăng nhập Facebook (có thể trang bị chuyển hướng hoặc chặn block).');
      }
    }

    const safeUrl = new URL(page.url());
    console.log('[FB-Login] Trang hiện tại:', safeUrl.pathname);

    const cUser = loginResult.cookies.find(cookie => cookie.name === 'c_user');
    const xs = loginResult.cookies.find(cookie => cookie.name === 'xs');

    if (!cUser || !xs) {
      const error = new Error('Facebook chưa tạo phiên đăng nhập hoàn chỉnh.');
      error.code = 'FB_LOGIN_NOT_COMPLETED';
      throw error;
    }

    console.log(`[FB-Login] Đăng nhập thành công! c_user = ${cUser.value}`);
    const cookieString = loginResult.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    await writeConfig(cookieString);
    clearUserCache();

    console.log('[FB-Login] Đã lưu cấu hình cookie thành công.');
    return res.json({ success: true, cookie: cookieString });

  } catch (error) {
    console.error('[FB-Login ERROR] Chi tiết lỗi đăng nhập:', error);
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
  } finally {
    if (context) {
      console.log('[FB-Login] Đang đóng trình duyệt giả lập...');
      await context.close();
    }
  }
}

module.exports = {
  getConfig,
  saveConfig,
  fbLogin
};
