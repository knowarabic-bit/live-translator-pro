import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import AuthPage      from './pages/AuthPage';
import Dashboard     from './pages/Dashboard';
import SessionRoom   from './pages/SessionRoom';
import PublicViewer  from './pages/PublicViewer';
import { Loader2 } from 'lucide-react';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
    </div>
  );
  return user ? children : <Navigate to="/auth" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/s/:code" element={<PublicViewer />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/session/:id" element={<RequireAuth><SessionRoom /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
