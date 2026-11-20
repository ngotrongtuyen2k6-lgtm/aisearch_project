const path = require('node:path');
const multer = require('multer');

const MB = 1024 * 1024;
const UPLOAD_LIMITS = {
  image: 5 * MB,
  audio: 15 * MB,
  document: 10 * MB
};
const MAX_UPLOAD_BYTES = UPLOAD_LIMITS.audio;

const FILE_RULES = {
  'image/jpeg': { type: 'image', extensions: ['.jpg', '.jpeg'] },
  'image/png': { type: 'image', extensions: ['.png'] },
  'image/webp': { type: 'image', extensions: ['.webp'] },
  'audio/mpeg': { type: 'audio', extensions: ['.mp3'] },
  'audio/mp3': { type: 'audio', extensions: ['.mp3'] },
  'audio/wav': { type: 'audio', extensions: ['.wav'] },
  'audio/x-wav': { type: 'audio', extensions: ['.wav'] },
  'audio/ogg': { type: 'audio', extensions: ['.ogg', '.oga'] },
  'audio/webm': { type: 'audio', extensions: ['.webm'] },
  'audio/mp4': { type: 'audio', extensions: ['.mp4', '.m4a'] },
  'audio/x-m4a': { type: 'audio', extensions: ['.m4a'] },
  'application/pdf': { type: 'document', extensions: ['.pdf'] },
  'text/plain': { type: 'document', extensions: ['.txt'] }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 400000 },
  fileFilter(req, file, callback) {
    const rule = FILE_RULES[file.mimetype];
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!rule || !rule.extensions.includes(extension)) {
      const error = new Error('Định dạng hoặc phần mở rộng tệp không được hỗ trợ.');
      error.status = 415;
      return callback(error);
    }
    file.detectedType = rule.type;
    return callback(null, true);
  }
});

function getUploadLimit(type) {
  return UPLOAD_LIMITS[type] || 0;
}

module.exports = { upload, MAX_UPLOAD_BYTES, UPLOAD_LIMITS, getUploadLimit };
