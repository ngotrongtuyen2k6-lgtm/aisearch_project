import { useRef, useState } from 'react';

const TYPES = [
  { id: 'image', vi: 'Hình ảnh', en: 'Image', badgeVi: 'MVP', badgeEn: 'MVP', accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' },
  { id: 'audio', vi: 'Âm thanh', en: 'Audio', badgeVi: 'Bản thử nghiệm', badgeEn: 'Beta', accept: '.mp3,.wav,.ogg,.oga,.webm,.mp4,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/x-m4a' },
  { id: 'document', vi: 'Tài liệu', en: 'Document', badgeVi: 'Bản thử nghiệm', badgeEn: 'Beta', accept: '.pdf,.txt,application/pdf,text/plain' }
];

const MAX_FILE_BYTES = { image: 5, audio: 15, document: 10 };

export default function UploadBox({ language, onSubmit, busy, analysisPhase }) {
  const [type, setType] = useState('image');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const isVi = language === 'vi';

  function chooseType(next) {
    setType(next);
    setFile(null);
    setText('');
    setError('');
  }

  function selectFile(nextFile) {
    setError('');
    if (!nextFile) return;
    const maxBytes = MAX_FILE_BYTES[type] * 1024 * 1024;
    if (nextFile.size > maxBytes) {
      setError(isVi ? `Tệp vượt quá giới hạn ${MAX_FILE_BYTES[type]} MB.` : `File exceeds the ${MAX_FILE_BYTES[type]} MB limit.`);
      setFile(null);
      return;
    }
    setFile(nextFile);
    setText('');
  }

  function dropFile(event) {
    event.preventDefault();
    if (busy) return;
    selectFile(event.dataTransfer.files?.[0]);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!file && !(type === 'document' && text.trim())) {
      setError(isVi ? 'Hãy chọn tệp hoặc dán nội dung văn bản.' : 'Choose a file or paste text.');
      return;
    }
    try {
      await onSubmit({ type, file, text: text.trim() });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <form className="upload-panel" onSubmit={submit} aria-busy={busy} id="upload">
      <div className="upload-panel-heading"><div><span className="eyebrow">{isVi ? '01 — CHỌN LOẠI NỘI DUNG' : '01 — SELECT CONTENT TYPE'}</span><h2>{isVi ? 'Bạn muốn kiểm tra nội dung nào?' : 'What would you like to check?'}</h2></div><span className="secure-mark"><span>✓</span> {isVi ? 'XỬ LÝ RIÊNG TƯ' : 'PRIVATE PROCESSING'}</span></div>
      <div className="type-tabs" role="tablist" aria-label={isVi ? 'Loại nội dung' : 'Content type'}>
        {TYPES.map(item => (
          <button type="button" role="tab" aria-selected={type === item.id}
            className={type === item.id ? 'type-tab active' : 'type-tab'} key={item.id} disabled={busy}
            onClick={() => chooseType(item.id)}>
            <span className="tab-icon" aria-hidden="true">{item.id === 'image' ? '▧' : item.id === 'audio' ? '◖' : '▤'}</span>
            <span className="tab-copy"><strong>{isVi ? item.vi : item.en}</strong><small>{isVi ? item.badgeVi : item.badgeEn}</small></span>
            {type === item.id && <span className="tab-selected" aria-label={isVi ? 'Đang chọn' : 'Selected'}>✓</span>}
          </button>
        ))}
      </div>
      {type === 'document' && (
        <label className="field-label" htmlFor="documentText">
          {isVi ? 'Dán văn bản (hoặc chọn PDF/TXT)' : 'Paste text (or choose PDF/TXT)'}
          <textarea id="documentText" rows="7" value={text}
            maxLength="100000" disabled={busy}
            onChange={event => { setText(event.target.value); setFile(null); }}
            placeholder={isVi ? 'Dán nội dung cần kiểm chứng tại đây…' : 'Paste content to review here…'} />
        </label>
      )}
      <input ref={inputRef} className="visually-hidden-file" type="file" aria-hidden="true" tabIndex="-1" accept={TYPES.find(item => item.id === type).accept} disabled={busy}
        onChange={event => selectFile(event.target.files?.[0])} />
      <div className={`drop-zone${file ? ' has-file' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={event => event.preventDefault()}
        onDrop={dropFile}>
        <button type="button" className="drop-pick" disabled={busy} onClick={() => inputRef.current?.click()}>
          <span className="drop-icon" aria-hidden="true">{file ? '✓' : '↑'}</span>
          <span className="drop-copy"><strong>{file ? file.name : (isVi ? 'Kéo thả hình ảnh vào đây' : 'Drop an image here')}</strong><small>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · ${file.type || 'unknown type'}` : (isVi ? 'hoặc chọn tệp từ thiết bị của bạn' : 'or choose a file from your device')}</small></span>
          <span className="secondary-button drop-action">{file ? (isVi ? 'Đổi tệp' : 'Change file') : (isVi ? 'Chọn tệp' : 'Browse files')}</span>
        </button>
        {file && <button type="button" className="remove-file" aria-label={isVi ? 'Bỏ tệp đã chọn' : 'Remove selected file'} disabled={busy} onClick={() => setFile(null)}>×</button>}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-button submit-button" disabled={busy || (!file && !(type === 'document' && text.trim()))}>
        {busy ? (isVi ? 'Đang xử lý…' : 'Processing…') : (isVi ? 'Bắt đầu phân tích' : 'Start analysis')} <span aria-hidden="true">→</span>
      </button>
      {busy && <div className="analysis-progress" role="status" aria-live="polite"><div className="progress-track"><span className={analysisPhase === 'analyzing' ? 'progress-fill analyzing' : 'progress-fill'} /></div><span className="progress-label"><span className="progress-spinner" />{analysisPhase === 'analyzing' ? (isVi ? 'Đang phân tích dấu hiệu hình ảnh…' : 'Analyzing image signals…') : (isVi ? 'Đang tải tệp an toàn…' : 'Securely uploading file…')}</span></div>}
      <p className="field-note">
        {isVi
          ? `${type === 'image' ? 'JPG, PNG hoặc WebP · tối đa 5 MB.' : type === 'audio' ? 'MP3, WAV, OGG hoặc WebM · tối đa 15 MB.' : 'PDF hoặc TXT · tối đa 10 MB.'} Tệp tự động xóa sau khi phân tích.`
          : `${type === 'image' ? 'JPG, PNG or WebP · up to 5 MB.' : type === 'audio' ? 'MP3, WAV, OGG or WebM · up to 15 MB.' : 'PDF or TXT · up to 10 MB.'} Files are automatically removed after analysis.`}
      </p>
    </form>
  );
}
