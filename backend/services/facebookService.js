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
    } catch (e) {
      // ignore
    }
  }

  // De-duplicate
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
  if (obj.id && obj.name && (obj.profile_picture || obj.profile_photo || obj.__typename === 'Page')) {
    list.push({
      id: obj.id,
      name: obj.name,
      avatar: obj.profile_picture?.uri || obj.profile_photo?.uri || null
    });
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
  if (cookieList.length === 0) {
    throw new Error('Không có cookie hợp lệ.');
  }

  // Hàm phụ lấy trang cho một cookie đơn lẻ
  const getPagesForSingleCookie = async (singleCookie) => {
    const tokens = await extractTokens(singleCookie);
    if (!tokens.success) {
      throw new Error(`Không thể trích xuất token: ${tokens.error}`);
    }

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

      return axios.post(
        'https://www.facebook.com/api/graphql/',
        querystring.stringify(params),
        { headers }
      );
    };

    let docId = getDocId('PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery');
    let response;
    try {
      response = await executeRequest(docId);
    } catch (error) {
      throw new Error(`Lỗi kết nối Facebook: ${error.message}`);
    }

    let respData = response.data;
    let isDocIdError = typeof respData === 'string' 
      ? respData.includes('was not found') 
      : JSON.stringify(respData).includes('was not found');

    if (isDocIdError) {
      console.log(`[Self-Healing] Phát hiện doc_id lấy danh sách page cũ (${docId}) đã hết hạn. Đang tự động dò tìm doc_id mới...`);
      const newDocId = await autoDiscoverDocId(singleCookie, 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery');
      if (newDocId) {
        console.log(`[Self-Healing] Đã lấy được doc_id mới (${newDocId}). Tiến hành gửi lại yêu cầu lấy danh sách...`);
        try {
          response = await executeRequest(newDocId);
          respData = response.data;
        } catch (error) {
          throw new Error(`Lỗi kết nối Facebook khi gọi lại: ${error.message}`);
        }
      }
    }

    const responseText = typeof respData === 'string' ? respData : JSON.stringify(respData);
    if (responseText.includes('error":1357001') || responseText.includes('errorSummary') || responseText.includes('Vui lòng đăng nhập')) {
      throw new Error('Cookie hết hạn hoặc không hợp lệ (Facebook yêu cầu đăng nhập lại).');
    }

    const parsedPages = parsePagesFromGraphQL(respData);
    // Gắn thuộc tính ownerCookie cho mỗi page để sau này dùng đúng cookie của tài khoản đó khi thả cảm xúc
    for (const page of parsedPages) {
      page.ownerCookie = singleCookie;
    }
    return parsedPages;
  };

  const allPages = [];
  const seenIds = new Set();

  for (const singleCookie of cookieList) {
    try {
      const pages = await getPagesForSingleCookie(singleCookie);
      for (const page of pages) {
        if (!seenIds.has(page.id)) {
          seenIds.add(page.id);
          allPages.push(page);
        }
      }
    } catch (err) {
      console.error(`⚠️ [facebookService.getPages] Bỏ qua cookie lỗi của tài khoản Facebook:`, err.message);
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
  if (!tokens.success) {
    throw new Error(`Lỗi token: ${tokens.error}`);
  }

  const pageName = customName && customName.trim() ? customName.trim() : generatePageName();
  const pageBio = customBio && customBio.trim() ? customBio.trim() : generateBio(pageName);
  const pageCategory = category && category.trim() ? category.trim() : '2347428775505624';

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
      bio: pageBio,
      categories: [pageCategory],
      creation_source: 'comet',
      name: pageName,
      off_platform_creator_reachout_id: null,
      page_referrer: 'null',
      actor_id: config.__user,
      client_mutation_id: '1'
    }
  };

  const executeRequest = async (docIdValue) => {
    const params = {
      av: config.__user,
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'AdditionalProfilePlusCreationMutation',
      server_timestamps: 'true',
      variables: JSON.stringify(variables),
      doc_id: docIdValue
    };

    return axios.post(
      'https://www.facebook.com/api/graphql/',
      querystring.stringify(params),
      { headers }
    );
  };

  let docId = getDocId('AdditionalProfilePlusCreationMutation');
  let response;
  try {
    response = await executeRequest(docId);
  } catch (error) {
    throw new Error(`Lỗi kết nối Facebook: ${error.message}`);
  }

  let respData = response.data;
  let isDocIdError = typeof respData === 'string' 
    ? respData.includes('was not found') 
    : JSON.stringify(respData).includes('was not found');

  if (isDocIdError) {
    console.log(`[Self-Healing] Phát hiện doc_id tạo page cũ (${docId}) đã hết hạn. Đang tự động dò tìm doc_id mới...`);
    const newDocId = await autoDiscoverDocId(cookie, 'AdditionalProfilePlusCreationMutation');
    if (newDocId) {
      console.log(`[Self-Healing] Đã lấy được doc_id mới (${newDocId}). Tiến hành gửi lại yêu cầu tạo page...`);
      try {
        response = await executeRequest(newDocId);
        respData = response.data;
      } catch (error) {
        throw new Error(`Lỗi kết nối Facebook khi gọi lại: ${error.message}`);
      }
    } else {
      throw new Error(`Facebook đã thay đổi API tạo trang. Không thể tự động lấy doc_id mới. Chi tiết phản hồi: ${JSON.stringify(respData)}`);
    }
  }

  const respStr = JSON.stringify(respData);
  const isSuccess = respStr.includes('page_create') || 
                    (respStr.includes('additional_profile_plus_create') && 
                     !respStr.includes('error_message') &&
                     !respStr.includes('"page\":null'));

  if (isSuccess) {
    return { success: true, name: pageName, bio: pageBio };
  }

  // Bắt lỗi yêu cầu xác minh SMS
  if (respStr.includes('SMS verification') || respStr.includes('suspicious activity') || respStr.includes('error_message')) {
    let errorMsg = 'Facebook từ chối tạo trang.';
    try {
      const parsed = typeof respData === 'string' ? JSON.parse(respData) : respData;
      const fbError = parsed?.data?.additional_profile_plus_create?.error_message;
      if (fbError) {
        if (fbError.includes('SMS verification') || fbError.includes('suspicious activity')) {
          errorMsg = 'Facebook phát hiện hoạt động đáng ngờ. Vui lòng mở ứng dụng Facebook trên điện thoại và hoàn tất xác minh số điện thoại (SMS) trước khi tạo trang mới.';
        } else {
          errorMsg = `Facebook từ chối: ${fbError}`;
        }
      }
    } catch {}
    throw new Error(errorMsg);
  }

  throw new Error(respStr);
}

/**
 * Translate Reel/Video ID to story feedback ID by parsing HTML
 */
async function getFeedbackIdForUrl(postUrl, postId, cookie) {
  const primaryCookie = cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || cookie;
  if (!postUrl.includes('/reel/') && !postUrl.includes('/reels/') && !postUrl.includes('/videos/') && !postUrl.includes('watch')) {
    return Buffer.from(`feedback:${postId}`).toString('base64');
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--mute-audio']
    });
    const context = await browser.newContext();

    // Set cookies for facebook
    const cookieParts = primaryCookie.split(';').map(part => part.trim());
    const playwrightCookies = [];
    for (const part of cookieParts) {
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
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(4000); // Wait for scripts to load post_id

    const html = await page.content();
    await browser.close();

    // Extract real post_id from HTML window search
    let realPostId = null;
    let pos = 0;
    while (true) {
      const idx = html.indexOf(postId, pos);
      if (idx === -1) break;
      const windowStart = Math.max(0, idx - 1000);
      const windowEnd = Math.min(html.length, idx + 1000);
      const window = html.substring(windowStart, windowEnd);
      const match = window.match(/"post_id"\s*:\s*"(\d+)"/);
      if (match) {
        realPostId = match[1];
        break;
      }
      pos = idx + 1;
    }

    if (realPostId) {
      return Buffer.from(`feedback:${realPostId}`).toString('base64');
    }
  } catch (error) {
    console.error('Lỗi trích xuất feedback_id thật từ Reels/Video:', error.message);
  } finally {
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
  }

  // Fallback to default
  return Buffer.from(`feedback:${postId}`).toString('base64');
}

/**
 * Execute feedback reaction mutation for a single page
 */
async function reactPost(config, pageId, feedbackId, reactionType, index) {
  const reactHeaders = {
    ...buildHeaders(config),
    'x-fb-friendly-name': 'CometUFIFeedbackReactMutation'
  };

  const variables = {
    input: {
      attribution_id_v2: `ProfileCometTimelineListViewRoot.react,comet.profile.timeline.list,via_cold_start,${Date.now()},45171,250100865708545,,`,
      feedback_id: feedbackId,
      feedback_reaction_id: reactionType,
      feedback_source: 'PROFILE',
      feedback_referrer: '/profile.php',
      is_tracking_encrypted: true,
      tracking: [],
      session_id: 'aa6e11ec-47c8-47fd-8018-caffe569df91',
      actor_id: pageId,
      client_mutation_id: index.toString()
    },
    scale: 2,
    canUseNicknameOnComet: false,
    useDefaultActor: false,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
  };

  const reactParams = {
    av: pageId,
    ...buildCommonParams(config),
    __crn: 'comet.fbweb.CometProfileTimelineListViewRoute',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'CometUFIFeedbackReactMutation',
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
    doc_id: '27646120298312844'
  };

  const response = await axios.post(
    'https://www.facebook.com/api/graphql/',
    querystring.stringify(reactParams),
    { headers: reactHeaders }
  );

  const respStr = JSON.stringify(response.data);
  const success = respStr.includes('feedback_react') || respStr.includes('feedback') || response.status === 200;
  return { success, data: response.data };
}

module.exports = {
  getPages,
  createPage,
  getFeedbackIdForUrl,
  reactPost
};
