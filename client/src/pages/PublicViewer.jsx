import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicSessions, subscribe } from '@/api/api';
import { Languages, Loader2, Users } from 'lucide-react';
import ConversationFeed from '../components/ConversationFeed';

export default function PublicViewer() {
  const { code: rawCode } = useParams();
  const code = (rawCode || '').toUpperCase();
  const [session, setSession] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error,   setError]   = useState('');

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
    let unsub = () => {};
    publicSessions.getByCode(code)
      .then((s) => {
        setSession(s);
        return publicSessions.entries(s.id, code).then(setEntries).then(() => s);
      })
      .then((s) => {
        unsub = subscribe(s.id, (msg) => {
          if (msg.type === 'entry')          mergeEntry(msg.data);
          if (msg.type === 'session_update') setSession((prev) => ({ ...prev, ...msg.data }));
        }, { code });
      })
      .catch((err) => setError(err.message));

    return () => unsub();
  }, [code, mergeEntry]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-3">
            <Languages className="w-5 h-5 text-red-400" />
          </div>
          <p className="text-white font-semibold mb-1">Can't join this session</p>
          <p className="text-slate-400 text-sm">{error}</p>
          <p className="text-slate-500 text-xs mt-3">Code: {code}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
            <Languages className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-base font-inter">{session.title}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                session.status === 'active'
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-slate-800 text-slate-500'
              }`}>{session.status}</span>
              <div className="flex items-center gap-1 text-slate-500 text-xs">
                <Users className="w-3 h-3" />
                {session.participant_count || 1} watching
              </div>
            </div>
          </div>
        </div>
        <span className="font-mono text-slate-400 text-sm tracking-wider">{session.access_code}</span>
      </div>

      <div className="flex-1 px-6 pt-6 pb-4">
        <ConversationFeed entries={entries} />
      </div>

      <div className="px-6 py-3 border-t border-slate-800/50 text-center">
        <span className="text-slate-600 text-xs">EN → AR · Live translation · guest view</span>
      </div>
    </div>
  );
}
