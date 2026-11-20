const jwt = require('jsonwebtoken');

function verifyAdminToken(req, res, next) {
  const token = req.cookies?.verity_admin;
  const secret = process.env.JWT_SECRET;
  if (!token || !secret || secret.length < 32) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  try {
    req.admin = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return next();
  } catch {
    res.clearCookie('verity_admin', clearCookieOptions());
    return res.status(401).json({ error: 'Admin session is invalid or expired.' });
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/admin',
    maxAge: 2 * 60 * 60 * 1000
  };
}

function clearCookieOptions() {
  const { maxAge, ...options } = cookieOptions();
  return options;
}

module.exports = { verifyAdminToken, cookieOptions, clearCookieOptions };
