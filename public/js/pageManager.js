/**
 * Page Manager Module - Handles Page Listing and Page Creation flows
 */

import * as api from './api.js';
import { showToast, updateStats, addLogEntry, escapeHtml } from './ui.js';

export async function loadPages(inputCookie, elements) {
  const { pagesList, pagesListLoading, pagesListEmpty, centralPagesListLoading, centralPagesListEmpty, centralPagesTableWrap } = elements;
  const cookie = inputCookie.value.trim();

  if (!cookie) {
    if (pagesListEmpty) pagesListEmpty.style.display = 'flex';
    if (pagesListLoading) pagesListLoading.style.display = 'none';
    if (pagesList) pagesList.style.display = 'none';
    
    if (centralPagesListEmpty) centralPagesListEmpty.style.display = 'flex';
    if (centralPagesListLoading) centralPagesListLoading.style.display = 'none';
    if (centralPagesTableWrap) centralPagesTableWrap.style.display = 'none';
    return;
  }

  if (pagesListLoading) pagesListLoading.style.display = 'flex';
  if (pagesListEmpty) pagesListEmpty.style.display = 'none';
  if (pagesList) pagesList.style.display = 'none';

  if (centralPagesListLoading) centralPagesListLoading.style.display = 'flex';
  if (centralPagesListEmpty) centralPagesListEmpty.style.display = 'none';
  if (centralPagesTableWrap) centralPagesTableWrap.style.display = 'none';

  try {
    const result = await api.getPages(cookie);

    if (result.success && result.pages && result.pages.length > 0) {
      window.cachedPages = result.pages;
      renderPages(result.pages, elements);
    } else {
      const errMsg = result.error || 'Hãy kiểm tra lại cookie.';
      if (pagesListEmpty) {
        pagesListEmpty.innerHTML = `<p>Không tìm thấy Page nào.</p><p class="hint">${errMsg}</p>`;
        pagesListEmpty.style.display = 'flex';
      }
      if (pagesListLoading) pagesListLoading.style.display = 'none';

      if (centralPagesListEmpty) {
        centralPagesListEmpty.innerHTML = `<p>Không tìm thấy Page nào.</p><p class="hint">${errMsg}</p>`;
        centralPagesListEmpty.style.display = 'flex';
      }
      if (centralPagesListLoading) centralPagesListLoading.style.display = 'none';
    }
  } catch (error) {
    const errMsg = error.message;
    if (pagesListEmpty) {
      pagesListEmpty.innerHTML = `<p>Lỗi tải danh sách Page.</p><p class="hint">${errMsg}</p>`;
      pagesListEmpty.style.display = 'flex';
    }
    if (pagesListLoading) pagesListLoading.style.display = 'none';

    if (centralPagesListEmpty) {
      centralPagesListEmpty.innerHTML = `<p>Lỗi tải danh sách Page.</p><p class="hint">${errMsg}</p>`;
      centralPagesListEmpty.style.display = 'flex';
    }
    if (centralPagesListLoading) centralPagesListLoading.style.display = 'none';
  }
}

export function renderCentralPages(pagesArray, elements) {
  const { centralPagesList, centralPagesListLoading, centralPagesListEmpty, centralPagesTableWrap, centralPagesCount } = elements;
  if (!centralPagesList) return;

  centralPagesList.innerHTML = '';
  
  if (centralPagesCount) {
    centralPagesCount.textContent = pagesArray.length;
  }

  if (pagesArray.length === 0) {
    if (centralPagesTableWrap) centralPagesTableWrap.style.display = 'none';
    if (centralPagesListEmpty) {
      centralPagesListEmpty.style.display = 'flex';
      centralPagesListEmpty.innerHTML = `<p class="text-body-lg text-on-surface-variant">Không tìm thấy Page nào phù hợp.</p>`;
    }
    return;
  }

  pagesArray.forEach((page, index) => {
    const tr = document.createElement('tr');
    
    const avatarContent = page.avatar 
      ? `<img src="${page.avatar}" alt="${page.name}" class="w-8 h-8 rounded-full object-cover">` 
      : `<div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">${page.name ? page.name.charAt(0).toUpperCase() : 'P'}</div>`;

    tr.innerHTML = `
      <td class="w-12">${index + 1}</td>
      <td>
        <div class="flex items-center gap-xs">
          ${avatarContent}
          <span class="font-semibold text-on-surface">${escapeHtml(page.name)}</span>
        </div>
      </td>
      <td class="font-mono text-outline">${page.id}</td>
      <td class="text-right">
        <div class="flex items-center justify-end gap-sm">
          <button class="copy-id-btn bg-[#292931] hover:bg-surface-variant text-on-surface py-1 px-3 rounded-lg text-xs font-label-md transition-all border-none cursor-pointer">
            Sao chép ID
          </button>
          <a href="https://www.facebook.com/${page.id}" target="_blank" class="bg-white hover:bg-white/90 text-black py-1 px-3 rounded-lg text-xs font-label-md transition-all inline-flex items-center gap-xs">
            Xem trên FB
          </a>
        </div>
      </td>
    `;

    tr.querySelector('.copy-id-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(page.id).then(() => {
        showToast('Đã sao chép ID page!', 'success');
      });
    });

    centralPagesList.appendChild(tr);
  });

  if (centralPagesListLoading) centralPagesListLoading.style.display = 'none';
  if (centralPagesListEmpty) centralPagesListEmpty.style.display = 'none';
  if (centralPagesTableWrap) centralPagesTableWrap.style.display = 'block';
}

function renderPages(pagesArray, elements) {
  const { pagesList, pagesListLoading, pagesListEmpty } = elements;
  
  if (pagesList) {
    pagesList.innerHTML = '';
    pagesArray.forEach(page => {
      const li = document.createElement('li');
      li.className = 'page-item';
      li.title = `Click để xem chi tiết Page: ${page.name}`;
      
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

  renderCentralPages(pagesArray, elements);
}

export async function createNewPage(inputCookie, pageInputs, elements, statsState, uiElements) {
  const { btnCreatePage } = elements;
  const { inputPageName, inputPageBio, inputCategory } = pageInputs;
  const cookie = inputCookie.value.trim();

  if (!cookie) {
    showToast('Vui lòng nhập cookie!', 'error');
    inputCookie.focus();
    return;
  }

  // Set loading state
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

    const result = await api.createPage(body);

    statsState.total++;
    if (result.success) {
      statsState.success++;
      showToast(`Tạo page thành công: ${result.name}`, 'success');
    } else {
      statsState.fail++;
      showToast(`Lỗi: ${result.error}`, 'error');
    }

    updateStats(statsState, uiElements);
    const logItem = { 
      ...result, 
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
    };
    addLogEntry(logItem, statsState.total, uiElements);

    // Save to sessionStorage
    sessionStorage.setItem('session_creator_stats', JSON.stringify(statsState));
    const savedLogs = JSON.parse(sessionStorage.getItem('session_creator_logs') || '[]');
    savedLogs.push(logItem);
    sessionStorage.setItem('session_creator_logs', JSON.stringify(savedLogs));

  } catch (error) {
    statsState.total++;
    statsState.fail++;
    updateStats(statsState, uiElements);
    const errLogItem = { 
      success: false, 
      pageName: 'Lỗi kết nối', 
      pageBio: error.message,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
    };
    addLogEntry(errLogItem, statsState.total, uiElements);
    
    // Save error to sessionStorage
    sessionStorage.setItem('session_creator_stats', JSON.stringify(statsState));
    const savedLogs = JSON.parse(sessionStorage.getItem('session_creator_logs') || '[]');
    savedLogs.push(errLogItem);
    sessionStorage.setItem('session_creator_logs', JSON.stringify(savedLogs));

    showToast(`Lỗi kết nối: ${error.message}`, 'error');
  } finally {
    btnCreatePage.classList.remove('loading');
    inner.style.display = 'flex';
    loading.style.display = 'none';
  }
}

export function restoreCreatorSession(statsState, uiElements) {
  try {
    const savedStats = sessionStorage.getItem('session_creator_stats');
    if (savedStats) {
      const parsed = JSON.parse(savedStats);
      statsState.total = parsed.total;
      statsState.success = parsed.success;
      statsState.fail = parsed.fail;
      updateStats(statsState, uiElements);
    }

    const savedLogs = sessionStorage.getItem('session_creator_logs');
    if (savedLogs) {
      const parsedLogs = JSON.parse(savedLogs);
      parsedLogs.forEach((log, index) => {
        addLogEntry(log, index + 1, uiElements);
      });
    }
  } catch (e) {
    console.error('Lỗi khôi phục session:', e);
  }
}
