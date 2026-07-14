const { readConfig, writeConfig } = require('../services/configService');
const { clearUserCache } = require('../utils/extract-tokens');
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Trạng thái xác minh đang chờ (global)
const verificationState = {
  pending: false,
  page: null,
  screenshotPath: null,
  _lastSs: null,
};

// Bộ nhớ đệm lưu BYTES ảnh đại diện Facebook trực tiếp (tránh CDN URL hết hạn hoặc cần auth)
const memoryAvatarCache = {}; // { [uid]: { bytes: Buffer, contentType: string, expiresAt: number } }



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
  let lastLoggedPath = '';
  let lastLogTime = 0;
  let waitingForCode = false;

  while (Date.now() - startedAt < timeout) {
    const captchaVisible = await page
      .locator('iframe#captcha-recaptcha')
      .isVisible()
      .catch(() => false);

    if (captchaVisible && !captchaDetected) {
      captchaDetected = true;
      console.log('[FB-Login] Phát hiện reCAPTCHA checkbox. Đang tự động click...');

      // Tự động click checkbox trong iframe reCAPTCHA
      let captchaClicked = false;
      try {
        const captchaFrame = page.frameLocator('iframe#captcha-recaptcha');
        const checkbox = captchaFrame.locator('.recaptcha-checkbox-border, #recaptcha-anchor, .recaptcha-checkbox');
        await checkbox.first().click({ timeout: 5000 });
        captchaClicked = true;
        console.log('[FB-Login] Đã click checkbox reCAPTCHA. Đang chờ kết quả...');
        await page.waitForTimeout(3000);

        // Kiểm tra xem captcha đã pass chưa (checkbox có class checked)
        const stillVisible = await page.locator('iframe#captcha-recaptcha').isVisible().catch(() => false);
        if (!stillVisible) {
          console.log('[FB-Login] reCAPTCHA đã được giải thành công! Tiếp tục đăng nhập...');
          captchaDetected = false; // reset để tiếp tục luồng bình thường
        } else {
          // Có thể hiện challenge hình ảnh, chụp screenshot
          console.log('[FB-Login] reCAPTCHA yêu cầu thêm xác minh. Đang chờ...');
        }
      } catch (captchaErr) {
        console.log('[FB-Login] Không thể tự động click reCAPTCHA:', captchaErr.message);
      }

      // Nếu vẫn còn captcha, chụp ảnh và chờ
      if (captchaDetected && !waitingForCode) {
        waitingForCode = true;
        try {
          const ssDir = path.join(process.cwd(), 'storage');
          if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
          const ssPath = path.join(ssDir, 'fb-verification.png');
          await page.screenshot({ path: ssPath, fullPage: false });
          verificationState.pending = true;
          verificationState.page = page;
          verificationState.screenshotPath = ssPath;
          console.log('[FB-Login] Đã chụp màn hình CAPTCHA. Cửa sổ trình duyệt đã mở — hãy tương tác trực tiếp để giải CAPTCHA.');
        } catch (ssErr) {
          console.log('[FB-Login] Không thể chụp màn hình:', ssErr.message);
        }
      }
    }


    // Kiểm tra cookie đăng nhập
    const cookies = await context.cookies('https://www.facebook.com');
    const cUser = cookies.find(cookie => cookie.name === 'c_user');
    const xs = cookies.find(cookie => cookie.name === 'xs');

    if (cUser && xs) {
      verificationState.pending = false;
      verificationState.page = null;
      console.log('[FB-Login] Facebook đã tạo phiên đăng nhập.');
      return { success: true, captchaDetected, cookies };
    }

    const currentUrl = new URL(page.url());
    const isLoginPage = currentUrl.pathname.includes('/login');
    const isCheckpoint = currentUrl.pathname.includes('/checkpoint');
    const isVerification = currentUrl.pathname.includes('/two_step_verification');

    // Khi gặp trang xác minh OTP/checkpoint, chụp ảnh và lưu trạng thái để frontend hiển thị
    if ((isVerification || isCheckpoint) && !waitingForCode) {
      waitingForCode = true;
      try {
        const ssDir = path.join(process.cwd(), 'storage');
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        const ssPath = path.join(ssDir, 'fb-verification.png');
        await page.screenshot({ path: ssPath, fullPage: false });
        verificationState.pending = true;
        verificationState.page = page;
        verificationState.screenshotPath = ssPath;
        console.log('[FB-Login] Đã chụp màn hình xác minh. Đang chờ người dùng nhập mã từ giao diện...');
      } catch (ssErr) {
        console.log('[FB-Login] Không thể chụp màn hình:', ssErr.message);
      }
    }

    // Cập nhật screenshot mỗi 3 giây khi đang chờ
    if (waitingForCode && verificationState.screenshotPath) {
      const now2 = Date.now();
      if (!verificationState._lastSs || now2 - verificationState._lastSs > 3000) {
        verificationState._lastSs = now2;
        try { await page.screenshot({ path: verificationState.screenshotPath, fullPage: false }); } catch {}
      }
    }

    if (!captchaVisible && !isLoginPage && !isCheckpoint && !isVerification) {
      await page.waitForTimeout(2000);

      const updatedCookies = await context.cookies('https://www.facebook.com');
      const updatedCUser = updatedCookies.find(cookie => cookie.name === 'c_user');
      const updatedXs = updatedCookies.find(cookie => cookie.name === 'xs');

      if (updatedCUser && updatedXs) {
        verificationState.pending = false;
        verificationState.page = null;
        return { success: true, captchaDetected, cookies: updatedCookies };
      }
    }

    // Chỉ log khi URL thay đổi HOẶC đã qua 10 giây
    const now = Date.now();
    if (currentUrl.pathname !== lastLoggedPath || now - lastLogTime > 10000) {
      lastLoggedPath = currentUrl.pathname;
      lastLogTime = now;
      const elapsed = Math.floor((now - startedAt) / 1000);

      if (isVerification || isCheckpoint) {
        if (waitingForCode) {
          console.log(`[FB-Login] (${elapsed}s) Chờ người dùng nhập mã xác minh từ giao diện web.`);
        } else {
          console.log(`[FB-Login] (${elapsed}s) Đang chờ xác minh tại: ${currentUrl.pathname}`);
        }
      } else {
        console.log(`[FB-Login] (${elapsed}s) Đang chờ xác minh tại: ${currentUrl.pathname}`);
      }
    }

    await page.waitForTimeout(1000);
  }

  verificationState.pending = false;
  verificationState.page = null;

  const error = new Error(
    captchaDetected
      ? 'Hết thời gian chờ người dùng hoàn thành CAPTCHA.'
      : 'Hết thời gian chờ Facebook hoàn tất đăng nhập.'
  );
  error.code = captchaDetected ? 'FB_CAPTCHA_TIMEOUT' : 'FB_LOGIN_TIMEOUT';
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
    console.log('[FB-Login] Đang khởi động trình duyệt...');
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

// API: Lấy trạng thái xác minh
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

// API: Lấy ảnh chụp màn hình xác minh
async function getVerificationScreenshot(req, res) {
  if (!verificationState.screenshotPath || !fs.existsSync(verificationState.screenshotPath)) {
    return res.status(404).json({ error: 'Không có ảnh xác minh.' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(verificationState.screenshotPath).pipe(res);
}

// API: Nhập mã xác minh từ người dùng
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
    
    // Tìm các ô nhập mã (OTP thường là input type=text hoặc number)
    const codeInput = page.locator(
      'input[name="approvals_code"], input[name="code"], input[type="number"], input[placeholder*="mã"], input[aria-label*="mã"], input[aria-label*="cụm từ"], input[type="text"]'
    ).first();

    await codeInput.fill(code.trim());
    await page.waitForTimeout(500);

    // Click nút xác nhận
    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("Tiếp tục"), button:has-text("Xác nhận"), button:has-text("Gửi"), [role="button"]:has-text("Tiếp tục"), [role="button"]:has-text("Xác nhận")'
    ).first();

    await submitBtn.click();
    console.log(`[FB-Login] Người dùng đã nhập mã xác minh: ${code.trim()}. Đã gửi.`);
    
    // Cập nhật screenshot ngay sau khi gửi mã
    await page.waitForTimeout(2000);
    try { await page.screenshot({ path: verificationState.screenshotPath, fullPage: false }); } catch {}

    return res.json({ success: true, message: 'Mã xác minh đã được gửi. Đang chờ Facebook xử lý...' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Lỗi khi nhập mã: ' + err.message });
  }
}

// API: Click vào toạ độ trên màn hình trình duyệt ẩn (cho captcha hình ảnh)
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
    // Tính toạ độ thực tế trên viewport trình duyệt (1280x900)
    const realX = Math.round((x / (viewportWidth || 1280)) * 1280);
    const realY = Math.round((y / (viewportHeight || 900)) * 900);

    await page.mouse.click(realX, realY);
    console.log(`[FB-Login] Người dùng click toạ độ (${realX}, ${realY}) trên trình duyệt ẩn.`);

    await page.waitForTimeout(1500);
    // Cập nhật screenshot ngay sau click
    try { await page.screenshot({ path: verificationState.screenshotPath, fullPage: false }); } catch {}

    return res.json({ success: true, message: 'Đã click. Ảnh đang cập nhật...' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Lỗi click: ' + err.message });
  }
}

// API: Proxy ảnh avatar Facebook qua backend
// Hỗ trợ query param ?uid= để lấy đúng avatar theo từng tài khoản
async function getFbAvatar(req, res) {
  try {
    const config = await readConfig();
    const cookieRaw = config.cookie;
    if (!cookieRaw) {
      return res.status(404).json({ error: 'Chưa cấu hình cookie.' });
    }

    const cookieList = cookieRaw.split('\n').map(c => c.trim()).filter(Boolean);

    // Nếu client truyền ?uid=xxx thì tìm đúng cookie của uid đó, nếu không thì lấy tài khoản đầu tiên
    const requestedUid = req.query.uid ? String(req.query.uid) : null;
    let targetCookie = cookieList[0] || cookieRaw;

    if (requestedUid) {
      const found = cookieList.find(c => {
        const m = c.match(/c_user=(\d+)/);
        return m && m[1] === requestedUid;
      });
      if (found) targetCookie = found;
    }

    // Lấy UID từ cookie đã chọn
    const uidMatch = targetCookie.match(/c_user=(\d+)/);
    if (!uidMatch) {
      return res.status(404).json({ error: 'Không tìm thấy UID trong cookie.' });
    }
    const uid = uidMatch[1];
    console.log(`[Avatar] Request avatar uid=${uid}`);

    // Kiểm tra cache bytes trong bộ nhớ (cache lưu BYTES, không phải URL)
    const cache = memoryAvatarCache[uid];
    if (cache && cache.bytes && cache.expiresAt > Date.now()) {
      console.log(`[Avatar] Cache hit uid=${uid}, serving ${cache.bytes.length} bytes`);
      res.setHeader('Content-Type', cache.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cache.bytes);
    }

    console.log(`[Avatar] Cache miss uid=${uid}, fetching...`);
    // Thử lấy ảnh đồng bộ để phục vụ ngay (không chờ background)
    const fetched = await fetchAvatarBytes(targetCookie, uid);
    if (fetched) {
      console.log(`[Avatar] Fetched uid=${uid} OK, serving ${fetched.bytes.length} bytes`);
      res.setHeader('Content-Type', fetched.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(fetched.bytes);
    }

    // Fallback: trả về ảnh SVG Initials nếu không lấy được
    console.log(`[Avatar] Fallback to dicebear uid=${uid}`);
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${uid}`;
    const https = require('https');
    https.get(fallbackUrl, (fallbackRes) => {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-cache');
      fallbackRes.pipe(res);
    }).on('error', () => {
      res.status(404).end();
    });
  } catch (err) {
    console.error('[Avatar] Unhandled error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// Helper: Lấy bytes ảnh avatar THẬT từ Facebook và cache vào bộ nhớ
// ƯU TIÊN:
//   1. mbasic.facebook.com profile scrape (nhẹ nhất, cookie-authenticated, luôn trả ảnh thật)
//   2. Facebook homepage HTML scrape (extractTokens đã fetch HTML, tìm avatar trong đó)
//   3. Graph API redirect (chỉ dùng nếu kết quả > 5KB — bỏ qua ảnh silhouette mặc định 1876 bytes)
// Cache BYTES trực tiếp để tránh vấn đề CDN cần Cookie header
async function fetchAvatarBytes(cookie, uid) {
  // Nếu đã có cache bytes và chưa hết hạn, trả về luôn
  const cache = memoryAvatarCache[uid];
  if (cache && cache.bytes && cache.expiresAt > Date.now()) {
    return cache;
  }

  const axios = require('axios');
  const commonHeaders = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  // ─── Phương án 1: Scrape mbasic.facebook.com (nhẹ, nhanh, cookie-auth) ───
  try {
    console.log(`[Avatar-mbasic] uid=${uid} đang scrape mbasic.facebook.com...`);
    const mbasicRes = await axios.get(`https://mbasic.facebook.com/profile.php?id=${uid}`, {
      headers: commonHeaders,
      timeout: 10000,
      maxRedirects: 5
    });
    const html = typeof mbasicRes.data === 'string' ? mbasicRes.data : '';

    // Tìm URL ảnh đại diện trong HTML mbasic
    // mbasic profile picture thường nằm trong thẻ <img> với src chứa fbcdn.net
    // và có các pattern path đặc trưng cho profile picture
    const imgPatterns = [
      // Profile picture thumbnail trên mbasic
      /<img[^>]+src="(https?:\/\/[^"]*?scontent[^"]*?fbcdn\.net[^"]*?)"/gi,
      /<img[^>]+src="(https?:\/\/[^"]*?fbcdn\.net[^"]*?)"/gi,
    ];

    let avatarCdnUrl = null;
    for (const pattern of imgPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1].replace(/&amp;/g, '&');
        // Bỏ qua ảnh mặc định / icon nhỏ / emoji
        if (url.includes('static') || url.includes('rsrc.php') || url.includes('emoji')) continue;
        // Ưu tiên ảnh profile (chứa t39.30808-1 hoặc t1.30497-1)
        if (url.includes('/t39.30808-1/') || url.includes('/t1.30497-1/') || url.includes('/t39.30808-6/')) {
          avatarCdnUrl = url;
          break;
        }
        // Nếu chưa có, lưu URL fbcdn đầu tiên tìm được
        if (!avatarCdnUrl && url.includes('fbcdn.net')) {
          avatarCdnUrl = url;
        }
      }
      if (avatarCdnUrl && (avatarCdnUrl.includes('/t39.30808-1/') || avatarCdnUrl.includes('/t1.30497-1/'))) break;
    }

    if (avatarCdnUrl) {
      console.log(`[Avatar-mbasic] uid=${uid} tìm thấy URL: ${avatarCdnUrl.substring(0, 80)}...`);
      // Download bytes từ CDN (fbcdn.net URLs thường public, không cần cookie)
      const imgRes = await axios.get(avatarCdnUrl, {
        responseType: 'arraybuffer',
        timeout: 8000,
        maxRedirects: 5
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      if (imgRes.data && imgRes.data.byteLength > 500 && ct.includes('image')) {
        const result = {
          bytes: Buffer.from(imgRes.data),
          contentType: ct,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        memoryAvatarCache[uid] = result;
        console.log(`✅ [Avatar-mbasic] uid=${uid} OK (${result.bytes.length} bytes, ${ct})`);
        return result;
      }
    } else {
      console.log(`[Avatar-mbasic] uid=${uid} không tìm thấy URL ảnh trong HTML mbasic`);
    }
  } catch (mbasicErr) {
    console.error(`❌ [Avatar-mbasic] uid=${uid} lỗi:`, mbasicErr.message);
  }

  // ─── Phương án 2: Scrape facebook.com chính (nặng hơn nhưng đầy đủ) ──────
  try {
    console.log(`[Avatar-Homepage] uid=${uid} đang scrape facebook.com homepage...`);
    const fbRes = await axios.get('https://www.facebook.com/', {
      headers: {
        ...commonHeaders,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      maxRedirects: 5
    });
    const html = typeof fbRes.data === 'string' ? fbRes.data : '';

    // Trong HTML Facebook chính, ảnh avatar thường xuất hiện với pattern:
    // "profilePicLarge":{"uri":"https://..."} hoặc "profile_picture":{"uri":"..."}
    const jsonPatterns = [
      /"profilePicLarge"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/,
      /"profilePicMedium"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/,
      /"profilePic(?:ture)?"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/,
      /"profile_picture"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/,
    ];

    let avatarUrl = null;
    for (const pattern of jsonPatterns) {
      const match = html.match(pattern);
      if (match) {
        avatarUrl = match[1].replace(/\\\//g, '/');
        if (avatarUrl.includes('fbcdn.net') && !avatarUrl.includes('176159830277856')) {
          break;
        }
        avatarUrl = null;
      }
    }

    if (avatarUrl) {
      console.log(`[Avatar-Homepage] uid=${uid} tìm thấy URL: ${avatarUrl.substring(0, 80)}...`);
      const imgRes = await axios.get(avatarUrl, {
        responseType: 'arraybuffer',
        timeout: 8000,
        maxRedirects: 5
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      if (imgRes.data && imgRes.data.byteLength > 500 && ct.includes('image')) {
        const result = {
          bytes: Buffer.from(imgRes.data),
          contentType: ct,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        memoryAvatarCache[uid] = result;
        console.log(`✅ [Avatar-Homepage] uid=${uid} OK (${result.bytes.length} bytes)`);
        return result;
      }
    } else {
      console.log(`[Avatar-Homepage] uid=${uid} không tìm thấy URL ảnh trong HTML`);
    }
  } catch (homeErr) {
    console.error(`❌ [Avatar-Homepage] uid=${uid} lỗi:`, homeErr.message);
  }

  // ─── Phương án 3: Graph API redirect (chỉ dùng nếu ảnh > 5KB, bỏ ảnh mặc định) ──
  try {
    const graphUrl = `https://graph.facebook.com/${uid}/picture?type=large&width=200&height=200`;
    const imgRes = await axios.get(graphUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxRedirects: 5
    });
    const ct = imgRes.headers['content-type'] || 'image/jpeg';
    // Ảnh silhouette mặc định của Facebook chỉ ~1876 bytes
    // Ảnh thật thường > 5KB
    if (imgRes.data && imgRes.data.byteLength > 5000 && ct.includes('image')) {
      const result = {
        bytes: Buffer.from(imgRes.data),
        contentType: ct,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000
      };
      memoryAvatarCache[uid] = result;
      console.log(`✅ [Avatar-Graph] uid=${uid} OK (${result.bytes.length} bytes)`);
      return result;
    } else {
      console.log(`[Avatar-Graph] uid=${uid} ảnh mặc định/nhỏ (${imgRes.data?.byteLength} bytes), bỏ qua`);
    }
  } catch (graphErr) {
    console.error(`❌ [Avatar-Graph] uid=${uid} lỗi:`, graphErr.message);
  }

  // ─── Phương án 4: Playwright Scraper (Độ tin cậy cao nhất khi bị chặn HTTP) ──
  let browser = null;
  try {
    console.log(`[Avatar-Playwright] uid=${uid} đang khởi động browser để scrape...`);
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu', '--mute-audio', '--no-sandbox',
        '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'
      ]
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });

    // Inject cookie của đúng tài khoản
    const playwrightCookies = [];
    for (const part of cookie.split(';').map(p => p.trim())) {
      const eqPos = part.indexOf('=');
      if (eqPos > 0) {
        playwrightCookies.push({
          name: part.slice(0, eqPos), value: part.slice(eqPos + 1),
          domain: '.facebook.com', path: '/'
        });
      }
    }
    await context.addCookies(playwrightCookies);
    const page = await context.newPage();

    let avatarUrl = null;

    // Intercept network để bắt URL ảnh avatar thực tế từ phản hồi mạng
    const avatarUrlPromise = new Promise((resolve) => {
      page.on('response', async (response) => {
        const url = response.url();
        if (
          url.includes('fbcdn.net') &&
          (url.includes('/t39.30808-1/') || url.includes('/t1.30497-1/')) &&
          !avatarUrl
        ) {
          try {
            const body = await response.body();
            const ct = response.headers()['content-type'] || 'image/jpeg';
            if (body && body.length > 500 && ct.includes('image')) {
              avatarUrl = url;
              resolve({ bytes: body, contentType: ct });
            }
          } catch {}
        }
      });
      // Timeout sau 15 giây
      setTimeout(() => resolve(null), 15000);
    });

    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const intercepted = await avatarUrlPromise;
    if (intercepted) {
      const result = {
        bytes: Buffer.from(intercepted.bytes),
        contentType: intercepted.contentType,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000
      };
      memoryAvatarCache[uid] = result;
      console.log(`✅ [Avatar-Playwright-Intercept] uid=${uid} OK (${result.bytes.length} bytes)`);
      return result;
    }

    // Nếu không bắt được qua network intercept, thử định vị bằng selectors
    const selectors = [
      'div[role="banner"] div[role="button"] img[src*="fbcdn"]',
      'div[aria-label*="Trang cá nhân"] img[src*="fbcdn"]',
      'div[aria-label*="Your profile"] img[src*="fbcdn"]',
      'img[src*="fbcdn.net/v/t39.30808-1"]'
    ];
    for (const selector of selectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        const src = await el.getAttribute('src');
        if (src && src.includes('fbcdn.net') && !src.includes('176159830277856')) {
          avatarUrl = src;
          break;
        }
      }
    }
    if (avatarUrl) {
      // Download bytes với cookie header
      const imgRes = await axios.get(avatarUrl, {
        headers: { 'Cookie': cookie },
        responseType: 'arraybuffer',
        timeout: 8000
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      if (imgRes.data && imgRes.data.byteLength > 500) {
        const result = {
          bytes: Buffer.from(imgRes.data),
          contentType: ct,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        memoryAvatarCache[uid] = result;
        console.log(`✅ [Avatar-Playwright-Selector] uid=${uid} OK (${result.bytes.length} bytes)`);
        return result;
      }
    }

    console.warn(`⚠️ [Avatar-Playwright] uid=${uid} không tìm thấy ảnh avatar.`);
  } catch (err) {
    console.error(`❌ [Avatar-Playwright] uid=${uid} lỗi:`, err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  console.warn(`⚠️ [Avatar] uid=${uid} không lấy được ảnh đại diện bằng bất kỳ phương án nào.`);
  return null;
}


async function diagnoseCookies(req, res) {
  try {
    const config = await readConfig();
    const cookie = config.cookie;
    if (!cookie) {
      return res.json({ success: true, diagnoses: [] });
    }

    const cookieList = cookie.split('\n').map(c => c.trim()).filter(Boolean);
    const diagnoses = [];

    const facebookService = require('../services/facebookService');
    const { extractTokens } = require('../utils/extract-tokens');

    for (let i = 0; i < cookieList.length; i++) {
      const singleCookie = cookieList[i];
      const uidMatch = singleCookie.match(/c_user=(\d+)/);
      const uid = uidMatch ? uidMatch[1] : `Unknown-${i + 1}`;

      if (!uidMatch) {
        diagnoses.push({
          uid,
          status: 'invalid',
          error: 'Thiếu cookie c_user',
          pagesCount: 0
        });
        continue;
      }

      try {
        const tokens = await extractTokens(singleCookie);
        if (!tokens.success) {
          diagnoses.push({
            uid,
            status: 'expired',
            error: tokens.error || 'Lỗi trích xuất token',
            pagesCount: 0
          });
          continue;
        }

        // Gọi thử lấy trang để xác minh cookie hoạt động
        const pages = await facebookService.getPages(singleCookie);
        diagnoses.push({
          uid,
          status: 'active',
          pagesCount: pages.length
        });
      } catch (err) {
        diagnoses.push({
          uid,
          status: 'expired',
          error: err.message,
          pagesCount: 0
        });
      }
    }

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


