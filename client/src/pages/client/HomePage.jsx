import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadBox from '../../components/UploadBox.jsx';
import { verifyContent } from '../../services/api.js';

export default function HomePage({ language }) {
  const [busy, setBusy] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState('uploading');
  const requestInFlight = useRef(false);
  const navigate = useNavigate();
  const isVi = language === 'vi';

  async function analyze(payload) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setAnalysisPhase('uploading');
    try {
      const result = await verifyContent({
        ...payload,
        onPhaseChange: setAnalysisPhase
      });
      const originalPreviewUrl = payload.type === 'image' && payload.file
        ? URL.createObjectURL(payload.file)
        : null;
      navigate('/result', {
        state: {
          analysis: result.analysis,
          jobId: result.jobId,
          originalPreviewUrl
        }
      });
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="page client-page">
      <section className="hero hero-lab">
        <div className="hero-copy">
          <span className="eyebrow"><span className="status-dot" />{isVi ? 'PHÒNG KIỂM CHỨNG NỘI DUNG SỐ' : 'DIGITAL CONTENT FORENSICS'}</span>
          <h1>{isVi ? <>Một góc nhìn rõ hơn.<br /><em>Không vội kết luận.</em></> : <>See the signals.<br /><em>Leave room for context.</em></>}</h1>
          <p className="hero-subtitle">
            {isVi
              ? 'Khám phá các dấu hiệu trong hình ảnh bằng quy trình minh bạch, có giải thích và nêu rõ giới hạn.'
              : 'Explore image signals through a transparent process that explains its evidence and limitations.'}
          </p>
          <div className="hero-meta"><span>01 / IMAGE MVP</span><span>{isVi ? 'KẾT QUẢ CÓ THỂ KIỂM TRA' : 'AUDITABLE SIGNALS'}</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="scan-frame"><span className="scan-cross scan-cross-a">+</span><span className="scan-cross scan-cross-b">+</span><span className="scan-line" /><div className="scan-object"><span className="scan-sun" /><span className="scan-horizon" /></div><div className="scan-label">VISUAL SIGNALS <b>● LIVE</b></div></div>
          <span className="art-coordinate">37° 46' 49.3" N<br />122° 25' 09.6" W</span>
        </div>
      </section>

      <section className="workflow-section" aria-label={isVi ? 'Quy trình ba bước' : 'Three-step workflow'}>
        <div className="workflow-heading"><div><span className="eyebrow">{isVi ? 'BẮT ĐẦU KIỂM TRA' : 'START A CHECK'}</span><h2>{isVi ? 'Ba bước, rõ từng chặng' : 'Three clear steps'}</h2></div><span className="workflow-note">{isVi ? 'Thời gian tùy theo tải xử lý' : 'Processing time varies with system load'}</span></div>
        <div className="workflow-steps">
          <div className="workflow-step active"><span className="step-number">01</span><span><strong>{isVi ? 'Chọn nội dung' : 'Choose content'}</strong><small>{isVi ? 'Hình ảnh là MVP' : 'Image MVP'}</small></span></div>
          <span className="step-connector" />
          <div className="workflow-step"><span className="step-number">02</span><span><strong>{isVi ? 'Tải lên an toàn' : 'Upload securely'}</strong><small>{isVi ? 'Tệp tạm thời' : 'Temporary file'}</small></span></div>
          <span className="step-connector" />
          <div className="workflow-step"><span className="step-number">03</span><span><strong>{isVi ? 'Đọc kết quả' : 'Review findings'}</strong><small>{isVi ? 'Bằng chứng & giới hạn' : 'Evidence & limits'}</small></span></div>
        </div>
      </section>

      <UploadBox language={language} onSubmit={analyze} busy={busy} analysisPhase={analysisPhase} />

      <section className="principles">
        <div className="section-heading"><span className="eyebrow">{isVi ? 'CÁCH ĐỌC KẾT QUẢ' : 'HOW TO READ RESULTS'}</span><h2>{isVi ? 'Dấu hiệu, không phải phán quyết' : 'Signals, not verdicts'}</h2></div>
        <div className="principle-grid">
          <article><span className="principle-index">01 / METADATA</span><h3>{isVi ? 'Thông tin nguồn ảnh' : 'Image metadata'}</h3><p>{isVi ? 'EXIF cho biết thiết bị, phần mềm và mốc thời gian nếu các trường này còn được giữ lại.' : 'EXIF can reveal device, software and timestamps when those fields are preserved.'}</p></article>
          <article><span className="principle-index">02 / PIXEL SIGNALS</span><h3>{isVi ? 'Khác biệt mức nén' : 'Compression differences'}</h3><p>{isVi ? 'ELA trực quan hóa sai khác khi nén lại JPEG; đây chỉ là dấu hiệu tham khảo, không chứng minh chỉnh sửa.' : 'ELA visualizes JPEG recompression differences; it is an indicator, not proof of editing.'}</p></article>
          <article><span className="principle-index">03 / PROVENANCE</span><h3>{isVi ? 'Nguồn gốc có chữ ký' : 'Signed provenance'}</h3><p>{isVi ? 'Chỉ báo nguồn gốc được xác minh khi có chữ ký mật mã hợp lệ; thiếu dữ liệu không đồng nghĩa ảnh giả.' : 'Provenance is verified only with a valid cryptographic signature; missing data does not mean an image is fake.'}</p></article>
        </div>
      </section>
      <div className="disclaimer-banner"><span className="disclaimer-icon">i</span><p><strong>{isVi ? 'Chỉ mang tính tham khảo' : 'Indicative, not proof'}</strong><span>{isVi ? 'Phân tích ảnh không thể xác thực tuyệt đối. Hãy xem xét bằng chứng và bối cảnh độc lập.' : 'Image analysis cannot provide absolute proof. Review evidence alongside independent context.'}</span></p></div>
      <p className="privacy-note"><span aria-hidden="true">◈</span> {isVi
        ? 'Tệp chỉ được giữ tạm thời để phân tích và tự động xóa sau đó.'
        : 'Files are held temporarily for analysis and automatically removed afterward.'}</p>
    </main>
  );
}
