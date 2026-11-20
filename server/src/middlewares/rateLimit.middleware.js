const crypto = require('node:crypto');
const { getLoginFailures, getSetting } = require('../db');

const VERIFY_LIMIT = 5;
const VERIFY_WINDOW_MS = 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_BUCKET_MAX = 50000;

const verifyBuckets = new Map();
let verifyRequestCount = 0;
let verifyLimit = Math.min(VERIFY_LIMIT, Math.max(1, Number(getSetting('rateLimitMax')) || VERIFY_LIMIT));

function getHashedIp(req) {
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(address).digest('hex');
}

function publicRateLimit(req, res, next) {
  const now = Date.now();
  const ipHash = getHashedIp(req);
  let bucket = verifyBuckets.get(ipHash);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + VERIFY_WINDOW_MS };
  }

  if (bucket.count >= verifyLimit) {
    res.setHeader('RateLimit-Limit', String(verifyLimit));
    res.setHeader('RateLimit-Remaining', '0');
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: `Bạn đã dùng hết ${verifyLimit} lượt kiểm tra trong phút này. Vui lòng chờ hết thời gian giới hạn rồi thử lại.` });
  }

  bucket.count += 1;
  verifyBuckets.set(ipHash, bucket);
  verifyRequestCount += 1;
  if (verifyRequestCount % 256 === 0) {
    for (const [key, value] of verifyBuckets) {
      if (value.resetAt <= now) verifyBuckets.delete(key);
    }
  }
  if (verifyBuckets.size > VERIFY_BUCKET_MAX) {
    const oldestKey = verifyBuckets.keys().next().value;
    if (oldestKey) verifyBuckets.delete(oldestKey);
  }

  res.setHeader('RateLimit-Limit', String(verifyLimit));
  res.setHeader('RateLimit-Remaining', String(verifyLimit - bucket.count));
  return next();
}

function getPublicVerifyLimit() {
  return verifyLimit;
}

function setPublicVerifyLimit(limit) {
  verifyLimit = Math.min(VERIFY_LIMIT, Math.max(1, limit));
}

function loginFailureRateLimit(req, res, next) {
  const now = Date.now();
  const ipHash = getHashedIp(req);
  const bucket = getLoginFailures(ipHash, now, LOGIN_WINDOW_MS);
  req.loginIpHash = ipHash;

  res.setHeader('RateLimit-Limit', String(LOGIN_FAILURE_LIMIT));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, LOGIN_FAILURE_LIMIT - bucket.count)));
  if (bucket.count >= LOGIN_FAILURE_LIMIT) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.windowStart + LOGIN_WINDOW_MS - now) / 1000))));
    return res.status(429).json({ error: 'Đã có 5 lần đăng nhập không thành công. Vui lòng thử lại sau 15 phút.' });
  }
  return next();
}

module.exports = {
  publicRateLimit,
  loginFailureRateLimit,
  getPublicVerifyLimit,
  setPublicVerifyLimit,
  VERIFY_LIMIT,
  VERIFY_WINDOW_MS,
  LOGIN_WINDOW_MS,
  LOGIN_FAILURE_LIMIT
};
