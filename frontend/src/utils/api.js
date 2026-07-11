/**
 * API Module - Handles all backend communication with JWT Authentication
 */

async function authFetch(url, options = {}) {
  const token = localStorage.getItem('jwt_token');
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, options);
  
  if (response.status === 401) {
    localStorage.removeItem('jwt_token');
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
  return response.json();
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
