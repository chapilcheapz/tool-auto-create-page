/**
 * API Module - Handles all backend communication with JWT Authentication & Graceful Error Handling
 */

let isRefreshing = null;

async function safeJsonResponse(response) {
  if (!response) {
    throw new Error('Không nhận được phản hồi từ máy chủ.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error('Máy chủ Backend hoặc dịch vụ trung gian chưa sẵn sàng. Vui lòng kiểm tra lại server.js.');
      }
      throw new Error(text || `Lỗi máy chủ (${response.status})`);
    }
    throw new Error('Phản hồi từ máy chủ không phải định dạng JSON.');
  }

  return response.json();
}

async function performRefresh() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    const err = new Error('Không tìm thấy Refresh Token');
    err.status = 401;
    throw err;
  }

  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });

  if (!response.ok) {
    const err = new Error('Gia hạn token thất bại');
    err.status = response.status;
    throw err;
  }

  const result = await safeJsonResponse(response);
  if (result.success && result.token && result.refreshToken) {
    localStorage.setItem('jwt_token', result.token);
    localStorage.setItem('refresh_token', result.refreshToken);
    return result.token;
  } else {
    const err = new Error('Phản hồi gia hạn không hợp lệ');
    err.status = 401;
    throw err;
  }
}

async function authFetch(url, options = {}) {
  let token = localStorage.getItem('jwt_token');
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  let response;
  try {
    response = await fetch(url, options);
  } catch (netErr) {
    if (netErr?.name === 'AbortError') {
      throw netErr;
    }
    throw new Error('Không thể kết nối tới máy chủ backend. Vui lòng kiểm tra lại server.js');
  }

  if (response.status === 401) {
    try {
      if (!isRefreshing) {
        isRefreshing = performRefresh();
      }
      const newToken = await isRefreshing;
      isRefreshing = null;
      
      options.headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, options);
    } catch (err) {
      isRefreshing = null;
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('refresh_token');
        window.dispatchEvent(new Event('auth-expired'));
        throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
      }
      throw new Error('Lỗi kết nối máy chủ backend. Vui lòng kiểm tra lại.');
    }
  }
  
  if (response.status === 401) {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('refresh_token');
    window.dispatchEvent(new Event('auth-expired'));
    throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
  }

  return response;
}

export async function login(username, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await safeJsonResponse(response);
  if (data.success && data.token && data.refreshToken) {
    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('refresh_token', data.refreshToken);
  }
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  const response = await authFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  return safeJsonResponse(response);
}

export async function fetchConfig() {
  const response = await authFetch('/api/config');
  return safeJsonResponse(response);
}

export async function diagnoseCookies() {
  const response = await authFetch('/api/config/diagnose-cookies');
  return safeJsonResponse(response);
}

export async function saveConfig(cookie) {
  const response = await authFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return safeJsonResponse(response);
}

export async function getPages(cookie) {
  const response = await authFetch('/api/get-pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return safeJsonResponse(response);
}

export async function createPage(body) {
  const response = await authFetch('/api/create-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return safeJsonResponse(response);
}

export async function reactPost(body) {
  const response = await authFetch('/api/react-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return safeJsonResponse(response);
}

/**
 * Media studio APIs
 */
export async function extractAudio(url, signal) {
  const response = await authFetch('/api/media/audio/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal
  });
  return safeJsonResponse(response);
}

export async function removeAudioSegment(audio, start, end) {
  const response = await authFetch('/api/media/audio/remove-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, start, end })
  });
  return safeJsonResponse(response);
}

export async function getSupabaseVideos(signal) {
  const response = await authFetch('/api/media/videos', { signal });
  return safeJsonResponse(response);
}

export async function uploadSupabaseVideo(file) {
  if (!file) {
    throw new Error('Vui lòng chọn một file video để tải lên.');
  }

  const response = await authFetch('/api/media/videos/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type?.startsWith('video/') ? file.type : 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || 'video.mp4')
    },
    body: file
  });
  return safeJsonResponse(response);
}

export async function mergeAudioWithVideo(audio, video) {
  const response = await authFetch('/api/media/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, video, mode: 'replace' })
  });
  return safeJsonResponse(response);
}
