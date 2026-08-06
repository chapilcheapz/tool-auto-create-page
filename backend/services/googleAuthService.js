const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const { savePlatformCookie } = require('./platformCookieService');

const storageDir = path.join(__dirname, '../../storage');
if (!fs.existsSync(storageDir)) {
  try {
    fs.mkdirSync(storageDir, { recursive: true });
  } catch (e) {}
}

const googleSessionFilePath = path.join(storageDir, 'google-session.json');

/**
 * Chuyển mảng cookies của Playwright thành định dạng Netscape (cookies.txt) dùng cho yt-dlp / curl
 */
function convertToNetscapeFormat(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# http://curl.haxx.se/rfc/cookie_spec.html', '# This is a generated file!  Do not edit.', ''];
  for (const c of cookies) {
    if (!c.domain) continue;
    const isDomainMatch = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const isSecure = c.secure ? 'TRUE' : 'FALSE';
    const expires = c.expires ? Math.round(c.expires) : Math.round(Date.now() / 1000) + 86400 * 365;
    lines.push(`${c.domain}\t${isDomainMatch}\t${path}\t${isSecure}\t${expires}\t${c.name}\t${c.value}`);
  }
  return lines.join('\n');
}

/**
 * Kiểm tra trạng thái phiên Google hiện tại
 */
async function getGoogleStatusService() {
  try {
    if (fs.existsSync(googleSessionFilePath)) {
      const raw = fs.readFileSync(googleSessionFilePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.cookies && data.cookies.length > 0) {
        // Tìm cookie đại diện tài khoản Google (SID hoặc HSID)
        const sidCookie = data.cookies.find(c => c.name === 'SID' || c.name === 'SAPISID');
        if (sidCookie) {
          const stats = fs.statSync(googleSessionFilePath);
          return {
            success: true,
            active: true,
            updatedAt: stats.mtime.toISOString(),
            cookieCount: data.cookies.length
          };
        }
      }
    }
  } catch (e) {}

  return {
    success: true,
    active: false,
    updatedAt: null,
    cookieCount: 0
  };
}

/**
 * Tiến trình tự động đăng nhập tài khoản Google bằng Playwright Stealth Mode
 */
async function googleLoginService(email, password, proxy = '') {
  let browser = null;
  try {
    const launchOptions = {
      headless: true,
      args: [
        '--disable-gpu',
        '--mute-audio',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,800'
      ]
    };

    if (proxy && proxy.trim()) {
      launchOptions.proxy = { server: proxy.trim() };
    }

    // Thử chạy bằng Google Chrome thật trên hệ thống để có chứng chỉ & fingerprint sạch nhất
    try {
      browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
      console.log('[Google-Auth] 🚀 Đã khởi chạy thành công trình duyệt Google Chrome gốc.');
    } catch (err) {
      console.log('[Google-Auth] Không tìm thấy Google Chrome gốc, fallback sang Chromium mặc định...');
      browser = await chromium.launch(launchOptions);
    }

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'vi-VN',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const page = await context.newPage();

    // Xóa cờ navigator.webdriver để Google không phát hiện bot
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete navigator.__proto__.webdriver;
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
    });

    // 1. Mở trang Đăng nhập Google
    console.log(`[Google-Auth] Đang mở trang đăng nhập Google cho: ${email}...`);
    await page.goto('https://accounts.google.com/ServiceLogin?hl=vi', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(() => {});

    await page.waitForTimeout(2000);

    // 2. Điền Email Google (Mở rộng selector để đảm bảo tìm đúng ô Email trên mọi giao diện Google)
    const emailSelector = 'input[type="email"], input[name="identifier"], #identifierId';
    await page.waitForSelector(emailSelector, { timeout: 20000 }).catch(async () => {
      const pageTitle = await page.title();
      const pageUrl = page.url();
      throw new Error(`Không tìm thấy ô nhập Email Google (URL: ${pageUrl}, Title: ${pageTitle}). Có thể Google đang yêu cầu xác minh CAPTCHA hoặc chặn IP.`);
    });

    await page.focus(emailSelector);
    // Giả lập gõ phím tự nhiên từng ký tự để bypass kiểm tra bot
    await page.type(emailSelector, email, { delay: 60 });
    await page.waitForTimeout(800);

    // Thử click nút Tiếp theo hoặc nhấn Enter
    const nextBtnSelector = '#identifierNext, button:has-text("Tiếp theo"), button:has-text("Next"), div#identifierNext button';
    const nextBtn = await page.$(nextBtnSelector);
    if (nextBtn) {
      await nextBtn.click().catch(() => page.press(emailSelector, 'Enter'));
    } else {
      await page.press(emailSelector, 'Enter');
    }
    await page.waitForTimeout(3500);

    // Kiểm tra xem có báo lỗi email không hợp lệ
    const emailError = await page.$('div[aria-live="assertive"], div.EkAifb, div.o6ACho, div.rFrNMe.N3vfEc');
    if (emailError) {
      const errText = await emailError.innerText().catch(() => '');
      if (errText && (errText.includes('không tìm thấy') || errText.includes('không hợp lệ') || errText.includes('Couldn\'t find') || errText.includes('Enter a valid'))) {
        throw new Error(`Email Google không tồn tại hoặc không đúng: ${errText.trim()}`);
      }
    }

    // 3. Điền Mật khẩu Google
    const passSelector = 'input[type="password"], input[name="Passwd"], input[name="password"]';
    await page.waitForSelector(passSelector, { timeout: 20000 }).catch(async () => {
      const pageUrl = page.url();
      if (pageUrl.includes('rejected') || pageUrl.includes('denied') || pageUrl.includes('signin/rejected')) {
        throw new Error('Google phát hiện trình duyệt tự động hóa và từ chối truy cập. Khuyên dùng: Dán trực tiếp Cookie Google vào tab YT & TikTok.');
      }
      throw new Error('Google phát hiện tự động hóa hoặc yêu cầu xác minh màn hình phụ (CAPTCHA/SMS). Vui lòng kiểm tra lại.');
    });

    await page.focus(passSelector);
    await page.type(passSelector, password, { delay: 60 });
    await page.waitForTimeout(800);

    const passNextBtnSelector = '#passwordNext, button:has-text("Tiếp theo"), button:has-text("Next"), div#passwordNext button';
    const passNextBtn = await page.$(passNextBtnSelector);
    if (passNextBtn) {
      await passNextBtn.click().catch(() => page.press(passSelector, 'Enter'));
    } else {
      await page.press(passSelector, 'Enter');
    }
    await page.waitForTimeout(5000);

    // Kiểm tra xem có lỗi mật khẩu sai không
    const passError = await page.$('div[aria-live="assertive"], div.EkAifb, span.jXeUud');
    if (passError) {
      const errText = await passError.innerText().catch(() => '');
      if (errText && (errText.includes('mật khẩu') || errText.includes('Wrong password') || errText.includes('không đúng'))) {
        throw new Error(`Mật khẩu Google không chính xác: ${errText.trim()}`);
      }
    }

    // 4. Kiểm tra thành công hoặc 2FA
    const currentUrl = page.url();
    console.log(`[Google-Auth] URL sau khi đăng nhập: ${currentUrl}`);

    // Đợi tối đa 5 giây cho điều hướng đăng nhập hoàn tất
    await page.waitForURL(url => !url.includes('/signin/v2/challenge') && !url.includes('/ServiceLogin'), { timeout: 8000 }).catch(() => {});

    const cookies = await context.cookies();
    const sidCookie = cookies.find(c => c.name === 'SID' || c.name === 'SAPISID');

    if (!sidCookie) {
      // Kiểm tra màn hình 2FA
      if (page.url().includes('challenge') || page.url().includes('2fa')) {
        throw new Error('Tài khoản Google yêu cầu xác minh 2 bước (2FA / OTP). Vui lòng tắt 2FA hoặc xác nhận trên điện thoại trước.');
      }
      throw new Error('Đăng nhập không thành công. Google chưa tạo session SID.');
    }

    // 5. Lưu phiên làm việc (Session Storage State & Cookies)
    await context.storageState({ path: googleSessionFilePath });
    console.log(`[Google-Auth] ✅ Đã lưu session Google thành công -> ${googleSessionFilePath}`);

    // Đồng thời chuyển đổi và tự động cập nhật cookie cho YouTube
    const netscapeCookies = convertToNetscapeFormat(cookies);
    if (netscapeCookies) {
      await savePlatformCookie('youtube', netscapeCookies).catch(() => {});
      console.log(`[Google-Auth] ✅ Đã tự động đồng bộ Cookie Google cho YouTube.`);
    }

    await browser.close();
    browser = null;

    return {
      success: true,
      email,
      message: 'Đăng nhập Google thành công! Phiên làm việc đã được lưu trữ cố định.'
    };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[Google-Auth ERROR] ${error.message}`);
    throw error;
  }
}

module.exports = {
  getGoogleStatusService,
  googleLoginService
};
