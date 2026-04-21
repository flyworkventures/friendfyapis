const JWT = require('jsonwebtoken')

module.exports = async (req, res, next) => {
  try {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({
        msg: "Access Denied. Token required."
      });
    }

    const user = await JWT.verify(token, "key");
    if (user) {
      next();
    } else {
      return res.status(401).json({
        msg: "Invalid credential"
      });
    }
  } catch (error) {
    // Token süresi dolmuş
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        msg: "Token expired. Please login again.",
        code: "TOKEN_EXPIRED",
        expiredAt: error.expiredAt
      });
    }
    // Geçersiz token (imza hatası, format hatası vb.)
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        msg: "Invalid token. Please login again.",
        code: "INVALID_TOKEN"
      });
    }
    return res.status(500).json({
      msg: "Authentication error",
      error: error.message
    });
  }
}