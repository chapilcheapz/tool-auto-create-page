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

app.listen(PORT, () => {
  console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}\n`);
});
