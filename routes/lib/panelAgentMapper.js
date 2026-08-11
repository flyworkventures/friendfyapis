const SYSTEM_LABELS = {
    0: 'custom',
    1: 'catalog',
    2: 'template'
};

function toPhotoUrlArray(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.filter((v) => typeof v === 'string' && v.trim() !== '');
    }
    if (typeof rawValue !== 'string') return [];
    const trimmed = rawValue.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((v) => typeof v === 'string' && v.trim() !== '');
            }
        } catch {
            /* tek URL */
        }
    }
    return [trimmed];
}

function parseJsonField(raw, fallback = null) {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t) return fallback;
        try {
            return JSON.parse(t);
        } catch {
            return raw;
        }
    }
    return raw;
}

function systemToAgentType(system) {
    const n = Number(system);
    return SYSTEM_LABELS[n] ?? 'unknown';
}

function agentTypeToSystem(agentType) {
    if (agentType == null || agentType === '') return undefined;
    const t = String(agentType).toLowerCase();
    if (t === 'custom' || t === 'user') return 0;
    if (t === 'catalog' || t === 'system') return 1;
    if (t === 'template') return 2;
    const n = Number(agentType);
    if (n === 0 || n === 1 || n === 2) return n;
    return undefined;
}

function normalizeOwnerId(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    if (s === '0' || s === 'null' || s === 'undefined') return null;
    return s;
}

function buildOwnerFromJoin(botRow, userRow) {
    const creatorId = normalizeOwnerId(botRow?.creatorId);
    if (!creatorId) {
        return {
            id: null,
            email: null,
            displayName: 'Sistem / katalog',
            isSystemOwner: true
        };
    }
    if (!userRow) {
        return {
            id: creatorId,
            email: null,
            displayName: null,
            isSystemOwner: false,
            ownerMissing: true
        };
    }
    return {
        id: String(userRow.id),
        email: userRow.email ?? null,
        displayName: userRow.username ?? null,
        isSystemOwner: false
    };
}

/**
 * bots (+ opsiyonel users join) → PanelAgent
 */
function rowToPanelAgent(botRow, userRow = null) {
    if (!botRow || botRow.id == null) return null;
    const sys = Number(botRow.system);
    const photoURLs = toPhotoUrlArray(botRow.photoURL);

    return {
        id: String(botRow.id),
        name: botRow.name != null ? String(botRow.name) : null,
        agentType: systemToAgentType(sys),
        system: sys,
        status: 'active',
        owner: buildOwnerFromJoin(botRow, userRow),
        createdAt: botRow.created_at
            ? new Date(botRow.created_at).toISOString()
            : null,
        extras: {
            character: botRow.character ?? null,
            age: botRow.age != null ? Number(botRow.age) : null,
            gender: botRow.gender ?? null,
            zodiac: botRow.zodiac ?? null,
            relationshipType: botRow.relationship_type ?? null,
            country: botRow.country ?? null,
            voiceId: botRow.voiceId ?? null,
            speakingStyle: botRow.speakingStyle ?? null,
            exampleResponse: botRow.exampleResponse ?? null,
            riveAvatar: botRow.rive_avatar ?? null,
            photoURLs,
            photoURL: photoURLs[0] ?? null,
            interests: parseJsonField(botRow.interests, []),
            interestsType: parseJsonField(botRow.interestsType, []),
            characterTags: parseJsonField(botRow.characterTags, []),
            userAgentOrigin: botRow.user_agent_origin ?? null,
            creatorId: botRow.creatorId != null ? String(botRow.creatorId) : null
        }
    };
}

function serializePhotoUrlsFromPanelBody(body) {
    const incoming = body.photoURLs ?? body.photos ?? body.photoURL;
    const normalized = toPhotoUrlArray(incoming);
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
            } catch {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    return [];
}

/**
 * Panel POST/PATCH gövdesi → INSERT/UPDATE alanları
 */
function panelAgentBodyToDb(body, { isCreate = false, existingRow = null } = {}) {
    const out = { fields: [], values: [] };

    const set = (col, val) => {
        out.fields.push(`${col} = ?`);
        out.values.push(val);
    };

    if (body.name !== undefined) set('name', body.name === null ? '' : String(body.name));
    if (body.character !== undefined || body.extras?.character !== undefined) {
        const v = body.character ?? body.extras?.character;
        set('`character`', v == null ? '' : String(v));
    }
    if (body.age !== undefined || body.extras?.age !== undefined) {
        const v = body.age ?? body.extras?.age;
        set('age', Number(v) || 18);
    }
    if (body.gender !== undefined || body.extras?.gender !== undefined) {
        const v = body.gender ?? body.extras?.gender;
        set('gender', v == null ? 'female' : String(v));
    }
    if (
        body.zodiac !== undefined ||
        body.zodiacSign !== undefined ||
        body.extras?.zodiac !== undefined
    ) {
        const v = body.zodiac ?? body.zodiacSign ?? body.extras?.zodiac;
        const t = v == null ? null : String(v).trim().toLowerCase();
        set('zodiac', t === '' ? null : t);
    }
    if (
        body.relationship_type !== undefined ||
        body.relationshipType !== undefined ||
        body.extras?.relationshipType !== undefined
    ) {
        const v =
            body.relationship_type ??
            body.relationshipType ??
            body.extras?.relationshipType;
        const t = v == null ? null : String(v).trim().toLowerCase();
        set('relationship_type', t === '' ? null : t);
    }
    if (body.country !== undefined || body.extras?.country !== undefined) {
        const v = body.country ?? body.extras?.country;
        set('country', v == null ? '' : String(v));
    }
    if (body.voiceId !== undefined || body.extras?.voiceId !== undefined) {
        const v = body.voiceId ?? body.extras?.voiceId;
        set('voiceId', v == null ? '' : String(v));
    }
    if (body.speakingStyle !== undefined || body.extras?.speakingStyle !== undefined) {
        const v = body.speakingStyle ?? body.extras?.speakingStyle;
        set('speakingStyle', v == null ? '' : String(v));
    }
    if (body.exampleResponse !== undefined || body.extras?.exampleResponse !== undefined) {
        const v = body.exampleResponse ?? body.extras?.exampleResponse;
        set('exampleResponse', v == null ? null : String(v));
    }
    if (
        body.rive_avatar !== undefined ||
        body.riveAvatar !== undefined ||
        body.extras?.riveAvatar !== undefined
    ) {
        const raw = body.rive_avatar ?? body.riveAvatar ?? body.extras?.riveAvatar;
        const t = raw == null ? null : String(raw).trim();
        set('rive_avatar', t === '' ? null : t);
    }
    if (
        body.photoURL !== undefined ||
        body.photoURLs !== undefined ||
        body.extras?.photoURL !== undefined ||
        body.extras?.photoURLs !== undefined
    ) {
        set('photoURL', serializePhotoUrlsFromPanelBody(body.extras ? { ...body, ...body.extras } : body));
    }
    if (body.interests !== undefined || body.extras?.interests !== undefined) {
        set('interests', JSON.stringify(normalizeArrayLike(body.interests ?? body.extras?.interests)));
    }
    if (body.interestsType !== undefined || body.extras?.interestsType !== undefined) {
        set(
            'interestsType',
            JSON.stringify(normalizeArrayLike(body.interestsType ?? body.extras?.interestsType))
        );
    }
    if (body.characterTags !== undefined || body.extras?.characterTags !== undefined) {
        set(
            'characterTags',
            JSON.stringify(normalizeArrayLike(body.characterTags ?? body.extras?.characterTags))
        );
    }

    if (isCreate) {
        let sys = agentTypeToSystem(body.agentType);
        if (sys === undefined && body.system !== undefined) {
            sys = Number(body.system);
        }
        if (sys === undefined || Number.isNaN(sys)) sys = 1;

        const ownerId =
            normalizeOwnerId(body.ownerId ?? body.creatorId ?? body.owner?.id) ??
            (sys === 0 ? null : '0');
        if (sys === 0 && !ownerId) {
            return { error: 'ownerId is required for custom agents (system 0)' };
        }

        out.insert = {
            system: sys,
            creatorId: sys === 0 ? ownerId : ownerId || '0',
            user_agent_origin:
                sys === 0 ? body.userAgentOrigin || body.user_agent_origin || 'friend_create' : null
        };
    } else if (body.ownerId !== undefined || body.creatorId !== undefined) {
        const ownerId = normalizeOwnerId(body.ownerId ?? body.creatorId);
        if (ownerId) set('creatorId', ownerId);
    }

    if (body.agentType !== undefined || body.system !== undefined) {
        let sys = agentTypeToSystem(body.agentType);
        if (sys === undefined && body.system !== undefined) sys = Number(body.system);
        if (sys !== undefined && !Number.isNaN(sys)) set('system', sys);
    }

    return out;
}

function validatePanelAgentCreate(body) {
    const name = body?.name ?? body?.displayName;
    if (!name || String(name).trim() === '') {
        return { ok: false, msg: 'name is required' };
    }
    let sys = agentTypeToSystem(body.agentType);
    if (sys === undefined && body.system !== undefined) sys = Number(body.system);
    if (sys === undefined || Number.isNaN(sys)) sys = 1;

    const voiceId = body.voiceId ?? body.extras?.voiceId;
    if (sys === 0 && (!voiceId || String(voiceId).trim() === '')) {
        return { ok: false, msg: 'voiceId is required for custom agents' };
    }
    if ((sys === 1 || sys === 2) && (!voiceId || String(voiceId).trim() === '')) {
        return { ok: false, msg: 'voiceId is required for catalog/template agents' };
    }

    const ownerId = normalizeOwnerId(body.ownerId ?? body.creatorId ?? body.owner?.id);
    if (sys === 0 && !ownerId) {
        return { ok: false, msg: 'ownerId is required for custom agents' };
    }

    const photos = toPhotoUrlArray(
        body.photoURLs ?? body.photoURL ?? body.extras?.photoURLs
    );
    if (photos.length !== 3) {
        return {
            ok: false,
            code: 'PHOTOS_COUNT_REQUIRED',
            msg: 'Her karakterin tam 3 fotoğrafı olmalıdır'
        };
    }

    const rive = body.riveAvatar ?? body.rive_avatar ?? body.extras?.riveAvatar;
    if (!rive || String(rive).trim() === '') {
        return {
            ok: false,
            code: 'RIVE_REQUIRED',
            msg: 'Her karakter için Rive (riveAvatar) gerekir'
        };
    }

    return { ok: true, system: sys };
}

module.exports = {
    rowToPanelAgent,
    panelAgentBodyToDb,
    validatePanelAgentCreate,
    serializePhotoUrlsFromPanelBody,
    normalizeArrayLike,
    systemToAgentType,
    agentTypeToSystem,
    toPhotoUrlArray,
    normalizeOwnerId
};
