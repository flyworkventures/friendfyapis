const routes = require('express').Router();
const middleware = require('../middleware/checkAuth')
const { getQuery , query, insertQuery} = require('../db')
const { normalizeLang, localizeAgents, localizeAgentRow } = require('./lib/agentLocalization');

function toPhotoUrlArray(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.filter((v) => typeof v === 'string' && v.trim() !== '');
    }
    if (typeof rawValue !== 'string') {
        return [];
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((v) => typeof v === 'string' && v.trim() !== '');
            }
        } catch (_) {
            // JSON parse edilemezse tek URL gibi davran
        }
    }
    return [trimmed];
}

function attachPhotoUrls(agent) {
    const photoURLs = toPhotoUrlArray(agent.photoURL);
    return {
        ...agent,
        photoURLs
    };
}

const MAX_AGENT_NAME_LENGTH = 20;

function parseAgentName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return { ok: false, code: 'NAME_REQUIRED', msg: 'name is required' };
    }
    if (trimmed.length > MAX_AGENT_NAME_LENGTH) {
        return {
            ok: false,
            code: 'NAME_TOO_LONG',
            msg: `name must be at most ${MAX_AGENT_NAME_LENGTH} characters`
        };
    }
    return { ok: true, value: trimmed };
}

function serializePhotoUrlsFromBody(body) {
    const incomingList = body.photoURLs ?? body.photos ?? body.photoURL;
    const normalized = toPhotoUrlArray(incomingList);
    return JSON.stringify(normalized);
}

/** İstemci: rive_avatar | riveAvatar. Gövdede yoksa existingRow.rive_avatar korunur. */
function parseRiveAvatarFromBody(body, existingRow = null) {
    if (!body || typeof body !== 'object') {
        return existingRow != null ? existingRow.rive_avatar ?? null : null;
    }
    const raw = body.rive_avatar ?? body.riveAvatar;
    if (raw === undefined) {
        return existingRow != null ? existingRow.rive_avatar ?? null : null;
    }
    if (raw === null) return null;
    const t = String(raw).trim();
    return t === '' ? null : t;
}

function normalizeArrayLike(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    return [];
}

/** voices.id veya elevenlabs_id → bots.voiceId için ElevenLabs voice id. */
async function resolveVoiceIdForStorage(rawVoiceId) {
    if (rawVoiceId === null || rawVoiceId === undefined) return null;
    const s = String(rawVoiceId).trim();
    if (!s) return null;

    // Zaten ElevenLabs voice id (harf içeren, yeterince uzun slug)
    if (/[a-zA-Z]/.test(s) && s.length >= 10) {
        return s;
    }

    // Sayısal voices tablosu id
    if (/^\d+$/.test(s)) {
        const rows = await getQuery(
            'SELECT elevenlabs_id FROM `voices` WHERE id = ? LIMIT 1',
            [Number(s)]
        );
        const resolved = rows?.[0]?.elevenlabs_id;
        if (resolved && String(resolved).trim()) {
            return String(resolved).trim();
        }
    }

    // Doğrudan elevenlabs_id eşleşmesi
    const byEl = await getQuery(
        'SELECT elevenlabs_id FROM `voices` WHERE elevenlabs_id = ? LIMIT 1',
        [s]
    );
    if (byEl?.[0]?.elevenlabs_id) {
        return String(byEl[0].elevenlabs_id).trim();
    }

    return s;
}

/** İstemci ve JWT id karşılaştırması (string | number). */
function normalizeAgentUserId(value) {
    if (value === null || value === undefined) return '';
    const s = String(value).trim();
    return s === 'undefined' || s === 'null' ? '' : s;
}

/** Oturumdaki kullanıcı: yalnızca JWT (id veya userId claim). */
function getJwtSubjectUserId(req) {
    const u = req.user;
    if (!u) return '';
    return normalizeAgentUserId(u.id ?? u.userId);
}

function getBodyOwnerOrUserId(body) {
    if (!body || typeof body !== 'object') return '';
    return normalizeAgentUserId(body.ownerId ?? body.userId);
}

/**
 * İstemci hem ownerId hem userId gönderdiyse (katalog dalı) aynı olmalı.
 * @returns {{ ok: true, combined: string } | { ok: false, status: number, json: object }}
 */
function assertOwnerAndUserIdBodyConsistent(body) {
    if (!body || typeof body !== 'object') return { ok: true, combined: '' };
    const o = normalizeAgentUserId(body.ownerId);
    const u = normalizeAgentUserId(body.userId);
    if (o && u && o !== u) {
        return {
            ok: false,
            status: 400,
            json: {
                success: false,
                code: 'OWNER_USER_ID_MISMATCH',
                msg: 'ownerId and userId must match when both are sent'
            }
        };
    }
    return { ok: true, combined: o || u };
}

function logOwnerJwtMismatch(route, req, jwtNorm, bodyNorm) {
    const u = req.user || {};
    console.error(`[${route}] ownerId/userId JWT ile eşleşmiyor`, {
        route,
        bodyOwnerId: req.body?.ownerId,
        bodyOwnerIdType: typeof req.body?.ownerId,
        bodyUserId: req.body?.userId,
        bodyUserIdType: typeof req.body?.userId,
        bodyNormalized: bodyNorm || '(boş)',
        jwtId: u.id,
        jwtIdType: typeof u.id,
        jwtUserIdClaim: u.userId,
        jwtUserIdClaimType: typeof u.userId,
        jwtNormalized: jwtNorm || '(boş)'
    });
}

/**
 * JWT id/userId; yoksa email ile users tablosundan (geçici uyumluluk).
 */
async function resolveJwtSubjectUserId(req) {
    const direct = getJwtSubjectUserId(req);
    if (direct) return direct;
    const u = req.user;
    if (!u) return '';
    const email = typeof u.email === 'string' ? u.email.trim() : '';
    if (!email) return '';
    try {
        const rows = await getQuery('SELECT id FROM `users` WHERE email = ? LIMIT 1', [email]);
        if (!rows?.length) return '';
        return normalizeAgentUserId(rows[0].id);
    } catch (e) {
        console.error('[agents] resolveJwtSubjectUserId email lookup failed', e);
        return '';
    }
}

/**
 * Gövdedeki ownerId veya userId, çözümlenen oturum kullanıcısı ile aynı olmalı.
 * Token geçerli ama özne yok: 403 (iş kuralı); geçersiz token middleware 401.
 */
async function assertJwtMatchesBodyOwner(req, routeLabel) {
    const bodyGate = assertOwnerAndUserIdBodyConsistent(req.body);
    if (!bodyGate.ok) {
        return bodyGate;
    }
    const bodyUserId = bodyGate.combined || getBodyOwnerOrUserId(req.body);

    const jwtUserId = await resolveJwtSubjectUserId(req);

    if (!jwtUserId) {
        console.error(`[${routeLabel}] Oturum kullanıcı id çözülemedi (JWT id/userId yok, email ile DB bulunamadı)`, {
            route: routeLabel,
            reqUserKeys: req.user ? Object.keys(req.user) : [],
            jwtEmail: req.user?.email
        });
        return {
            ok: false,
            status: 403,
            json: {
                success: false,
                code: 'ACCESS_TOKEN_SUBJECT_MISSING',
                msg: 'Token missing user id; please login again or renew tokens'
            }
        };
    }

    if (!bodyUserId) {
        return {
            ok: false,
            status: 400,
            json: {
                success: false,
                code: 'INVALID_PAYLOAD',
                msg: 'ownerId or userId is required'
            }
        };
    }

    if (jwtUserId !== bodyUserId) {
        logOwnerJwtMismatch(routeLabel, req, jwtUserId, bodyUserId);
        return {
            ok: false,
            status: 403,
            json: {
                success: false,
                code: 'FORBIDDEN',
                msg: 'ownerId (or userId) must match authenticated user'
            }
        };
    }

    return { ok: true, jwtUserId, bodyUserId };
}

/** Senkron: yalnızca JWT claim (email fallback yok). Katalog birleştirme için async resolveJwtSubjectUserId tercih edin. */
function authUserIdFromRequest(req) {
    return getJwtSubjectUserId(req);
}

/** Katalog satırı + override satırı (aynı bot id, kullanıcıya özel). */
function applyCatalogOverride(agent, overrideRow) {
    if (!overrideRow) return agent;
    const base = { ...agent };
    base.name = overrideRow.name ?? base.name;
    base.character = overrideRow.character ?? base.character;
    base.age =
        overrideRow.age != null && !Number.isNaN(Number(overrideRow.age))
            ? Number(overrideRow.age)
            : base.age;
    base.gender = overrideRow.gender ?? base.gender;
    base.interests = overrideRow.interests ?? base.interests;
    base.interestsType = overrideRow.interestsType ?? base.interestsType;
    base.photoURL = overrideRow.photoURL ?? base.photoURL;
    base.characterTags = overrideRow.characterTags ?? base.characterTags;
    base.speakingStyle = overrideRow.speakingStyle ?? base.speakingStyle;
    base.voiceId = overrideRow.voiceId ?? base.voiceId;
    base.country = overrideRow.country ?? base.country;
    if (
        overrideRow.rive_avatar != null &&
        String(overrideRow.rive_avatar).trim() !== ''
    ) {
        base.rive_avatar = overrideRow.rive_avatar;
    }
    return base;
}

async function loadCatalogOverridesMap(userId) {
    if (!userId) return new Map();
    try {
        const rows = await getQuery(
            'SELECT * FROM `bot_catalog_overrides` WHERE user_id = ?',
            [userId]
        );
        const map = new Map();
        for (const row of rows || []) {
            map.set(Number(row.bot_id), row);
        }
        return map;
    } catch (e) {
        if (e && e.code === 'ER_NO_SUCH_TABLE') {
            console.warn(
                '[agents] bot_catalog_overrides tablosu yok; scripts/sql/bot_catalog_overrides.sql çalıştırın.'
            );
            return new Map();
        }
        throw e;
    }
}

async function fetchFriendCreateUserAgents(creatorId) {
    try {
        return await getQuery(
            'SELECT * FROM `bots` WHERE system = ? AND creatorId = ? AND user_agent_origin = ?',
            [0, creatorId, 'friend_create']
        );
    } catch (e) {
        if (e && e.code === 'ER_BAD_FIELD_ERROR') {
            console.warn(
                '[agents] user_agent_origin kolonu yok; scripts/sql/bots_user_agent_origin.sql çalıştırın — geçici olarak tüm custom botlar listeleniyor.'
            );
            return await getQuery('SELECT * FROM `bots` WHERE system = ? AND creatorId = ?', [
                0,
                creatorId
            ]);
        }
        throw e;
    }
}

/** Kolon bir kez görülünce true kalır; yoksa her seferinde SHOW (migration sonrası restart gerekmez). */
let _botsUserAgentOriginKnownTrue = false;

async function botsHasUserAgentOriginColumn() {
    if (_botsUserAgentOriginKnownTrue) {
        return true;
    }
    try {
        const r = await getQuery(
            "SHOW COLUMNS FROM `bots` WHERE Field = 'user_agent_origin'"
        );
        const has = Array.isArray(r) && r.length > 0;
        if (has) {
            _botsUserAgentOriginKnownTrue = true;
        }
        return has;
    } catch (e) {
        console.warn('[agents] botsHasUserAgentOriginColumn check failed:', e?.message || e);
        return false;
    }
}

let _botCatalogOverridesRiveKnownTrue = false;

async function botCatalogOverridesHasRiveAvatarColumn() {
    if (_botCatalogOverridesRiveKnownTrue) {
        return true;
    }
    try {
        const r = await getQuery(
            "SHOW COLUMNS FROM `bot_catalog_overrides` WHERE Field = 'rive_avatar'"
        );
        const has = Array.isArray(r) && r.length > 0;
        if (has) {
            _botCatalogOverridesRiveKnownTrue = true;
        }
        return has;
    } catch (e) {
        if (e && e.code === 'ER_NO_SUCH_TABLE') {
            return false;
        }
        console.warn(
            '[agents] botCatalogOverridesHasRiveAvatarColumn check failed:',
            e?.message || e
        );
        return false;
    }
}

routes.post('/get-user-agents',middleware,async (req,res)=>{
    try {
        const gate = await assertJwtMatchesBodyOwner(req, 'get-user-agents');
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }
        const userId = gate.jwtUserId;

        const lang = normalizeLang(req.body?.lang);
        const userAgents = await fetchFriendCreateUserAgents(userId);
        
        if (userAgents.length === 0) {
            return res.status(200).json([]);
        }
        
        const withPhotos = userAgents.map(attachPhotoUrls);
        const localized = await localizeAgents(withPhotos, lang);
        return res.status(200).json(localized);
        
    } catch (error) {
        console.log("Error getting user agents:", error);
        res.status(500).json({
            "msg": "Server error",
            "success": false
        });
    }
})




routes.post('/get-system-agents', middleware, async (req, res) => {
    try {
        const lang = normalizeLang(req.body?.lang);
        const agents = await getQuery('SELECT * FROM `bots` WHERE system IN (1, 2)', []);
        const userId = await resolveJwtSubjectUserId(req);
        const overridesMap = await loadCatalogOverridesMap(userId);
        const merged = agents.map((a) => {
            const o = overridesMap.get(Number(a.id));
            const row = o ? applyCatalogOverride(a, o) : a;
            return attachPhotoUrls(row);
        });
        const localized = await localizeAgents(merged, lang);
        return res.status(200).json(localized);
    } catch (error) {
        console.log('get-system-agents error:', error);
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            msg: 'Server error'
        });
    }
});

routes.post('/get-random-template-agent', middleware, async (req, res) => {
    try {
        const rows = await getQuery(
            "SELECT * FROM `bots` WHERE system = 2 ORDER BY RAND() LIMIT 1",
            []
        );
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                success: false,
                code: "TEMPLATE_NOT_FOUND",
                msg: "No template agent found for system=2"
            });
        }
        return res.status(200).json({
            success: true,
            agent: attachPhotoUrls(rows[0])
        });
    } catch (error) {
        console.log("get-random-template-agent error:", error);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            msg: "Server error"
        });
    }
});


routes.post('/get-agent-data', middleware, async (req, res) => {
    try {
        const { id } = req.body;
        const lang = normalizeLang(req.body?.lang);
        const agents = await getQuery(
            'SELECT * FROM `bots` WHERE id = ? AND system != 2',
            [id]
        );
        if (agents.length === 0) {
            return res.status(404).json({
                msg: 'Agent not found',
                success: false
            });
        }
        let row = agents[0];
        const sys = Number(row.system);
        if (sys === 1 || sys === 2) {
            const userId = await resolveJwtSubjectUserId(req);
            const map = await loadCatalogOverridesMap(userId);
            const o = map.get(Number(row.id));
            if (o) row = applyCatalogOverride(row, o);
        }
        const enableTranslate = process.env.AGENT_TRANSLATE_ON_FETCH === 'true';
        row = await localizeAgentRow(attachPhotoUrls(row), lang, {
            translate: enableTranslate
        });
        return res.status(200).json({
            success: true,
            agent: row
        });
    } catch (error) {
        console.log(error);
        return res.status(400).json({
            msg: 'server error',
            success: false
        });
    }
});


routes.post('/create-custom-agent', middleware, async (req, res) => {
    try {
        const gate = await assertJwtMatchesBodyOwner(req, 'create-custom-agent');
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }
        const actorId = gate.jwtUserId;

        const {
            name,
            character,
            age,
            gender,
            interests,
            interestsType,
            photoURL,
            photoURLs,
            characterTags,
            speakingStyle,
            voiceId,
            country
        } = req.body;

        if (!voiceId) {
            return res.status(400).json({
                success: false,
                code: "INVALID_PAYLOAD",
                msg: "name and voiceId are required (ownerId or userId must match JWT)"
            });
        }

        const resolvedVoiceId = await resolveVoiceIdForStorage(voiceId);
        if (!resolvedVoiceId) {
            return res.status(400).json({
                success: false,
                code: "INVALID_VOICE",
                msg: "voiceId could not be resolved"
            });
        }

        const parsedName = parseAgentName(name);
        if (!parsedName.ok) {
            return res.status(400).json({
                success: false,
                code: parsedName.code,
                msg: parsedName.msg
            });
        }

        const normalizedInterests = JSON.stringify(normalizeArrayLike(interests));
        const normalizedInterestsType = JSON.stringify(normalizeArrayLike(interestsType));
        const normalizedCharacterTags = JSON.stringify(normalizeArrayLike(characterTags));

        const hasOriginCol = await botsHasUserAgentOriginColumn();
        const riveVal = parseRiveAvatarFromBody(req.body, null);

        const baseValues = [
            parsedName.value,
            character || '',
            Number(age) || 18,
            gender || 'female',
            normalizedInterests,
            normalizedInterestsType,
            serializePhotoUrlsFromBody({ photoURL, photoURLs }),
            normalizedCharacterTags,
            speakingStyle || '',
            resolvedVoiceId,
            country || '',
            riveVal,
            actorId,
            0
        ];

        let insertQuery;
        let values;
        if (hasOriginCol) {
            insertQuery = `
            INSERT INTO bots 
            (name, \`character\`, age, gender, interests, interestsType, photoURL, 
             characterTags, speakingStyle, voiceId, country, rive_avatar, creatorId, system, user_agent_origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
            values = [...baseValues, 'friend_create'];
        } else {
            console.warn(
                '[agents] create-custom-agent: `user_agent_origin` kolonu yok — eski INSERT kullanılıyor. `scripts/sql/bots_user_agent_origin.sql` çalıştırın.'
            );
            insertQuery = `
            INSERT INTO bots 
            (name, \`character\`, age, gender, interests, interestsType, photoURL, 
             characterTags, speakingStyle, voiceId, country, rive_avatar, creatorId, system)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
            values = baseValues;
        }

        const newAgentId = await insertQuery(insertQuery, values);

        if (newAgentId) {
            const createdRows = await getQuery(
                'SELECT * FROM `bots` WHERE id = ? LIMIT 1',
                [newAgentId]
            );
            const createdAgent = createdRows?.[0]
                ? attachPhotoUrls(createdRows[0])
                : null;
            return res.status(200).json({
                success: true,
                msg: "Custom agent created successfully",
                agentId: newAgentId,
                voiceId: resolvedVoiceId,
                agent: createdAgent
            });
        } else {
            return res.status(500).json({
                success: false,
                code: "CREATE_AGENT_FAILED",
                msg: "Failed to create custom agent"
            });
        }

    } catch (error) {
        console.log('Error creating custom agent:', error);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            msg: "Server error"
        });
    }
});

/**
 * system=0 + sahip: bots satırı güncellenir.
 * system=1|2 (katalog): bots değişmez; bot_catalog_overrides upsert — get-system-agents aynı id ile birleştirir.
 */
routes.post('/update-agent', middleware, async (req, res) => {
    try {
        const gate = await assertJwtMatchesBodyOwner(req, 'update-agent');
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }
        const actorId = gate.jwtUserId;

        const {
            agentId,
            name,
            character,
            age,
            gender,
            interests,
            interestsType,
            photoURL,
            photoURLs,
            characterTags,
            speakingStyle,
            voiceId,
            country
        } = req.body;

        if (!agentId) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PAYLOAD',
                msg: 'agentId is required'
            });
        }

        const rows = await getQuery('SELECT * FROM `bots` WHERE id = ? LIMIT 1', [agentId]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'NOT_FOUND',
                msg: 'Agent not found'
            });
        }

        const bot = rows[0];
        const sys = Number(bot.system);

        const normalizedInterests = JSON.stringify(normalizeArrayLike(interests));
        const normalizedInterestsType = JSON.stringify(normalizeArrayLike(interestsType));
        const normalizedCharacterTags = JSON.stringify(normalizeArrayLike(characterTags));
        const photoSerialized = serializePhotoUrlsFromBody({ photoURL, photoURLs });
        const riveResolved = parseRiveAvatarFromBody(req.body, bot);
        const resolvedVoiceId =
            voiceId !== undefined && voiceId !== null
                ? await resolveVoiceIdForStorage(voiceId)
                : bot.voiceId;

        let resolvedName = bot.name;
        if (name !== undefined && name !== null) {
            const parsedName = parseAgentName(name);
            if (!parsedName.ok) {
                return res.status(400).json({
                    success: false,
                    code: parsedName.code,
                    msg: parsedName.msg
                });
            }
            resolvedName = parsedName.value;
        }

        // Kendi custom agent (system=0): yalnızca şu anki kullanıcı (JWT) sahibi olmalı — şablon creatorId ile ilgisi yok
        if (sys === 0 && normalizeAgentUserId(bot.creatorId) === actorId) {
            const ok = await query(
                `UPDATE \`bots\` SET name=?, \`character\`=?, age=?, gender=?, interests=?, interestsType=?, photoURL=?, characterTags=?, speakingStyle=?, voiceId=?, country=?, rive_avatar=? WHERE id=? AND creatorId=? AND system=0 LIMIT 1`,
                [
                    resolvedName,
                    character || '',
                    Number(age) || 18,
                    gender || 'female',
                    normalizedInterests,
                    normalizedInterestsType,
                    photoSerialized,
                    normalizedCharacterTags,
                    speakingStyle || '',
                    resolvedVoiceId,
                    country || '',
                    riveResolved,
                    agentId,
                    actorId
                ]
            );
            if (!ok) {
                return res.status(500).json({
                    success: false,
                    code: 'UPDATE_FAILED',
                    msg: 'Failed to update agent'
                });
            }
            return res.status(200).json({
                success: true,
                msg: 'Agent updated successfully',
                agentId: Number(agentId),
                voiceId: resolvedVoiceId
            });
        }

        if (sys === 1 || sys === 2) {
            const riveForCatalog = parseRiveAvatarFromBody(req.body, bot);
            const hasRiveOverrideCol = await botCatalogOverridesHasRiveAvatarColumn();
            let upsertSql;
            let upsertParams;
            if (hasRiveOverrideCol) {
                upsertSql = `
                INSERT INTO \`bot_catalog_overrides\`
                (user_id, bot_id, name, \`character\`, age, gender, interests, interestsType, photoURL, characterTags, speakingStyle, voiceId, country, rive_avatar)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE
                name=VALUES(name),
                \`character\`=VALUES(\`character\`),
                age=VALUES(age),
                gender=VALUES(gender),
                interests=VALUES(interests),
                interestsType=VALUES(interestsType),
                photoURL=VALUES(photoURL),
                characterTags=VALUES(characterTags),
                speakingStyle=VALUES(speakingStyle),
                voiceId=VALUES(voiceId),
                country=VALUES(country),
                rive_avatar=VALUES(rive_avatar)
            `;
                upsertParams = [
                    actorId,
                    Number(agentId),
                    resolvedName,
                    character || '',
                    Number(age) || 18,
                    gender || 'female',
                    normalizedInterests,
                    normalizedInterestsType,
                    photoSerialized,
                    normalizedCharacterTags,
                    speakingStyle || '',
                    resolvedVoiceId,
                    country || '',
                    riveForCatalog
                ];
            } else {
                console.warn(
                    '[agents] update-agent katalog: `bot_catalog_overrides.rive_avatar` yok — scripts/sql/bot_catalog_overrides_add_rive_avatar.sql çalıştırın.'
                );
                upsertSql = `
                INSERT INTO \`bot_catalog_overrides\`
                (user_id, bot_id, name, \`character\`, age, gender, interests, interestsType, photoURL, characterTags, speakingStyle, voiceId, country)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE
                name=VALUES(name),
                \`character\`=VALUES(\`character\`),
                age=VALUES(age),
                gender=VALUES(gender),
                interests=VALUES(interests),
                interestsType=VALUES(interestsType),
                photoURL=VALUES(photoURL),
                characterTags=VALUES(characterTags),
                speakingStyle=VALUES(speakingStyle),
                voiceId=VALUES(voiceId),
                country=VALUES(country)
            `;
                upsertParams = [
                    actorId,
                    Number(agentId),
                    resolvedName,
                    character || '',
                    Number(age) || 18,
                    gender || 'female',
                    normalizedInterests,
                    normalizedInterestsType,
                    photoSerialized,
                    normalizedCharacterTags,
                    speakingStyle || '',
                    resolvedVoiceId,
                    country || ''
                ];
            }
            const ok = await query(upsertSql, upsertParams);
            if (!ok) {
                return res.status(500).json({
                    success: false,
                    code: 'OVERRIDE_UPSERT_FAILED',
                    msg: 'Failed to save catalog customization'
                });
            }
            return res.status(200).json({
                success: true,
                msg: 'Catalog agent customized',
                agentId: Number(agentId),
                voiceId: resolvedVoiceId
            });
        }

        return res.status(403).json({
            success: false,
            code: 'FORBIDDEN',
            msg: 'Cannot update this agent'
        });
    } catch (error) {
        console.log('update-agent error:', error);
        if (error && error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                success: false,
                code: 'MIGRATION_REQUIRED',
                msg: 'Run scripts/sql/bot_catalog_overrides.sql on the database'
            });
        }
        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            msg: 'Server error'
        });
    }
});

// Son 15 gün içerisinde eklenen botları çeker
routes.post('/get-recent-bots', middleware, async (req, res) => {
    try {
        const lang = normalizeLang(req.body?.lang);
        // Son 15 günün tarihini hesapla
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
        const dateString = fifteenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
        
        // Son 15 gün içerisinde eklenen botları çek
        // Not: Eğer created_at kolonu yoksa, created, date_created vb. kolon ismini kullanın
        const recentBots = await getQuery(
            "SELECT * FROM `bots` WHERE created_at >= ? AND system != 2 ORDER BY created_at DESC", 
            [dateString]
        );
        
        if (recentBots.length === 0) {
            return res.status(200).json({
                "msg": "Son 15 günde eklenen bot bulunamadı",
                "success": true,
                "data": []
            });
        }

        const withPhotos = recentBots.map(attachPhotoUrls);
        const localized = await localizeAgents(withPhotos, lang);
        
        return res.status(200).json({
            "msg": "Son 15 günde eklenen botlar başarıyla getirildi",
            "success": true,
            "count": localized.length,
            "data": localized
        });
        
    } catch (error) {
        console.log("Error getting recent bots:", error);
        res.status(500).json({
            "msg": "Server error",
            "success": false,
            "error": error.message
        });
    }
});

routes.post('/delete-agent', middleware, async (req, res) => {
    try {
        const gate = await assertJwtMatchesBodyOwner(req, 'delete-agent');
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }
        const actorId = gate.jwtUserId;

        const { agentId } = req.body;

        if (!agentId) {
            return res.status(400).json({
                msg: 'agentId is required',
                success: false
            });
        }

        const existing = await getQuery(
            'SELECT id FROM `bots` WHERE id = ? AND creatorId = ? AND system = 0 LIMIT 1',
            [agentId, actorId]
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                msg: 'Agent not found',
                success: false
            });
        }

        const deleted = await query(
            'DELETE FROM `bots` WHERE id = ? AND creatorId = ? AND system = 0 LIMIT 1',
            [agentId, actorId]
        );

        if (!deleted) {
            return res.status(500).json({
                msg: 'Failed to delete agent',
                success: false
            });
        }

        return res.status(200).json({
            msg: 'Agent deleted successfully',
            success: true
        });
    } catch (error) {
        console.log('Error deleting agent:', error);
        return res.status(500).json({
            msg: 'Server error',
            success: false
        });
    }
});


module.exports = routes;