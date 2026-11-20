const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { verifyAdminToken, cookieOptions, clearCookieOptions } = require('../middlewares/auth.middleware');
const {
  loginFailureRateLimit,
  LOGIN_WINDOW_MS,
  LOGIN_FAILURE_LIMIT,
  VERIFY_LIMIT,
  getPublicVerifyLimit,
  setPublicVerifyLimit
} = require('../middlewares/rateLimit.middleware');
const { getSetting, setSetting, getStats, recordLoginFailure, clearLoginFailures } = require('../db');
const { getAllPrompts, updatePrompts } = require('../services/prompt.service');

const router = express.Router();
router.post('/login', loginFailureRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const secret = process.env.JWT_SECRET;
    if (!process.env.ADMIN_USERNAME || !passwordHash || !secret || secret.length < 32) {
      return res.status(503).json({ error: 'Admin login is not configured on the server.' });
    }
    const valid = typeof username === 'string' && typeof password === 'string'
      && username === process.env.ADMIN_USERNAME
      && await bcrypt.compare(password, passwordHash);
    if (!valid) {
      const failures = recordLoginFailure(req.loginIpHash, Date.now(), LOGIN_WINDOW_MS);
      res.setHeader('RateLimit-Remaining', String(Math.max(0, LOGIN_FAILURE_LIMIT - failures.count)));
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    clearLoginFailures(req.loginIpHash);
    const token = jwt.sign({ sub: username, role: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '2h' });
    res.cookie('verity_admin', token, cookieOptions());
    return res.json({ authenticated: true });
  } catch (error) {
    return next(error);
  }
});

router.use(verifyAdminToken);
router.get('/session', (req, res) => res.json({ authenticated: true, username: req.admin.sub }));
router.post('/logout', (req, res) => {
  res.clearCookie('verity_admin', clearCookieOptions());
  res.json({ authenticated: false });
});

router.get('/prompts', (req, res) => res.json({ prompts: getAllPrompts() }));
router.put('/prompts', (req, res) => res.json({ prompts: updatePrompts(req.body?.prompts) }));

router.get('/stats', (req, res) => {
  res.json(getStats());
});

router.get('/rate-limit', (req, res) => {
  res.json({
    max: getPublicVerifyLimit(),
    windowSeconds: 60
  });
});

router.put('/rate-limit', (req, res) => {
  const { max, windowSeconds } = req.body || {};
  if (!Number.isInteger(max) || max < 1 || max > VERIFY_LIMIT || windowSeconds !== 60) {
    return res.status(400).json({ error: 'Giới hạn kiểm tra phải từ 1 đến 5 lượt trong 60 giây.' });
  }
  setPublicVerifyLimit(max);
  setSetting('rateLimitMax', max);
  setSetting('rateLimitWindowSeconds', 60);
  return res.json({ max, windowSeconds: 60 });
});

module.exports = router;
