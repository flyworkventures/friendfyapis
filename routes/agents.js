const routes = require('express').Router();
const middleware = require('../middleware/checkAuth')
const { getQuery , query} = require('../db')

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

function serializePhotoUrlsFromBody(body) {
    const incomingList = body.photoURLs ?? body.photos ?? body.photoURL;
    const normalized = toPhotoUrlArray(incomingList);
    return JSON.stringify(normalized);
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

routes.post('/get-user-agents',middleware,async (req,res)=>{
    try {
        const gate = await assertJwtMatchesBodyOwner(req, 'get-user-agents');
        if (!gate.ok) {
            return res.status(gate.status).json(gate.json);
        }
        const userId = gate.jwtUserId;

        const userAgents = await fetchFriendCreateUserAgents(userId);
        
        if (userAgents.length === 0) {
            return res.status(200).json([]);
        }
        
        return res.status(200).json(userAgents.map(attachPhotoUrls));
        
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
        const agents = await getQuery('SELECT * FROM `bots` WHERE system IN (1, 2)', []);
        const userId = await resolveJwtSubjectUserId(req);
        const overridesMap = await loadCatalogOverridesMap(userId);
        const merged = agents.map((a) => {
            const o = overridesMap.get(Number(a.id));
            const row = o ? applyCatalogOverride(a, o) : a;
            return attachPhotoUrls(row);
        });
        return res.status(200).json(merged);
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
        return res.status(200).json({
            success: true,
            agent: attachPhotoUrls(row)
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

        // Validate required fields
        if (!name || !voiceId) {
            return res.status(400).json({
                success: false,
                code: "INVALID_PAYLOAD",
                msg: "name and voiceId are required (ownerId or userId must match JWT)"
            });
        }

        const normalizedInterests = JSON.stringify(normalizeArrayLike(interests));
        const normalizedInterestsType = JSON.stringify(normalizeArrayLike(interestsType));
        const normalizedCharacterTags = JSON.stringify(normalizeArrayLike(characterTags));

        // Insert: yalnızca "Arkadaş oluştur" — user_agent_origin = friend_create (get-user-agents ile uyum)
        const insertQuery = `
            INSERT INTO bots 
            (name, \`character\`, age, gender, interests, interestsType, photoURL, 
             characterTags, speakingStyle, voiceId, country, creatorId, system, user_agent_origin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            name,
            character || '',
            Number(age) || 18,
            gender || 'female',
            normalizedInterests,
            normalizedInterestsType,
            serializePhotoUrlsFromBody({ photoURL, photoURLs }),
            normalizedCharacterTags,
            speakingStyle || '',
            voiceId,
            country || '',
            actorId,
            0,
            'friend_create'
        ];

        const result = await query(insertQuery, values);

        if (result) {
            return res.status(200).json({
                success: true,
                msg: "Custom agent created successfully"
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

        // Kendi custom agent (system=0): yalnızca şu anki kullanıcı (JWT) sahibi olmalı — şablon creatorId ile ilgisi yok
        if (sys === 0 && normalizeAgentUserId(bot.creatorId) === actorId) {
            const ok = await query(
                `UPDATE \`bots\` SET name=?, \`character\`=?, age=?, gender=?, interests=?, interestsType=?, photoURL=?, characterTags=?, speakingStyle=?, voiceId=?, country=? WHERE id=? AND creatorId=? AND system=0 LIMIT 1`,
                [
                    name,
                    character || '',
                    Number(age) || 18,
                    gender || 'female',
                    normalizedInterests,
                    normalizedInterestsType,
                    photoSerialized,
                    normalizedCharacterTags,
                    speakingStyle || '',
                    voiceId,
                    country || '',
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
                agentId: Number(agentId)
            });
        }

        if (sys === 1 || sys === 2) {
            const upsertSql = `
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
            const ok = await query(upsertSql, [
                actorId,
                Number(agentId),
                name,
                character || '',
                Number(age) || 18,
                gender || 'female',
                normalizedInterests,
                normalizedInterestsType,
                photoSerialized,
                normalizedCharacterTags,
                speakingStyle || '',
                voiceId,
                country || ''
            ]);
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
                agentId: Number(agentId)
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
        
        return res.status(200).json({
            "msg": "Son 15 günde eklenen botlar başarıyla getirildi",
            "success": true,
            "count": recentBots.length,
            "data": recentBots.map(attachPhotoUrls)
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