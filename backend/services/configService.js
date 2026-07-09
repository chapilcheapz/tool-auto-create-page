const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(data);
      return { cookie: config.cookie || '' };
    }
  } catch (e) {
    console.error('Lỗi đọc file cấu hình config.json:', e.message);
  }
  return { cookie: '' };
}

function writeConfig(cookieValue) {
  try {
    const configData = { cookie: cookieValue || '' };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configData, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    console.error('Lỗi ghi file cấu hình config.json:', e.message);
    throw new Error('Không thể ghi file cấu hình config.json');
  }
}

module.exports = {
  readConfig,
  writeConfig
};
