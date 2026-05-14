const crypto = require('crypto');

const ALLOWED_MEMBERSHIP_TYPES = new Set(['paid', 'trial', 'freeTrial']);

/** Sunucunun cihaz denemesinde kullandığı productId (istemci free_trial_${id} gönderse bile sync’te silinir). */
const DEVICE_TRIAL_PRODUCT_ID =
    process.env.DEVICE_TRIAL_MEMBERSHIP_PRODUCT_ID || 'friendify_device_free_trial_v1';

const TRIAL_DAYS = Math.min(
    365,
    Math.max(1, Number(process.env.DEVICE_TRIAL_DAYS) || 3)
);

function getDeviceTrialPepper() {
    return process.env.DEVICE_TRIAL_PEPPER || process.env.JWT_SECRET || 'key';
}

function normalizeDeviceFingerprint(raw) {
    if (raw == null) return '';
    return String(raw).trim();
}

/** Ham cihaz id’si loglanmaz; yalnızca SHA-256 (pepper ile) saklanır. */
function hashDeviceFingerprint(raw) {
    const normalized = normalizeDeviceFingerprint(raw);
    if (!normalized || normalized.length < 8) {
        return null;
    }
    return crypto
        .createHash('sha256')
        .update(`${normalized}|${getDeviceTrialPepper()}`, 'utf8')
        .digest('hex');
}

function normalizeIsoDate(value, { nullable = false } = {}) {
    if (value === null || value === undefined || value === '') {
        if (nullable) return null;
        return { error: 'invalid_date' };
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { error: 'invalid_date' };
    }
    return date.toISOString();
}

function normalizeMembership(membership) {
    if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
        return { error: 'invalid_membership' };
    }
    const normalizedStartDate = normalizeIsoDate(membership.startDate);
    if (normalizedStartDate?.error) {
        return { error: 'startDate must be a valid ISO date' };
    }
    const normalizedEndDate = normalizeIsoDate(membership.endDate, { nullable: true });
    if (normalizedEndDate?.error) {
        return { error: 'endDate must be a valid ISO date or null' };
    }
    const normalizedPurchasedAt = normalizeIsoDate(membership.purchasedAt, {
        nullable: true
    });
    if (normalizedPurchasedAt?.error) {
        return { error: 'purchasedAt must be a valid ISO date or null' };
    }
    if (!membership.productId || typeof membership.productId !== 'string') {
        return { error: 'productId is required and must be a string' };
    }
    if (!ALLOWED_MEMBERSHIP_TYPES.has(membership.type)) {
        return { error: 'type must be one of: paid, trial, freeTrial' };
    }
    if (typeof membership.isActive !== 'boolean') {
        return { error: 'isActive must be a boolean' };
    }
    return {
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        productId: membership.productId,
        type: membership.type,
        isActive: membership.isActive,
        purchasedAt: normalizedPurchasedAt
    };
}

function parseMembershipsArray(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw);
            return Array.isArray(p) ? p : [];
        } catch {
            return [];
        }
    }
    return [];
}

function isFreeTrialEntry(m) {
    if (!m || typeof m !== 'object') return false;
    const t = String(m.type || '')
        .toLowerCase()
        .replace(/_/g, '');
    return t === 'freetrial';
}

function stripClientFreeTrials(clientArr) {
    return clientArr.filter((m) => !isFreeTrialEntry(m));
}

function extractDbFreeTrials(dbArr) {
    return dbArr.filter(isFreeTrialEntry);
}

/**
 * İstemciden gelen freeTrial kayıtlarına güvenilmez; yalnızca DB’de zaten kayıtlı denemeler korunur.
 * @param {unknown} dbMembershipsRaw users.memberships
 * @param {object[]} clientNormalizedArray normalizeMembership ile geçirilmiş dizi
 */
function mergeMembershipsDbWithClient(dbMembershipsRaw, clientNormalizedArray) {
    const dbArr = parseMembershipsArray(dbMembershipsRaw);
    const dbTrials = extractDbFreeTrials(dbArr);
    const clientNoTrial = stripClientFreeTrials(clientNormalizedArray);
    return [...clientNoTrial, ...dbTrials];
}

function buildDeviceFreeTrialMembership() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + TRIAL_DAYS);
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        productId: DEVICE_TRIAL_PRODUCT_ID,
        type: 'freeTrial',
        isActive: true,
        purchasedAt: start.toISOString()
    };
}

/** DB’deki deneme satırını (aynı productId) kaldırıp yenisiyle değiştirir. */
function replaceServerDeviceTrial(dbArr, newTrial) {
    const rest = dbArr.filter(
        (m) =>
            !(
                isFreeTrialEntry(m) &&
                String(m.productId || '') === DEVICE_TRIAL_PRODUCT_ID
            )
    );
    rest.push(newTrial);
    return rest;
}

module.exports = {
    ALLOWED_MEMBERSHIP_TYPES,
    DEVICE_TRIAL_PRODUCT_ID,
    TRIAL_DAYS,
    normalizeDeviceFingerprint,
    hashDeviceFingerprint,
    normalizeMembership,
    parseMembershipsArray,
    mergeMembershipsDbWithClient,
    buildDeviceFreeTrialMembership,
    replaceServerDeviceTrial,
    isFreeTrialEntry
};
