import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminPrompts, saveAdminPrompts } from '../../services/api.js';

const LABELS = { image: 'Hình ảnh', audio: 'Âm thanh', document: 'Tài liệu / Văn bản' };

export default function PromptManagerPage() {
  const [prompts, setPrompts] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { getAdminPrompts().then(data => setPrompts(data.prompts)).catch(e => setError(e.message)); }, []);
  function changePrompt(type, value) { setPrompts(current => ({ ...current, [type]: value })); }
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    try { const result = await saveAdminPrompts(prompts); setPrompts(result.prompts); setMessage('Đã lưu prompt. Các lượt phân tích mới sẽ sử dụng nội dung này.'); }
    catch (e) { setError(e.message); }
  }
  return (
    <main className="page admin-page">
      <Link to="/admin" className="back-link">← Dashboard</Link><h1>Quản lý System Prompt</h1>
      <p>Prompt được nạp động cho từng yêu cầu phân tích. Không nhập API key hoặc thông tin bí mật vào đây.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {prompts && <form className="prompt-form" onSubmit={submit}>{Object.entries(LABELS).map(([type, label]) => <label key={type}>{label}<textarea rows="9" value={prompts[type] || ''} onChange={event => changePrompt(type, event.target.value)} required minLength="20" /></label>)}<button className="primary-button">Lưu các prompt</button>{message && <p className="success-message">{message}</p>}</form>}
    </main>
  );
}
