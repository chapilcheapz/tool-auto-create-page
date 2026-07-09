/**
 * Main JS Entrypoint - Links all modules and sets up event listeners
 */

import { $, showToast, clearLogs } from './ui.js';
import * as api from './api.js';
import * as pageManager from './pageManager.js';
import * as reactManager from './reactManager.js';

// ========= DOM Elements =========
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

const btnRefreshPages = $('#btnRefreshPages');
const pagesListLoading = $('#pagesListLoading');
const pagesListEmpty = $('#pagesListEmpty');
const pagesList = $('#pagesList');

const btnStartReact = $('#btnStartReact');
const inputPostUrl = $('#inputPostUrl');
const selectReaction = $('#selectReaction');
const inputReactCount = $('#inputReactCount');
const statReactTotal = $('#statReactTotal');
const statReactSuccess = $('#statReactSuccess');
const statReactFail = $('#statReactFail');
const reactProgressBox = $('#reactProgressBox');
const reactProgressLog = $('#reactProgressLog');

// ========= State =========
const stats = { total: 0, success: 0, fail: 0 };
let isCreating = false;
let isReacting = false;

// ========= DOM Groupings for Modules =========
const sidebarElements = { pagesList, pagesListLoading, pagesListEmpty };
const uiStatsElements = { statTotal, statSuccess, statFail };
const uiLogsElements = { logEmpty, logTableWrap, logTableBody };
const creationElements = { btnCreatePage };
const pageInputs = { inputPageName, inputPageBio, inputCategory };

const reactionInputs = { inputPostUrl, selectReaction, inputReactCount };
const reactionElements = {
  btnStartReact,
  statReactTotal,
  statReactSuccess,
  statReactFail,
  reactProgressBox,
  reactProgressLog
};

// ========= Settings Modal Toggle =========
const openSettings = () => settingsModal.classList.add('active');
const closeSettings = () => settingsModal.classList.remove('active');

btnOpenSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
modalOverlay.addEventListener('click', closeSettings);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// ========= Save/Load Config (Cookie) =========
btnSaveConfig.addEventListener('click', async () => {
  const cookie = inputCookie.value.trim();
  if (cookie) {
    try {
      const result = await api.saveConfig(cookie);
      if (result.success) {
        showToast('Đã lưu cookie vào file cấu hình!', 'success');
        closeSettings();
        pageManager.loadPages(inputCookie, sidebarElements);
      } else {
        showToast('Lỗi lưu cấu hình!', 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối server!', 'error');
    }
  } else {
    showToast('Cookie trống!', 'error');
  }
});

btnClearConfig.addEventListener('click', async () => {
  try {
    const result = await api.saveConfig('');
    if (result.success) {
      inputCookie.value = '';
      showToast('Đã xoá cookie', 'success');
      closeSettings();
      pagesList.innerHTML = '';
      pagesList.style.display = 'none';
      pagesListEmpty.style.display = 'flex';
    }
  } catch (e) {
    showToast('Lỗi kết nối server!', 'error');
  }
});

// ========= Create Page Event =========
btnCreatePage.addEventListener('click', async () => {
  if (isCreating) return;
  isCreating = true;
  await pageManager.createNewPage(
    inputCookie,
    pageInputs,
    creationElements,
    stats,
    { ...uiStatsElements, ...uiLogsElements }
  );
  isCreating = false;
});

// ========= Bulk React Event =========
btnStartReact.addEventListener('click', async () => {
  if (isReacting) return;
  isReacting = true;
  await reactManager.startReact(
    inputCookie,
    reactionInputs,
    reactionElements,
    openSettings
  );
  isReacting = false;
});

// ========= Sidebar Refresh Event =========
btnRefreshPages.addEventListener('click', () => {
  pageManager.loadPages(inputCookie, sidebarElements);
});

// ========= Clear Logs Event =========
btnClearLog.addEventListener('click', () => {
  clearLogs(
    { ...uiLogsElements, ...uiStatsElements },
    stats
  );
});

// ========= Tab Switching Event =========
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;

    // Toggle active buttons
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Toggle active contents
    tabContents.forEach(content => {
      if (content.id === targetTab) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  });
});

// ========= Initialize On Page Load =========
async function init() {
  try {
    const response = await api.fetchConfig();
    if (response.success && response.cookie) {
      inputCookie.value = response.cookie;
      pageManager.loadPages(inputCookie, sidebarElements);
    }
  } catch (error) {
    console.error('Lỗi khởi tạo cấu hình từ server:', error);
  }
}

init();
