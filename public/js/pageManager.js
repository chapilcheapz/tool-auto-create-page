/**
 * Page Manager Module - Handles Page Listing and Page Creation flows
 */

import * as api from './api.js';
import { showToast, updateStats, addLogEntry, escapeHtml } from './ui.js';

export async function loadPages(inputCookie, elements) {
  const { pagesList, pagesListLoading, pagesListEmpty } = elements;
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
    const result = await api.getPages(cookie);

    if (result.success && result.pages && result.pages.length > 0) {
      renderPages(result.pages, elements);
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

function renderPages(pagesArray, elements) {
  const { pagesList, pagesListLoading, pagesListEmpty } = elements;
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
    addLogEntry(result, statsState.total, uiElements);

  } catch (error) {
    statsState.total++;
    statsState.fail++;
    updateStats(statsState, uiElements);
    addLogEntry({ success: false, pageName: 'Lỗi kết nối', pageBio: error.message }, statsState.total, uiElements);
    showToast(`Lỗi kết nối: ${error.message}`, 'error');
  } finally {
    btnCreatePage.classList.remove('loading');
    inner.style.display = 'flex';
    loading.style.display = 'none';
  }
}
