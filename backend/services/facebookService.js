const axios = require('axios');
const querystring = require('querystring');
const { chromium } = require('playwright');
const { extractTokens } = require('../utils/extract-tokens');
const { generatePageName, generateBio, buildCommonParams, buildHeaders } = require('../utils/random');

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
  const tokens = await extractTokens(cookie);
  if (!tokens.success) {
    throw new Error(`Không thể trích xuât token: ${tokens.error}`);
  }

  const config = {
    cookie,
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

  const params = {
    av: config.__user,
    ...buildCommonParams(config),
    __crn: 'comet.fbweb.CometHomeRoute',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery',
    server_timestamps: 'true',
    variables: JSON.stringify({ scale: 2 }),
    doc_id: '27150973057845854'
  };

  const response = await axios.post(
    'https://www.facebook.com/api/graphql/',
    querystring.stringify(params),
    { headers }
  );

  return parsePagesFromGraphQL(response.data);
}

/**
 * Create a new Facebook Page
 */
async function createPage(cookie, customName, customBio, category) {
  const tokens = await extractTokens(cookie);
  if (!tokens.success) {
    throw new Error(`Lỗi token: ${tokens.error}`);
  }

  const pageName = customName && customName.trim() ? customName.trim() : generatePageName();
  const pageBio = customBio && customBio.trim() ? customBio.trim() : generateBio(pageName);
  const pageCategory = category && category.trim() ? category.trim() : '2347428775505624';

  const config = {
    cookie,
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
  headers['x-fb-friendly-name'] = 'ProfileCometCreationMutation';

  const variables = {
    input: {
      bio: pageBio,
      categories: [pageCategory],
      name: pageName,
      page_creation_source: 'COMET_LAUNCHPOINT',
      client_mutation_id: '1'
    }
  };

  const params = {
    av: config.__user,
    ...buildCommonParams(config),
    __crn: 'comet.fbweb.CometHomeRoute',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'ProfileCometCreationMutation',
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
    doc_id: '8682136001859062'
  };

  const response = await axios.post(
    'https://www.facebook.com/api/graphql/',
    querystring.stringify(params),
    { headers }
  );

  const respData = response.data;
  const isSuccess = JSON.stringify(respData).includes('page_create');

  if (isSuccess) {
    return { success: true, name: pageName, bio: pageBio };
  } else {
    throw new Error(JSON.stringify(respData));
  }
}

/**
 * Translate Reel/Video ID to story feedback ID by parsing HTML
 */
async function getFeedbackIdForUrl(postUrl, postId, cookie) {
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
    const cookieParts = cookie.split(';').map(part => part.trim());
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
