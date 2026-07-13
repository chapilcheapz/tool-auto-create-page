const campaigns = new Map();

/**
 * Khởi tạo một chiến dịch mới
 */
function createCampaign(id, type, total) {
  campaigns.set(id, {
    id,
    type,
    status: 'processing',
    total,
    successCount: 0,
    failCount: 0,
    logs: [],
    clients: []
  });
  return campaigns.get(id);
}

/**
 * Lấy thông tin chiến dịch
 */
function getCampaign(id) {
  return campaigns.get(id);
}

/**
 * Đăng ký một client lắng nghe luồng sự kiện SSE
 */
function addClient(id, res) {
  const campaign = campaigns.get(id);
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Không tìm thấy chiến dịch' });
    return;
  }

  // Thiết lập các header cần thiết cho Server-Sent Events (SSE)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Hỗ trợ Nginx Proxy Buffering disable
  });

  // Gửi thông báo bắt đầu kết nối
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Đã kết nối với luồng logs chiến dịch.' })}\n\n`);

  // Gửi toàn bộ những logs đã chạy trước đó (nếu có - trường hợp F5)
  if (campaign.logs.length > 0) {
    res.write(`data: ${JSON.stringify({ type: 'history', logs: campaign.logs, stats: { total: campaign.total, success: campaign.successCount, fail: campaign.failCount } })}\n\n`);
  }

  // Nếu chiến dịch đã hoàn thành trước đó, thông báo đóng luồng luôn
  if (campaign.status === 'completed' || campaign.status === 'failed') {
    res.write(`data: ${JSON.stringify({ type: 'done', status: campaign.status })}\n\n`);
    res.end();
    return;
  }

  // Đăng ký client vào danh sách lắng nghe
  campaign.clients.push(res);

  // Giữ kết nối mở bằng cách gửi tin nhắn trống (heartbeat) định kỳ
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  reqCloseListener(res, campaign, keepAlive);
}

function reqCloseListener(res, campaign, keepAlive) {
  res.on('close', () => {
    clearInterval(keepAlive);
    campaign.clients = campaign.clients.filter(client => client !== res);
  });
}

/**
 * Đẩy một log mới về tất cả các client đang kết nối
 */
function addLog(id, logItem) {
  const campaign = campaigns.get(id);
  if (!campaign) return;

  campaign.logs.push(logItem);
  if (logItem.success) {
    campaign.successCount++;
  } else {
    campaign.failCount++;
  }

  const message = JSON.stringify({
    type: 'log',
    log: logItem,
    stats: {
      total: campaign.total,
      success: campaign.successCount,
      fail: campaign.failCount
    }
  });

  // Stream log tới toàn bộ client
  campaign.clients.forEach(client => {
    client.write(`data: ${message}\n\n`);
  });
}

/**
 * Đóng chiến dịch và hoàn thành kết nối
 */
function endCampaign(id, status = 'completed') {
  const campaign = campaigns.get(id);
  if (!campaign) return;

  campaign.status = status;

  const endMessage = JSON.stringify({
    type: 'done',
    status: campaign.status,
    stats: {
      total: campaign.total,
      success: campaign.successCount,
      fail: campaign.failCount
    }
  });

  // Báo kết thúc tới toàn bộ client và đóng kết nối
  campaign.clients.forEach(client => {
    client.write(`data: ${endMessage}\n\n`);
    client.end();
  });

  campaign.clients = [];
}

module.exports = {
  createCampaign,
  getCampaign,
  addClient,
  addLog,
  endCampaign
};
