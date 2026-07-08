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
const configToggle = $('#configToggle');
const logEmpty = $('#logEmpty');
const logTableWrap = $('#logTableWrap');
const logTableBody = $('#logTableBody');
const statTotal = $('#statTotal');
const statSuccess = $('#statSuccess');
const statFail = $('#statFail');

// ========= State =========
let stats = { total: 0, success: 0, fail: 0 };
let isCreating = false;

// ========= Config Toggle =========
configToggle.addEventListener('click', () => {
  const card = configToggle.closest('.config-card');
  card.classList.toggle('collapsed');
});

// ========= Save/Load Cookie =========
btnSaveConfig.addEventListener('click', () => {
  const cookie = inputCookie.value.trim();
  if (cookie) {
    localStorage.setItem('fb_cookie', cookie);
    showToast('Đã lưu cookie!', 'success');
  } else {
    showToast('Cookie trống!', 'error');
  }
});

btnClearConfig.addEventListener('click', () => {
  localStorage.removeItem('fb_cookie');
  inputCookie.value = '';
  showToast('Đã xoá cookie', 'success');
});

// Load saved cookie on start
const savedCookie = localStorage.getItem('fb_cookie');
if (savedCookie) {
  inputCookie.value = savedCookie;
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
