const express = require('express');
const crypto = require('node:crypto');
const { publicRateLimit } = require('../middlewares/rateLimit.middleware');
const { upload, MAX_UPLOAD_BYTES, UPLOAD_LIMITS, getUploadLimit } = require('../middlewares/upload.middleware');
const { analyzeContent, analysisCapacity } = require('../services/aiVerify.service');
const { recordAnalysis, addDispute } = require('../db');

const router = express.Router();

router.post('/verify', publicRateLimit, analysisCapacity, upload.single('file'), async (req, res, next) => {
  try {
    const type = req.body?.type;
    if (!['image', 'audio', 'document'].includes(type)) {
      return res.status(400).json({ error: 'Hãy chọn loại nội dung là hình ảnh, âm thanh hoặc tài liệu.' });
    }

    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (text.length > 100000) {
      return res.status(413).json({ error: 'Văn bản vượt quá giới hạn 100.000 ký tự.' });
    }
    if (req.file && req.file.detectedType !== type) {
      return res.status(400).json({ error: 'Định dạng tệp không khớp với loại nội dung đã chọn.' });
    }
    if (req.file && req.file.size > getUploadLimit(type)) {
      const maxMb = getUploadLimit(type) / (1024 * 1024);
      return res.status(413).json({ error: `Tệp ${type === 'image' ? 'hình ảnh' : type === 'audio' ? 'âm thanh' : 'tài liệu'} vượt quá giới hạn ${maxMb} MB.` });
    }
    if (!req.file && !(type === 'document' && text)) {
      return res.status(400).json({ error: 'Hãy chọn tệp hoặc dán nội dung tài liệu cần kiểm tra.' });
    }

    const analysis = await analyzeContent(
      { type, file: req.file, text },
      { slotAcquired: req.analysisSlotAcquired }
    );
    const id = crypto.randomUUID();
    recordAnalysis(id, type, req.file?.originalname?.slice(0, 255) || null, analysis.confidence, analysis.status, analysis.timestamp);
    return res.json({ analysis: { ...analysis, id } });
  } catch (error) {
    return next(error);
  } finally {
    if (req.file) {
      req.file.buffer = null;
      req.file = undefined;
    }
    if (req.body && typeof req.body.text === 'string') req.body.text = '';
  }
});

router.get('/limits', (req, res) => {
  res.json({
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxImageBytes: UPLOAD_LIMITS.image,
    maxAudioBytes: UPLOAD_LIMITS.audio,
    maxDocumentBytes: UPLOAD_LIMITS.document,
    maxTextCharacters: 100000
  });
});

router.post('/results/:id/dispute', (req, res) => {
  const { comment, contact } = req.body || {};
  if (typeof comment !== 'string' || comment.trim().length < 10 || comment.length > 5000
    || (contact != null && (typeof contact !== 'string' || contact.length > 320))) {
    return res.status(400).json({ error: 'Góp ý cần dài từ 10 đến 5.000 ký tự.' });
  }
  const dispute = addDispute(
    req.params.id,
    comment.trim(),
    typeof contact === 'string' ? contact.trim() : null,
    new Date().toISOString()
  );
  if (!dispute) return res.status(404).json({ error: 'Không tìm thấy kết quả phân tích để gửi góp ý.' });
  return res.status(201).json({ disputeId: dispute.id, receivedAt: dispute.createdAt });
});

module.exports = router;
