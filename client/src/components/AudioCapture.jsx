import { useState, useRef, useEffect, useCallback } from 'react';
import { transcribe, translate, entries as entriesApi } from '@/api/api';
import { useAuth } from '@/lib/AuthContext';
import { Mic, Monitor, Square } from 'lucide-react';

// ─── Tuning ──────────────────────────────────────────────────────────────────
const CHUNK_MS   = 1500;   // ms per audio chunk → faster first-word appearance
const MIN_BYTES  = 500;    // ignore tiny blobs (silence artefacts)

// Bilingual labels for non-speech audio events
const EVENT_LABELS = {
  laughter: { en: 'Laughter',         ar: 'المتحدث يضحك'    },
  applause: { en: 'Applause',         ar: 'تصفيق'           },
  music:    { en: 'Music',            ar: 'موسيقى'          },
  silence:  { en: 'Silence',         ar: 'فترة صمت'        },
  noise:    { en: 'Background Noise', ar: 'ضجيج خلفية'      },
  unclear:  { en: 'Unclear Audio',    ar: 'الصوت غير واضح'  },
};

export default function AudioCapture({ sessionId, onEntry, isHost }) {
  const { user }            = useAuth();
  const [recording, setRec] = useState(false);
  const [mode, setMode]     = useState('mic');   // mic | system
  const [status, setStatus] = useState('idle');  // idle | listening | processing

  const streamRef    = useRef(null);
  const recorderRef  = useRef(null);
  const timerRef     = useRef(null);
  const activeRef    = useRef(false);
  const sequenceRef  = useRef(0);

  // ── Core: process one audio blob ─────────────────────────────────────────
  const processChunk = useCallback(async (blob, mimeType) => {
    if (blob.size < MIN_BYTES) return;
    setStatus('processing');

    try {
      // Encode blob → base64
      const buf    = await blob.arrayBuffer();
      const b64    = btoa(String.fromCharCode(...new Uint8Array(buf)));

      // 1. Transcribe via Whisper
      const txRes = await transcribe(b64, mimeType);
      const { event_type, text, language: rawLang } = txRes;
      const detectedLang = /^[a-z]{2}$/.test(rawLang) ? rawLang : 'en';

      // ── Non-speech event ─────────────────────────────────────────────────
      if (event_type && EVENT_LABELS[event_type]) {
        const lbl = EVENT_LABELS[event_type];
        sequenceRef.current += 1;
        const entry = await entriesApi.create(sessionId, {
          original_text:     `[${lbl.ar} / ${lbl.en}]`,
          translated_text:   '',
          detected_language: detectedLang,
          target_language:   '',
          speaker_email:     user?.email,
          sequence:          sequenceRef.current,
          event_type,
        });
        onEntry(entry);
        setStatus('listening');
        return;
      }

      // ── No usable speech ─────────────────────────────────────────────────
      if (!text?.trim() || text.trim().split(/\s+/).length <= 2) {
        setStatus('listening');
        return;
      }

      // ── EN → AR only: skip anything that isn't English ───────────────────
      if (detectedLang !== 'en') {
        setStatus('listening');
        return;
      }

      // ── OPTIMISTIC: show original immediately ────────────────────────────
      const targetLang = 'ar';
      sequenceRef.current += 1;
      const seq = sequenceRef.current;

      const optimistic = {
        id:                `optimistic-${seq}`,
        session_id:        sessionId,
        original_text:     text,
        translated_text:   null,     // null = "Translating…" spinner
        detected_language: 'en',
        target_language:   targetLang,
        speaker_email:     user?.email,
        sequence:          seq,
      };
      onEntry(optimistic);
      setStatus('listening');       // unblock UI before translate round-trip

      // 2. Translate in background (EN → AR via DeepL)
      const tlRes = await translate(text, 'en', targetLang);
      const { translated_text, detected_language: confirmedLang } = tlRes;

      // Persist to server (triggers WS broadcast to other participants)
      const realEntry = await entriesApi.create(sessionId, {
        original_text:     text,
        translated_text:   translated_text || '',
        detected_language: confirmedLang || 'en',
        target_language:   targetLang,
        speaker_email:     user?.email,
        sequence:          seq,
      });

      // Replace optimistic bubble with persisted entry
      onEntry({ ...realEntry, _replaceId: `optimistic-${seq}` });

    } catch (err) {
      console.error('[AudioCapture] processChunk:', err.message);
      setStatus('listening');
    }
  }, [sessionId, onEntry, user]);

  // ── Self-restarting chunk loop ────────────────────────────────────────────
  const startLoop = useCallback((stream, mimeType) => {
    if (!activeRef.current) return;
    const chunks   = [];
    const opts     = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(stream, opts);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (blob.size > MIN_BYTES) processChunk(blob, mimeType || 'audio/webm');
      if (activeRef.current) startLoop(stream, mimeType);
    };

    recorder.start();
    timerRef.current = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, CHUNK_MS);
  }, [processChunk]);

  const startRecording = async () => {
    try {
      let stream;
      if (mode === 'system') {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((t) => t.stop());
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const supported = [
        'audio/webm;codecs=opus', 'audio/webm',
        'audio/ogg;codecs=opus',  'audio/ogg', 'audio/mp4',
      ];
      const mimeType = supported.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

      activeRef.current = true;
      setRec(true);
      setStatus('listening');
      startLoop(stream, mimeType);
    } catch (err) {
      console.error('[AudioCapture] startRecording:', err.message);
    }
  };

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    clearTimeout(timerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRec(false);
    setStatus('idle');
  }, []);

  useEffect(() => () => stopRecording(), [stopRecording]);

  if (!isHost) return null;

  return (
    <div className="flex items-center gap-3">
      {/* Mode selector */}
      {!recording && (
        <div className="flex rounded-xl overflow-hidden border border-slate-700">
          {[
            { id: 'mic',    Icon: Mic,     label: 'Mic'    },
            { id: 'system', Icon: Monitor, label: 'System' },
          ].map(({ id, Icon, label }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all ${
                mode === id
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      )}

      {/* Record / Stop */}
      <button
        onClick={recording ? stopRecording : startRecording}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
          recording
            ? 'bg-red-500 hover:bg-red-400 text-white'
            : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
        }`}
      >
        {recording
          ? <><Square className="w-4 h-4" /> Stop</>
          : <><Mic    className="w-4 h-4" /> Start Capture</>}
      </button>

      {/* Status dot */}
      {recording && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className={`w-2 h-2 rounded-full ${
            status === 'listening'  ? 'bg-green-400 animate-pulse' :
            status === 'processing' ? 'bg-yellow-400 animate-spin' :
                                      'bg-slate-500'
          }`} />
          {status === 'listening'  ? 'Listening…'  :
           status === 'processing' ? 'Translating…' : 'Idle'}
        </div>
      )}
    </div>
  );
}
