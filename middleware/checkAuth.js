const JWT = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'key';
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '365d';

function issueAccessToken(payload) {
  // Refresh token payload'undaki "type" alanını access token'a taşımıyoruz.
  const nextPayload = { email: payload.email };
  if (payload.id) nextPayload.id = payload.id;
  if (payload.userId) nextPayload.userId = payload.userId;
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
      return next();
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
      return next();
    }
  } catch (error) {
    return res.status(500).json({
      msg: 'Authentication error',
      error: error.message
    });
  }
};