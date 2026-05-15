const PANEL_TIMEZONE = process.env.PANEL_TIMEZONE || 'Europe/Istanbul';

function isGuestEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return email.endsWith('@guest.local') || email.startsWith('guest_');
}

function parseLastLoginsRaw(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t) return [];
        try {
            const parsed = JSON.parse(t);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') {
                return Object.values(parsed);
            }
        } catch {
            return [t];
        }
        return [t];
    }
    if (typeof raw === 'object') {
        return Object.values(raw);
    }
    return [];
}

function toDateOrNull(value) {
    if (value == null) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function extractLastLoginAt(lastLoginsRaw) {
    const entries = parseLastLoginsRaw(lastLoginsRaw);
    let latest = null;
    for (const entry of entries) {
        let candidate = null;
        if (entry == null) continue;
        if (typeof entry === 'string' || typeof entry === 'number') {
            candidate = toDateOrNull(entry);
        } else if (typeof entry === 'object') {
            candidate = toDateOrNull(
                entry.at || entry.date || entry.timestamp || entry.loginAt
            );
        }
        if (candidate && (!latest || candidate > latest)) {
            latest = candidate;
        }
    }
    return latest ? latest.toISOString() : null;
}

function mapVerificatedToStatus(verificated, email) {
    const v = verificated == null ? 1 : Number(verificated);
    if (Number.isNaN(v)) return 'active';
    if (v <= -1 || v === 2) return 'banned';
    if (v === 0) return 'inactive';
    if (isGuestEmail(email)) return 'active';
    return 'active';
}

function mapStatusToVerificated(status) {
    if (status == null) return undefined;
    const s = String(status).toLowerCase();
    if (s === 'active') return 1;
    if (s === 'inactive') return 0;
    if (s === 'banned') return 2;
    return undefined;
}

function parseMembershipsSummary(raw) {
    if (raw == null) return null;
    let arr = raw;
    if (typeof raw === 'string') {
        try {
            arr = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(arr)) return null;
    const active = arr.filter((m) => m && m.isActive === true);
    return {
        count: arr.length,
        activeCount: active.length,
        types: [...new Set(arr.map((m) => m?.type).filter(Boolean))]
    };
}

/**
 * DB users satırı → App Panel v2 PanelUser
 * @param {Record<string, unknown>} row
 */
function rowToPanelUser(row) {
    if (!row) return null;
    const id = row.id != null ? String(row.id) : null;
    if (!id) return null;

    const email = row.email != null ? String(row.email) : null;
    const country = row.country ?? row.counrty ?? null;

    return {
        id,
        email,
        displayName: row.username != null ? String(row.username) : null,
        phone: row.phoneNumber != null ? String(row.phoneNumber) : null,
        status: mapVerificatedToStatus(row.verificated, email),
        createdAt: row.accountCreatedDate
            ? toDateOrNull(row.accountCreatedDate)?.toISOString() ?? null
            : null,
        lastLoginAt: extractLastLoginAt(row.lastLogins),
        extras: {
            credential: row.credential ?? null,
            verificated: row.verificated ?? null,
            gender: row.gender ?? null,
            country: country != null ? String(country) : null,
            birthdate: row.birthdate
                ? toDateOrNull(row.birthdate)?.toISOString() ?? null
                : null,
            photoURL: row.photoURL ?? null,
            hobbies: row.hobbies ?? null,
            isGuest: isGuestEmail(email),
            membershipsSummary: parseMembershipsSummary(row.memberships)
        }
    };
}

/**
 * Panel PATCH gövdesi → users tablosu alanları
 * extras: gender, country, photoURL, hobbies (shallow merge)
 */
function panelPatchToDbFields(existingRow, body) {
    const fields = [];
    const values = [];

    if (body.displayName !== undefined) {
        fields.push('username = ?');
        values.push(body.displayName === null ? null : String(body.displayName));
    }
    if (body.email !== undefined) {
        fields.push('email = ?');
        values.push(body.email === null ? null : String(body.email));
    }
    if (body.phone !== undefined) {
        fields.push('phoneNumber = ?');
        values.push(body.phone === null ? null : String(body.phone));
    }
    if (body.status !== undefined) {
        const v = mapStatusToVerificated(body.status);
        if (v !== undefined) {
            fields.push('verificated = ?');
            values.push(v);
        }
    }

    const extras = body.extras;
    if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
        if (extras.gender !== undefined) {
            fields.push('gender = ?');
            values.push(extras.gender === null ? null : String(extras.gender));
        }
        if (extras.country !== undefined) {
            fields.push('country = ?');
            values.push(extras.country === null ? null : String(extras.country));
        }
        if (extras.photoURL !== undefined) {
            fields.push('photoURL = ?');
            values.push(extras.photoURL === null ? null : String(extras.photoURL));
        }
        if (extras.hobbies !== undefined) {
            const hobbiesVal =
                extras.hobbies == null
                    ? null
                    : typeof extras.hobbies === 'string'
                      ? extras.hobbies
                      : JSON.stringify(extras.hobbies);
            fields.push('hobbies = ?');
            values.push(hobbiesVal);
        }
    }

    return { fields, values, existingRow };
}

module.exports = {
    PANEL_TIMEZONE,
    rowToPanelUser,
    panelPatchToDbFields,
    extractLastLoginAt,
    isGuestEmail
};
