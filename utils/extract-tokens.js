const { chromium } = require('playwright');

/**
 * Trích xuất fb_dtsg, __user, lsd, jazoest từ Facebook bằng cookie
 * @param {string} cookieString - Cookie string dạng "name1=value1; name2=value2; ..."
 * @returns {Promise<Object>} - { fb_dtsg, __user, lsd, jazoest, __rev, __hsi, __dyn, __csr }
 */
async function extractTokens(cookieString) {
  let browser = null;

  try {
    // Parse cookie string thành mảng cookie objects
    const cookies = parseCookieString(cookieString);

    // Trích xuất __user từ c_user cookie
    const cUserCookie = cookies.find(c => c.name === 'c_user');
    const userId = cUserCookie ? cUserCookie.value : null;

    // Launch browser headless
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      locale: 'vi-VN',
      viewport: { width: 1280, height: 720 }
    });

    // Set cookies
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Navigate tới Facebook
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Đợi page load đủ
    await page.waitForTimeout(3000);

    // Trích xuất tokens từ page source
    const tokens = await page.evaluate(() => {
      const result = {
        fb_dtsg: null,
        lsd: null,
        jazoest: null,
        __rev: null,
        __hsi: null,
      };

      // Lấy toàn bộ HTML
      const html = document.documentElement.innerHTML;

      // fb_dtsg - tìm trong DTSGInitialData hoặc hidden input
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

      // lsd - tìm trong LSD token
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

      // jazoest - tìm trong hidden input hoặc script
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

      // __rev (server revision)
      const revMatch = html.match(/"server_revision"\s*:\s*(\d+)/) ||
                        html.match(/__spin_r['":\s]+(\d+)/) ||
                        html.match(/"__spin_r"\s*:\s*(\d+)/);
      if (revMatch) result.__rev = revMatch[1];

      // __hsi
      const hsiMatch = html.match(/"hsi"\s*:\s*"(\d+)"/) ||
                        html.match(/"haste_session"\s*:\s*"(\d+)"/);
      if (hsiMatch) result.__hsi = hsiMatch[1];

      return result;
    });

    await browser.close();
    browser = null;

    return {
      success: true,
      fb_dtsg: tokens.fb_dtsg,
      __user: userId,
      lsd: tokens.lsd,
      jazoest: tokens.jazoest,
      __rev: tokens.__rev,
      __hsi: tokens.__hsi,
    };

  } catch (error) {
    if (browser) await browser.close();
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Parse cookie string "name1=value1; name2=value2" thành mảng Playwright cookie objects
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

module.exports = { extractTokens };
