function normalizeUserId(value) {
    if (value === null || value === undefined) return '';
    const s = String(value).trim();
    return s === 'undefined' || s === 'null' ? '' : s;
}

function getJwtUserId(req) {
    const u = req.user;
    if (!u) return '';
    return normalizeUserId(u.id ?? u.userId);
}

/**
 * @returns {{ ok: true, jwtUserId: string } | { ok: false, status: number, json: object }}
 */
function assertJwtMatchesUserId(req, bodyUserId) {
    const jwtUserId = getJwtUserId(req);
    const bodyNorm = normalizeUserId(bodyUserId);
    if (!jwtUserId) {
        return {
            ok: false,
            status: 403,
            json: {
                success: false,
                code: 'ACCESS_TOKEN_SUBJECT_MISSING',
                msg: 'Authenticated user id missing in token'
            }
        };
    }
    if (!bodyNorm || jwtUserId !== bodyNorm) {
        return {
            ok: false,
            status: 403,
            json: {
                success: false,
                code: 'FORBIDDEN',
                msg: 'userId must match authenticated user'
            }
        };
    }
    return { ok: true, jwtUserId };
}

module.exports = { assertJwtMatchesUserId, getJwtUserId, normalizeUserId };
