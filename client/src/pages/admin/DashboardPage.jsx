import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminLogout, getAdminStats, getRateLimit, saveRateLimit } from '../../services/api.js';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [limit, setLimit] = useState({ max: 5, windowSeconds: 60 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    Promise.all([getAdminStats(), getRateLimit()])
      .then(([statsResult, limitResult]) => { setStats(statsResult); setLimit(limitResult); })
      .catch(e => setError(e.message));
  }, []);
  async function updateLimit(event) {
    event.preventDefault(); setError('');
    try { setLimit(await saveRateLimit(limit)); setMessage('Đã lưu giới hạn rate-limit.'); }
    catch (e) { setError(e.message); }
  }
  return (
    <main className="page admin-page">
      <div className="admin-heading"><div><span className="eyebrow">PROTECTED ADMIN</span><h1>Dashboard</h1></div><div className="admin-actions"><Link to="/admin/prompts" className="secondary-button inline-button">Quản lý System Prompt</Link><button className="secondary-button" onClick={async () => { await adminLogout(); navigate('/admin/login', { replace: true }); }}>Đăng xuất</button></div></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {stats && <><div className="stats-grid"><article className="stat-card"><span>Tổng lượt kiểm tra</span><strong>{stats.total}</strong></article>{['image','audio','document'].map(type => <article className="stat-card" key={type}><span>{type}</span><strong>{stats.byType?.[type] || 0}</strong></article>)}</div><section className="result-section"><h2>Thống kê mức tin cậy</h2><p>Thấp: {stats.byConfidence?.low || 0} · Trung bình: {stats.byConfidence?.medium || 0} · Cao: {stats.byConfidence?.high || 0}</p><h2>Lượt kiểm tra gần đây</h2><div className="admin-table">{(stats.recent || []).map(item => <div className="admin-table-row" key={item.id}><span>{item.type}</span><span>{item.filename || 'Văn bản'}</span><span>{item.confidence}</span><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}</div></section></>}
      <form className="admin-card rate-form" onSubmit={updateLimit}><h2>Rate-limit Client (theo IP)</h2><label>Số lượt kiểm tra tối đa mỗi phút<input type="number" min="1" max="5" value={limit.max} onChange={e => setLimit({ ...limit, max: Number(e.target.value) })} /></label><p className="field-note">Cửa sổ cố định: 60 giây (tối đa 5 lượt/phút).</p><button className="primary-button">Lưu giới hạn</button>{message && <p className="success-message">{message}</p>}</form>
    </main>
  );
}
