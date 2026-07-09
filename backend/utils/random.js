// Random Vietnamese & English names for page creation
const firstNames = [
  'Minh', 'Anh', 'Hương', 'Lan', 'Phúc', 'Thảo', 'Tùng', 'Mai', 'Đức', 'Linh',
  'Bảo', 'Ngọc', 'Trung', 'Hà', 'Quân', 'Vy', 'Khoa', 'Trang', 'Nam', 'Thy',
  'Alex', 'Luna', 'Max', 'Mia', 'Leo', 'Zoe', 'Kai', 'Noa', 'Ava', 'Eli'
];

const lastNames = [
  'Shop', 'Store', 'Beauty', 'Fashion', 'Style', 'Home', 'Food', 'Tech', 'Art', 'Music',
  'Boutique', 'Studio', 'Corner', 'Place', 'World', 'Hub', 'Zone', 'Lab', 'Space', 'House'
];

const prefixes = [
  'The', 'My', 'Best', 'Top', 'Pro', 'Super', 'New', 'Hot', 'Cool', 'Star',
  'Golden', 'Silver', 'Royal', 'Prime', 'Elite', 'Smart', 'Fresh', 'Happy', 'Lucky', 'Sweet'
];

const bioTemplates = [
  'Chào mừng bạn đến với {name}! 🌟',
  '✨ {name} - Nơi bạn tìm thấy điều tuyệt vời',
  '{name} | Chất lượng hàng đầu 🏆',
  'Theo dõi {name} để cập nhật mới nhất! 💫',
  '🎯 {name} - Uy tín, chất lượng',
  'Welcome to {name}! Follow us for more 🔥',
  '{name} ✦ Quality & Trust',
  '🌈 {name} bringing joy to your life',
  '{name} - Where quality meets passion 💎',
  '⭐ {name} - Your trusted choice'
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePageName() {
  const style = Math.floor(Math.random() * 4);
  switch (style) {
    case 0: return `${randomItem(firstNames)} ${randomItem(lastNames)}`;
    case 1: return `${randomItem(prefixes)} ${randomItem(lastNames)}`;
    case 2: return `${randomItem(firstNames)}'s ${randomItem(lastNames)}`;
    case 3: return `${randomItem(prefixes)} ${randomItem(firstNames)} ${randomItem(lastNames)}`;
    default: return `${randomItem(firstNames)} ${randomItem(lastNames)}`;
  }
}

function generateBio(pageName) {
  const template = randomItem(bioTemplates);
  return template.replace(/{name}/g, pageName);
}

function buildCommonParams(config) {
  return {
    __aaid: '0',
    __user: config.__user,
    __a: '1',
    __hs: config.__hs || '20642.HYP:comet_pkg.2.1...0',
    dpr: '2',
    __ccg: 'EXCELLENT',
    __rev: config.__rev || '1042828618',
    __s: config.__s || '',
    __hsi: config.__hsi || '',
    __dyn: config.__dyn || '',
    __csr: config.__csr || '',
    __comet_req: '15',
    fb_dtsg: config.fb_dtsg,
    jazoest: config.jazoest,
    lsd: config.lsd,
    __spin_r: config.__rev || '1042828618',
    __spin_b: 'trunk',
    __spin_t: Math.floor(Date.now() / 1000).toString(),
  };
}

function buildHeaders(config) {
  return {
    'accept': '*/*',
    'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
    'content-type': 'application/x-www-form-urlencoded',
    'priority': 'u=1, i',
    'sec-ch-prefers-color-scheme': 'light',
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-full-version-list': '"Google Chrome";v="149.0.7827.201", "Chromium";v="149.0.7827.201", "Not)A;Brand";v="24.0.0.0"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-platform-version': '"15.5.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-asbd-id': '359341',
    'x-fb-lsd': config.lsd,
    'cookie': config.cookie,
    'origin': 'https://www.facebook.com',
    'referer': 'https://www.facebook.com/pages/creation?profile_switcher_unified_creation=3870284937&ref_type=profile_switcher_unified_creation',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  };
}

module.exports = {
  generatePageName,
  generateBio,
  buildCommonParams,
  buildHeaders
};
