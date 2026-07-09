const { chromium } = require('playwright');
const axios = require('axios');

// In-memory cache for extracted tokens to avoid launching browser/making requests repeatedly
const tokenCache = new Map();

/**
 * Trích xuất fb_dtsg, __user, lsd, jazoest bằng phương thức HTTP GET siêu tốc (axios)
 */
async function extractViaHttp(cookieString, userId) {
  try {
    const response = await axios.get('https://www.facebook.com/', {
      headers: {
        'cookie': cookieString,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5'
      },
      timeout: 8000
    });

    const html = response.data;
    const result = {
      fb_dtsg: null,
      lsd: null,
      jazoest: null,
      __rev: null,
      __hsi: null,
    };

    // Regex patterns to find tokens in HTML source
    const dtsgPatterns = [
      /"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/,
      /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
      /name="fb_dtsg"\s+value="([^"]+)"/,
      /"dtsg":\{"token":"([^"]+)"/,
      /fb_dtsg.*?value['":\s]+['"]([^'"]+)['"]/,
    ];
    for (const pat of dtsgPatterns) {
      const match = html.match(pat);
      if (match) {
        result.fb_dtsg = match[1];
        break;
      }
    }

    const lsdPatterns = [
      /\["LSD",\[\],\{"token":"([^"]+)"/,
      /"LSD".*?"token"\s*:\s*"([^"]+)"/,
      /name="lsd"\s+value="([^"]+)"/,
      /"lsd":\s*"([^"]+)"/,
    ];
    for (const pat of lsdPatterns) {
      const match = html.match(pat);
      if (match) {
        result.lsd = match[1];
        break;
      }
    }

    const jazoestPatterns = [
      /name="jazoest"\s+value="([^"]+)"/,
      /"jazoest"\s*:\s*"?(\d+)"?/,
      /jazoest=(\d+)/,
    ];
    for (const pat of jazoestPatterns) {
      const match = html.match(pat);
      if (match) {
        result.jazoest = match[1];
        break;
      }
    }

    const revMatch = html.match(/"server_revision"\s*:\s*(\d+)/) ||
                     html.match(/__spin_r['":\s]+(\d+)/) ||
                     html.match(/"__spin_r"\s*:\s*(\d+)/);
    if (revMatch) result.__rev = revMatch[1];

    const hsiMatch = html.match(/"hsi"\s*:\s*"(\d+)"/) ||
                     html.match(/"haste_session"\s*:\s*"(\d+)"/);
    if (hsiMatch) result.__hsi = hsiMatch[1];

    // Ensure we extracted the essential tokens (fb_dtsg is mandatory)
    if (result.fb_dtsg) {
      return {
        success: true,
        fb_dtsg: result.fb_dtsg,
        __user: userId,
        lsd: result.lsd,
        jazoest: result.jazoest,
        __rev: result.__rev,
        __hsi: result.__hsi
      };
    }

    return {
      success: false,
      error: 'Dữ liệu HTML phản hồi không chứa token fb_dtsg.'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Trích xuất fb_dtsg, __user, lsd, jazoest từ Facebook bằng cookie
 * @param {string} cookieString - Cookie string dạng "name1=value1; name2=value2; ..."
 * @returns {Promise<Object>} - { fb_dtsg, __user, lsd, jazoest, __rev, __hsi }
 */
async function extractTokens(cookieString) {
  // 1. Parse cookie string
  const cookies = parseCookieString(cookieString);
  const cUserCookie = cookies.find(c => c.name === 'c_user');
  const userId = cUserCookie ? cUserCookie.value : null;

  if (!userId) {
    return {
      success: false,
      error: 'Không tìm thấy cookie c_user. Vui lòng kiểm tra lại tính hợp lệ của cookie Facebook.'
    };
  }

  // 2. Check Memory Cache
  if (tokenCache.has(userId)) {
    return {
      success: true,
      ...tokenCache.get(userId)
    };
  }

  // 3. Thử trích xuất qua HTTP Request siêu tốc
  const httpResult = await extractViaHttp(cookieString, userId);
  if (httpResult.success) {
    // Lưu vào cache trước khi trả về
    tokenCache.set(userId, {
      fb_dtsg: httpResult.fb_dtsg,
      __user: httpResult.__user,
      lsd: httpResult.lsd,
      jazoest: httpResult.jazoest,
      __rev: httpResult.__rev,
      __hsi: httpResult.__hsi
    });
    return httpResult;
  }

  // 4. Nếu HTTP Request thất bại, chạy Playwright Headless Browser làm dự phòng
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      locale: 'vi-VN',
      viewport: { width: 1280, height: 720 }
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Giảm thời gian chờ xuống 1.5s thay vì 3s cho nhanh hơn
    await page.waitForTimeout(1500);

    const tokens = await page.evaluate(() => {
      const result = {
        fb_dtsg: null,
        lsd: null,
        jazoest: null,
        __rev: null,
        __hsi: null,
      };

      const html = document.documentElement.innerHTML;

      const dtsgPatterns = [
        /"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/,
        /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
        /name="fb_dtsg"\s+value="([^"]+)"/,
        /"dtsg":\{"token":"([^"]+)"/,
        /fb_dtsg.*?value['":\s]+['"]([^'"]+)['"]/,
      ];
      for (const pat of dtsgPatterns) {
        const match = html.match(pat);
        if (match) {
          result.fb_dtsg = match[1];
          break;
        }
      }

      const lsdPatterns = [
        /\["LSD",\[\],\{"token":"([^"]+)"/,
        /"LSD".*?"token"\s*:\s*"([^"]+)"/,
        /name="lsd"\s+value="([^"]+)"/,
        /"lsd":\s*"([^"]+)"/,
      ];
      for (const pat of lsdPatterns) {
        const match = html.match(pat);
        if (match) {
          result.lsd = match[1];
          break;
        }
      }

      const jazoestPatterns = [
        /name="jazoest"\s+value="([^"]+)"/,
        /"jazoest"\s*:\s*"?(\d+)"?/,
        /jazoest=(\d+)/,
      ];
      for (const pat of jazoestPatterns) {
        const match = html.match(pat);
        if (match) {
          result.jazoest = match[1];
          break;
        }
      }

      const revMatch = html.match(/"server_revision"\s*:\s*(\d+)/) ||
                       html.match(/__spin_r['":\s]+(\d+)/) ||
                       html.match(/"__spin_r"\s*:\s*(\d+)/);
      if (revMatch) result.__rev = revMatch[1];

      const hsiMatch = html.match(/"hsi"\s*:\s*"(\d+)"/) ||
                       html.match(/"haste_session"\s*:\s*"(\d+)"/);
      if (hsiMatch) result.__hsi = hsiMatch[1];

      return result;
    });

    await browser.close();
    browser = null;

    if (tokens.fb_dtsg) {
      const successData = {
        fb_dtsg: tokens.fb_dtsg,
        __user: userId,
        lsd: tokens.lsd,
        jazoest: tokens.jazoest,
        __rev: tokens.__rev,
        __hsi: tokens.__hsi
      };
      // Lưu vào cache
      tokenCache.set(userId, successData);
      return {
        success: true,
        ...successData
      };
    }

    return {
      success: false,
      error: 'Không thể trích xuất fb_dtsg qua trình duyệt Playwright.'
    };

  } catch (error) {
    if (browser) await browser.close();
    return {
      success: false,
      error: `Lỗi Playwright fallback: ${error.message}`
    };
  }
}

/**
 * Xóa cache cho một user cụ thể (khi cookie được cập nhật mới hoặc bị lỗi)
 */
function clearUserCache(userId) {
  if (userId) {
    tokenCache.delete(userId);
  } else {
    tokenCache.clear();
  }
}

/**
 * Parse cookie string thành mảng Playwright cookie objects
 */
function parseCookieString(cookieString) {
  if (!cookieString || !cookieString.trim()) return [];

  return cookieString.split(';')
    .map(pair => pair.trim())
    .filter(pair => pair.includes('='))
    .map(pair => {
      const eqIndex = pair.indexOf('=');
      const name = pair.substring(0, eqIndex).trim();
      const value = pair.substring(eqIndex + 1).trim();
      return {
        name,
        value,
        domain: '.facebook.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'None'
      };
    });
}

module.exports = { 
  extractTokens,
  clearUserCache
};
