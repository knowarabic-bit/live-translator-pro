# Live Translator Pro — Independent Stack

Real-time **English → Arabic** translation with word-by-word streaming.
**No proprietary BaaS.** Runs entirely on your own infrastructure.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│  AuthPage  Dashboard  SessionRoom                    │
│  AudioCapture → /api/transcribe  (base64 audio)      │
│               → /api/translate   (text)              │
│  WebSocket  ← ws://host/ws  (live entry broadcast)   │
└────────────────────────┬────────────────────────────┘
                         │ HTTP + WebSocket
┌────────────────────────▼────────────────────────────┐
│              Express Server  (Node.js)               │
│                                                      │
│  /api/auth/*          JWT + bcrypt                   │
│  /api/sessions/*      In-memory store (swap → DB)    │
│  /api/transcribe      OpenAI Whisper-1               │
│  /api/translate       DeepL (EN → AR only)           │
│  /api/sessions/:id/export-pdf   PDFKit               │
│  WebSocket /ws        Rooms by sessionId             │
└──────────────────────────────────────────────────────┘
```

### Translation
Only **English → Arabic** is supported. Whisper transcribes; DeepL translates.
Non-English audio is transcribed but not translated.

---

## Quick Start

### 1. Clone & install
```bash
git clone https://github.com/knowarabic-bit/live-translator-pro.git
cd live-translator-pro
npm install        # installs root + client + server workspaces
```

### 2. Configure environment variables

**server/.env** (copy from server/.env.example):
```env
OPENAI_API_KEY=sk-...
DEEPL_API_KEY=...          # ends with :fx for the free plan
JWT_SECRET=change-me-to-a-long-random-string
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
```

**client/.env.local** (copy from client/.env.example):
```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
```

### 3. Run in development
From the repo root:
```bash
npm run dev        # starts server (4000) + client (5173) in parallel
```
…or run them separately:
```bash
npm run dev --workspace=server
npm run dev --workspace=client
```
Open **http://localhost:5173**

---

## API Keys

| Key              | Where to get it |
|------------------|-----------------|
| OPENAI_API_KEY   | https://platform.openai.com/api-keys |
| DEEPL_API_KEY    | https://www.deepl.com/pro-api (500k chars/month free) |

---

## Production Deployment

### Option A — Single VPS
Build the client, then serve `client/dist` as static files from Express:
```bash
cd client && npm run build
# Add static file serving to server/index.js (see comments at bottom of file)
cd ../server && NODE_ENV=production npm start
```

### Option B — Vercel (client) + Railway/Fly.io (server)
1. Deploy `server/` to Railway or Fly.io, set all env vars in the dashboard
2. Deploy `client/` to Vercel:
   - `VITE_API_URL=https://your-server.railway.app`
   - `VITE_WS_URL=wss://your-server.railway.app`

---

## Upgrading the Database

The server uses a simple in-memory `Map` store — data is lost on restart.
To persist data, swap the `db` object in `server/index.js` for:

- **SQLite** (zero-config): `npm install better-sqlite3`
- **PostgreSQL**: `npm install postgres` or `npm install pg`

---

## Project Structure

```
live-translator-pro/
├── server/
│   ├── index.js            ← All routes: auth, sessions, transcribe, translate, PDF, WS
│   ├── package.json
│   └── .env.example
│
└── client/
    ├── src/
    │   ├── api/api.js              ← HTTP + WebSocket client
    │   ├── lib/AuthContext.jsx     ← JWT auth context
    │   ├── pages/
    │   │   ├── AuthPage.jsx        ← Login / Register
    │   │   ├── Dashboard.jsx       ← Sessions list, create, join
    │   │   └── SessionRoom.jsx     ← Live translation room
    │   └── components/
    │       ├── AudioCapture.jsx        ← Mic/system → 1.5s chunks → API
    │       ├── ConversationFeed.jsx    ← rAF auto-scroll feed
    │       └── ConversationBubble.jsx  ← Word-by-word streaming (Cairo + Inter)
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    └── .env.example
```
