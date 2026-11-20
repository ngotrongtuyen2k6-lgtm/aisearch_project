const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');
const { cleanupExpiredData } = require('./db');

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(clientDist, 'index.html'), error => error && next(error));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Tệp vượt quá giới hạn tối đa 15 MB.' });
    }
    if (error.code === 'LIMIT_FIELD_VALUE') {
      return res.status(413).json({ error: 'Văn bản vượt quá giới hạn 100.000 ký tự.' });
    }
    return res.status(400).json({ error: 'Dữ liệu tải lên không hợp lệ. Vui lòng kiểm tra lại tệp.' });
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('Request failed:', error.message);
  return res.status(status).json({
    error: status === 500 ? 'Analysis failed. Please try again later.' : error.message
  });
});

cleanupExpiredData();
setInterval(cleanupExpiredData, 60 * 60 * 1000).unref();

module.exports = app;
