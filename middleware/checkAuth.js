const JWT = require('jsonwebtoken');
const { getQuery } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'key';
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '365d';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'info@fly-work.com';

// Banlı kullanıcı id'leri bellekte cache'lenir (60sn TTL) — her isteğe DB
// sorgusu yüklememek için. Banlı kullanıcı sayısı çok az olur.
let _bannedIds = new Set();
let _bannedLoadedAt = 0;
const BANNED_CACHE_TTL_MS = 60 * 1000;

async function getBannedIds() {
  if (Date.now() - _bannedLoadedAt < BANNED_CACHE_TTL_MS) return _bannedIds;
  try {
    const rows = await getQuery('SELECT id FROM `users` WHERE is_banned = 1');
    _bannedIds = new Set((rows || []).map((r) => Number(r.id)));
    _bannedLoadedAt = Date.now();
  } catch (_) {
    // is_banned kolonu yoksa (migration öncesi) veya DB hatasında: ban uygulama
    // (fail-open) — eski cache korunur. Migration sonrası devreye girer.
  }
  return _bannedIds;
}

// req.user set edildikten sonra ban kontrolü yapıp next()'e geçer.
async function finishAuth(req, res, next) {
  const uid = Number(req.user?.id ?? req.user?.userId);
  if (uid && (await getBannedIds()).has(uid)) {
    return res.status(403).json({
      code: 'ACCOUNT_BANNED',
      msg: 'Hesabınız topluluk kurallarını ihlal ettiği için askıya alındı. İtiraz için bizimle iletişime geçin: ' + SUPPORT_EMAIL,
      contact: SUPPORT_EMAIL,
    });
  }
  return next();
}

function issueAccessToken(payload) {
  // Refresh token payload'undaki "type" access token'a taşınmaz.
  const nextPayload = { email: payload.email };
  const raw = payload.id ?? payload.userId;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      nextPayload.id = n;
      nextPayload.userId = n;
    } else {
      nextPayload.id = raw;
      nextPayload.userId = raw;
    }
  }
  return JWT.sign(nextPayload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

module.exports = async (req, res, next) => {
  try {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({
        msg: 'Access Denied. Token required.'
      });
    }

    try {
      const user = JWT.verify(token, JWT_SECRET);
      req.user = user;
      return finishAuth(req, res, next);
    } catch (verifyError) {
      if (verifyError.name !== 'TokenExpiredError') {
        if (verifyError.name === 'JsonWebTokenError') {
          return res.status(401).json({
            msg: 'Invalid token. Please login again.',
            code: 'INVALID_TOKEN'
          });
        }
        throw verifyError;
      }

      // Access token expired: refresh token ile otomatik yenile.
      const refreshToken =
        req.header('x-refresh-token') ||
        req.header('refresh-token') ||
        req.body?.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({
          msg: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED',
          expiredAt: verifyError.expiredAt
        });
      }

      let refreshPayload;
      try {
        refreshPayload = JWT.verify(refreshToken, JWT_SECRET);
      } catch (refreshError) {
        if (refreshError.name === 'TokenExpiredError') {
          return res.status(401).json({
            msg: 'Refresh token expired. Please login again.',
            code: 'REFRESH_TOKEN_EXPIRED'
          });
        }
        return res.status(401).json({
          msg: 'Invalid refresh token. Please login again.',
          code: 'INVALID_REFRESH_TOKEN'
        });
      }

      if (refreshPayload.type !== 'refresh') {
        return res.status(401).json({
          msg: 'Invalid refresh token. Please login again.',
          code: 'INVALID_REFRESH_TOKEN'
        });
      }

      const newAccessToken = issueAccessToken(refreshPayload);
      res.setHeader('x-auth-token', newAccessToken);
      res.setHeader('x-token-renewed', 'true');
      req.user = JWT.verify(newAccessToken, JWT_SECRET);
      req.renewedToken = newAccessToken;
      return finishAuth(req, res, next);
    }
  } catch (error) {
    return res.status(500).json({
      msg: 'Authentication error',
      error: error.message
    });
  }
};