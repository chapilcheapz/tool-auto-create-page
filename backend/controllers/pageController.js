const facebookService = require('../services/facebookService');
const campaignManager = require('../utils/campaignManager');

async function fetchPages(req, res) {
  const { cookie } = req.body;
  if (!cookie || !cookie.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp cookie!' });
  }

  try {
    const pages = await facebookService.getPages(cookie);
    return res.json({ success: true, pages });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * API Tạo Page Hàng Loạt qua Campaign ngầm
 */
async function createNewPage(req, res) {
  const { cookie, pageNames, pageBios, customBio, category, count } = req.body;
  if (!cookie || !cookie.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp cookie!' });
  }

  // Phân tích danh sách tên page ban đầu
  let namesList = Array.isArray(pageNames) && pageNames.length > 0 ? pageNames : [];

  const targetCount = parseInt(count, 10) || 1;

  // Nếu danh sách tên trống, hoặc chỉ nhập 1 tên cơ bản nhưng số lượng (count) lớn hơn 1
  if (namesList.length === 0 || (namesList.length === 1 && targetCount > 1)) {
    const baseName = namesList[0] || '';
    namesList = [];
    for (let i = 0; i < targetCount; i++) {
      namesList.push(baseName ? `${baseName} ${i + 1}` : '');
    }
  }

  const campaignId = 'create_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  // Tạo chiến dịch ngầm với số lượng thực tế trong namesList
  campaignManager.createCampaign(campaignId, 'create-page', namesList.length);

  // Trả về mã chiến dịch ngay lập tức cho client
  res.json({ success: true, campaignId });

  // Khởi chạy tiến trình tạo page ngầm
  (async () => {
    for (let i = 0; i < namesList.length; i++) {
      const name = namesList[i];
      const bio = (Array.isArray(pageBios) ? pageBios[i] : pageBios) || customBio || '';
      
      try {
        const result = await facebookService.createPage(cookie, name, bio, category);
        const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        campaignManager.addLog(campaignId, {
          success: result.success,
          pageName: result.name || name || 'Tên ngẫu nhiên',
          pageBio: result.bio || bio || 'Bio ngẫu nhiên',
          pageId: result.pageId || '',
          error: result.error || '',
          time
        });
      } catch (error) {
        const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        campaignManager.addLog(campaignId, {
          success: false,
          pageName: name || 'Tên ngẫu nhiên',
          pageBio: bio || 'Bio ngẫu nhiên',
          pageId: '',
          error: error.message,
          time
        });
      }

      // Delay 1 giây giữa các lần tạo trang
      if (i < namesList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Đánh dấu hoàn thành chiến dịch
    campaignManager.endCampaign(campaignId);
  })();
}

/**
 * API Đăng ký nhận luồng Server-Sent Events (SSE) để theo dõi tiến độ chiến dịch
 */
function streamCampaignLogs(req, res) {
  const { id } = req.params;
  campaignManager.addClient(id, res);
}

module.exports = {
  fetchPages,
  createNewPage,
  streamCampaignLogs
};
