const router = require('express').Router();
const panelAuth = require('../middleware/panelAuth');
const { getQuery, query } = require('../db');
const { buildAnalysePayload } = require('./lib/panelAnalytics');
const { rowToPanelUser, panelPatchToDbFields } = require('./lib/panelUserMapper');
const {
    listAgents,
    listAgentsByOwner,
    fetchAgentWithOwner,
    createAgent,
    updateAgent,
    deleteAgent
} = require('./lib/panelAgentService');
const { agentTypeToSystem } = require('./lib/panelAgentMapper');
const panelAgentUpload = require('../middleware/panelAgentUpload');
const {
    uploadPanelAgentAssets,
    parsePanelAgentFormBody,
    hasAnyUploadedFiles,
    makeAgentUploadSlug,
    mapUploadErrorToResponse,
    assertCreateMultipartMedia,
    assertAgentMediaComplete,
    assertPatchMediaIfProvided
} = require('./lib/panelAgentUploads');
const { buildUserInsights } = require('./lib/panelUserInsights');
const { parseMembershipsArray } = require('./lib/membershipsSync');

/** Panel karakter ekleme: dosyalar Bunny CDN'e yüklenir, DB'ye public URL yazılır. */
async function prepareCreateAgentBody(req, body) {
    assertCreateMultipartMedia(req.files);
    const slug = makeAgentUploadSlug();
    const assets = await uploadPanelAgentAssets(req.files, {
        slug,
        requireThreePhotos: true
    });
    body.photoURLs = assets.photoURLs;
    body.riveAvatar = assets.riveAvatarUrl;
    body.rive_avatar = assets.riveAvatarUrl;
    assertAgentMediaComplete(body);
    return body;
}

async function preparePatchAgentBody(req, body) {
    assertPatchMediaIfProvided(body, req.files);
    if (!hasAnyUploadedFiles(req.files)) {
        return body;
    }
    const slug = makeAgentUploadSlug();
    const assets = await uploadPanelAgentAssets(req.files, { slug });
    if (assets.photoURLs.length) {
        body.photoURLs = assets.photoURLs;
    }
    if (assets.riveAvatarUrl) {
        body.riveAvatar = assets.riveAvatarUrl;
        body.rive_avatar = assets.riveAvatarUrl;
    }
    if (body.photoURLs) {
        assertAgentMediaComplete(body);
    }
    return body;
}

function runPanelAgentUpload(req, res, next) {
    panelAgentUpload(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                ok: false,
                code: 'MULTIPART_ERROR',
                msg: err.message
            });
        }
        return next();
    });
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.use(panelAuth);

router.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        service: 'friendfy-panel-api',
        contractVersion: '2',
        features: ['users', 'agents', 'analyse']
    });
});

router.get('/analyse', async (req, res) => {
    try {
        const payload = await buildAnalysePayload();
        return res.status(200).json(payload);
    } catch (error) {
        console.error('panel /analyse error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.get('/users', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
        );
        const offset = (page - 1) * limit;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        let whereSql = '';
        const countParams = [];
        const listParams = [];

        if (search) {
            whereSql =
                ' WHERE email LIKE ? OR username LIKE ? OR phoneNumber LIKE ? OR CAST(id AS CHAR) LIKE ? OR appleUserIdentifier LIKE ? ';
            const like = `%${search}%`;
            countParams.push(like, like, like, like, like);
            listParams.push(like, like, like, like, like);
        }

        const [countRow] = await getQuery(
            `SELECT COUNT(*) AS total FROM \`users\`${whereSql}`,
            countParams
        );
        const total = Number(countRow?.total) || 0;

        const rows = await getQuery(
            `SELECT * FROM \`users\`${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...listParams, limit, offset]
        );

        const users = (rows || []).map(rowToPanelUser).filter(Boolean);
        const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

        return res.status(200).json({
            contractVersion: '2',
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        });
    } catch (error) {
        console.error('panel GET /users error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

/** RevenueCat müşteri kimliğini uygulama kullanıcısıyla eşleştirir. */
router.get('/users/resolve-rc', async (req, res) => {
    try {
        const customerId =
            typeof req.query.customerId === 'string' ? req.query.customerId.trim() : '';
        if (!customerId) {
            return res.status(400).json({ ok: false, msg: 'customerId gerekli' });
        }

        const candidates = [];

        if (/^\d+$/.test(customerId)) {
            const byId = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
                Number(customerId)
            ]);
            if (byId?.[0]) candidates.push(byId[0]);
        }

        if (!candidates.length) {
            try {
                const byRc = await getQuery(
                    'SELECT * FROM `users` WHERE revenuecat_customer_id = ? LIMIT 1',
                    [customerId]
                );
                if (byRc?.[0]) candidates.push(byRc[0]);
            } catch (error) {
                if (error?.code !== 'ER_BAD_FIELD_ERROR') throw error;
            }
        }

        if (!candidates.length) {
            const byApple = await getQuery(
                'SELECT * FROM `users` WHERE appleUserIdentifier = ? LIMIT 1',
                [customerId]
            );
            if (byApple?.[0]) candidates.push(byApple[0]);
        }

        if (!candidates.length && aliasIds.length) {
            for (const aliasId of aliasIds) {
                if (!aliasId || candidates.length) break;
                try {
                    const byRcAlias = await getQuery(
                        'SELECT * FROM `users` WHERE revenuecat_customer_id = ? LIMIT 1',
                        [aliasId]
                    );
                    if (byRcAlias?.[0]) candidates.push(byRcAlias[0]);
                } catch (error) {
                    if (error?.code !== 'ER_BAD_FIELD_ERROR') throw error;
                }
            }
        }

        const aliasIds = Array.isArray(req.query.aliasIds)
            ? req.query.aliasIds
            : typeof req.query.aliasIds === 'string'
              ? req.query.aliasIds.split(',').map((s) => s.trim()).filter(Boolean)
              : [];

        for (const aliasId of aliasIds) {
            if (!/^\d+$/.test(aliasId)) continue;
            const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [
                Number(aliasId)
            ]);
            if (rows?.[0] && !candidates.some((r) => r.id === rows[0].id)) {
                candidates.push(rows[0]);
            }
        }

        const email =
            typeof req.query.email === 'string' ? req.query.email.trim() : '';
        if (email && !candidates.length) {
            const byEmail = await getQuery(
                'SELECT * FROM `users` WHERE email = ? LIMIT 1',
                [email]
            );
            if (byEmail?.[0]) candidates.push(byEmail[0]);
        }

        const user = candidates[0] ? rowToPanelUser(candidates[0]) : null;
        return res.status(200).json({
            contractVersion: '2',
            matched: Boolean(user),
            user,
            matchStrategy: user
                ? /^\d+$/.test(customerId) && String(user.id) === customerId
                    ? 'user_id'
                    : user.extras?.revenuecatCustomerId === customerId
                      ? 'revenuecat_customer_id'
                      : user.providerId === customerId
                        ? 'apple_user_identifier'
                        : email && user.email === email
                          ? 'email'
                          : 'alias_or_lookup'
                : null
        });
    } catch (error) {
        console.error('panel GET /users/resolve-rc error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/agents', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
        );
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        let system = req.query.system;
        if (req.query.agentType) {
            const mapped = agentTypeToSystem(req.query.agentType);
            if (mapped !== undefined) system = mapped;
        }
        const ownerId = req.query.ownerId ?? req.query.creatorId ?? '';

        const { agents, total } = await listAgents({
            page,
            limit,
            search,
            system,
            ownerId: ownerId ? String(ownerId) : undefined
        });

        return res.status(200).json({
            contractVersion: '2',
            agents,
            pagination: {
                page,
                limit,
                total,
                totalPages: total === 0 ? 0 : Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('panel GET /agents error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.post('/agents', runPanelAgentUpload, async (req, res) => {
    try {
        let body = parsePanelAgentFormBody(req);
        body = await prepareCreateAgentBody(req, body);
        const result = await createAgent(body);
        return res.status(result.status).json(result.json);
    } catch (error) {
        console.error('panel POST /agents error:', error);
        if (error?.code) {
            const mapped = mapUploadErrorToResponse(error);
            return res.status(mapped.status).json(mapped.json);
        }
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/agents/:id', async (req, res) => {
    try {
        const agent = await fetchAgentWithOwner(req.params.id);
        if (!agent) {
            return res.status(404).json({ ok: false, msg: 'Agent not found' });
        }
        return res.status(200).json({ contractVersion: '2', agent });
    } catch (error) {
        console.error('panel GET /agents/:id error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.patch('/agents/:id', runPanelAgentUpload, async (req, res) => {
    try {
        let body = parsePanelAgentFormBody(req);
        body = await preparePatchAgentBody(req, body);
        const result = await updateAgent(req.params.id, body);
        return res.status(result.status).json(result.json);
    } catch (error) {
        console.error('panel PATCH /agents/:id error:', error);
        if (error?.code) {
            const mapped = mapUploadErrorToResponse(error);
            return res.status(mapped.status).json(mapped.json);
        }
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.delete('/agents/:id', async (req, res) => {
    try {
        const result = await deleteAgent(req.params.id);
        return res.status(result.status).json(result.json);
    } catch (error) {
        console.error('panel DELETE /agents/:id error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/users/:id/agents', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
        );
        const { agents, total } = await listAgentsByOwner(req.params.id, { page, limit });
        return res.status(200).json({
            contractVersion: '2',
            userId: String(req.params.id),
            agents,
            pagination: {
                page,
                limit,
                total,
                totalPages: total === 0 ? 0 : Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('panel GET /users/:id/agents error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/voices', async (req, res) => {
    try {
        const genderRaw = String(req.query.gender || '').trim().toLowerCase();
        const gender = genderRaw === 'female' || genderRaw === 'male' ? genderRaw : null;

        let rows;
        if (gender) {
            rows = await getQuery(
                'SELECT id, name, elevenlabs_id AS voiceId, mp3_url AS previewUrl, gender FROM `voices` WHERE gender = ? ORDER BY id ASC',
                [gender]
            );
            if (!rows?.length) {
                rows = await getQuery(
                    'SELECT id, name, elevenlabs_id AS voiceId, mp3_url AS previewUrl, gender FROM `voices` ORDER BY id ASC',
                    []
                );
            }
        } else {
            rows = await getQuery(
                'SELECT id, name, elevenlabs_id AS voiceId, mp3_url AS previewUrl, gender FROM `voices` ORDER BY id ASC',
                []
            );
        }

        const mapped = (rows || []).map((row) => ({
            voiceId: row.voiceId || '',
            name: row.name || 'İsimsiz ses',
            gender:
                String(row.gender || '').toLowerCase() === 'female' ||
                String(row.gender || '').toLowerCase() === 'male'
                    ? String(row.gender).toLowerCase()
                    : 'unknown',
            previewUrl: row.previewUrl || null
        }));

        return res.status(200).json({
            contractVersion: '2',
            data: mapped,
            meta: {
                gender: gender || 'all',
                total: mapped.length,
                fallbackUsed: Boolean(gender && rows?.length && !rows.every((r) => String(r.gender).toLowerCase() === gender))
            }
        });
    } catch (error) {
        console.error('panel GET /voices error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/users/:id/billing', async (req, res) => {
    try {
        const id = req.params.id;
        let rows;
        try {
            rows = await getQuery(
                'SELECT id, email, username, memberships, revenuecat_customer_id FROM `users` WHERE id = ? LIMIT 1',
                [id]
            );
        } catch (error) {
            if (error?.code === 'ER_BAD_FIELD_ERROR') {
                rows = await getQuery(
                    'SELECT id, email, username, memberships FROM `users` WHERE id = ? LIMIT 1',
                    [id]
                );
            } else {
                throw error;
            }
        }

        if (!rows?.length) {
            return res.status(404).json({ ok: false, msg: 'User not found' });
        }

        const row = rows[0];
        const memberships = parseMembershipsArray(row.memberships).map((m) => ({
            type: m?.type ?? null,
            productId: m?.productId ?? null,
            isActive: Boolean(m?.isActive),
            startDate: m?.startDate ?? null,
            endDate: m?.endDate ?? null,
            purchasedAt: m?.purchasedAt ?? null
        }));

        return res.status(200).json({
            contractVersion: '2',
            userId: String(row.id),
            email: row.email ?? null,
            displayName: row.username ?? null,
            revenuecatCustomerId: row.revenuecat_customer_id ?? null,
            memberships,
            invoiceNote:
                'Apple App Store faturaları genelde RevenueCat PDF olarak gelmez; mağaza fatura geçmişi veya RC abonelik detayı kullanılır.'
        });
    } catch (error) {
        console.error('panel GET /users/:id/billing error:', error);
        return res.status(500).json({ ok: false, msg: 'Server error' });
    }
});

router.get('/users/:id/details', async (req, res) => {
    try {
        const id = req.params.id;
        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }

        const user = rowToPanelUser(rows[0]);
        const insights = await buildUserInsights(id);

        return res.status(200).json({
            contractVersion: '2',
            user: {
                ...user,
                insights
            }
        });
    } catch (error) {
        console.error('panel GET /users/:id/details error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.get('/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }
        return res.status(200).json({
            contractVersion: '2',
            user: rowToPanelUser(rows[0])
        });
    } catch (error) {
        console.error('panel GET /users/:id error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

router.patch('/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body || {};

        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'User not found'
            });
        }

        const existing = rows[0];
        const { fields, values } = panelPatchToDbFields(existing, body);

        if (fields.length === 0) {
            return res.status(400).json({
                ok: false,
                msg: 'No supported fields to update'
            });
        }

        if (body.email !== undefined && body.email !== null) {
            const dup = await getQuery(
                'SELECT id FROM `users` WHERE email = ? AND id != ? LIMIT 1',
                [body.email, id]
            );
            if (dup && dup.length > 0) {
                return res.status(409).json({
                    ok: false,
                    code: 'EMAIL_IN_USE',
                    msg: 'Email already registered'
                });
            }
        }

        const sql = `UPDATE \`users\` SET ${fields.join(', ')} WHERE id = ? LIMIT 1`;
        const ok = await query(sql, [...values, id]);
        if (!ok) {
            return res.status(500).json({
                ok: false,
                msg: 'Update failed'
            });
        }

        const updated = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [id]);
        return res.status(200).json({
            contractVersion: '2',
            ok: true,
            user: rowToPanelUser(updated[0])
        });
    } catch (error) {
        console.error('panel PATCH /users/:id error:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Server error'
        });
    }
});

module.exports = router;
