import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { sessions, entries as entriesApi, exportPdf, subscribe } from '@/api/api';
import {
  ArrowLeft, Copy, Check, Users, StopCircle, Download, Loader2, Mail, Share2,
} from 'lucide-react';
import ConversationFeed from '../components/ConversationFeed';
import AudioCapture    from '../components/AudioCapture';

export default function SessionRoom() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const [session,   setSession]   = useState(null);
  const [entries,   setEntries]   = useState([]);
  const [copied,    setCopied]    = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ending,    setEnding]    = useState(false);
  const [emailing,  setEmailing]  = useState(false);
  const [emailMsg,  setEmailMsg]  = useState('');

  // ── Unified entry merge: handles optimistic, replace, and WS broadcasts ──
  const mergeEntry = useCallback((entry) => {
    setEntries((prev) => {
      if (entry._replaceId) {
        const { _replaceId, ...clean } = entry;
        return prev.map((e) => (e.id === _replaceId ? clean : e));
      }
      if (prev.some((e) => e.id === entry.id)) return prev;
      return [...prev, entry];
    });
  }, []);

  useEffect(() => {
    // Load session + existing entries
    sessions.get(id).then(setSession).catch(() => navigate('/'));
    entriesApi.list(id).then(setEntries);

    // Real-time WebSocket subscription
    const unsub = subscribe(id, (msg) => {
      if (msg.type === 'entry')          mergeEntry(msg.data);
      if (msg.type === 'session_update') setSession(msg.data);
    });

    return unsub;
  }, [id, navigate, mergeEntry]);

  const copyCode = () => {
    navigator.clipboard.writeText(session?.access_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareUrl = session
    ? `${window.location.origin}/s/${session.access_code}`
    : '';

  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const endSession = async () => {
    setEnding(true);
    try {
      const updated = await sessions.update(id, { status: 'ended' });
      setSession(updated);
    } finally {
      setEnding(false);
    }
  };

  const emailTranscript = async () => {
    setEmailing(true);
    setEmailMsg('');
    try {
      const to = user?.email;
      await sessions.emailPdf(id, to);
      setEmailMsg(`Sent to ${to}`);
    } catch (err) {
      setEmailMsg(err.message);
    } finally {
      setEmailing(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const blob = await exportPdf(id);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `session-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const isHost = user && session && user.email === session.host_email;

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-white font-semibold text-base font-inter">
              {session.title}
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                session.status === 'active'
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-slate-800 text-slate-500'
              }`}>
                {session.status}
              </span>
              <div className="flex items-center gap-1 text-slate-500 text-xs">
                <Users className="w-3 h-3" />
                {session.participant_count || 1} participants
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {session.status === 'active' && (
            <>
              <button
                onClick={copyCode}
                title="Copy access code"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-300 text-sm transition-all"
              >
                {copied
                  ? <Check className="w-4 h-4 text-green-400" />
                  : <Copy  className="w-4 h-4" />}
                <span className="font-mono tracking-wider">{session.access_code}</span>
              </button>
              <button
                onClick={copyShareLink}
                title="Copy public share link"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 text-sm transition-all"
              >
                {linkCopied
                  ? <Check className="w-4 h-4 text-green-400" />
                  : <Share2 className="w-4 h-4" />}
                {linkCopied ? 'Link copied' : 'Share link'}
              </button>
            </>
          )}

          {isHost && session.status === 'ended' && (
            <button
              onClick={emailTranscript}
              disabled={emailing || entries.length === 0}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30 hover:border-violet-400 text-violet-300 text-sm transition-all disabled:opacity-40"
            >
              {emailing
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Mail className="w-4 h-4" />}
              Email PDF
            </button>
          )}

          <button
            onClick={handleExportPdf}
            disabled={exporting || entries.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-violet-500/50 text-slate-300 text-sm transition-all disabled:opacity-40"
          >
            {exporting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            Export PDF
          </button>

          {isHost && session.status === 'active' && (
            <button
              onClick={endSession}
              disabled={ending}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 hover:border-red-400 text-red-400 text-sm transition-all"
            >
              <StopCircle className="w-4 h-4" />
              End Session
            </button>
          )}
        </div>
      </div>

      {/* ── Audio capture bar (host only) ───────────────────────────────── */}
      {isHost && session.status === 'active' && (
        <div className="px-6 py-3 bg-slate-900/50 border-b border-slate-800/50 flex items-center gap-4">
          <span className="text-slate-500 text-xs uppercase tracking-widest mr-2">
            Audio Source:
          </span>
          <AudioCapture
            sessionId={id}
            onEntry={mergeEntry}
            isHost={isHost}
          />
        </div>
      )}

      {/* ── End-of-session banner ────────────────────────────────────────── */}
      {isHost && session.status === 'ended' && (
        <div className="px-6 py-3 bg-slate-900/50 border-b border-slate-800/50 flex items-center justify-between">
          <span className="text-slate-300 text-sm">
            Session ended — email the transcript as a PDF to <span className="text-violet-300">{user?.email}</span>?
          </span>
          {emailMsg && <span className="text-xs text-slate-400">{emailMsg}</span>}
        </div>
      )}

      {/* ── Conversation feed ────────────────────────────────────────────── */}
      <div className="flex-1 px-6 pt-6 pb-4">
        <ConversationFeed entries={entries} />
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-t border-slate-800/50 flex items-center justify-between">
        <span className="text-slate-600 text-xs">
          {entries.filter(e => !e.event_type).length} segments transcribed
        </span>
        <span className="text-slate-600 text-xs">
          EN → AR · Whisper + DeepL
        </span>
      </div>
    </div>
  );
}
