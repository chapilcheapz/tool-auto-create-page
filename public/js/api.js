/**
 * API Module - Handles all backend communication
 */

export async function fetchConfig() {
  const response = await fetch('/api/config');
  return response.json();
}

export async function saveConfig(cookie) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return response.json();
}

export async function getPages(cookie) {
  const response = await fetch('/api/get-pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie })
  });
  return response.json();
}

export async function createPage(body) {
  const response = await fetch('/api/create-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

export async function reactPost(body) {
  const response = await fetch('/api/react-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}
