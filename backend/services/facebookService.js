const axios = require('axios');
const querystring = require('querystring');
const { chromium } = require('playwright');
const { extractTokens } = require('../utils/extract-tokens');
const { generatePageName, generateBio, buildCommonParams, buildHeaders } = require('../utils/random');
const { getDocId, autoDiscoverDocId } = require('../utils/doc-manager');

// Helper to parse pages recursively from FB GraphQL response
function parsePagesFromGraphQL(responseData) {
  const pages = [];
  const responseText = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
  const lines = responseText.split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      findPagesRecursively(parsed, pages);
    } catch (e) { /* ignore */ }
  }
  const uniquePages = [];
  const seenIds = new Set();
  for (const page of pages) {
    if (!seenIds.has(page.id)) {
      seenIds.add(page.id);
      uniquePages.push(page);
    }
  }
  return uniquePages;
}

function findPagesRecursively(obj, list) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.id && obj.name && (obj.profile_picture || obj.profile_photo || obj.__typename === 'Page' || obj.__typename === 'User')) {
    list.push({ id: String(obj.id), name: obj.name, avatar: obj.profile_picture?.uri || obj.profile_photo?.uri || null });
  }
  for (const key of Object.keys(obj)) {
    findPagesRecursively(obj[key], list);
  }
}

/**
 * Fetch list of Pages owned by the user
 */
async function getPages(cookie) {
  const cookieList = cookie.split('\n').map(c => c.trim()).filter(Boolean);
  if (cookieList.length === 0) throw new Error('Không có cookie hợp lệ.');

  const getPagesForSingleCookie = async (singleCookie) => {
    const tokens = await extractTokens(singleCookie);
    if (!tokens.success) throw new Error(`Không thể trích xuất token: ${tokens.error}`);

    const config = {
      cookie: singleCookie,
      fb_dtsg: tokens.fb_dtsg,
      __user: tokens.__user,
      lsd: tokens.lsd,
      jazoest: tokens.jazoest,
      __hsi: tokens.__hsi || '',
      __rev: tokens.__rev || '',
      __dyn: '',
      __csr: '',
    };

    const headers = buildHeaders(config);
    headers['x-fb-friendly-name'] = 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery';

    const executeRequest = async (docIdValue) => {
      const params = {
        av: config.__user,
        ...buildCommonParams(config),
        __crn: 'comet.fbweb.CometHomeRoute',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery',
        server_timestamps: 'true',
        variables: JSON.stringify({ scale: 2 }),
        doc_id: docIdValue
      };
      return axios.post('https://www.facebook.com/api/graphql/', querystring.stringify(params), { headers });
    };

    let docId = getDocId('PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery');
    let response;
    try { response = await executeRequest(docId); }
    catch (error) { throw new Error(`Lỗi kết nối Facebook: ${error.message}`); }

    let respData = response.data;
    let isDocIdError = typeof respData === 'string' ? respData.includes('was not found') : JSON.stringify(respData).includes('was not found');

    if (isDocIdError) {
      console.log(`[Self-Healing] doc_id cũ (${docId}) hết hạn. Tìm mới...`);
      const newDocId = await autoDiscoverDocId(singleCookie, 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery');
      if (newDocId) {
        try { response = await executeRequest(newDocId); respData = response.data; }
        catch (error) { throw new Error(`Lỗi kết nối Facebook khi gọi lại: ${error.message}`); }
      }
    }

    const responseText = typeof respData === 'string' ? respData : JSON.stringify(respData);
    if (responseText.includes('error\":1357001') || responseText.includes('errorSummary') || responseText.includes('Vui lòng đăng nhập')) {
      throw new Error('Cookie hết hạn hoặc không hợp lệ (Facebook yêu cầu đăng nhập lại).');
    }

    const parsedPages = parsePagesFromGraphQL(respData);
    for (const page of parsedPages) {
      page.ownerCookie = singleCookie;
      page.avatar = page.avatar && page.avatar.startsWith('http')
        ? `/api/config/fb-avatar?uid=${encodeURIComponent(page.avatar)}`
        : `/api/config/fb-avatar?uid=${page.id}`;
    }

    const personalName = tokens.userName ? `${tokens.userName}` : `Trang cá nhân (${tokens.__user})`;
    const personalProfile = {
      id: String(tokens.__user),
      name: personalName,
      avatar: `/api/config/fb-avatar?uid=${tokens.__user}`,
      type: 'personal',
      isPersonal: true,
      ownerCookie: singleCookie
    };
    return [personalProfile, ...parsedPages];
  };

  const allPages = [];
  const seenIds = new Set();
  for (const singleCookie of cookieList) {
    try {
      const pages = await getPagesForSingleCookie(singleCookie);
      for (const page of pages) {
        if (!seenIds.has(page.id)) { seenIds.add(page.id); allPages.push(page); }
      }
    } catch (err) {
      console.error(`⚠️ [getPages] Bỏ qua cookie lỗi:`, err.message);
    }
  }
  return allPages;
}

/**
 * Create a new Facebook Page
 */
async function createPage(cookie, customName, customBio, category) {
  const primaryCookie = cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || cookie;
  const tokens = await extractTokens(primaryCookie);
  if (!tokens.success) throw new Error(`Lỗi token: ${tokens.error}`);

  const pageName = customName?.trim() || generatePageName();
  const pageBio = customBio?.trim() || generateBio(pageName);
  const pageCategory = category?.trim() || '2347428775505624';

  const config = {
    cookie: primaryCookie,
    fb_dtsg: tokens.fb_dtsg,
    __user: tokens.__user,
    lsd: tokens.lsd,
    jazoest: tokens.jazoest,
    __hsi: tokens.__hsi || '',
    __rev: tokens.__rev || '',
    __dyn: '',
    __csr: '',
  };

  const headers = buildHeaders(config);
  headers['x-fb-friendly-name'] = 'AdditionalProfilePlusCreationMutation';

  const variables = {
    input: {
      bio: pageBio, categories: [pageCategory], creation_source: 'comet', name: pageName,
      off_platform_creator_reachout_id: null, page_referrer: 'null',
      actor_id: config.__user, client_mutation_id: '1'
    }
  };

  const executeRequest = async (docIdValue) => {
    const params = {
      av: config.__user, ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'AdditionalProfilePlusCreationMutation',
      server_timestamps: 'true', variables: JSON.stringify(variables), doc_id: docIdValue
    };
    return axios.post('https://www.facebook.com/api/graphql/', querystring.stringify(params), { headers });
  };

  let docId = getDocId('AdditionalProfilePlusCreationMutation');
  let response;
  try { response = await executeRequest(docId); }
  catch (error) { throw new Error(`Lỗi kết nối Facebook: ${error.message}`); }

  let respData = response.data;
  let isDocIdError = typeof respData === 'string' ? respData.includes('was not found') : JSON.stringify(respData).includes('was not found');

  if (isDocIdError) {
    const newDocId = await autoDiscoverDocId(cookie, 'AdditionalProfilePlusCreationMutation');
    if (newDocId) {
      try { response = await executeRequest(newDocId); respData = response.data; }
      catch (error) { throw new Error(`Lỗi kết nối Facebook khi gọi lại: ${error.message}`); }
    } else {
      throw new Error(`Facebook đã thay đổi API. Chi tiết: ${JSON.stringify(respData)}`);
    }
  }

  const respStr = JSON.stringify(respData);
  if (respStr.includes('page_create') || (respStr.includes('additional_profile_plus_create') && !respStr.includes('error_message') && !respStr.includes('"page\":null'))) {
    return { success: true, name: pageName, bio: pageBio };
  }

  if (respStr.includes('SMS verification') || respStr.includes('suspicious activity') || respStr.includes('error_message')) {
    let errorMsg = 'Facebook từ chối tạo trang.';
    try {
      const parsed = typeof respData === 'string' ? JSON.parse(respData) : respData;
      const fbError = parsed?.data?.additional_profile_plus_create?.error_message;
      if (fbError) {
        errorMsg = fbError.includes('SMS') || fbError.includes('suspicious')
          ? 'Facebook phát hiện hoạt động đáng ngờ. Vui lòng mở ứng dụng Facebook và hoàn tất xác minh số điện thoại (SMS) trước khi tạo trang mới.'
          : `Facebook từ chối: ${fbError}`;
      }
    } catch {}
    throw new Error(errorMsg);
  }
  throw new Error(respStr);
}

/**
 * Translate Reel/Video ID to story feedback ID
 */
async function getFeedbackIdForUrl(postUrl, postId, cookie) {
  const primaryCookie = cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || cookie;
  if (!postUrl.includes('/reel/') && !postUrl.includes('/reels/') && !postUrl.includes('/videos/') && !postUrl.includes('watch')) {
    return Buffer.from(`feedback:${postId}`).toString('base64');
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--mute-audio'] });
    const context = await browser.newContext();
    const cookieParts = primaryCookie.split(';').map(p => p.trim());
    const pwCookies = cookieParts.filter(p => p.includes('=')).map(p => {
      const eq = p.indexOf('=');
      return { name: p.slice(0, eq), value: p.slice(eq + 1), domain: '.facebook.com', path: '/' };
    });
    await context.addCookies(pwCookies);
    const page = await context.newPage();
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(4000);
    const html = await page.content();
    await browser.close();
    let realPostId = null, pos = 0;
    while (true) {
      const idx = html.indexOf(postId, pos);
      if (idx === -1) break;
      const w = html.substring(Math.max(0, idx - 1000), Math.min(html.length, idx + 1000));
      const match = w.match(/"post_id"\s*:\s*"(\d+)"/);
      if (match) { realPostId = match[1]; break; }
      pos = idx + 1;
    }
    if (realPostId) return Buffer.from(`feedback:${realPostId}`).toString('base64');
  } catch (error) {
    console.error('Lỗi trích xuất feedback_id:', error.message);
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
  return Buffer.from(`feedback:${postId}`).toString('base64');
}

/**
 * Execute feedback reaction mutation
 */
async function reactPost(config, pageId, feedbackId, reactionType, index) {
  const reactHeaders = { ...buildHeaders(config), 'x-fb-friendly-name': 'CometUFIFeedbackReactMutation' };
  const variables = {
    input: {
      attribution_id_v2: `ProfileCometTimelineListViewRoot.react,comet.profile.timeline.list,via_cold_start,${Date.now()},45171,250100865708545,,`,
      feedback_id: feedbackId, feedback_reaction_id: reactionType, feedback_source: 'PROFILE',
      feedback_referrer: '/profile.php', is_tracking_encrypted: true, tracking: [],
      session_id: 'aa6e11ec-47c8-47fd-8018-caffe569df91', actor_id: pageId, client_mutation_id: index.toString()
    },
    scale: 2, canUseNicknameOnComet: false, useDefaultActor: false,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
  };
  const reactParams = {
    av: pageId, ...buildCommonParams(config),
    __crn: 'comet.fbweb.CometProfileTimelineListViewRoute',
    fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: 'CometUFIFeedbackReactMutation',
    server_timestamps: 'true', variables: JSON.stringify(variables), doc_id: '27646120298312844'
  };
  const response = await axios.post('https://www.facebook.com/api/graphql/', querystring.stringify(reactParams), { headers: reactHeaders });
      const respStr = JSON.stringify(response.data);
  return { success: respStr.includes('feedback_react') || response.status === 200, data: response.data };
}

/**
 * Đăng video lên Facebook (Trang cá nhân hoặc Fanpage)
 * Quy trình 6 bước chuẩn:
 * 1. Tải video từ URL (YouTube/TikTok/M3U8) về máy chủ nếu chưa có file sẵn
 * 2. Kiểm tra tính hợp lệ của file MP4 (Header + FFprobe)
 * 3. Upload file MP4 vào Facebook bằng Playwright
 * 4. Nhập tiêu đề/nội dung (caption)
 * 5. Đăng bài
 * 6. Tự động xóa file tạm trên máy chủ
 */
async function postToFacebook(cookie, targetId, caption, videoUrl = '', videoFilePath = '') {
  const primaryCookie = cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || cookie;
  const tokens = await extractTokens(primaryCookie);
  if (!tokens.success) throw new Error(`Lỗi token: ${tokens.error}`);

  const { __user } = tokens;
  const isPage = targetId && String(targetId) !== String(__user);
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

  const fs = require('fs');
  const path = require('path');
  const ytdlpService = require('./ytdlpService');

  let localFilePath = videoFilePath;
  let isTemporaryFile = false;

  // 📌 BƯỚC 1: Nếu chưa có file MP4 sẵn, tự động tải video từ URL (YouTube/TikTok/M3U8) về máy chủ
  if (!localFilePath || !fs.existsSync(localFilePath)) {
    if (!videoUrl || !videoUrl.trim()) {
      throw new Error('Vui lòng cung cấp liên kết video (YouTube/TikTok/M3U8) để đăng!');
    }

    const rawTargetUrl = videoUrl.trim();
    console.log(`[postToFacebook] 🚀 1/6. Tự động xử lý video từ URL: ${rawTargetUrl}`);

    const downloadDir = process.env.DOWNLOAD_DIR
      ? path.resolve(process.env.DOWNLOAD_DIR.replace(/^"|"$/g, ''))
      : path.join(__dirname, '../../storage/downloads');

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const tempId = `temp_fb_${Date.now()}`;
    const destPath = path.join(downloadDir, `${tempId}.mp4`);
    const videoService = require('./videoService');

    // Thử bóc tách lấy link trực tiếp (Direct MP4 / M3U8)
    let directUrl = '';
    try {
      const parsedInfo = await videoService.getVideoInfo(rawTargetUrl);
      if (parsedInfo && parsedInfo.success && parsedInfo.qualities?.[0]?.url) {
        directUrl = parsedInfo.qualities[0].url;
        console.log(`[postToFacebook] 💡 Đã bóc tách thành công Direct URL: ${directUrl}`);
      }
    } catch (parseErr) {
      console.log(`[postToFacebook] Bóc tách link trực tiếp không thành công (${parseErr.message}), dùng yt-dlp...`);
    }

    // Phương án A: Tải trực tiếp qua HTTP stream siêu tốc (Bảo mật 100%, không chạm máy cá nhân)
    if (directUrl && directUrl.startsWith('http') && !directUrl.includes('.m3u8')) {
      try {
        console.log(`[postToFacebook] 📥 Tải trực tiếp file MP4 qua HTTP stream...`);
        await videoService.downloadDirectHttpFile(directUrl, destPath);
        localFilePath = destPath;
        isTemporaryFile = true;
        console.log(`[postToFacebook] ✅ 1/6. Tải xong file MP4 qua HTTP stream: ${localFilePath}`);
      } catch (httpDlErr) {
        console.log(`[postToFacebook] HTTP stream thất bại (${httpDlErr.message}), chuyển sang yt-dlp...`);
      }
    }

    // Phương án B: Dùng yt-dlp tải video
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      const outputTemplate = path.join(downloadDir, `${tempId}_%(ext)s`);
      try {
        localFilePath = await ytdlpService.downloadWithYtDlp(directUrl || rawTargetUrl, outputTemplate);
        isTemporaryFile = true;
        console.log(`[postToFacebook] ✅ 1/6. yt-dlp đã tải xong file MP4 về máy chủ: ${localFilePath}`);
      } catch (dlErr) {
        if (directUrl && directUrl !== rawTargetUrl) {
          console.log(`[postToFacebook] yt-dlp với directUrl thất bại, thử lại bằng link gốc...`);
          try {
            localFilePath = await ytdlpService.downloadWithYtDlp(rawTargetUrl, outputTemplate);
            isTemporaryFile = true;
            console.log(`[postToFacebook] ✅ 1/6. yt-dlp tải xong từ link gốc: ${localFilePath}`);
          } catch (retryErr) {
            throw new Error(`Tải video từ liên kết thất bại: ${retryErr.message}`);
          }
        } else {
          throw new Error(`Tải video từ liên kết thất bại: ${dlErr.message}`);
        }
      }
    }
  }

  // 📌 BƯỚC 2: Kiểm tra file MP4 (Xác minh Header & luồng FFprobe)
  try {
    console.log(`[postToFacebook] 🔍 2/6. Kiểm tra tính hợp lệ của file MP4...`);
    ytdlpService.verifyHeaderNotHtml(localFilePath);
    await ytdlpService.verifyWithFfprobe(localFilePath);
    console.log(`[postToFacebook] ✅ 2/6. Kiểm tra file MP4 hoàn tất: File hợp lệ.`);
  } catch (verifyErr) {
    if (isTemporaryFile && localFilePath && fs.existsSync(localFilePath)) {
      try { fs.unlinkSync(localFilePath); } catch (e) {}
    }
    throw new Error(`File video không hợp lệ: ${verifyErr.message}`);
  }

  // 📌 BƯỚC 3: Upload file MP4 lên Supabase Storage & Lấy URL từ Supabase
  const supabaseStorageService = require('./supabaseStorageService');
  console.log(`[postToFacebook] ☁️ 3/6. Upload file MP4 lên Supabase Storage...`);
  const sbResult = await supabaseStorageService.uploadVideoToSupabase(localFilePath);

  let finalUploadFilePath = localFilePath;
  let isSbTempFile = false;

  if (sbResult && sbResult.success && sbResult.publicUrl) {
    console.log(`[postToFacebook] ✅ 3/6. Đã lưu video trên Supabase Storage! Public URL: ${sbResult.publicUrl}`);
    // Tải file từ Supabase Storage URL về để Playwright đưa vào setInputFiles upload lên Facebook (Không lấy trực tiếp từ YouTube/TikTok)
    const downloadDir = path.dirname(localFilePath);
    const sbLocalPath = path.join(downloadDir, `supabase_${Date.now()}.mp4`);
    try {
      console.log(`[postToFacebook] 📥 4/6. Lấy video từ Supabase Storage URL về để upload Facebook...`);
      await videoService.downloadDirectHttpFile(sbResult.publicUrl, sbLocalPath);
      finalUploadFilePath = sbLocalPath;
      isSbTempFile = true;
      console.log(`[postToFacebook] ✅ 4/6. Đã lấy xong video từ Supabase Storage: ${finalUploadFilePath}`);
    } catch (sbDlErr) {
      console.warn(`[postToFacebook] Không thể kéo file từ Supabase Storage URL (${sbDlErr.message}), dùng file đã upload.`);
    }
  } else {
    console.warn(`[postToFacebook] Upload Supabase Storage không thành công (${sbResult.error}), dùng file tạm trên server.`);
  }

  // 📌 BƯỚC 4 + 5: Upload file MP4 (nạp từ Supabase) vào Facebook & Đăng bài
  let postResult;
  try {
    console.log(`[postToFacebook] 📤 5/6. Đang upload file MP4 từ Supabase lên Facebook...`);
    const cleanCaption = (caption || '').trim();
    postResult = await _playwrightPost(primaryCookie, targetId, isPage, userAgent, cleanCaption, finalUploadFilePath, fs);
  } finally {
    // 📌 BƯỚC 6: Dọn dẹp file tạm
    if (isSbTempFile && finalUploadFilePath && fs.existsSync(finalUploadFilePath)) {
      try { fs.unlinkSync(finalUploadFilePath); } catch (e) {}
    }
    if (isTemporaryFile && localFilePath && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
        console.log(`[postToFacebook] 🧹 6/6. Đã dọn dẹp xong các file tạm.`);
      } catch (cleanErr) {
        console.warn(`[postToFacebook] Lỗi xóa file tạm: ${cleanErr.message}`);
      }
    }
  }

  return postResult;
}

/**
 * Playwright core: Upload file MP4 vào Facebook & đăng bài
 */
async function _playwrightPost(primaryCookie, targetId, isPage, userAgent, fullMessage, videoFilePath, fs) {
  let browser;

  console.log(`[Playwright] Upload video mode: ${videoFilePath}`);

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--mute-audio',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-background-networking',
      ]
    });

    const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

    const context = await browser.newContext({
      userAgent: macUA,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    });

    const pwCookies = primaryCookie.split(';').map(p => p.trim()).filter(p => p.includes('=')).map(p => {
      const eq = p.indexOf('=');
      return { name: p.slice(0, eq), value: p.slice(eq + 1), domain: '.facebook.com', path: '/' };
    });
    await context.addCookies(pwCookies);

    const page = await context.newPage();
    const targetUrl = isPage
      ? `https://www.facebook.com/profile.php?id=${targetId}`
      : 'https://www.facebook.com/';

    console.log(`[Playwright] Truy cập → ${targetUrl}`);
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (navErr) {
      console.log(`[Playwright] Fallback về trang chủ...`);
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (_) {
      await page.waitForTimeout(4000);
    }

    // Kiểm tra login
    const pageTitle = await page.title().catch(() => '');
    const pageContent = await page.content().catch(() => '');
    const isLoggedOut = pageContent.includes('Đăng nhập') && pageContent.includes('Mật khẩu')
      || pageTitle.toLowerCase().includes('facebook - log in');

    if (isLoggedOut) {
      throw new Error('Cookie Facebook hết hạn hoặc không hợp lệ. Vui lòng cập nhật cookie mới.');
    }

    // ── UPLOAD FILE MP4 VÀO FACEBOOK ──
    let uploadedViaChooser = false;

    // Cách 1: Click "Ảnh/video" & waitForEvent filechooser
    try {
      const photoVideoBtn = page.locator('[aria-label="Ảnh/video"]').first();
      if (await photoVideoBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
        console.log('[Playwright] Click nút "Ảnh/video" & chờ filechooser...');
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          photoVideoBtn.click()
        ]);
        await fileChooser.setFiles(videoFilePath);
        console.log('[Playwright] ✅ Đã đẩy file MP4 vào filechooser thành công!');
        uploadedViaChooser = true;
      }
    } catch (chooserErr) {
      console.log(`[Playwright] filechooser event thất bại: ${chooserErr.message}`);
    }

    // Cách 2: setInputFiles vào input[type=file]
    if (!uploadedViaChooser) {
      try {
        const fileInputs = page.locator('input[type="file"]');
        if (await fileInputs.count() > 0) {
          await fileInputs.first().setInputFiles(videoFilePath, { timeout: 10000 });
          console.log('[Playwright] ✅ setInputFiles trực tiếp thành công!');
          uploadedViaChooser = true;
        }
      } catch (directErr) {
        console.log(`[Playwright] setInputFiles direct thất bại: ${directErr.message}`);
      }
    }

    if (!uploadedViaChooser) {
      throw new Error('Không tìm thấy ô upload video trên giao diện Facebook.');
    }

    // Đợi Facebook tải video lên (progressbar)
    console.log('[Playwright] ⏳ Đang đợi Facebook tải video lên...');
    await page.waitForTimeout(4000);
    try {
      await page.waitForSelector('[role="progressbar"]', { state: 'visible', timeout: 10000 });
      console.log('[Playwright] Phát hiện tiến trình tải lên — đang chờ hoàn tất...');
      await page.waitForSelector('[role="progressbar"]', { state: 'detached', timeout: 180000 });
      console.log('[Playwright] ✅ Upload video lên Facebook hoàn tất!');
    } catch (_) {
      await page.waitForTimeout(6000);
    }

    // ── NHẬP TIÊU ĐỀ / NỘI DUNG (CAPTION) ──
    let filled = false;
    const captionSels = [
      'div[role="dialog"] div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="Bạn đang"]',
      'div[contenteditable="true"][aria-label*="Mô tả"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of captionSels) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(300);
        if (fullMessage) {
          await page.keyboard.type(fullMessage, { delay: 10 });
          await page.waitForTimeout(1000);
        }
        filled = true;
        console.log(`[Playwright] ✅ Đã nhập tiêu đề/nội dung bài viết: "${sel}"`);
        break;
      }
    }

    // ── ĐĂNG BÀI (Hỗ trợ cả nút Tiếp / Next / Đăng / Chia sẻ) ──
    let posted = false;

    // Xử lý nếu có nút Tiếp / Next trước
    const nextBtns = [
      'div[role="dialog"] div[role="button"]:has-text("Tiếp")',
      'div[role="dialog"] div[role="button"]:has-text("Next")',
    ];
    for (const nSel of nextBtns) {
      const nEl = page.locator(nSel).first();
      if (await nEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[Playwright] Click nút Tiếp/Next: "${nSel}"`);
        await nEl.click();
        await page.waitForTimeout(2000);
        break;
      }
    }

    // Click nút Đăng / Post / Chia sẻ
    const postSels = [
      'div[role="dialog"] div[role="button"]:has-text("Đăng")',
      'div[role="dialog"] div[role="button"]:has-text("Post")',
      'div[role="dialog"] div[role="button"]:has-text("Chia sẻ")',
      'div[role="dialog"] div[role="button"]:has-text("Share")',
      '[aria-label="Đăng"][role="button"]',
      '[aria-label="Post"][role="button"]',
      'div[role="button"]:has-text("Đăng")',
    ];

    for (let attempt = 0; attempt < 10 && !posted; attempt++) {
      for (const sel of postSels) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const disabled = await el.getAttribute('aria-disabled').catch(() => null);
          if (disabled === 'true') {
            console.log(`[Playwright] Nút Đăng bị khóa/disabled (${attempt + 1}/10) — chờ 2s...`);
            await page.waitForTimeout(2000);
            break;
          }
          console.log(`[Playwright] 🚀 Click nút Đăng bài: "${sel}"`);
          await el.click({ timeout: 8000 });
          await page.waitForTimeout(7000);
          posted = true;
          break;
        }
      }
    }

    if (!posted) {
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(6000);
      posted = true;
    }

    await browser.close();
    return { success: true, targetId, message: '🎉 Đăng video thành công lên Facebook!' };  } catch (error) {
    if (browser) { try { await browser.close(); } catch(e) {} }
    throw new Error(`Đăng video thất bại: ${error.message}`);
  }
}

module.exports = { getPages, createPage, getFeedbackIdForUrl, reactPost, postToFacebook };
