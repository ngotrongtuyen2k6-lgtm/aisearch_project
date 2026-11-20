import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getAdminSession } from '../services/api.js';

export default function ProtectedRoute() {
  const [state, setState] = useState('checking');

  useEffect(() => {
    let active = true;
    getAdminSession()
      .then(() => active && setState('authorized'))
      .catch(() => active && setState('unauthorized'));
    return () => { active = false; };
  }, []);

  if (state === 'checking') return <main className="page"><p>Đang xác thực phiên đăng nhập…</p></main>;
  if (state === 'unauthorized') return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}
