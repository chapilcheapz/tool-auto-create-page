const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readConfig, writeConfig } = require('./configService');
const { clearUserCache, extractTokens } = require('../utils/extract-tokens');

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

async function waitForFacebookAuthentication(page, context) {
  const timeout = 300000;
  const startedAt = Date.now();

  let captchaDetected = false;
  let lastLoggedPath = '';
  let lastLogTime = 0;

  while (Date.now() - startedAt < timeout) {
    // Tìm kiếm frame chứa reCAPTCHA Checkbox (đường dẫn chứa /anchor)
    const anchorFrame = page.frames().find(f => 
      f.url().includes('google.com/recaptcha/api2/anchor') || 
      f.url().includes('google.com/recaptcha/enterprise/anchor')
    );
    const captchaVisible = !!anchorFrame;

    if (anchorFrame && !captchaDetected) {
      captchaDetected = true;
      console.log('[FB-Login] Phát hiện reCAPTCHA checkbox. Đang tự động click...');

      try {
        // Các selector phổ biến của ô tick reCAPTCHA
        const checkboxSelector = '.recaptcha-checkbox-border, #recaptcha-anchor, .recaptcha-checkbox';
        const checkbox = anchorFrame.locator(checkboxSelector).first();
        
        await checkbox.waitFor({ state: 'visible', timeout: 5000 });
        
        // Di chuyển chuột nhẹ và click
        await checkbox.hover();
        await page.waitForTimeout(800 + Math.random() * 500); // Đợi ngẫu nhiên 0.8s - 1.3s
        await checkbox.click(); // Bỏ force: true vì dễ bị Google bắt bài
        
        console.log('[FB-Login] Đã click checkbox reCAPTCHA. Đang chờ kết quả...');
        await page.waitForTimeout(4000);

        // Kiểm tra xem checkbox đã được tick chưa (có class recaptcha-checkbox-checked)
        const isChecked = await anchorFrame.evaluate(() => {
          const cb = document.querySelector('#recaptcha-anchor');
          return cb ? cb.getAttribute('aria-checked') === 'true' : false;
        }).catch(() => false);

        if (isChecked) {
          console.log('[FB-Login] reCAPTCHA đã được giải thành công! Tiếp tục đăng nhập...');
          captchaDetected = false;
        } else {
          console.log('[FB-Login] reCAPTCHA yêu cầu xác minh thêm. Đang chuyển sang Audio Challenge...');
          
          // Đợi 2 giây để Google load challenge bframe
          await page.waitForTimeout(2000);

          // Tìm challenge frame chứa hình ảnh/âm thanh (đường dẫn chứa /bframe)
          const challengeFrame = page.frames().find(f => 
            f.url().includes('google.com/recaptcha/api2/bframe') || 
            f.url().includes('google.com/recaptcha/enterprise/bframe')
          );

          if (challengeFrame) {
            // Click nút chuyển sang chế độ Audio (ID thường là #recaptcha-audio-button)
            const audioBtn = challengeFrame.locator('#recaptcha-audio-button').first();
            if (await audioBtn.isVisible().catch(() => false)) {
              await audioBtn.hover();
              await page.waitForTimeout(1000 + Math.random() * 1000); // Thêm độ trễ giống người
              await audioBtn.click();
              console.log('[FB-Login] Đã click chuyển sang Audio Challenge.');
              await page.waitForTimeout(3000);

              // Tìm nút tải xuống MP3
              const downloadLink = challengeFrame.locator('.rc-audiochallenge-tdownload-link').first();
              if (await downloadLink.isVisible().catch(() => false)) {
                const audioUrl = await downloadLink.getAttribute('href');
                console.log('[FB-Login] Tìm thấy link tải audio MP3:', audioUrl);
                
                // Click vào nút tải xuống (sẽ mở tab mới hoặc tải về tùy cấu hình browser)
                console.log('[FB-Login] Đã click nút tải xuống audio.');
                
                try {
                  // Gửi request lấy audio buffer
                  const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
                  const audioBuffer = Buffer.from(audioResponse.data);
                  console.log('[FB-Login] Đã tải xong file MP3. Đang gửi lên wit.ai để giải mã...');

                  const witAiToken = process.env.WIT_AI_TOKEN;
                  if (!witAiToken) {
                    console.log('[FB-Login] Lỗi: Chưa cấu hình WIT_AI_TOKEN trong file .env. Vui lòng thêm WIT_AI_TOKEN=your_token để sử dụng tính năng giải audio.');
                    return;
                  }
                  
                  const witResponse = await axios.post('https://api.wit.ai/speech', audioBuffer, {
                    headers: {
                      'Authorization': `Bearer ${witAiToken}`,
                      'Content-Type': 'audio/mpeg3',
                      'Accept': 'application/vnd.wit.20200513+json'
                    }
                  });

                  // Trích xuất text (wit.ai có thể trả về NDJSON, lấy chunk cuối cùng hoặc trường 'text')
                  let solvedText = '';
                  if (typeof witResponse.data === 'string') {
                    const lines = witResponse.data.split('\n').filter(l => l.trim() !== '');
                    const lastLine = JSON.parse(lines[lines.length - 1]);
                    solvedText = lastLine.text;
                  } else {
                    solvedText = witResponse.data.text;
                  }

                  if (solvedText && solvedText.trim() !== '') {
                    console.log(`[FB-Login] Giải mã âm thanh thành công. Kết quả: "${solvedText}"`);
                    
                    // Điền kết quả vào ô input và nhấn Verify
                    const audioInput = challengeFrame.locator('#audio-response').first();
                    await audioInput.fill(solvedText.trim());
                    await page.waitForTimeout(1000);
                    
                    const verifyBtn = challengeFrame.locator('#recaptcha-verify-button').first();
                    await verifyBtn.click();
                    console.log('[FB-Login] Đã submit kết quả audio.');
                    await page.waitForTimeout(3000);
                  } else {
                     console.log('[FB-Login] Wit.ai không nhận diện được giọng nói trong file audio.');
                  }
                } catch (audioErr) {
                  console.log('[FB-Login] Lỗi trong quá trình giải mã audio:', audioErr.message);
                }
              } else {
                console.log('[FB-Login] Không tìm thấy nút tải xuống audio (có thể bị chặn IP hoặc bắt giải captcha hình ảnh bắt buộc).');
              }
            } else {
              console.log('[FB-Login] Không tìm thấy nút chuyển đổi Audio (có thể giao diện đã thay đổi hoặc bị chặn tạm thời).');
            }
          } else {
            console.log('[FB-Login] Không tìm thấy challenge bframe của reCAPTCHA.');
          }
        }
      } catch (captchaErr) {
        console.log('[FB-Login] Không thể click reCAPTCHA:', captchaErr.message);
      }
    }

    // Kiểm tra cookie đăng nhập
    const cookies = await context.cookies('https://www.facebook.com');

    // --- Bổ sung xử lý FunCaptcha / Arkose Labs (Thử thách âm thanh) ---
    // Dump mã HTML của trang hiện tại và các iframe con để phân tích DOM
    try {
      const pageHtml = await page.content();
      if (pageHtml.includes('MatchKey của Arkose Labs') || pageHtml.includes('Chọn thử thách âm thanh')) {
        let fullHtml = `<!-- PAGE URL: ${page.url()} -->\n` + pageHtml;
        for (const frame of page.frames()) {
          try {
            fullHtml += `\n\n<!-- IFRAME URL: ${frame.url()} -->\n`;
            fullHtml += await frame.content();
          } catch(e) {}
        }
        const dumpPath = path.join(process.cwd(), 'storage', 'funcaptcha_source.html');
        fs.writeFileSync(dumpPath, fullHtml);
        console.log(`[FB-Login] Đã phát hiện FunCaptcha! Đã tải và lưu toàn bộ Source Code ra file: ${dumpPath} để phân tích.`);
        
        // Ngủ đông 10s để tránh spam lưu liên tục
        await page.waitForTimeout(10000);
      }
    } catch(e) {}
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

    const now = Date.now();
    if (currentUrl.pathname !== lastLoggedPath || now - lastLogTime > 10000) {
      lastLoggedPath = currentUrl.pathname;
      lastLogTime = now;
      const elapsed = Math.floor((now - startedAt) / 1000);

      console.log(`[FB-Login] (${elapsed}s) Đang chờ xác minh tại: ${currentUrl.pathname}`);
    }

    // [LIVE VIEW]: Chụp ảnh màn hình liên tục mỗi 2 giây để frontend stream thành dạng "video"
    if (now - (verificationState._lastSs || 0) > 2000) {
      try {
        // Lưu ảnh đè lên checkpoint.png liên tục
        const screenshotPath = path.join(process.cwd(), 'frontend', 'public', 'checkpoint.png');
        await page.screenshot({ path: screenshotPath });
        
        // Cập nhật URL có biến t=now để frontend bỏ qua cache trình duyệt và load ảnh mới
        verificationState.screenshotPath = screenshotPath;
        verificationState.pending = true;
        verificationState._lastSs = now;
      } catch (ssErr) {
        // Bỏ qua lỗi chụp ảnh nếu trang đang load hoặc bị đóng
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

// Thực hiện đăng nhập Facebook bằng Playwright
async function fbLoginService(username, password, twoFactorSecret, proxyString) {
  console.log(`[FB-Login] Bắt đầu tiến trình đăng nhập cho tài khoản: ${username}${proxyString ? ` (kèm Proxy)` : ''}`);
  
  const email = username;
  const profilePath = path.resolve(process.cwd(), 'storage/facebook-browser-profile');
  
  let context = null;
  try {
    console.log('[FB-Login] Đang khởi động trình duyệt...');
    
    const launchOptions = {
      headless: true ,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-gpu',
        '--mute-audio',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      viewport: { width: 1280, height: 900 }
    };

    // Xử lý chuỗi Proxy (IP:Port hoặc IP:Port:User:Pass) hoặc API Key
    let actualProxyString = proxyString;
    if (proxyString && typeof proxyString === 'string') {
      const trimmedProxy = proxyString.trim();
      
      // Nếu là API Key (không chứa dấu hai chấm)
      if (!trimmedProxy.includes(':')) {
        console.log(`[FB-Login] Nhận diện API Key Proxy xoay (CKey.vn). Đang lấy proxy mới...`);
        try {
          const proxyApiUrl = `https://ckey.vn/api/getproxyxoay?keyproxy=${trimmedProxy}&nhamang=random&tinhthanh=0`;
          const proxyRes = await axios.get(proxyApiUrl);
          if (proxyRes.data && proxyRes.data.status === 100) {
             actualProxyString = proxyRes.data.proxyhttp;
             // Xóa bỏ các dấu : thừa ở cuối nếu không có User/Pass (VD: 160.250.166.33:10694:: -> 160.250.166.33:10694)
             actualProxyString = actualProxyString.replace(/:+$/, ''); 
             console.log(`[FB-Login] Lấy proxy thành công từ CKey: ${actualProxyString}`);
          } else {
             console.log(`[FB-Login] Lỗi lấy proxy từ CKey: ${proxyRes.data ? proxyRes.data.message : 'Unknown'}`);
             actualProxyString = null;
          }
        } catch (e) {
           console.log(`[FB-Login] Lỗi gọi API CKey: ${e.message}`);
           actualProxyString = null;
        }
      }

      if (actualProxyString) {
        const parts = actualProxyString.split(':');
        if (parts.length >= 2) {
          const host = parts[0];
          const port = parts[1];
          launchOptions.proxy = { server: `http://${host}:${port}` };
          
          // Nếu có User:Pass (độ dài >= 4 và không rỗng)
          if (parts.length >= 4 && parts[2] && parts[3]) {
            launchOptions.proxy.username = parts[2];
            launchOptions.proxy.password = parts[3];
          }
          console.log(`[FB-Login] Cấu hình Proxy cho trình duyệt: ${host}:${port}`);
        }
      }
    }

    context = await chromium.launchPersistentContext(profilePath, launchOptions);

    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    // [Tối đa Stealth] Tiêm script vào mọi trang web trước khi tải để ẩn hoàn toàn cờ tự động hoá
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    console.log('[FB-Login] Đang điều hướng đến trang facebook.com...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1. Kiểm tra xem phiên cũ đã đăng nhập sẵn chưa
    const initialCookies = await context.cookies('https://www.facebook.com');
    const hasCUser = initialCookies.find(c => c.name === 'c_user');
    const hasXs = initialCookies.find(c => c.name === 'xs');

    if (hasCUser && hasXs) {
      console.log(`[FB-Login] Trình duyệt đã đăng nhập sẵn! c_user = ${hasCUser.value}`);
      const cookieString = initialCookies.map(c => `${c.name}=${c.value}`).join('; ');
      
      await writeConfig(cookieString);
      clearUserCache();
      
      console.log('[FB-Login] Đã tự động nhận diện và lưu cấu hình cookie từ phiên cũ.');
      return { success: true, cookie: cookieString };
    }

    console.log('[FB-Login] Đang kiểm tra hộp thoại Cookie Consent...');
    try {
      const cookieAcceptBtn = page.locator('button[data-cookiebanner="accept_button"], button[data-testid="cookie-policy-manage-dialog-accept-button"]');
      if (await cookieAcceptBtn.count() > 0) {
        console.log('[FB-Login] Phát hiện banner chấp nhận Cookie. Đang click đồng ý...');
        await cookieAcceptBtn.first().click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log('[FB-Login] Lỗi khi xử lý banner Cookie:', e.message);
    }

    console.log('[FB-Login] Đang điền thông tin đăng nhập (email và password)...');
    
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

      // Xử lý điền 2FA tự động trước khi chạy luồng chờ xác minh nếu có cấu hình
      if (twoFactorSecret) {
        console.log('[FB-Login] Đang tạo mã OTP 2FA tự động...');
        const otpCode = generateTOTP(twoFactorSecret);
        if (otpCode) {
          console.log(`[FB-Login] Mã OTP tạo ra: ${otpCode}. Đang kiểm tra trang OTP...`);
          
          // Chờ trang OTP tải và điền mã tự động
          try {
            await page.waitForURL(url => url.includes('/two_step_verification') || url.includes('/checkpoint'), { timeout: 15000 });
            console.log('[FB-Login] Đã phát hiện trang xác thực 2FA. Đang tự động nhập OTP...');
            
            const codeInput = page.locator(
              'input[name="approvals_code"], input[name="code"], input[type="number"], input[type="text"]'
            ).first();
            await codeInput.waitFor({ state: 'visible', timeout: 5000 });
            await codeInput.fill(otpCode);
            await page.waitForTimeout(500);

            const submitBtn = page.locator(
              'button[type="submit"], button:has-text("Tiếp tục"), button:has-text("Xác nhận"), button:has-text("Gửi")'
            ).first();
            await submitBtn.click();
            console.log('[FB-Login] Đã submit mã 2FA tự động.');
            await page.waitForTimeout(3000);
          } catch (otpErr) {
            console.log('[FB-Login] Không thể điền OTP tự động hoặc trang 2FA chưa xuất hiện:', otpErr.message);
          }
        }
      }

      console.log('[FB-Login] Bắt đầu luồng kiểm tra và chờ xác thực...');
      loginResult = await waitForFacebookAuthentication(page, context);
    } catch (e) {
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
    return { success: true, cookie: cookieString, c_user: cUser.value };

  } finally {
    if (context) {
      console.log('[FB-Login] Đang đóng trình duyệt giả lập...');
      await context.close();
    }
  }
}

// Proxy lấy avatar Facebook và quản lý cache
async function getFbAvatarService(requestedUid) {
  const config = await readConfig();
  const cookieRaw = config.cookie;
  if (!cookieRaw) {
    throw new Error('Chưa cấu hình cookie.');
  }

  const cookieList = cookieRaw.split('\n').map(c => c.trim()).filter(Boolean);
  let targetCookie = cookieList[0] || cookieRaw;

  if (requestedUid) {
    const found = cookieList.find(c => {
      const m = c.match(/c_user=(\d+)/);
      return m && m[1] === requestedUid;
    });
    if (found) targetCookie = found;
  }

  const uidMatch = targetCookie.match(/c_user=(\d+)/);
  if (!uidMatch) {
    throw new Error('Không tìm thấy UID trong cookie.');
  }
  const uid = uidMatch[1];
  console.log(`[Avatar] Request avatar uid=${uid}`);

  const cache = memoryAvatarCache[uid];
  if (cache && cache.bytes && cache.expiresAt > Date.now()) {
    console.log(`[Avatar] Cache hit uid=${uid}`);
    return cache;
  }

  console.log(`[Avatar] Cache miss uid=${uid}, fetching...`);
  const fetched = await fetchAvatarBytes(targetCookie, uid);
  if (fetched) {
    return fetched;
  }

  return null;
}

// Cào bytes avatar của tài khoản
async function fetchAvatarBytes(cookie, uid) {
  const cache = memoryAvatarCache[uid];
  if (cache && cache.bytes && cache.expiresAt > Date.now()) {
    return cache;
  }

  const commonHeaders = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  // Phương án 1: Scrape mbasic
  try {
    const mbasicRes = await axios.get(`https://mbasic.facebook.com/profile.php?id=${uid}`, {
      headers: commonHeaders,
      timeout: 10000,
      maxRedirects: 5
    });
    const html = typeof mbasicRes.data === 'string' ? mbasicRes.data : '';
    const imgPatterns = [
      /<img[^>]+src="(https?:\/\/[^"]*?scontent[^"]*?fbcdn\.net[^"]*?)"/gi,
      /<img[^>]+src="(https?:\/\/[^"]*?fbcdn\.net[^"]*?)"/gi,
    ];

    let avatarCdnUrl = null;
    for (const pattern of imgPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1].replace(/&amp;/g, '&');
        if (url.includes('static') || url.includes('rsrc.php') || url.includes('emoji')) continue;
        if (url.includes('/t39.30808-1/') || url.includes('/t1.30497-1/') || url.includes('/t39.30808-6/')) {
          avatarCdnUrl = url;
          break;
        }
        if (!avatarCdnUrl && url.includes('fbcdn.net')) {
          avatarCdnUrl = url;
        }
      }
      if (avatarCdnUrl && (avatarCdnUrl.includes('/t39.30808-1/') || avatarCdnUrl.includes('/t1.30497-1/'))) break;
    }

    if (avatarCdnUrl) {
      const imgRes = await axios.get(avatarCdnUrl, {
        responseType: 'arraybuffer',
        timeout: 8000
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      if (imgRes.data && imgRes.data.byteLength > 500 && ct.includes('image')) {
        const result = {
          bytes: Buffer.from(imgRes.data),
          contentType: ct,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        memoryAvatarCache[uid] = result;
        return result;
      }
    }
  } catch (mbasicErr) {
    console.error(`❌ [Avatar-mbasic] uid=${uid} lỗi:`, mbasicErr.message);
  }

  // Phương án 2: Scrape Homepage
  try {
    const fbRes = await axios.get('https://www.facebook.com/', {
      headers: {
        ...commonHeaders,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      maxRedirects: 5
    });
    const html = typeof fbRes.data === 'string' ? fbRes.data : '';
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
      const imgRes = await axios.get(avatarUrl, {
        responseType: 'arraybuffer',
        timeout: 8000
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      if (imgRes.data && imgRes.data.byteLength > 500 && ct.includes('image')) {
        const result = {
          bytes: Buffer.from(imgRes.data),
          contentType: ct,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        memoryAvatarCache[uid] = result;
        return result;
      }
    }
  } catch (homeErr) {
    console.error(`❌ [Avatar-Homepage] uid=${uid} lỗi:`, homeErr.message);
  }

  // Phương án 3: Graph API
  try {
    const graphUrl = `https://graph.facebook.com/${uid}/picture?type=large&width=200&height=200`;
    const imgRes = await axios.get(graphUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const ct = imgRes.headers['content-type'] || 'image/jpeg';
    if (imgRes.data && imgRes.data.byteLength > 5000 && ct.includes('image')) {
      const result = {
        bytes: Buffer.from(imgRes.data),
        contentType: ct,
        expiresAt: Date.now() + 2 * 60 * 60 * 1000
      };
      memoryAvatarCache[uid] = result;
      return result;
    }
  } catch (graphErr) {
    console.error(`❌ [Avatar-Graph] uid=${uid} lỗi:`, graphErr.message);
  }

  // Phương án 4: Playwright
  let browser = null;
  try {
    console.log(`[Avatar-Playwright] uid=${uid} đang khởi động browser...`);
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
      return result;
    }

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
        return result;
      }
    }
  } catch (err) {
    console.error(`❌ [Avatar-Playwright] uid=${uid} lỗi:`, err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return null;
}

// Chẩn đoán trạng thái hoạt động của Cookie
async function diagnoseCookiesService() {
  const config = await readConfig();
  const cookie = config.cookie;
  if (!cookie) {
    return [];
  }

  const cookieList = cookie.split('\n').map(c => c.trim()).filter(Boolean);
  const diagnoses = [];

  const facebookService = require('./facebookService');

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

  return diagnoses;
}

module.exports = {
  verificationState,
  fbLoginService,
  getFbAvatarService,
  diagnoseCookiesService,
};
