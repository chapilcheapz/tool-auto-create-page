const fs = require('fs');
const path = require('path');

const configFilePath = path.join(__dirname, '../../config.json');

/**
 * Đọc cấu hình từ file config.json cục bộ
 * @returns {Promise<Object>} - { cookie }
 */
async function readConfig() {
  try {
    if (!fs.existsSync(configFilePath)) {
      return { cookie: '' };
    }
    const rawData = fs.readFileSync(configFilePath, 'utf8');
    const config = JSON.parse(rawData);
    return { cookie: config.cookie || '' };
  } catch (e) {
    console.error('Lỗi khi đọc file config.json:', e.message);
    return { cookie: '' };
  }
}

/**
 * Ghi cấu hình vào file config.json cục bộ
 * @param {string} cookieValue
 * @returns {Promise<Object>} - { success: true }
 */
async function writeConfig(cookieValue) {
  try {
    const config = { cookie: cookieValue || '' };
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    throw new Error('Không thể lưu cấu hình cục bộ: ' + e.message);
  }
}

const crypto = require('crypto');
let dynamicJwtSecret = null;

function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (!dynamicJwtSecret) {
    dynamicJwtSecret = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️ Cảnh báo: process.env.JWT_SECRET trống. Đã tạo một JWT_SECRET ngẫu nhiên cho phiên chạy này.');
  }
  return dynamicJwtSecret;
}

module.exports = {
  readConfig,
  writeConfig,
  getJwtSecret
};
