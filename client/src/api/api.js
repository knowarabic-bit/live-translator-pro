/**
 * api.js — thin HTTP + WebSocket client for live-translator-pro.
 * Talks to the Express server under /api and a WebSocket at /ws.
 */

const BASE = import.meta.env.VITE_API_URL || '';
const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${location.host}`;

// ─── Token storage ──────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('ltp_token'); }
export function setToken(t) { localStorage.setItem('ltp_token', t); }
export function clearToken() { localStorage.removeItem('ltp_token'); }

// ─── Base fetch ─────────────────────────────────────────────────────────────
async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  register: (email, password, name) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/api/auth/me'),
};

// ─── Sessions ────────────────────────────────────────────────────────────────
export const sessions = {
  create: (data) => request('/api/sessions', { method: 'POST', body: JSON.stringify(data) }),
  list:   ()     => request('/api/sessions'),
  get:    (id)   => request(`/api/sessions/${id}`),
  update: (id, data) => request(`/api/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  join:   (code) => request('/api/sessions/join', { method: 'POST', body: JSON.stringify({ access_code: code }) }),
};

// ─── Entries ─────────────────────────────────────────────────────────────────
export const entries = {
  list:   (sessionId) => request(`/api/sessions/${sessionId}/entries`),
  create: (sessionId, data) =>
    request(`/api/sessions/${sessionId}/entries`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Transcription & Translation ─────────────────────────────────────────────
export const transcribe = (audio_base64, mime_type) =>
  request('/api/transcribe', { method: 'POST', body: JSON.stringify({ audio_base64, mime_type }) });

export const translate = (text, source_lang, target_lang) =>
  request('/api/translate', { method: 'POST', body: JSON.stringify({ text, source_lang, target_lang }) });

// ─── PDF export (returns a Blob) ──────────────────────────────────────────────
export async function exportPdf(sessionId) {
  const token = getToken();
  const res   = await fetch(`${BASE}/api/sessions/${sessionId}/export-pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
  return res.blob();
}

// ─── WebSocket subscription ───────────────────────────────────────────────────
/**
 * subscribe(sessionId, onMessage) → unsub function
 * onMessage receives parsed JSON: { type, data }
 */
export function subscribe(sessionId, onMessage) {
  const token = getToken();
  const url   = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
  const ws    = new WebSocket(url);

  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };
  ws.onerror = (e) => console.error('[WS] error', e);

  return () => ws.close();
}
