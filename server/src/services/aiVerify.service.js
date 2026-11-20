const crypto = require('node:crypto');
const { getAnalysisPrompt } = require('./prompt.service');

const ALLOWED_TYPES = new Set(['image', 'audio', 'document']);
const MAX_CONCURRENT_ANALYSES = 3;
const MAX_QUEUED_ANALYSES = 6;
const MAX_QUEUE_WAIT_MS = 15000;
const AI_TIMEOUT_MS = 30000;

let activeAnalyses = 0;
const analysisQueue = [];

function busyError() {
  const error = new Error('Hệ thống đang bận xử lý các yêu cầu khác. Vui lòng thử lại sau ít phút.');
  error.status = 503;
  return error;
}

function releaseAnalysisSlot() {
  const next = analysisQueue.shift();
  if (next) {
    next.grant();
    return;
  }
  activeAnalyses -= 1;
}

function acquireAnalysisSlot(req) {
  if (activeAnalyses < MAX_CONCURRENT_ANALYSES) {
    activeAnalyses += 1;
    return Promise.resolve(true);
  }
  if (analysisQueue.length >= MAX_QUEUED_ANALYSES) return Promise.resolve(false);

  return new Promise(resolve => {
    let settled = false;
    let timeout;
    const settle = acquired => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (req) req.removeListener('aborted', onAbort);
      resolve(acquired);
    };
    const removeFromQueue = () => {
      const index = analysisQueue.indexOf(waiter);
      if (index >= 0) analysisQueue.splice(index, 1);
    };
    const onAbort = () => {
      removeFromQueue();
      settle(false);
    };
    const waiter = {
      grant: () => settle(true)
    };

    timeout = setTimeout(() => {
      removeFromQueue();
      settle(false);
    }, MAX_QUEUE_WAIT_MS);
    if (req) req.once('aborted', onAbort);
    analysisQueue.push(waiter);
  });
}

async function analysisCapacity(req, res, next) {
  try {
    const acquired = await acquireAnalysisSlot(req);
    if (!acquired) {
      if (req.aborted) return;
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: busyError().message });
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseAnalysisSlot();
    };
    res.once('finish', release);
    res.once('close', release);
    req.analysisSlotAcquired = true;
    return next();
  } catch (error) {
    return next(error);
  }
}

function serviceError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function makeParts({ type, file, text }) {
  if (type === 'document' && text) {
    return [{ text: `Analyze the following document text:\n\n${text}` }];
  }
  if (!file) throw serviceError('Hãy chọn tệp hoặc nhập nội dung cần kiểm tra.', 400);
  if (type === 'document' && file.mimetype === 'text/plain') {
    return [{ text: `Analyze the following document text:\n\n${file.buffer.toString('utf8')}` }];
  }
  return [
    { text: `Analyze the attached ${type} content. Do not infer details that are not observable in the provided content.` },
    { inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } }
  ];
}

function parseModelResult(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  } catch {
    throw serviceError('Dịch vụ AI trả về kết quả không đúng định dạng.', 502);
  }

  const probability = value => Number.isInteger(value) && value >= 0 && value <= 100;
  if (!probability(parsed.aiGeneratedProbability) || !probability(parsed.editedProbability)
    || !['low', 'medium', 'high'].includes(parsed.confidence)
    || !Array.isArray(parsed.observedEvidence) || !Array.isArray(parsed.hypotheses)
    || typeof parsed.confidenceReason !== 'string') {
    throw serviceError('Kết quả từ dịch vụ AI không đúng cấu trúc yêu cầu.', 502);
  }
  return {
    aiGeneratedProbability: parsed.aiGeneratedProbability,
    editedProbability: parsed.editedProbability,
    confidence: parsed.confidence,
    observedEvidence: parsed.observedEvidence.filter(item => typeof item === 'string').slice(0, 12),
    hypotheses: parsed.hypotheses.filter(item => typeof item === 'string').slice(0, 12),
    confidenceReason: parsed.confidenceReason.slice(0, 2000)
  };
}

async function analyzeWithinSlot({ type, file, text }) {
  if (!ALLOWED_TYPES.has(type)) throw serviceError('Loại nội dung không được hỗ trợ.', 400);
  if (type !== 'document' && !file) throw serviceError('Hãy chọn tệp cần kiểm tra.', 400);
  if (type === 'document' && !file && !text?.trim()) {
    throw serviceError('Hãy chọn tệp tài liệu hoặc dán nội dung văn bản.', 400);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw serviceError('Hệ thống chưa được cấu hình dịch vụ phân tích AI. Vui lòng liên hệ quản trị viên.', 503);
  }
  const prompt = getAnalysisPrompt(type);
  if (!prompt) throw serviceError('Chưa có hướng dẫn phân tích cho loại nội dung này.', 500);

  const schema = {
    type: 'OBJECT',
    properties: {
      aiGeneratedProbability: { type: 'INTEGER' },
      editedProbability: { type: 'INTEGER' },
      confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
      observedEvidence: { type: 'ARRAY', items: { type: 'STRING' } },
      hypotheses: { type: 'ARRAY', items: { type: 'STRING' } },
      confidenceReason: { type: 'STRING' }
    },
    required: ['aiGeneratedProbability', 'editedProbability', 'confidence', 'observedEvidence', 'hypotheses', 'confidenceReason']
  };
  const requestBody = {
    systemInstruction: {
      parts: [{ text: `${prompt}\n\nReturn only JSON matching the requested schema. Probabilities are estimates, not ground truth. If evidence is insufficient, use confidence "low" and explain why. Observed evidence must contain only directly visible/audible/textual observations; put interpretations in hypotheses. Do not claim cryptographic provenance verification unless provenance data was actually supplied and verified.` }]
    },
    contents: [{ role: 'user', parts: makeParts({ type, file, text }) }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let response;
  let data;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (response.ok) data = await response.json();
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      throw serviceError('Dịch vụ AI phản hồi quá thời gian chờ 30 giây. Vui lòng thử lại.', 504);
    }
    throw serviceError('Không thể kết nối hoặc đọc phản hồi từ dịch vụ AI.', 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 429 || response.status === 503) {
      throw serviceError('Dịch vụ AI đang quá tải. Vui lòng thử lại sau ít phút.', 503);
    }
    throw serviceError('Dịch vụ AI hiện không thể xử lý yêu cầu. Vui lòng thử lại sau.', 502);
  }

  const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  if (!raw) throw serviceError('Dịch vụ AI không trả về nội dung phân tích.', 502);
  const result = parseModelResult(raw);
  const status = result.confidence === 'low'
    || Math.abs(result.aiGeneratedProbability - 50) < 15
    ? 'inconclusive'
    : 'analyzed';
  return {
    ...result,
    status,
    type,
    sha256: crypto.createHash('sha256').update(file ? file.buffer : text).digest('hex'),
    timestamp: new Date().toISOString()
  };
}

async function analyzeContent(input, { slotAcquired = false } = {}) {
  let release;
  if (!slotAcquired) {
    const acquired = await acquireAnalysisSlot();
    if (!acquired) throw busyError();
    let released = false;
    release = () => {
      if (released) return;
      released = true;
      releaseAnalysisSlot();
    };
  }

  try {
    return await analyzeWithinSlot(input);
  } finally {
    if (release) release();
  }
}

module.exports = {
  analyzeContent,
  analysisCapacity,
  MAX_CONCURRENT_ANALYSES,
  MAX_QUEUED_ANALYSES,
  MAX_QUEUE_WAIT_MS,
  AI_TIMEOUT_MS
};
