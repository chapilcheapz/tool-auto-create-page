const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');

// Tự động đọc cấu hình cookie từ file config.json của ứng dụng
let FACEBOOK_COOKIE = "";
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.cookie) {
      FACEBOOK_COOKIE = configData.cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || configData.cookie;
      console.log('✅ Đã tìm thấy cookie tự động từ config.json.');
    }
  }
} catch (e) {
  console.log('[-] Không thể đọc tự động config.json, dùng cấu hình thủ công.');
}

// Nếu config.json trống, bạn có thể dán thủ công tại đây:
if (!FACEBOOK_COOKIE) {
  FACEBOOK_COOKIE = "datr=xxxx; sb=xxxx; c_user=xxxx; xs=xxxx;";
}

async function getFacebookAvatarBase64(cookie) {
  const uidMatch = cookie.match(/c_user=(\d+)/);
  const uid = uidMatch ? uidMatch[1] : null;
  
  if (!uid) {
    console.error('[-] Lỗi: Cookie không chứa c_user (UID).');
    return null;
  }

  // ─── Phương án 1: Dùng Playwright Scraper (Độ tin cậy 100%, lấy ảnh đại diện THẬT) ───
  let browser = null;
  try {
    console.log(`[*] Đang khởi động trình duyệt ngầm để lấy avatar UID: ${uid}...`);
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu', '--mute-audio', '--no-sandbox',
        '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Inject cookie vào trình duyệt
    const playwrightCookies = [];
    for (const part of cookie.split(';').map(p => p.trim())) {
      const eqPos = part.indexOf('=');
      if (eqPos > 0) {
        playwrightCookies.push({
          name: part.slice(0, eqPos),
          value: part.slice(eqPos + 1),
          domain: '.facebook.com',
          path: '/'
        });
      }
    }
    await context.addCookies(playwrightCookies);
    const page = await context.newPage();

    let avatarBytes = null;
    let contentType = 'image/jpeg';

    // Lắng nghe network để bắt gói tin ảnh đại diện tải từ facebook CDN
    const avatarUrlPromise = new Promise((resolve) => {
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('fbcdn.net') && (url.includes('/t39.30808-1/') || url.includes('/t1.30497-1/'))) {
          try {
            const body = await response.body();
            const ct = response.headers()['content-type'] || 'image/jpeg';
            if (body && body.length > 500 && ct.includes('image')) {
              resolve({ bytes: body, contentType: ct });
            }
          } catch {}
        }
      });
      // Hạn giờ tìm kiếm là 10 giây
      setTimeout(() => resolve(null), 10000);
    });

    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const intercepted = await avatarUrlPromise;
    if (intercepted) {
      avatarBytes = intercepted.bytes;
      contentType = intercepted.contentType;
      console.log(`[+] Đã lấy ảnh đại diện qua Network Intercept.`);
    } else {
      // Thử dùng selector nếu không intercept được
      const el = page.locator('div[role="banner"] div[role="button"] img[src*="fbcdn"]').first();
      const isVisible = await el.isVisible().catch(() => false);
      if (isVisible) {
        const src = await el.getAttribute('src');
        if (src && src.includes('fbcdn.net')) {
          const imgRes = await axios.get(src, { responseType: 'arraybuffer', timeout: 8000 });
          avatarBytes = imgRes.data;
          contentType = imgRes.headers['content-type'] || 'image/jpeg';
          console.log(`[+] Đã lấy ảnh đại diện qua DOM Selector.`);
        }
      }
    }

    await browser.close();
    browser = null;

    if (avatarBytes) {
      const base64String = Buffer.from(avatarBytes).toString('base64');
      return `data:${contentType};base64,${base64String}`;
    }
  } catch (err) {
    console.error('[-] Lỗi trình duyệt ngầm:', err.message);
    if (browser) await browser.close().catch(() => {});
  }

  // ─── Phương án 2: Dùng Graph API với UID (Dự phòng nhanh nếu phương án 1 lỗi) ───
  try {
    console.log(`[*] Thử phương án dự phòng Graph API cho UID: ${uid}...`);
    const graphUrl = `https://graph.facebook.com/${uid}/picture?type=large&width=200&height=200`;
    const response = await axios.get(graphUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    if (contentType.includes('image')) {
      const base64String = Buffer.from(response.data).toString('base64');
      console.log(`[+] Đã lấy ảnh đại diện qua Graph API (có thể là ảnh mặc định nếu tài khoản riêng tư).`);
      return `data:${contentType};base64,${base64String}`;
    }
  } catch (error) {
    console.error('[-] Lỗi Graph API:', error.message);
  }

  return null;
}

// Chạy thử nghiệm
(async () => {
  if (FACEBOOK_COOKIE.includes('xxxx')) {
    console.error('⚠️ Vui lòng cấu hình chuỗi Cookie Facebook thật vào biến FACEBOOK_COOKIE trong file này!');
    process.exit(1);
  }

  const avatarDataUrl = await getFacebookAvatarBase64(FACEBOOK_COOKIE);
  
  if (avatarDataUrl) {
    console.log('\n✅ LẤY ẢNH THÀNH CÔNG!');
    console.log('----------------------------------------------------');
    console.log('Bạn có thể dán chuỗi này trực tiếp vào src của thẻ img:');
    console.log('----------------------------------------------------');
    console.log(`${avatarDataUrl.substring(0, 120)}...[còn tiếp]...${avatarDataUrl.substring(avatarDataUrl.length - 50)}`);
    console.log('----------------------------------------------------');
    
    // Tạo mã HTML mẫu để hiển thị
    const htmlPreview = `
      <h3>Demo hiển thị ảnh đại diện bằng Base64</h3>
      <img src="${avatarDataUrl}" alt="Facebook Avatar" style="border-radius: 50%; width: 150px; height: 150px; border: 3px solid #3b5998;" />
    `;
    console.log('Mã HTML để chạy thử:\n', htmlPreview);
  } else {
    console.error('[-] Thất bại: Không thể lấy ảnh bằng bất kỳ phương án nào.');
  }
})();
