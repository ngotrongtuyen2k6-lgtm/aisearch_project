const API_BASE = import.meta.env.VITE_API_BASE || '';
const IMAGE_API_BASE = import.meta.env.VITE_IMAGE_API_BASE || 'http://localhost:8000';

async function requestAt(baseUrl, path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options
    });
  } catch {
    throw new Error('Không thể kết nối tới máy chủ. Vui lòng kiểm tra kết nối và thử lại.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallbackMessages = {
      413: 'Tệp hoặc nội dung vượt quá dung lượng cho phép.',
      429: 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.',
      503: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
      504: 'Yêu cầu xử lý quá thời gian chờ. Vui lòng thử lại.'
    };
    throw new Error(body.error || body.detail || fallbackMessages[response.status] || `Yêu cầu thất bại (HTTP ${response.status}).`);
  }
  return body;
}

function request(path, options = {}) {
  return requestAt(API_BASE, path, { credentials: 'include', ...options });
}

async function verifyImageContent(file, onPhaseChange) {
  const form = new FormData();
  form.append('file', file);
  onPhaseChange?.('uploading');
  const accepted = await requestAt(IMAGE_API_BASE, '/upload', {
    method: 'POST',
    credentials: 'omit',
    body: form
  });

  if (accepted.status === 'completed') {
    return {
      analysis: await requestAt(IMAGE_API_BASE, `/results/${accepted.job_id}`),
      jobId: accepted.job_id
    };
  }

  onPhaseChange?.('analyzing');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const job = await requestAt(IMAGE_API_BASE, `/jobs/${accepted.job_id}`, { credentials: 'omit' });
    if (job.status === 'failed') throw new Error(job.error || 'Không thể phân tích ảnh.');
    if (job.status === 'completed') {
      return {
        analysis: await requestAt(IMAGE_API_BASE, `/results/${accepted.job_id}`, { credentials: 'omit' }),
        jobId: accepted.job_id
      };
    }
  }
  throw new Error('Phân tích ảnh chưa hoàn tất sau 2 phút. Hãy kiểm tra lại trạng thái job.');
}

export function verifyContent({ type, file, text, onPhaseChange }) {
  if (type === 'image' && file) return verifyImageContent(file, onPhaseChange);
  const form = new FormData();
  form.append('type', type);
  if (file) form.append('file', file);
  if (text) form.append('text', text);
  onPhaseChange?.('analyzing');
  return request('/api/verify', { method: 'POST', body: form });
}

export function submitImageDispute(jobId, { comment, contact }) {
  return requestAt(IMAGE_API_BASE, `/results/${encodeURIComponent(jobId)}/dispute`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment, contact: contact || undefined })
  });
}

export function submitDispute(analysisId, { comment, contact }) {
  return request(`/api/results/${encodeURIComponent(analysisId)}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment, contact: contact || undefined })
  });
}

export function adminLogin(username, password) {
  return request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export function getAdminSession() { return request('/api/admin/session'); }
export function adminLogout() { return request('/api/admin/logout', { method: 'POST' }); }
export function getAdminStats() { return request('/api/admin/stats'); }
export function getAdminPrompts() { return request('/api/admin/prompts'); }

export function saveAdminPrompts(prompts) {
  return request('/api/admin/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts })
  });
}

export function getRateLimit() { return request('/api/admin/rate-limit'); }

export function saveRateLimit(settings) {
  return request('/api/admin/rate-limit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
}
