/**
 * React Manager Module - Handles bulk post/reel reactions flow
 */

import * as api from './api.js';
import { showToast, escapeHtml } from './ui.js';

export async function startReact(inputCookie, inputs, elements, openSettings) {
  const { inputPostUrl, selectReaction, inputReactCount } = inputs;
  const { btnStartReact, statReactTotal, statReactSuccess, statReactFail, reactProgressBox, reactProgressLog } = elements;

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
    const result = await api.reactPost({
      cookie,
      postUrl,
      reactionType,
      limit: limitVal
    });

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

      // Save react session state
      const reactSession = {
        postId: result.postId,
        total: result.totalRun,
        success: successCount,
        fail: failCount,
        logHtml: reactProgressLog.innerHTML
      };
      sessionStorage.setItem('session_react_campaign', JSON.stringify(reactSession));

      showToast(`Đã hoàn thành thả cảm xúc bài viết!`, 'success');
    } else {
      reactProgressLog.innerHTML += `<div style="color:var(--error)">[Lỗi] ${result.error || 'Có lỗi xảy ra'}</div>`;
      showToast(`Lỗi: ${result.error}`, 'error');
    }
  } catch (error) {
    reactProgressLog.innerHTML += `<div style="color:var(--error)">[Lỗi kết nối] ${error.message}</div>`;
    showToast(`Lỗi kết nối: ${error.message}`, 'error');
  } finally {
    btnStartReact.classList.remove('loading');
    inner.style.display = 'flex';
    loading.style.display = 'none';
  }
}

export function restoreReactSession(elements) {
  const { statReactTotal, statReactSuccess, statReactFail, reactProgressBox, reactProgressLog } = elements;
  if (!reactProgressLog) return;
  try {
    const saved = sessionStorage.getItem('session_react_campaign');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (statReactTotal) statReactTotal.textContent = parsed.total;
      if (statReactSuccess) statReactSuccess.textContent = parsed.success;
      if (statReactFail) statReactFail.textContent = parsed.fail;
      reactProgressLog.innerHTML = parsed.logHtml;
      reactProgressBox.style.display = 'block';
    }
  } catch (e) {
    console.error('Lỗi khôi phục react session:', e);
  }
}
