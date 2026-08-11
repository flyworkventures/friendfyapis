const { getQuery, query } = require('../../db');
const {
    rowToPanelAgent,
    panelAgentBodyToDb,
    validatePanelAgentCreate,
    serializePhotoUrlsFromPanelBody,
    normalizeArrayLike
} = require('./panelAgentMapper');

let _hasUserAgentOriginCol = null;
let _hasCreatedAtCol = null;

async function columnExists(table, field) {
    const rows = await getQuery(`SHOW COLUMNS FROM \`${table}\` WHERE Field = ?`, [field]);
    return rows && rows.length > 0;
}

async function botsHasUserAgentOriginColumn() {
    if (_hasUserAgentOriginCol === true) return true;
    if (_hasUserAgentOriginCol === false) return false;
    try {
        _hasUserAgentOriginCol = await columnExists('bots', 'user_agent_origin');
        return _hasUserAgentOriginCol;
    } catch {
        _hasUserAgentOriginCol = false;
        return false;
    }
}

async function botsHasCreatedAtColumn() {
    if (_hasCreatedAtCol === true) return true;
    if (_hasCreatedAtCol === false) return false;
    try {
        _hasCreatedAtCol = await columnExists('bots', 'created_at');
        return _hasCreatedAtCol;
    } catch {
        _hasCreatedAtCol = false;
        return false;
    }
}

function buildAgentListWhere(queryParams) {
    const { search, system, ownerId, agentType } = queryParams;
    const clauses = [];
    const params = [];

    if (system !== undefined && system !== '' && !Number.isNaN(Number(system))) {
        clauses.push('b.system = ?');
        params.push(Number(system));
    }

    if (ownerId !== undefined && ownerId !== '') {
        clauses.push('b.creatorId = ?');
        params.push(String(ownerId));
    }

    if (search) {
        clauses.push('(b.name LIKE ? OR b.`character` LIKE ? OR CAST(b.id AS CHAR) LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
    }

    const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return { whereSql, params };
}

async function fetchAgentWithOwner(agentId) {
    const rows = await getQuery(
        `
        SELECT b.*, u.id AS owner_user_id, u.email AS owner_email, u.username AS owner_username
        FROM \`bots\` b
        LEFT JOIN \`users\` u ON u.id = b.creatorId
        WHERE b.id = ?
        LIMIT 1
        `,
        [agentId]
    );
    if (!rows?.length) return null;
    const row = rows[0];
    const userRow =
        row.owner_user_id != null
            ? { id: row.owner_user_id, email: row.owner_email, username: row.owner_username }
            : null;
    const { owner_user_id, owner_email, owner_username, ...bot } = row;
    return rowToPanelAgent(bot, userRow);
}

async function listAgents({ page, limit, search, system, ownerId }) {
    const { whereSql, params } = buildAgentListWhere({ search, system, ownerId });

    const [countRow] = await getQuery(
        `SELECT COUNT(*) AS total FROM \`bots\` b${whereSql}`,
        params
    );
    const total = Number(countRow?.total) || 0;
    const offset = (page - 1) * limit;

    const rows = await getQuery(
        `
        SELECT b.*, u.id AS owner_user_id, u.email AS owner_email, u.username AS owner_username
        FROM \`bots\` b
        LEFT JOIN \`users\` u ON u.id = b.creatorId
        ${whereSql}
        ORDER BY b.id DESC
        LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
    );

    const agents = (rows || []).map((row) => {
        const userRow =
            row.owner_user_id != null
                ? { id: row.owner_user_id, email: row.owner_email, username: row.owner_username }
                : null;
        const { owner_user_id, owner_email, owner_username, ...bot } = row;
        return rowToPanelAgent(bot, userRow);
    }).filter(Boolean);

    return { agents, total };
}

async function listAgentsByOwner(userId, { page, limit }) {
    return listAgents({ page, limit, ownerId: String(userId), search: '', system: undefined });
}

async function createAgent(body) {
    const validation = validatePanelAgentCreate(body);
    if (!validation.ok) {
        return {
            ok: false,
            status: 400,
            json: {
                ok: false,
                msg: validation.msg,
                code: validation.code || 'VALIDATION_ERROR'
            }
        };
    }

    const mapped = panelAgentBodyToDb(
        { ...body, name: body.name ?? body.displayName, system: validation.system },
        { isCreate: true }
    );
    if (mapped.error) {
        return { ok: false, status: 400, json: { ok: false, msg: mapped.error } };
    }

    const ins = mapped.insert;
    const name = String(body.name ?? body.displayName).trim();
    const character = body.character ?? body.extras?.character ?? '';
    const age = Number(body.age ?? body.extras?.age) || 18;
    const gender = body.gender ?? body.extras?.gender ?? 'female';
    const zodiacRaw = body.zodiac ?? body.zodiacSign ?? body.extras?.zodiac ?? null;
    const zodiac =
        zodiacRaw == null || String(zodiacRaw).trim() === ''
            ? null
            : String(zodiacRaw).trim().toLowerCase();
    const relRaw =
        body.relationship_type ??
        body.relationshipType ??
        body.extras?.relationshipType ??
        null;
    const relationshipType =
        relRaw == null || String(relRaw).trim() === ''
            ? null
            : String(relRaw).trim().toLowerCase();
    const voiceId = String(body.voiceId ?? body.extras?.voiceId ?? '').trim();
    const country = body.country ?? body.extras?.country ?? '';
    const speakingStyle = body.speakingStyle ?? body.extras?.speakingStyle ?? '';
    const exampleResponse = body.exampleResponse ?? body.extras?.exampleResponse ?? null;
    const rive =
        body.rive_avatar ?? body.riveAvatar ?? body.extras?.riveAvatar ?? null;
    const riveTrim = rive == null ? null : String(rive).trim() || null;

    const photoURL = serializePhotoUrlsFromPanelBody(body.extras ? { ...body, ...body.extras } : body);
    const interests = JSON.stringify(normalizeArrayLike(body.interests ?? body.extras?.interests));
    const interestsType = JSON.stringify(
        normalizeArrayLike(body.interestsType ?? body.extras?.interestsType)
    );
    const characterTags = JSON.stringify(
        normalizeArrayLike(body.characterTags ?? body.extras?.characterTags)
    );

    const hasOrigin = await botsHasUserAgentOriginColumn();
    let insertSql;
    let values;

    if (hasOrigin && ins.system === 0) {
        insertSql = `
            INSERT INTO bots
            (name, \`character\`, age, gender, zodiac, relationship_type, interests, interestsType, photoURL,
             characterTags, speakingStyle, voiceId, country, rive_avatar, creatorId, system, user_agent_origin, exampleResponse)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        values = [
            name,
            String(character),
            age,
            String(gender),
            zodiac,
            relationshipType,
            interests,
            interestsType,
            photoURL,
            characterTags,
            String(speakingStyle),
            voiceId,
            String(country),
            riveTrim,
            ins.creatorId,
            ins.system,
            ins.user_agent_origin || 'friend_create',
            exampleResponse
        ];
    } else {
        insertSql = `
            INSERT INTO bots
            (name, \`character\`, age, gender, zodiac, relationship_type, interests, interestsType, photoURL,
             characterTags, speakingStyle, voiceId, country, rive_avatar, creatorId, system, exampleResponse)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        values = [
            name,
            String(character),
            age,
            String(gender),
            zodiac,
            relationshipType,
            interests,
            interestsType,
            photoURL,
            characterTags,
            String(speakingStyle),
            voiceId,
            String(country),
            riveTrim,
            ins.creatorId,
            ins.system,
            exampleResponse
        ];
    }

    const ok = await query(insertSql, values);
    if (!ok) {
        return { ok: false, status: 500, json: { ok: false, msg: 'Failed to create agent' } };
    }

    const inserted = await getQuery('SELECT id FROM `bots` ORDER BY id DESC LIMIT 1', []);
    const newId = inserted?.[0]?.id;
    const agent = newId ? await fetchAgentWithOwner(newId) : null;

    return {
        ok: true,
        status: 201,
        json: { contractVersion: '2', ok: true, agent }
    };
}

async function updateAgent(agentId, body) {
    const rows = await getQuery('SELECT * FROM `bots` WHERE id = ? LIMIT 1', [agentId]);
    if (!rows?.length) {
        return { ok: false, status: 404, json: { ok: false, msg: 'Agent not found' } };
    }

    const mapped = panelAgentBodyToDb(body, { existingRow: rows[0] });
    if (mapped.error) {
        return { ok: false, status: 400, json: { ok: false, msg: mapped.error } };
    }
    if (mapped.fields.length === 0) {
        return { ok: false, status: 400, json: { ok: false, msg: 'No supported fields to update' } };
    }

    const sql = `UPDATE \`bots\` SET ${mapped.fields.join(', ')} WHERE id = ? LIMIT 1`;
    const ok = await query(sql, [...mapped.values, agentId]);
    if (!ok) {
        return { ok: false, status: 500, json: { ok: false, msg: 'Update failed' } };
    }

    const agent = await fetchAgentWithOwner(agentId);
    return {
        ok: true,
        status: 200,
        json: { contractVersion: '2', ok: true, agent }
    };
}

async function deleteAgent(agentId) {
    const rows = await getQuery('SELECT id, system FROM `bots` WHERE id = ? LIMIT 1', [agentId]);
    if (!rows?.length) {
        return { ok: false, status: 404, json: { ok: false, msg: 'Agent not found' } };
    }

    const ok = await query('DELETE FROM `bots` WHERE id = ? LIMIT 1', [agentId]);
    if (!ok) {
        return { ok: false, status: 500, json: { ok: false, msg: 'Delete failed' } };
    }

    return {
        ok: true,
        status: 200,
        json: { contractVersion: '2', ok: true, deletedId: String(agentId) }
    };
}

async function buildAgentsAnalyseSummary() {
    const totalRows = await getQuery('SELECT COUNT(*) AS total FROM `bots`', []);
    const totalRow = Array.isArray(totalRows) ? totalRows[0] : totalRows;

    const bySystemRows = await getQuery(
        'SELECT system, COUNT(*) AS cnt FROM `bots` GROUP BY system',
        []
    );
    const bySystemList = Array.isArray(bySystemRows) ? bySystemRows : bySystemRows ? [bySystemRows] : [];

    const byType = { custom: 0, catalog: 0, template: 0, unknown: 0 };
    for (const r of bySystemList) {
        const s = Number(r.system);
        if (s === 0) byType.custom = Number(r.cnt) || 0;
        else if (s === 1) byType.catalog = Number(r.cnt) || 0;
        else if (s === 2) byType.template = Number(r.cnt) || 0;
        else byType.unknown += Number(r.cnt) || 0;
    }

    let newAgentsToday = 0;
    if (await botsHasCreatedAtColumn()) {
        const todayRows = await getQuery(
            `
            SELECT COUNT(*) AS cnt FROM \`bots\`
            WHERE created_at IS NOT NULL
              AND DATE(CONVERT_TZ(created_at, '+00:00', '+03:00')) = DATE(
                  CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')
              )
            `,
            []
        );
        const todayRow = Array.isArray(todayRows) ? todayRows[0] : todayRows;
        newAgentsToday = Number(todayRow?.cnt) || 0;
    }

    const ownedRows = await getQuery(
        `SELECT COUNT(*) AS cnt FROM \`bots\` WHERE system = 0 AND creatorId IS NOT NULL AND creatorId != '0'`,
        []
    );
    const ownedRow = Array.isArray(ownedRows) ? ownedRows[0] : ownedRows;

    return {
        totalAgents: Number(totalRow?.total) || 0,
        newAgentsToday,
        byType,
        withUserOwner: Number(ownedRow?.cnt) || 0
    };
}

module.exports = {
    listAgents,
    listAgentsByOwner,
    fetchAgentWithOwner,
    createAgent,
    updateAgent,
    deleteAgent,
    buildAgentsAnalyseSummary
};
