// ========= DOM Elements =========
const $ = (sel) => document.querySelector(sel);
const inputCookie = $('#inputCookie');
const inputPageName = $('#inputPageName');
const inputPageBio = $('#inputPageBio');
const inputCategory = $('#inputCategory');
const btnCreatePage = $('#btnCreatePage');
const btnSaveConfig = $('#btnSaveConfig');
const btnClearConfig = $('#btnClearConfig');
const btnClearLog = $('#btnClearLog');
const btnOpenSettings = $('#btnOpenSettings');
const btnCloseSettings = $('#btnCloseSettings');
const settingsModal = $('#settingsModal');
const modalOverlay = $('#modalOverlay');
const logEmpty = $('#logEmpty');
const logTableWrap = $('#logTableWrap');
const logTableBody = $('#logTableBody');
const statTotal = $('#statTotal');
const statSuccess = $('#statSuccess');
const statFail = $('#statFail');

// ========= State =========
let stats = { total: 0, success: 0, fail: 0 };
let isCreating = false;

// ========= Settings Modal Toggle =========
const openSettings = () => settingsModal.classList.add('active');
const closeSettings = () => settingsModal.classList.remove('active');

btnOpenSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
modalOverlay.addEventListener('click', closeSettings);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// ========= Save/Load Cookie =========
btnSaveConfig.addEventListener('click', () => {
  const cookie = inputCookie.value.trim();
  if (cookie) {
    localStorage.setItem('fb_cookie', cookie);
    showToast('Đã lưu cookie!', 'success');
    closeSettings();
    loadPages(); // Tự động load danh sách trang mới
  } else {
    showToast('Cookie trống!', 'error');
  }
});

btnClearConfig.addEventListener('click', () => {
  localStorage.removeItem('fb_cookie');
  inputCookie.value = '';
  showToast('Đã xoá cookie', 'success');
  closeSettings();
  pagesList.innerHTML = '';
  pagesList.style.display = 'none';
  pagesListEmpty.style.display = 'flex';
});

// Load saved cookie on start
const savedCookie = localStorage.getItem('fb_cookie');
if (savedCookie) {
  inputCookie.value = savedCookie;
}

// ========= Sidebar Page List Elements =========
const btnRefreshPages = $('#btnRefreshPages');
const pagesListLoading = $('#pagesListLoading');
const pagesListEmpty = $('#pagesListEmpty');
const pagesList = $('#pagesList');

// ========= Load Pages function =========
async function loadPages() {
  const cookie = inputCookie.value.trim();
  if (!cookie) {
    pagesListEmpty.style.display = 'flex';
    pagesListLoading.style.display = 'none';
    pagesList.style.display = 'none';
    return;
  }

  pagesListLoading.style.display = 'flex';
  pagesListEmpty.style.display = 'none';
  pagesList.style.display = 'none';

  try {
    const response = await fetch('/api/get-pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
    });

    const result = await response.json();

    if (result.success && result.pages && result.pages.length > 0) {
      renderPages(result.pages);
    } else {
      pagesListEmpty.innerHTML = `<p>Không tìm thấy Page nào.</p><p class="hint">${result.error || 'Hãy kiểm tra lại cookie.'}</p>`;
      pagesListEmpty.style.display = 'flex';
      pagesListLoading.style.display = 'none';
    }
  } catch (error) {
    pagesListEmpty.innerHTML = `<p>Lỗi tải danh sách Page.</p><p class="hint">${error.message}</p>`;
    pagesListEmpty.style.display = 'flex';
    pagesListLoading.style.display = 'none';
  }
}

function renderPages(pagesArray) {
  pagesList.innerHTML = '';
  pagesArray.forEach(page => {
    const li = document.createElement('li');
    li.className = 'page-item';
    li.title = `Click để xem chi tiết Page: ${page.name}`;
    
    // Set placeholder avatar or image
    const avatarContent = page.avatar 
      ? `<img src="${page.avatar}" alt="${page.name}">` 
      : (page.name ? page.name.charAt(0).toUpperCase() : 'P');

    li.innerHTML = `
      <div class="page-avatar">${avatarContent}</div>
      <div class="page-info">
        <span class="page-name">${escapeHtml(page.name)}</span>
        <span class="page-id">${page.id}</span>
      </div>
    `;

    li.addEventListener('click', () => {
      window.open(`https://www.facebook.com/${page.id}`, '_blank');
    });

    pagesList.appendChild(li);
  });

  pagesList.style.display = 'flex';
  pagesListLoading.style.display = 'none';
  pagesListEmpty.style.display = 'none';
}

// Bind loadPages events
btnRefreshPages.addEventListener('click', loadPages);

// Auto load pages list on start if cookie exists
if (savedCookie) {
  loadPages();
}


// ========= Toast Notification =========
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success'
    ? '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  toast.innerHTML = `${icon}<span>${message}</span>`;
  container.prepend(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ========= Update Stats =========
function updateStats() {
  statTotal.textContent = stats.total;
  statSuccess.textContent = stats.success;
  statFail.textContent = stats.fail;
}

// ========= Add Log Entry =========
function addLogEntry(data) {
  logEmpty.style.display = 'none';
  logTableWrap.style.display = 'block';

  const row = document.createElement('tr');
  const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const isSuccess = data.success;
  const pageIdCell = data.pageId
    ? `<a href="https://www.facebook.com/${data.pageId}" target="_blank">${data.pageId}</a>`
    : '<span style="color:var(--text-muted)">—</span>';

  const statusBadge = isSuccess
    ? '<span class="badge badge-success">✓ Thành công</span>'
    : `<span class="badge badge-error">✗ Lỗi</span>`;

  row.innerHTML = `
    <td>${stats.total}</td>
    <td>${time}</td>
    <td>${escapeHtml(data.pageName || '—')}</td>
    <td title="${escapeHtml(data.pageBio || '')}">${escapeHtml(data.pageBio || '—')}</td>
    <td>${pageIdCell}</td>
    <td>${statusBadge}</td>
  `;

  logTableBody.prepend(row);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========= Clear Log =========
btnClearLog.addEventListener('click', () => {
  logTableBody.innerHTML = '';
  logEmpty.style.display = 'flex';
  logTableWrap.style.display = 'none';
  stats = { total: 0, success: 0, fail: 0 };
  updateStats();
  showToast('Đã xoá log', 'success');
});

// ========= Create Page =========
btnCreatePage.addEventListener('click', async () => {
  if (isCreating) return;

  const cookie = inputCookie.value.trim();
  if (!cookie) {
    showToast('Vui lòng nhập cookie!', 'error');
    inputCookie.focus();
    return;
  }

  // Set loading state
  isCreating = true;
  btnCreatePage.classList.add('loading');
  const inner = btnCreatePage.querySelector('.btn-create-inner');
  const loading = btnCreatePage.querySelector('.btn-create-loading');
  inner.style.display = 'none';
  loading.style.display = 'flex';

  try {
    const body = {
      cookie,
      customName: inputPageName.value.trim() || undefined,
      customBio: inputPageBio.value.trim() || undefined,
      category: inputCategory.value.trim() || undefined,
    };

    const response = await fetch('/api/create-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    stats.total++;
    if (result.success) {
      stats.success++;
      showToast(`Tạo page thành công: ${result.pageName}`, 'success');
    } else {
      stats.fail++;
      showToast(`Lỗi: ${result.error}`, 'error');
    }

    updateStats();
    addLogEntry(result);

  } catch (error) {
    stats.total++;
    stats.fail++;
    updateStats();
    addLogEntry({ success: false, pageName: 'Lỗi kết nối', pageBio: error.message });
    showToast(`Lỗi kết nối: ${error.message}`, 'error');
  } finally {
    isCreating = false;
    btnCreatePage.classList.remove('loading');
    const inner2 = btnCreatePage.querySelector('.btn-create-inner');
    const loading2 = btnCreatePage.querySelector('.btn-create-loading');
    inner2.style.display = 'flex';
    loading2.style.display = 'none';
  }
});

// ========= Bulk Page React Action =========
const btnStartReact = $('#btnStartReact');
const inputPostUrl = $('#inputPostUrl');
const selectReaction = $('#selectReaction');
const inputReactCount = $('#inputReactCount');
const statReactTotal = $('#statReactTotal');
const statReactSuccess = $('#statReactSuccess');
const statReactFail = $('#statReactFail');
const reactProgressBox = $('#reactProgressBox');
const reactProgressLog = $('#reactProgressLog');

let isReacting = false;

btnStartReact.addEventListener('click', async () => {
  if (isReacting) return;

  const cookie = inputCookie.value.trim();
  const postUrl = inputPostUrl.value.trim();
  const reactionType = selectReaction.value;
  const limitVal = parseInt(inputReactCount.value.trim(), 10) || 0;

  if (!cookie) {
    showToast('Vui lòng nhập cookie trong phần Cài đặt!', 'error');
    openSettings();
    return;
  }

  if (!postUrl) {
    showToast('Vui lòng nhập link bài viết cần thả cảm xúc!', 'error');
    inputPostUrl.focus();
    return;
  }

  // Set loading state
  isReacting = true;
  btnStartReact.classList.add('loading');
  const inner = btnStartReact.querySelector('.btn-create-inner');
  const loading = btnStartReact.querySelector('.btn-create-loading');
  inner.style.display = 'none';
  loading.style.display = 'flex';

  // Reset progress view
  statReactTotal.textContent = '0';
  statReactSuccess.textContent = '0';
  statReactFail.textContent = '0';
  reactProgressLog.innerHTML = '<div>[System] Bắt đầu kết nối và trích xuất danh sách Page...</div>';
  reactProgressBox.style.display = 'block';

  try {
    const response = await fetch('/api/react-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookie,
        postUrl,
        reactionType,
        limit: limitVal
      })
    });

    const result = await response.json();

    if (result.success && result.results) {
      let successCount = 0;
      let failCount = 0;

      // Clear log and print post information
      reactProgressLog.innerHTML = `<div>[Post ID] ${result.postId}</div>`;
      
      // Print result for each page
      result.results.forEach((res, index) => {
        const time = new Date().toLocaleTimeString('vi-VN');
        const statusText = res.success 
          ? `<span style="color:var(--success)">[THÀNH CÔNG]</span>` 
          : `<span style="color:var(--error)">[THẤT BẠI - ${res.error || 'Lỗi không xác định'}]</span>`;
        
        const logItem = document.createElement('div');
        logItem.innerHTML = `[${time}] ${index + 1}. Page <strong>${escapeHtml(res.name)}</strong> (${res.pageId}): ${statusText}`;
        reactProgressLog.appendChild(logItem);

        if (res.success) successCount++;
        else failCount++;
      });

      statReactTotal.textContent = result.totalRun;
      statReactSuccess.textContent = successCount;
      statReactFail.textContent = failCount;

      showToast(`Đã hoàn thành thả cảm xúc bài viết!`, 'success');
    } else {
      reactProgressLog.innerHTML += `<div style="color:var(--error)">[Lỗi] ${result.error || 'Có lỗi xảy ra'}</div>`;
      showToast(`Lỗi: ${result.error}`, 'error');
    }
  } catch (error) {
    reactProgressLog.innerHTML += `<div style="color:var(--error)">[Lỗi kết nối] ${error.message}</div>`;
    showToast(`Lỗi kết nối: ${error.message}`, 'error');
  } finally {
    isReacting = false;
    btnStartReact.classList.remove('loading');
    const inner2 = btnStartReact.querySelector('.btn-create-inner');
    const loading2 = btnStartReact.querySelector('.btn-create-loading');
    inner2.style.display = 'flex';
    loading2.style.display = 'none';
  }
});

