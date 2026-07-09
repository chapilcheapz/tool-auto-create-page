const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const querystring = require('querystring');
const { generatePageName, generateBio, buildCommonParams, buildHeaders } = require('./utils/random');
const { extractTokens } = require('./utils/extract-tokens');

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Helper functions to parse pages recursively from FB GraphQL multiline JSON response
function parsePagesFromGraphQL(responseData) {
  const pages = [];
  const responseText = typeof responseData === 'string'
    ? responseData
    : JSON.stringify(responseData);

  const lines = responseText.split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      findPagesRecursively(parsed, pages);
    } catch (e) {
      // ignore
    }
  }

  // De-duplicate pages by id
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

  // A page node has id, name and typically a profile_picture or is in list page query nodes
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

// Fetch pages list endpoint
app.post('/api/get-pages', async (req, res) => {
  const { cookie } = req.body;

  if (!cookie || !cookie.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Vui lòng cung cấp cookie!'
    });
  }

  try {
    const tokens = await extractTokens(cookie);

    if (!tokens.success) {
      return res.status(500).json({
        success: false,
        error: `Không thể trích xuất token: ${tokens.error}`
      });
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

    const pages = parsePagesFromGraphQL(response.data);

    res.json({
      success: true,
      pages
    });

  } catch (error) {
    const errorMsg = error.response
      ? `Facebook API Error: ${error.response.status} - ${JSON.stringify(error.response.data).substring(0, 300)}`
      : error.message;

    res.status(500).json({
      success: false,
      error: errorMsg
    });
  }
});


// Create page — chỉ cần cookie, tự lấy token rồi tạo page luôn
app.post('/api/create-page', async (req, res) => {
  const { cookie, customName, customBio, category } = req.body;

  if (!cookie || !cookie.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Vui lòng nhập cookie!'
    });
  }

  const pageName = customName || generatePageName();
  const pageBio = customBio || generateBio(pageName);
  const pageCategory = category || '2347428775505624';

  try {
    // ====== STEP 0: Trích xuất token từ cookie bằng Playwright ======
    const tokens = await extractTokens(cookie);

    if (!tokens.success) {
      return res.status(500).json({
        success: false,
        error: `Không thể trích xuất token: ${tokens.error}`,
        pageName,
        pageBio
      });
    }

    // Build config từ cookie + token đã trích xuất
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

    if (!config.fb_dtsg || !config.__user || !config.lsd || !config.jazoest) {
      return res.status(500).json({
        success: false,
        error: `Thiếu token: fb_dtsg=${!!config.fb_dtsg}, __user=${!!config.__user}, lsd=${!!config.lsd}, jazoest=${!!config.jazoest}`,
        pageName,
        pageBio
      });
    }

    // ====== STEP 1: Navigation ======
    const navHeaders = buildHeaders(config);
    const navParams = {
      client_previous_actor_id: config.__user,
      route_url: '/pages/creation/?profile_switcher_unified_creation=3870284937&ref_type=profile_switcher_unified_creation',
      routing_namespace: 'fb_comet',
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute'
    };

    await axios.post(
      'https://www.facebook.com/ajax/navigation/',
      querystring.stringify(navParams),
      { headers: navHeaders }
    );

    // ====== STEP 2: Create Page Mutation ======
    const createHeaders = {
      ...buildHeaders(config),
      'x-fb-friendly-name': 'AdditionalProfilePlusCreationMutation'
    };

    const variables = {
      input: {
        bio: pageBio,
        categories: [pageCategory],
        creation_source: 'comet',
        name: pageName,
        off_platform_creator_reachout_id: null,
        page_referrer: 'profile_switcher_unified_creation',
        actor_id: config.__user,
        client_mutation_id: Math.floor(Math.random() * 100).toString()
      }
    };

    const createParams = {
      av: config.__user,
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'AdditionalProfilePlusCreationMutation',
      server_timestamps: 'true',
      variables: JSON.stringify(variables),
      doc_id: '23863457623296585'
    };

    const createResponse = await axios.post(
      'https://www.facebook.com/api/graphql/',
      querystring.stringify(createParams),
      { headers: createHeaders }
    );

    // Parse page ID from response
    let pageId = null;
    const responseText = typeof createResponse.data === 'string'
      ? createResponse.data
      : JSON.stringify(createResponse.data);

    const lines = responseText.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?.data?.additional_profile_plus_create?.additional_profile?.id) {
          pageId = parsed.data.additional_profile_plus_create.additional_profile.id;
          break;
        }
        if (parsed?.data?.additional_profile_plus_create?.profile?.id) {
          pageId = parsed.data.additional_profile_plus_create.profile.id;
          break;
        }
        const idMatch = JSON.stringify(parsed).match(/"id"\s*:\s*"(\d{10,})"/);
        if (idMatch && idMatch[1] !== config.__user) {
          pageId = idMatch[1];
          break;
        }
      } catch (e) {
        // Skip unparseable lines
      }
    }

    if (!pageId) {
      return res.json({
        success: true,
        warning: 'Page có thể đã tạo nhưng không parse được ID từ response',
        pageName,
        pageBio,
        rawResponse: responseText.substring(0, 500)
      });
    }

    // ====== STEP 3: CTA Button Query ======
    const ctaHeaders = {
      ...buildHeaders(config),
      'x-fb-friendly-name': 'AdditionalProfilePlusCreationFormEditCTAButtonRendererQuery'
    };

    const ctaParams = {
      av: pageId,
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'AdditionalProfilePlusCreationFormEditCTAButtonRendererQuery',
      server_timestamps: 'true',
      variables: JSON.stringify({ userID: pageId, scale: 2 }),
      doc_id: '27487860774183988'
    };

    await axios.post(
      'https://www.facebook.com/api/graphql/',
      querystring.stringify(ctaParams),
      { headers: ctaHeaders }
    );

    // ====== STEP 4: Onboarding Eligibility ======
    const onboardHeaders = {
      ...buildHeaders(config),
      'x-fb-friendly-name': 'useIntegratedOnboardingEligibilityMutation'
    };

    const onboardParams = {
      av: config.__user,
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometAdditionalProfilePlusCreationRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'useIntegratedOnboardingEligibilityMutation',
      server_timestamps: 'true',
      variables: JSON.stringify({ pageId: pageId }),
      doc_id: '9926214160816587'
    };

    await axios.post(
      'https://www.facebook.com/api/graphql/',
      querystring.stringify(onboardParams),
      { headers: onboardHeaders }
    );

    // ====== SUCCESS ======
    res.json({
      success: true,
      pageId,
      pageName,
      pageBio,
      pageUrl: `https://www.facebook.com/${pageId}`,
      createdAt: new Date().toISOString()
    });

  } catch (error) {
    const errorMsg = error.response
      ? `Facebook API Error: ${error.response.status} - ${JSON.stringify(error.response.data).substring(0, 300)}`
      : error.message;

    res.status(500).json({
      success: false,
      error: errorMsg,
      pageName,
      pageBio
    });
  }
});

const { chromium } = require('playwright');

// Helper to extract post ID or string ID from Facebook URL
function extractPostId(url) {
  if (!url) return null;
  const decodeUrl = decodeURIComponent(url);
  const patterns = [
    /\/posts\/([a-zA-Z0-9_.]+)/,
    /story_fbid=([a-zA-Z0-9_.]+)/,
    /fbid=([a-zA-Z0-9_.]+)/,
    /\/permalink\.php\?story_fbid=([a-zA-Z0-9_.]+)/,
    /\/photos\/a\.\d+\.([a-zA-Z0-9_.]+)\//,
    /\/photos\/([a-zA-Z0-9_.]+)/,
    /\/videos\/([a-zA-Z0-9_.]+)/,
    /watch\/\?v=([a-zA-Z0-9_.]+)/,
    /\/groups\/[^/]+\/permalink\/(\d+)/,
    /\/groups\/[^/]+\/posts\/(\d+)/,
    /\/reels?\/([a-zA-Z0-9_.]+)/
  ];
  for (const pattern of patterns) {
    const match = decodeUrl.match(pattern);
    if (match) return match[1];
  }
  // If user enters direct post ID
  if (/^\d+$/.test(url.trim()) || /^pfbid[a-zA-Z0-9]+$/.test(url.trim())) {
    return url.trim();
  }
  return null;
}

// Helper to translate Reel/Video ID to real Post Feedback ID
async function getFeedbackIdForUrl(postUrl, postId, cookie) {
  if (!postUrl.includes('/reel/') && !postUrl.includes('/reels/') && !postUrl.includes('/videos/') && !postUrl.includes('watch')) {
    return Buffer.from(`feedback:${postId}`).toString('base64');
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
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

// Bulk Page React endpoint
app.post('/api/react-post', async (req, res) => {
  const { cookie, postUrl, reactionType, limit } = req.body;

  if (!cookie || !cookie.trim()) {
    return res.status(400).json({ success: false, error: 'Thiếu Cookie!' });
  }
  if (!postUrl || !postUrl.trim()) {
    return res.status(400).json({ success: false, error: 'Thiếu Link bài viết!' });
  }

  const postId = extractPostId(postUrl);
  if (!postId) {
    return res.status(400).json({
      success: false,
      error: 'Không tìm thấy Post ID hợp lệ trong link bài viết! Vui lòng kiểm tra lại link.'
    });
  }

  // Get correct feedback ID (handles Reel/Video translation)
  const feedbackId = await getFeedbackIdForUrl(postUrl, postId, cookie);


  try {
    // 1. Trích xuất token chính
    const tokens = await extractTokens(cookie);
    if (!tokens.success) {
      return res.status(500).json({ success: false, error: `Lỗi token: ${tokens.error}` });
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

    // 2. Lấy danh sách Page
    const listHeaders = buildHeaders(config);
    listHeaders['x-fb-friendly-name'] = 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery';

    const listParams = {
      av: config.__user,
      ...buildCommonParams(config),
      __crn: 'comet.fbweb.CometHomeRoute',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery',
      server_timestamps: 'true',
      variables: JSON.stringify({ scale: 2 }),
      doc_id: '27150973057845854'
    };

    const listResponse = await axios.post(
      'https://www.facebook.com/api/graphql/',
      querystring.stringify(listParams),
      { headers: listHeaders }
    );

    let pages = parsePagesFromGraphQL(listResponse.data);

    if (pages.length === 0) {
      return res.status(404).json({ success: false, error: 'Tài khoản không sở hữu Page nào!' });
    }

    // Giới hạn số lượng page chạy nếu người dùng nhập
    const maxLimit = parseInt(limit, 10);
    if (maxLimit > 0 && maxLimit < pages.length) {
      pages = pages.slice(0, maxLimit);
    }

    const results = [];
    const targetReaction = reactionType || '1635855486666999'; // Default Like

    // 3. Thả cảm xúc tuần tự cho từng Page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        const reactHeaders = {
          ...buildHeaders(config),
          'x-fb-friendly-name': 'CometUFIFeedbackReactMutation'
        };

        const variables = {
          input: {
            attribution_id_v2: `ProfileCometTimelineListViewRoot.react,comet.profile.timeline.list,via_cold_start,${Date.now()},45171,250100865708545,,`,
            feedback_id: feedbackId,
            feedback_reaction_id: targetReaction,
            feedback_source: 'PROFILE',
            feedback_referrer: '/profile.php',
            is_tracking_encrypted: true,
            tracking: [],
            session_id: 'aa6e11ec-47c8-47fd-8018-caffe569df91',
            actor_id: page.id,
            client_mutation_id: (i + 1).toString()
          },
          scale: 2,
          canUseNicknameOnComet: false,
          useDefaultActor: false,
          __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
        };

        const reactParams = {
          av: page.id,
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

        // Simple check mutation response
        const respStr = JSON.stringify(response.data);
        if (respStr.includes('feedback_react') || respStr.includes('feedback') || response.status === 200) {
          results.push({ pageId: page.id, name: page.name, success: true });
        } else {
          results.push({ pageId: page.id, name: page.name, success: false, error: 'Facebook phản hồi không thành công' });
        }

      } catch (err) {
        results.push({
          pageId: page.id,
          name: page.name,
          success: false,
          error: err.response ? `API Error ${err.response.status}` : err.message
        });
      }

      // Delay 150ms để an toàn
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    res.json({
      success: true,
      postId,
      feedbackId,
      totalRun: pages.length,
      results
    });

  } catch (error) {
    const errorMsg = error.response
      ? `Facebook API Error: ${error.response.status} - ${JSON.stringify(error.response.data).substring(0, 300)}`
      : error.message;

    res.status(500).json({
      success: false,
      error: errorMsg
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}\n`);
});

