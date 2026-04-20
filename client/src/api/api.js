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
  emailPdf: (id, to) =>
    request(`/api/sessions/${id}/email-pdf`, { method: 'POST', body: JSON.stringify({ to }) }),
};

// ─── Public (guest) access by code ───────────────────────────────────────────
export const publicSessions = {
  getByCode: (code) => fetch(`${BASE}/api/public/sessions/by-code/${encodeURIComponent(code)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      return r.json();
    }),
  entries: (id, code) => fetch(`${BASE}/api/public/sessions/${id}/entries?code=${encodeURIComponent(code)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      return r.json();
    }),
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
 * subscribe(sessionId, onMessage, { code? }) → unsub function
 * Pass `code` to authenticate as a guest (no token). onMessage receives parsed
 * JSON: { type, data }.
 */
export function subscribe(sessionId, onMessage, opts = {}) {
  const token = getToken();
  const qs    = new URLSearchParams({ sessionId });
  if (opts.code) qs.set('code', opts.code);
  else if (token) qs.set('token', token);
  const ws = new WebSocket(`${WS_BASE}/ws?${qs.toString()}`);

  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };
  ws.onerror = (e) => console.error('[WS] error', e);

  return () => ws.close();
}
