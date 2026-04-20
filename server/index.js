/**
 * live-translator-pro — Independent Express + WebSocket server.
 *
 * Routes:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   GET  /api/auth/me
 *
 *   POST /api/sessions            create session
 *   GET  /api/sessions            list user's sessions
 *   GET  /api/sessions/:id        get one session
 *   PATCH /api/sessions/:id       update (end) session
 *
 *   GET  /api/sessions/:id/entries   list entries
 *   POST /api/sessions/:id/entries   create entry (internal, used by workers)
 *
 *   POST /api/transcribe          upload audio → Whisper → text + events
 *   POST /api/translate           text → DeepL (EN → AR only)
 *   GET  /api/sessions/:id/export-pdf
 *
 * WebSocket  ws://host:PORT/ws?token=JWT&sessionId=ID
 *   Server broadcasts { type:'entry', data:{...entry} } to all
 *   clients watching the same sessionId.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';
import { Resend } from 'resend';

// ─── In-memory store (swap for PostgreSQL/SQLite in prod) ───────────────────
const db = {
  users:    new Map(), // email → { id, email, passwordHash, name }
  sessions: new Map(), // id → session object
  entries:  new Map(), // sessionId → entry[]
};

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 4000;
const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-change-me';
// Comma-separated list of allowed browser origins. '*' allows any origin
// (but CORS credentials require reflecting the request origin, so we do
// that instead of returning a literal '*').
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const allowedOrigins = CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.includes('*')
  ? true                                        // reflect request origin
  : (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    };

// Lazily construct the OpenAI client so the server still boots if the key is
// missing — the /api/transcribe route will surface a clear error instead.
let _openai;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ─── Express setup ──────────────────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── WebSocket server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
// sessionId → Set<WebSocket>
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const params    = new URL(req.url, `http://localhost`).searchParams;
  const token     = params.get('token');
  const code      = params.get('code');
  const sessionId = params.get('sessionId');

  // Accept either a JWT (host/registered participant) or an access_code that
  // matches the sessionId — lets anyone with the share link watch live.
  let authed = false;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); authed = true; } catch { /* fallthrough */ }
  }
  if (!authed && code && sessionId) {
    const session = db.sessions.get(sessionId);
    if (session && session.access_code === code.toUpperCase()) authed = true;
  }
  if (!authed) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
  rooms.get(sessionId).add(ws);

  ws.on('close', () => {
    rooms.get(sessionId)?.delete(ws);
    if (rooms.get(sessionId)?.size === 0) rooms.delete(sessionId);
  });
});

/** Broadcast an entry to all WebSocket clients watching a session */
function broadcast(sessionId, payload) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const client of room) {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  }
}

// ─── Auth middleware ─────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (db.users.has(email)) return res.status(409).json({ error: 'Email already registered' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), email, passwordHash, name: name || email.split('@')[0] };
  db.users.set(email, user);
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name });
});

// ═══════════════════════════════════════════════════════════════════════════
// SESSION ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/sessions', requireAuth, (req, res) => {
  const { title, source_language = 'en', target_language = 'ar' } = req.body;
  const session = {
    id:                uuidv4(),
    title:             title || 'Untitled Session',
    host_email:        req.user.email,
    status:            'active',
    access_code:       Math.random().toString(36).slice(2, 8).toUpperCase(),
    participant_count: 1,
    source_language,
    target_language,
    created_at:        new Date().toISOString(),
  };
  db.sessions.set(session.id, session);
  db.entries.set(session.id, []);
  res.status(201).json(session);
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const all = [...db.sessions.values()].filter(
    (s) => s.host_email === req.user.email
  );
  res.json(all.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db.sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db.sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.host_email !== req.user.email)
    return res.status(403).json({ error: 'Only the host can update this session' });
  Object.assign(session, req.body, { id: session.id }); // prevent id override
  broadcast(session.id, { type: 'session_update', data: session });
  res.json(session);
});

// Join by access code (non-host participants)
app.post('/api/sessions/join', requireAuth, (req, res) => {
  const { access_code } = req.body;
  const session = [...db.sessions.values()].find((s) => s.access_code === access_code);
  if (!session) return res.status(404).json({ error: 'Invalid access code' });
  session.participant_count = (session.participant_count || 1) + 1;
  broadcast(session.id, { type: 'session_update', data: session });
  res.json(session);
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC GUEST VIEWER — anyone with the access code can watch the translation
// feed live, no account required.
// ═══════════════════════════════════════════════════════════════════════════

function publicSessionView(session) {
  return {
    id:                session.id,
    title:             session.title,
    status:            session.status,
    access_code:       session.access_code,
    participant_count: session.participant_count,
    source_language:   session.source_language,
    target_language:   session.target_language,
    created_at:        session.created_at,
  };
}

app.get('/api/public/sessions/by-code/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const session = [...db.sessions.values()].find((s) => s.access_code === code);
  if (!session) return res.status(404).json({ error: 'Invalid access code' });
  session.participant_count = (session.participant_count || 1) + 1;
  broadcast(session.id, { type: 'session_update', data: session });
  res.json(publicSessionView(session));
});

app.get('/api/public/sessions/:id/entries', (req, res) => {
  const code = (req.query.code || '').toString().toUpperCase();
  const session = db.sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.access_code !== code) return res.status(403).json({ error: 'Invalid access code' });
  const entries = (db.entries.get(req.params.id) || []).sort((a, b) => a.sequence - b.sequence);
  res.json(entries);
});

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/sessions/:id/entries', requireAuth, (req, res) => {
  const entries = db.entries.get(req.params.id) || [];
  res.json(entries.sort((a, b) => a.sequence - b.sequence));
});

app.post('/api/sessions/:id/entries', requireAuth, (req, res) => {
  const sessionId = req.params.id;
  if (!db.sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
  const entries = db.entries.get(sessionId);
  const entry = {
    id:                uuidv4(),
    session_id:        sessionId,
    sequence:          entries.length + 1,
    speaker_email:     req.user.email,
    created_at:        new Date().toISOString(),
    ...req.body,
  };
  entries.push(entry);
  broadcast(sessionId, { type: 'entry', data: entry });
  res.status(201).json(entry);
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION  — POST /api/transcribe
// Body: multipart/form-data  field "audio" (file) OR  JSON { audio_base64, mime_type }
// ═══════════════════════════════════════════════════════════════════════════

const LANG_MAP = {
  english:'en', arabic:'ar', french:'fr', german:'de', spanish:'es',
  italian:'it', portuguese:'pt', russian:'ru', chinese:'zh', japanese:'ja',
  korean:'ko', turkish:'tr', hindi:'hi', dutch:'nl', polish:'pl',
};

const EVENT_PATTERNS = [
  { type:'laughter', patterns:[/\[laughter\]/i,/\(laughter\)/i,/\blaughing\b/i] },
  { type:'applause', patterns:[/\[applause\]/i,/\(applause\)/i,/\bclapping\b/i] },
  { type:'music',    patterns:[/\[music\]/i,/♪/,/♫/] },
  { type:'noise',    patterns:[/\[noise\]/i,/\[background\]/i] },
  { type:'unclear',  patterns:[/\[inaudible\]/i,/\[unclear\]/i] },
];

function detectContextEvent(text) {
  const lower = text.toLowerCase();
  for (const { type, patterns } of EVENT_PATTERNS) {
    if (patterns.some((p) => p.test(lower))) return type;
  }
  return null;
}

function isLowConfidence(segments) {
  if (!segments?.length) return false;
  const avgNoSpeech = segments.reduce((s, seg) => s + (seg.no_speech_prob || 0), 0) / segments.length;
  const avgLogProb  = segments.reduce((s, seg) => s + (seg.avg_logprob   || 0), 0) / segments.length;
  return avgNoSpeech > 0.6 || avgLogProb < -1.2;
}

app.post('/api/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    let audioBuffer, mimeType;

    if (req.file) {
      // multipart upload
      audioBuffer = req.file.buffer;
      mimeType    = req.file.mimetype || 'audio/webm';
    } else if (req.body.audio_base64) {
      // base64 JSON upload (browser MediaRecorder path)
      const b64 = req.body.audio_base64;
      audioBuffer = Buffer.from(b64, 'base64');
      mimeType    = (req.body.mime_type || 'audio/webm').split(';')[0];
    } else {
      return res.status(400).json({ error: 'Provide audio file or audio_base64' });
    }

    const extMap = {
      'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a',
      'audio/mpeg':'mp3','audio/wav':'wav','audio/flac':'flac',
    };
    const ext = extMap[mimeType] || 'webm';

    // Build a File-like object for the OpenAI SDK
    const blob = new Blob([audioBuffer], { type: mimeType });
    const file = new File([blob], `audio.${ext}`, { type: mimeType });

    const response = await getOpenAI().audio.transcriptions.create({
      file,
      model:           'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    const rawLang  = (response.language || '').toLowerCase();
    const language = LANG_MAP[rawLang] || rawLang || 'en';
    const rawText  = (response.text || '').trim();
    const segments = response.segments || [];

    // Silence
    if (!rawText || /^[\s.,!?…\-–—]+$/.test(rawText)) {
      return res.json({ event_type: 'silence', language });
    }
    // Audio context events
    const evt = detectContextEvent(rawText);
    if (evt) return res.json({ event_type: evt, language });

    // Low confidence → noise
    if (isLowConfidence(segments)) {
      return res.json({ event_type: 'noise', language });
    }

    // Good speech
    const words = (response.words || []).map((w) => ({
      word: w.word, start: w.start, end: w.end,
    }));
    res.json({ text: rawText, language, words });
  } catch (err) {
    console.error('[/api/transcribe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSLATION  — POST /api/translate
// Body: { text, source_lang, target_lang }
// EN → AR only, via DeepL.
// ═══════════════════════════════════════════════════════════════════════════

const GLOSSARY = {
  'ISO 27001':       'ISO 27001',
  'LMS':             'LMS',
  'IT Management':   'إدارة تقنية المعلومات',
  'Cybersecurity':   'الأمن السيبراني',
  'Data Governance': 'حوكمة البيانات',
  'Risk Assessment': 'تقييم المخاطر',
  'Compliance':      'الامتثال',
  'Infrastructure':  'البنية التحتية',
};

function applyGlossary(text) {
  let result = text;
  for (const [term, rep] of Object.entries(GLOSSARY)) {
    result = result.replace(new RegExp(term, 'gi'), rep);
  }
  return result;
}

async function translateWithDeepL(text, sourceLang, targetLang) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('DEEPL_API_KEY is not set');
  const isFreePlan = key.endsWith(':fx');
  const apiUrl     = isFreePlan
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  const body = new URLSearchParams({ text, target_lang: targetLang.toUpperCase() });
  if (sourceLang && /^[a-zA-Z]{2}$/.test(sourceLang)) {
    body.append('source_lang', sourceLang.toUpperCase());
  }

  const r = await fetch(apiUrl, {
    method:  'POST',
    headers: {
      Authorization:  `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`DeepL ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return {
    translated_text:   data.translations[0].text,
    detected_language: data.translations[0].detected_source_language?.toLowerCase() || sourceLang,
    engine:            'deepl',
  };
}

app.post('/api/translate', requireAuth, async (req, res) => {
  try {
    const { text, source_lang, target_lang } = req.body;
    if (!text || !target_lang) return res.status(400).json({ error: 'text and target_lang required' });

    const src = (source_lang || '').toLowerCase();
    const tgt = (target_lang || '').toLowerCase();

    // Only English → Arabic is supported.
    if (tgt !== 'ar' || (src && src !== 'en')) {
      return res.status(400).json({
        error: 'Only English → Arabic translation is supported',
      });
    }

    const result = await translateWithDeepL(text, 'EN', 'AR');
    result.translated_text = applyGlossary(result.translated_text);
    res.json(result);
  } catch (err) {
    console.error('[/api/translate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PDF EXPORT  — translation first, original transcript appendix at the end
// ═══════════════════════════════════════════════════════════════════════════

function buildPdf(session, entries) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  doc.fontSize(20).fillColor('#000').text(session.title, { align: 'center' });
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor('#666')
    .text(`Session ID: ${session.id}  ·  ${session.created_at}`, { align: 'center' });
  doc.moveDown(1);

  // ── Translation (Arabic) — main body ───────────────────────────────────
  doc.fontSize(14).fillColor('#000').text('Translation (Arabic)', { underline: true });
  doc.moveDown(0.5);
  for (const entry of entries) {
    if (entry.event_type) {
      doc.fontSize(10).fillColor('#888').text(`[${entry.original_text}]`);
    } else if (entry.translated_text) {
      doc.fontSize(11).fillColor('#000').text(entry.translated_text, { align: 'right' });
    }
    doc.moveDown(0.35);
  }

  // ── Original transcript appendix ───────────────────────────────────────
  doc.addPage();
  doc.fontSize(14).fillColor('#000').text('Original Transcript (English)', { underline: true });
  doc.moveDown(0.5);
  for (const entry of entries) {
    if (entry.event_type) {
      doc.fontSize(10).fillColor('#888').text(`[${entry.original_text}]`);
    } else if (entry.original_text) {
      doc.fontSize(11).fillColor('#000').text(entry.original_text);
    }
    doc.moveDown(0.35);
  }

  doc.end();
  return doc;
}

function collectPdfBuffer(session, entries) {
  return new Promise((resolve, reject) => {
    const doc = buildPdf(session, entries);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

app.get('/api/sessions/:id/export-pdf', requireAuth, (req, res) => {
  const session = db.sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const entries = (db.entries.get(req.params.id) || []).sort((a, b) => a.sequence - b.sequence);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.pdf"`);
  const doc = buildPdf(session, entries);
  doc.pipe(res);
});

// Email the PDF to the host (or a user-provided address).
app.post('/api/sessions/:id/email-pdf', requireAuth, async (req, res) => {
  try {
    const session = db.sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.host_email !== req.user.email)
      return res.status(403).json({ error: 'Only the host can email the transcript' });

    const to = (req.body?.to || req.user.email || '').trim();
    if (!to) return res.status(400).json({ error: 'recipient email required' });

    if (!process.env.RESEND_API_KEY)
      return res.status(503).json({ error: 'Email is not configured (RESEND_API_KEY missing)' });

    const entries = (db.entries.get(session.id) || []).sort((a, b) => a.sequence - b.sequence);
    const pdfBuffer = await collectPdfBuffer(session, entries);

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Live Translator Pro <onboarding@resend.dev>';
    const subject = `Transcript: ${session.title}`;
    const text = `Your transcript from "${session.title}" is attached.\n\n` +
                 `Session ID: ${session.id}\n` +
                 `Created: ${session.created_at}\n` +
                 `Segments: ${entries.filter((e) => !e.event_type).length}\n`;

    const { data, error } = await resend.emails.send({
      from, to, subject, text,
      attachments: [{
        filename: `session-${session.id}.pdf`,
        content:  pdfBuffer.toString('base64'),
      }],
    });
    if (error) return res.status(502).json({ error: error.message || 'Email send failed' });
    res.json({ ok: true, id: data?.id, to });
  } catch (err) {
    console.error('[/api/sessions/:id/email-pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅  live-translator-pro server running on http://localhost:${PORT}`);
  console.log(`🔌  WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
