function maskToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.length <= 10) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

module.exports = function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const authHeader = req.header('x-auth-token') || req.header('authorization') || null;
  const refreshHeader = req.header('x-refresh-token') || req.header('refresh-token') || null;

  const reqInfo = {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    hasAuth: Boolean(authHeader),
    hasRefresh: Boolean(refreshHeader),
    authPreview: maskToken(authHeader),
    refreshPreview: maskToken(refreshHeader)
  };

  console.log(`[API] request`, reqInfo);

  res.on('finish', () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[API] response`, {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      elapsedMs
    });
  });

  next();
};
