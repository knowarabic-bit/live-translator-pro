import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { sessions } from '@/api/api';
import { Plus, LogIn, Languages, Loader2, LogOut, Clock } from 'lucide-react';

export default function Dashboard() {
  const { user, logout }         = useAuth();
  const navigate                 = useNavigate();
  const [list, setList]          = useState([]);
  const [loading, setLoading]    = useState(true);
  const [showCreate, setCreate]  = useState(false);
  const [showJoin, setJoin]      = useState(false);
  const [title, setTitle]        = useState('');
  const [code, setCode]          = useState('');
  const [working, setWorking]    = useState(false);
  const [error, setError]        = useState('');

  useEffect(() => {
    sessions.list().then(setList).finally(() => setLoading(false));
  }, []);

  const createSession = async (e) => {
    e.preventDefault();
    setWorking(true); setError('');
    try {
      const s = await sessions.create({ title: title || 'Untitled Session' });
      navigate(`/session/${s.id}`);
    } catch (err) { setError(err.message); }
    finally { setWorking(false); }
  };

  const joinSession = async (e) => {
    e.preventDefault();
    setWorking(true); setError('');
    try {
      const s = await sessions.join(code.trim().toUpperCase());
      navigate(`/session/${s.id}`);
    } catch (err) { setError(err.message); }
    finally { setWorking(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
            <Languages className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-white font-semibold font-inter">Live Translator Pro</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm">{user?.email}</span>
          <button onClick={logout} className="text-slate-500 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Action buttons */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => { setCreate(true); setJoin(false); setError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>
          <button
            onClick={() => { setJoin(true); setCreate(false); setError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 text-white text-sm transition-all"
          >
            <LogIn className="w-4 h-4" /> Join Session
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={createSession} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
            <h3 className="text-white font-semibold mb-4">New Translation Session</h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Session title (optional)"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-cyan-500 transition-colors mb-3"
            />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={working}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm disabled:opacity-60"
              >
                {working && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
              <button type="button" onClick={() => setCreate(false)} className="text-slate-400 text-sm hover:text-white">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Join form */}
        {showJoin && (
          <form onSubmit={joinSession} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
            <h3 className="text-white font-semibold mb-4">Join a Session</h3>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code (e.g. A1B2C3)"
              maxLength={8}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm outline-none focus:border-cyan-500 transition-colors mb-3 uppercase tracking-widest"
            />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={working || !code.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm disabled:opacity-60"
              >
                {working && <Loader2 className="w-4 h-4 animate-spin" />}
                Join
              </button>
              <button type="button" onClick={() => setJoin(false)} className="text-slate-400 text-sm hover:text-white">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Session list */}
        <h2 className="text-slate-400 text-xs uppercase tracking-widest mb-3">Your Sessions</h2>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 text-cyan-400 animate-spin" /></div>
        ) : list.length === 0 ? (
          <p className="text-slate-600 text-sm text-center py-12">No sessions yet — create one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/session/${s.id}`)}
                className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-slate-700 transition-all text-left"
              >
                <div>
                  <p className="text-white font-medium font-inter">{s.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.status === 'active'
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-slate-800 text-slate-500'
                    }`}>{s.status}</span>
                    <span className="font-mono text-xs text-slate-500">{s.access_code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-600 text-xs">
                  <Clock className="w-3 h-3" />
                  {new Date(s.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
