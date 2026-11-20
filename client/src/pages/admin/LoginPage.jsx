import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminLogin } from '../../services/api.js';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await adminLogin(data.get('username'), data.get('password'));
      navigate('/admin', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="page admin-page"><form className="admin-card" onSubmit={submit}><h1>Admin sign in</h1><label>Tên đăng nhập<input name="username" autoComplete="username" required /></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="error-message" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Đang xác thực…' : 'Đăng nhập'}</button><Link to="/" className="back-link">← Về trang chủ</Link></form></main>;
}
