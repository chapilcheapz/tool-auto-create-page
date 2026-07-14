const facebookService = require('../services/facebookService');
const { extractTokens } = require('../utils/extract-tokens');

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

async function bulkReact(req, res) {
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

  try {
    // Lấy cookie của tài khoản đầu tiên để gọi tác vụ chung
    const primaryCookie = cookie.split('\n').map(c => c.trim()).filter(Boolean)[0] || cookie;

    // 1. Lấy đúng feedback_id (xử lý link Reel/Video)
    const feedbackId = await facebookService.getFeedbackIdForUrl(postUrl, postId, primaryCookie);

    // 2. Lấy danh sách tất cả các Page từ tất cả các Cookie
    let pages = await facebookService.getPages(cookie);
    if (pages.length === 0) {
      return res.status(404).json({ success: false, error: 'Không sở hữu Page nào từ các tài khoản đã đăng nhập!' });
    }

    // Giới hạn số lượng page chạy nếu người dùng nhập
    const maxLimit = parseInt(limit, 10);
    if (maxLimit > 0 && maxLimit < pages.length) {
      pages = pages.slice(0, maxLimit);
    }

    const results = [];
    const targetReaction = reactionType || '1635855486666999'; // Default Like

    // 3. Thả cảm xúc tuần tự cho từng Page sử dụng đúng Cookie của tài khoản sở hữu
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageCookie = page.ownerCookie || primaryCookie;
      
      try {
        // Trích xuất token bảo mật cho tài khoản sở hữu Page này
        const tokens = await extractTokens(pageCookie);
        if (!tokens.success) {
          results.push({
            pageId: page.id,
            name: page.name,
            success: false,
            error: `Lỗi token của tài khoản sở hữu page: ${tokens.error}`
          });
          continue;
        }

        const config = {
          cookie: pageCookie,
          fb_dtsg: tokens.fb_dtsg,
          __user: tokens.__user,
          lsd: tokens.lsd,
          jazoest: tokens.jazoest,
          __hsi: tokens.__hsi || '',
          __rev: tokens.__rev || '',
          __dyn: '',
          __csr: '',
        };

        const outcome = await facebookService.reactPost(config, page.id, feedbackId, targetReaction, i + 1);
        if (outcome.success) {
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

    return res.json({
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

    return res.status(500).json({
      success: false,
      error: errorMsg
    });
  }
}

module.exports = {
  bulkReact
};
