/**
 * API Module - Handles all backend communication with JWT Authentication
 */

let isRefreshing = null;

async function performRefresh() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    throw new Error('Không tìm thấy Refresh Token');
  }

  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });

  if (!response.ok) {
    throw new Error('Gia hạn token thất bại');
  }

  const result = await response.json();
  if (result.success && result.token && result.refreshToken) {
    localStorage.setItem('jwt_token', result.token);
    localStorage.setItem('refresh_token', result.refreshToken);
    return result.token;
  } else {
    throw new Error('Phản hồi gia hạn không hợp lệ');
  }
}

async function authFetch(url, options = {}) {
  let token = localStorage.getItem('jwt_token');
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  let response = await fetch(url, options);
  
  if (response.status === 401) {
    try {
      if (!isRefreshing) {
        isRefreshing = performRefresh();
      }
      const newToken = await isRefreshing;
      isRefreshing = null; // Reset refresh state
      
      // Retry request with new token
      options.headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, options);
      
    } catch (err) {
      isRefreshing = null;
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('refresh_token');
      window.dispatchEvent(new Event('auth-expired'));
      throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
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
  const data = await response.json();
  if (data.success && data.token && data.refreshToken) {
    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('refresh_token', data.refreshToken);
  }
  return data;
}

export async function register(username, email, password) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });
  return response.json();
}

export async function changePassword(currentPassword, newPassword) {
  const response = await authFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  return response.json();
}

export async function fetchConfig() {
  const response = await authFetch('/api/config');
  return response.json();
}

export async function saveConfig(cookie) {
  const response = await authFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return response.json();
}

export async function getPages(cookie) {
  const response = await authFetch('/api/get-pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return response.json();
}

export async function createPage(body) {
  const response = await authFetch('/api/create-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

export async function reactPost(body) {
  const response = await authFetch('/api/react-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}
