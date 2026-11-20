import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { submitDispute, submitImageDispute } from '../../services/api.js';

const CONFIDENCE_ORDER = ['Low', 'Medium', 'High'];

export default function ResultView({ language }) {
  const { state } = useLocation();
  const analysis = state?.analysis;
  const jobId = state?.jobId;
  const originalPreviewUrl = state?.originalPreviewUrl;
  const isVi = language === 'vi';
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  useEffect(() => () => {
    if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl);
  }, [originalPreviewUrl]);

  if (!analysis) {
    return (
      <main className="page result-page">
        <div className="empty-result-card">
          <span className="empty-result-icon">⌕</span>
          <h1>{isVi ? 'Chưa có kết quả để hiển thị' : 'No result to display yet'}</h1>
          <p>{isVi ? 'Hãy chọn nội dung cần kiểm tra để bắt đầu.' : 'Choose content to start a new check.'}</p>
          <Link className="primary-button" to="/">{isVi ? 'Về trang kiểm tra' : 'Back to verification'}</Link>
        </div>
      </main>
    );
  }

  const isImageMvpResult = Boolean(analysis.ai_generated);
  const aiScore = isImageMvpResult ? analysis.ai_generated.score : analysis.aiGeneratedProbability;
  const editedScore = isImageMvpResult ? analysis.edited.score : analysis.editedProbability;
  const confidenceLevels = isImageMvpResult
    ? [analysis.ai_generated.confidence, analysis.edited.confidence]
    : [analysis.confidence ? analysis.confidence[0].toUpperCase() + analysis.confidence.slice(1) : 'Low'];
  const confidenceValue = confidenceLevels
    .filter(Boolean)
    .sort((left, right) => CONFIDENCE_ORDER.indexOf(left) - CONFIDENCE_ORDER.indexOf(right))[0] || 'Low';
  const confidenceLabel = {
    Low: isVi ? 'Thấp' : 'Low',
    Medium: isVi ? 'Trung bình' : 'Medium',
    High: isVi ? 'Cao' : 'High'
  }[confidenceValue] || confidenceValue;
  const evidence = isImageMvpResult
    ? analysis.evidence
    : [
        ...(analysis.observedEvidence || []).map((detail, index) => ({ code: `observed-${index}`, kind: 'observed', title: isVi ? 'Quan sát được' : 'Observed', detail })),
        ...(analysis.hypotheses || []).map((detail, index) => ({ code: `hypothesis-${index}`, kind: 'inference', title: isVi ? 'Dấu hiệu tham khảo' : 'Indicative signal', detail }))
      ];
  const inconclusive = analysis.status === 'inconclusive'
    || analysis.status === 'Inconclusive'
    || confidenceLevels.includes('Low');
  const limitations = isImageMvpResult
    ? analysis.limitations
    : [analysis.confidenceReason].filter(Boolean);

  async function sendFeedback(event) {
    event.preventDefault();
    if (feedbackBusy || comment.trim().length < 10) return;
    setFeedbackBusy(true);
    setFeedbackError('');
    try {
      if (isImageMvpResult && jobId) {
        await submitImageDispute(jobId, { comment: comment.trim(), contact: contact.trim() });
      } else if (analysis.id) {
        await submitDispute(analysis.id, { comment: comment.trim(), contact: contact.trim() });
      } else {
        throw new Error(isVi ? 'Không tìm thấy mã kết quả để gửi góp ý.' : 'This result has no reference ID for feedback.');
      }
      setFeedbackSent(true);
    } catch (error) {
      setFeedbackError(error.message);
    } finally {
      setFeedbackBusy(false);
    }
  }

  const scoreText = score => score == null
    ? (isVi ? 'Chưa có điểm' : 'Not available')
    : `${score}%`;

  return (
    <main className="page result-page">
      <Link to="/" className="back-link"><span aria-hidden="true">←</span> {isVi ? 'Kiểm tra nội dung khác' : 'Check another item'}</Link>
      <section className="result-heading">
        <div><span className="eyebrow">{isVi ? 'BÁO CÁO PHÂN TÍCH' : 'ANALYSIS REPORT'} <span className="report-id">{analysis.sha256?.slice(0, 10)}</span></span><h1>{isVi ? 'Các dấu hiệu tìm thấy' : 'Signals in this file'}</h1><p>{isVi ? 'Đọc từng dấu hiệu cùng bối cảnh. Điểm số không phải phán quyết.' : 'Review each signal in context. Scores are not verdicts.'}</p></div>
        <span className={`confidence-pill confidence-${confidenceValue.toLowerCase()}`}><span aria-hidden="true">{confidenceValue === 'High' ? '✓' : confidenceValue === 'Medium' ? '◐' : '!'}</span>{isVi ? 'Độ tin cậy' : 'Confidence'}: {confidenceLabel}</span>
      </section>

      {inconclusive && <div className="inconclusive-banner"><span className="banner-symbol" aria-hidden="true">!</span><p><strong>{isVi ? 'Chưa đủ cơ sở kết luận' : 'Inconclusive'}</strong><span>{isVi ? 'Các dấu hiệu hiện có chưa đủ tin cậy để đưa ra nhận định chắc chắn.' : 'The available signals are not reliable enough for a firm assessment.'}</span></p></div>}

      <section className="score-grid" aria-label={isVi ? 'Các chỉ số phân tích' : 'Analysis scores'}>
        <ScoreCard label={isVi ? 'Khả năng do AI tạo' : 'AI-generated likelihood'} score={aiScore} confidence={isImageMvpResult ? analysis.ai_generated.confidence : analysis.confidence} icon="✳" kind="ai" isVi={isVi} scoreText={scoreText} />
        <ScoreCard label={isVi ? 'Khả năng đã chỉnh sửa' : 'Edited likelihood'} score={editedScore} confidence={isImageMvpResult ? analysis.edited.confidence : analysis.confidence} icon="⌁" kind="edited" isVi={isVi} scoreText={scoreText} />
      </section>

      {isImageMvpResult && <section className="visual-evidence-card">
        <div className="visual-card-heading"><div><span className="eyebrow">{isVi ? '01 / BẰNG CHỨNG THỊ GIÁC' : '01 / VISUAL EVIDENCE'}</span><h2>{isVi ? 'Quan sát ảnh & bản đồ nhiệt' : 'Image & heatmap view'}</h2></div>
          {analysis.ela_heatmap_base64 && <button className={`toggle-control${heatmapEnabled ? ' selected' : ''}`} type="button" aria-pressed={heatmapEnabled} onClick={() => setHeatmapEnabled(value => !value)}><span className="toggle-track"><span /></span>{isVi ? 'Lớp phủ ELA' : 'ELA overlay'}</button>}
        </div>
        <div className="visual-canvas">
          {originalPreviewUrl
            ? <img className="original-image" src={originalPreviewUrl} alt={isVi ? 'Ảnh gốc được tải lên' : 'Uploaded original image'} />
            : <div className="image-unavailable"><span aria-hidden="true">▧</span><p>{isVi ? 'Ảnh gốc chỉ có trong phiên tải lên hiện tại.' : 'The original is available only in the upload session.'}</p></div>}
          {heatmapEnabled && analysis.ela_heatmap_base64 && <img className={`heatmap-image${originalPreviewUrl ? ' heatmap-overlay' : ''}`} src={`data:image/png;base64,${analysis.ela_heatmap_base64}`} alt={isVi ? 'Bản đồ nhiệt ELA tham khảo' : 'Indicative ELA heatmap'} />}
          <span className="canvas-corner canvas-corner-tl" /><span className="canvas-corner canvas-corner-tr" /><span className="canvas-corner canvas-corner-bl" /><span className="canvas-corner canvas-corner-br" />
        </div>
        <div className="visual-legend"><span><i className="legend-dot original-dot" />{isVi ? 'Ảnh gốc' : 'Original image'}</span><span><i className="legend-dot heat-dot" />{isVi ? 'Sai khác nén được tăng cường để quan sát' : 'Enhanced compression differences'}</span><small>{isVi ? 'ELA là phép so sánh tham khảo, không khẳng định vùng bị chỉnh sửa.' : 'ELA is an indicative comparison, not proof of edited regions.'}</small></div>
      </section>}

      <section className="evidence-section">
        <div className="section-heading evidence-heading"><div><span className="eyebrow">{isVi ? '02 / CƠ SỞ ĐÁNH GIÁ' : '02 / BASIS OF ASSESSMENT'}</span><h2>{isVi ? 'Bằng chứng & dấu hiệu' : 'Evidence & signals'}</h2></div><span className="evidence-count">{String(evidence.length).padStart(2, '0')} {isVi ? 'MỤC' : 'ITEMS'}</span></div>
        {evidence.length
          ? <div className="evidence-grid">{evidence.map((item, index) => <EvidenceCard key={item.code || index} item={item} index={index} isVi={isVi} />)}</div>
          : <div className="no-evidence-card"><span aria-hidden="true">i</span><p>{isVi ? 'Chưa có bằng chứng cụ thể được trích xuất. Vui lòng xem các giới hạn bên dưới.' : 'No specific evidence was extracted. Review the limitations below.'}</p></div>}
      </section>

      <details className="limitations-panel">
        <summary><span><span className="eyebrow">{isVi ? '03 / MINH BẠCH' : '03 / TRANSPARENCY'}</span><strong>{isVi ? 'Giới hạn của phân tích này' : 'Limitations of this analysis'}</strong></span><span className="details-toggle">{isVi ? 'Mở rộng' : 'Expand'} <b aria-hidden="true">＋</b></span></summary>
        <ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        {isImageMvpResult && <p className="provenance-note"><strong>{isVi ? 'Nguồn gốc:' : 'Provenance:'}</strong> {analysis.provenance?.summary || (isVi ? 'Chưa có dữ liệu C2PA được xác minh.' : 'No verified C2PA data was available.')}</p>}
      </details>

      <div className="report-footer"><div className="integrity-row"><span><span className="integrity-icon">⌗</span> SHA-256 <code>{analysis.sha256}</code></span><span>{new Date(analysis.timestamp).toLocaleString(isVi ? 'vi-VN' : 'en-US')}</span></div><span className="report-footer-note">{isVi ? 'Thời gian phân tích' : 'Analysis timestamp'}</span></div>

      <div className="result-actions"><button type="button" className="feedback-button" onClick={() => { setFeedbackOpen(true); setFeedbackSent(false); setFeedbackError(''); }}><span aria-hidden="true">↗</span>{isVi ? 'Kết quả này có vẻ chưa đúng' : 'This result doesn’t look right'}</button><Link to="/" className="primary-button inline-button">{isVi ? 'Kiểm tra nội dung khác' : 'Check another item'} <span aria-hidden="true">→</span></Link></div>

      <div className="disclaimer-banner result-disclaimer"><span className="disclaimer-icon">i</span><p><strong>{isVi ? 'Chỉ mang tính tham khảo, không phải bằng chứng xác thực tuyệt đối' : 'Indicative, not proof'}</strong><span>{isVi ? 'Hãy xác minh độc lập trước khi sử dụng thông tin này.' : 'Verify independently before relying on this information.'}</span></p><span className="disclaimer-en">INDICATIVE, NOT PROOF</span></div>

      {feedbackOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !feedbackBusy) setFeedbackOpen(false); }}>
        <section className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onKeyDown={event => { if (event.key === 'Escape' && !feedbackBusy) setFeedbackOpen(false); }}>
          <button type="button" className="modal-close" aria-label={isVi ? 'Đóng' : 'Close'} onClick={() => setFeedbackOpen(false)}>×</button>
          {feedbackSent
            ? <div className="feedback-success"><span aria-hidden="true">✓</span><h2>{isVi ? 'Đã ghi nhận góp ý' : 'Feedback received'}</h2><p>{isVi ? 'Cảm ơn bạn đã giúp cải thiện công cụ kiểm chứng.' : 'Thank you for helping improve this verification tool.'}</p><button className="primary-button" type="button" onClick={() => setFeedbackOpen(false)}>{isVi ? 'Đóng' : 'Close'}</button></div>
            : <form onSubmit={sendFeedback}><span className="eyebrow">{isVi ? 'PHẢN HỒI KẾT QUẢ' : 'RESULT FEEDBACK'}</span><h2 id="feedback-title">{isVi ? 'Điều gì có vẻ chưa đúng?' : 'What seems incorrect?'}</h2><p>{isVi ? 'Góp ý của bạn được gắn với mã kết quả này để đội ngũ có thể xem xét.' : 'Your feedback is linked to this result so it can be reviewed.'}</p><label htmlFor="feedback-comment">{isVi ? 'Mô tả góp ý' : 'Your feedback'}<textarea id="feedback-comment" autoFocus value={comment} onChange={event => setComment(event.target.value)} minLength="10" maxLength="5000" rows="5" required placeholder={isVi ? 'Chia sẻ dấu hiệu hoặc bối cảnh mà bạn nghĩ còn thiếu…' : 'Share evidence or context you think was missed…'} /></label><label htmlFor="feedback-contact">{isVi ? 'Email liên hệ (không bắt buộc)' : 'Contact email (optional)'}<input id="feedback-contact" type="email" maxLength="320" value={contact} onChange={event => setContact(event.target.value)} placeholder="name@example.com" /></label>{feedbackError && <p className="error-message" role="alert">{feedbackError}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={feedbackBusy} onClick={() => setFeedbackOpen(false)}>{isVi ? 'Hủy' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={feedbackBusy || comment.trim().length < 10}>{feedbackBusy ? (isVi ? 'Đang gửi…' : 'Sending…') : (isVi ? 'Gửi góp ý' : 'Send feedback')}</button></div></form>}
        </section>
      </div>}
    </main>
  );
}

function ScoreCard({ label, score, confidence, icon, kind, isVi, scoreText }) {
  const level = confidence ? confidence[0].toUpperCase() + confidence.slice(1) : 'Low';
  const confidenceLabel = { Low: isVi ? 'Thấp' : 'Low', Medium: isVi ? 'Trung bình' : 'Medium', High: isVi ? 'Cao' : 'High' }[level] || level;
  const numericScore = typeof score === 'number' ? Math.min(100, Math.max(0, score)) : 0;
  return (
    <article className={`score-card score-${kind}`}>
      <div className="score-card-top"><span className="score-icon" aria-hidden="true">{icon}</span><span className={`confidence-pill confidence-${(level || 'Low').toLowerCase()}`}><span aria-hidden="true">{level === 'High' ? '✓' : level === 'Medium' ? '◐' : '!'}</span>{confidenceLabel}</span></div>
      <span className="score-label">{label}</span><strong className="score-value">{scoreText(score)}</strong>
      <div className="score-track" aria-hidden="true"><span style={{ width: `${numericScore}%` }} /></div>
      <span className="score-caption">{isVi ? 'Mức tin cậy của chỉ số này' : 'Confidence for this score'}: <b>{confidenceLabel}</b></span>
    </article>
  );
}

function EvidenceCard({ item, index, isVi }) {
  const kindLabel = item.kind === 'observed'
    ? (isVi ? 'QUAN SÁT ĐƯỢC' : 'OBSERVED')
    : item.kind === 'provenance'
      ? (isVi ? 'NGUỒN GỐC' : 'PROVENANCE')
      : (isVi ? 'DẤU HIỆU THAM KHẢO' : 'INDICATIVE');
  const icon = item.kind === 'observed' ? '◎' : item.kind === 'provenance' ? '◇' : '⌁';
  return (
    <article className="evidence-card">
      <div className="evidence-card-top"><span className={`evidence-kind evidence-${item.kind}`}><span aria-hidden="true">{icon}</span>{kindLabel}</span><span className="evidence-index">{String(index + 1).padStart(2, '0')}</span></div>
      <h3>{item.title}</h3><p>{item.detail}</p>
    </article>
  );
}
