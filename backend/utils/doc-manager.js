const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { chromium } = require('playwright');

const CONFIG_PATH = path.join(__dirname, '../doc_ids.json');

const DEFAULT_DOC_IDS = {
  AdditionalProfilePlusCreationMutation: '23863457623296585',
  PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery: '27150973057845854'
};

function readDocIds() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_DOC_IDS, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Lỗi đọc doc_ids.json:', e.message);
  }
  return DEFAULT_DOC_IDS;
}

function writeDocIds(docIds) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(docIds, null, 2), 'utf8');
  } catch (e) {
    console.error('Lỗi ghi doc_ids.json:', e.message);
  }
}

function getDocId(mutationName) {
  const docIds = readDocIds();
  return docIds[mutationName] || DEFAULT_DOC_IDS[mutationName];
}

function setDocId(mutationName, newDocId) {
  const docIds = readDocIds();
  docIds[mutationName] = newDocId;
  writeDocIds(docIds);
}

function extractDocIdFromJs(jsContent, mutationName) {
  const patterns = [
    new RegExp(`name\\s*:\\s*["']${mutationName}["']\\s*,\\s*params\\s*:\\s*\\{\\s*id\\s*:\\s*["'](\\d+)["']`),
    new RegExp(`params\\s*:\\s*\\{\\s*id\\s*:\\s*["'](\\d+)["']\\s*,[^}]*name\\s*:\\s*["']${mutationName}["']`),
    new RegExp(`["']${mutationName}["']\\s*,\\s*params\\s*:\\s*\\{\\s*id\\s*:\\s*["'](\\d+)["']`)
  ];

  for (const pattern of patterns) {
    const match = jsContent.match(pattern);
    if (match) return match[1];
  }
  
  const idx = jsContent.indexOf(mutationName);
  if (idx !== -1) {
    const windowText = jsContent.substring(Math.max(0, idx - 400), Math.min(jsContent.length, idx + 400));
    const match = windowText.match(/id\s*:\s*["'](\d+)["']/);
    if (match) return match[1];
  }
  
  return null;
}

async function autoDiscoverDocId(cookie, mutationName) {
  console.log(`[Auto-Discovery] Bắt đầu dò tìm doc_id mới cho mutation: ${mutationName}...`);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--mute-audio']
    });
    const context = await browser.newContext();
    
    // Nạp cookies
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

    let discoveredId = null;

    // 1. Lắng nghe các request gửi đi để chụp doc_id thực tế (Độ chính xác 100%)
    page.on('request', request => {
      try {
        const url = request.url();
        if (url.includes('/api/graphql/')) {
          const postData = request.postData();
          if (postData) {
            const isTargetMutation = postData.includes(mutationName) || 
                                     (mutationName === 'AdditionalProfilePlusCreationMutation' && 
                                      (postData.includes('page_creation_source') || postData.includes('COMET_LAUNCHPOINT') || postData.includes('ProfilePlus') || postData.includes('AdditionalProfile')));
            
            if (isTargetMutation) {
              const docIdMatch = postData.match(/doc_id=([\d]+)/);
              if (docIdMatch) {
                discoveredId = docIdMatch[1];
                console.log(`[Auto-Discovery] Chụp được doc_id thực tế từ request gửi đi: ${discoveredId}`);
              }
            }
          }
        }
      } catch (err) {
        // ignore
      }
    });

    // 2. Lắng nghe script response để quét JS bundle
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('.js') && response.status() === 200) {
        try {
          const text = await response.text();
          if (text.includes(mutationName)) {
            const docId = extractDocIdFromJs(text, mutationName);
            if (docId) {
              discoveredId = docId;
              console.log(`[Auto-Discovery] Tìm thấy doc_id từ file JS bundle: ${discoveredId}`);
            }
          }
        } catch (e) {
          // ignore
        }
      }
    });

    // Mở trang tạo page để kích hoạt việc tải JS bundle tạo page
    const targetUrl = mutationName === 'AdditionalProfilePlusCreationMutation' 
      ? 'https://www.facebook.com/pages/creation/' 
      : 'https://www.facebook.com/pages/?category=your_pages';
      
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const currentUrl = page.url();
    console.log(`[Auto-Discovery] URL trình duyệt hiện tại: ${currentUrl}`);
    await page.waitForTimeout(4000); // Chờ load trang ban đầu

    // 3. Tương tác giả lập điền form để kích hoạt load component hoặc kích hoạt gửi request tạo page thật
    if (mutationName === 'AdditionalProfilePlusCreationMutation' && !discoveredId) {
      console.log(`[Auto-Discovery] Đang tiến hành điền form tạo page giả lập để kích hoạt request...`);
      try {
        await page.waitForSelector('input:visible', { timeout: 10000 });
        const inputs = await page.locator('input:visible, textarea:visible').all();
        console.log(`[Auto-Discovery] Tìm thấy tổng cộng ${inputs.length} ô input hiển thị.`);
        
        let nameInput = null;
        let categoryInput = null;

        for (let i = 0; i < inputs.length; i++) {
          const type = await inputs[i].getAttribute('type') || '';
          const label = await inputs[i].getAttribute('aria-label') || '';
          const role = await inputs[i].getAttribute('role') || '';
          const placeholder = await inputs[i].getAttribute('placeholder') || '';
          
          const isSearchHeader = label.includes('Tìm kiếm') || placeholder.includes('Tìm kiếm') || label.toLowerCase().includes('search');
          if (isSearchHeader) continue;

          // Nhận diện Tên trang: là ô input text đầu tiên của form (thường là type=text)
          if (type === 'text' && !nameInput) {
            nameInput = inputs[i];
            console.log(`[Auto-Discovery] Nhận diện Tên trang -> Input #${i}`);
          }
          
          // Nhận diện Hạng mục: có nhãn Hạng mục/Category hoặc role combobox
          if (label.includes('Hạng mục') || placeholder.includes('Hạng mục') || label.toLowerCase().includes('category') || role === 'combobox') {
            if (!categoryInput) {
              categoryInput = inputs[i];
              console.log(`[Auto-Discovery] Nhận diện Hạng mục -> Input #${i}`);
            }
          }
        }

        if (nameInput && categoryInput) {
          // Điền tên trang test
          await nameInput.fill('Auto test page ' + Math.floor(Math.random() * 10000));
          await page.waitForTimeout(1000);
          
          // Click vào ô hạng mục để mở dropdown
          await categoryInput.click();
          await page.waitForTimeout(1500);
          
          // Gõ 1 ký tự để kích hoạt gợi ý
          await categoryInput.type('B', { delay: 100 });
          await page.waitForTimeout(2000);

          // Tìm và click vào item đầu tiên trong dropdown
          const listItems = page.locator('[role="option"], [role="listbox"] li, [role="listbox"] div').first();
          const hasItem = await listItems.isVisible().catch(() => false);
          if (hasItem) {
            await listItems.click();
            console.log('[Auto-Discovery] Đã chọn hạng mục từ dropdown.');
          } else {
            // Fallback: nhấn ArrowDown + Enter
            await categoryInput.press('ArrowDown');
            await page.waitForTimeout(500);
            await categoryInput.press('Enter');
            console.log('[Auto-Discovery] Đã chọn hạng mục bằng ArrowDown+Enter.');
          }
          await page.waitForTimeout(1000);

          // Tìm nút Tạo trang (bất kể disabled hay không)
          const createBtn = page.locator('[aria-label="Tạo trang"], [aria-label="Create Page"], div[role="button"]:has-text("Tạo trang"), button:has-text("Tạo trang"), div[role="button"]:has-text("Create Page"), button:has-text("Create Page")').first();
          const btnVisible = await createBtn.isVisible().catch(() => false);
          if (btnVisible) {
            await createBtn.click({ force: true }); // force để vượt qua disabled
            console.log('[Auto-Discovery] Đã click nút Tạo trang giả lập. Đang chờ chụp request...');
          } else {
            console.log('[Auto-Discovery] Không tìm thấy nút Tạo trang.');
          }
          
          // Chờ 6 giây để request bay đi và listener bắt được
          await page.waitForTimeout(6000);
        } else {
          console.log(`[Auto-Discovery] Không tìm thấy đủ các ô nhập liệu cần thiết (Tên trang & Hạng mục).`);
        }
      } catch (interactiveError) {
        console.log(`[Auto-Discovery] Lỗi tương tác giả lập (có thể bỏ qua nếu đã quét được JS):`, interactiveError.message);
      }
    } else {
      // Chờ thêm 6 giây cho getPages hoặc khi đã quét xong
      await page.waitForTimeout(6000);
    }
    
    await browser.close();

    if (discoveredId) {
      console.log(`[Auto-Discovery] Thành công! Đã lấy được doc_id mới: ${discoveredId}`);
      setDocId(mutationName, discoveredId);
      return discoveredId;
    } else {
      console.log(`[Auto-Discovery] Thất bại! Không tìm thấy doc_id cho ${mutationName}.`);
      return null;
    }
  } catch (error) {
    console.error(`[Auto-Discovery] Lỗi trong quá trình chạy Playwright:`, error.message);
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
    return null;
  }
}

module.exports = {
  getDocId,
  setDocId,
  autoDiscoverDocId
};
