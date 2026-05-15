/**
 * App Panel sunucusundan gelen istekler için API anahtarı doğrulaması.
 * Panel şu an Authorization göndermediği için x-panel-api-key kullanılır.
 */
function panelAuth(req, res, next) {
    const configured = process.env.PANEL_API_KEY;
    if (!configured || String(configured).trim() === '') {
        return res.status(503).json({
            ok: false,
            code: 'PANEL_NOT_CONFIGURED',
            msg: 'PANEL_API_KEY is not set on the server'
        });
    }

    const provided =
        req.header('x-panel-api-key') ||
        req.header('x-api-key') ||
        req.query?.panel_key ||
        req.query?.api_key;

    if (!provided || String(provided) !== String(configured)) {
        return res.status(401).json({
            ok: false,
            code: 'PANEL_UNAUTHORIZED',
            msg: 'Invalid or missing panel API key'
        });
    }

    return next();
}

module.exports = panelAuth;
