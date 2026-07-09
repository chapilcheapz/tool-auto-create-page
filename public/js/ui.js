/**
 * UI Module - Handles DOM manipulation, notification, and logging
 */

export const $ = (sel) => document.querySelector(sel);

export function showToast(message, type = 'success') {
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

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function updateStats(stats, elements) {
  const { statTotal, statSuccess, statFail } = elements;
  statTotal.textContent = stats.total;
  statSuccess.textContent = stats.success;
  statFail.textContent = stats.fail;
}

export function addLogEntry(data, totalIndex, elements) {
  const { logEmpty, logTableWrap, logTableBody } = elements;
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
    <td>${totalIndex}</td>
    <td>${time}</td>
    <td>${escapeHtml(data.pageName || '—')}</td>
    <td title="${escapeHtml(data.pageBio || '')}">${escapeHtml(data.pageBio || '—')}</td>
    <td>${pageIdCell}</td>
    <td>${statusBadge}</td>
  `;

  logTableBody.prepend(row);
}

export function clearLogs(elements, statsObj) {
  const { logEmpty, logTableWrap, logTableBody, statTotal, statSuccess, statFail } = elements;
  logTableBody.innerHTML = '';
  logEmpty.style.display = 'flex';
  logTableWrap.style.display = 'none';
  
  statsObj.total = 0;
  statsObj.success = 0;
  statsObj.fail = 0;
  
  updateStats(statsObj, { statTotal, statSuccess, statFail });
  showToast('Đã xoá log', 'success');
}
