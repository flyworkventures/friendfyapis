// Kayıt (onboarding) tercih cevaplarını doğrular ve DB'ye yazılacak JSON'a çevirir.
// Flutter `userModel.onboardingAnswers` gönderir; bilinmeyen alanlar atılır,
// slug'lar ve uzunluklar sınırlandırılır.

const SLUG_RE = /^[a-z0-9_]{1,40}$/;
const MULTI_KEYS = ['shareTopics', 'chatStyle', 'selfTime', 'activities'];
const ANSWER_VALUES = new Set(['yes', 'no', 'skip']);
const GENDER_VALUES = new Set(['female', 'male', 'unspecified']);

function cleanSlug(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return SLUG_RE.test(s) ? s : null;
}

function cleanSlugList(v) {
    if (!Array.isArray(v)) return undefined;
    const out = [];
    for (const item of v) {
        const s = cleanSlug(item);
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= 12) break;
    }
    return out;
}

/**
 * @param {object} parsedUser signup gövdesindeki userModel
 * @returns {string|null} JSON string ya da kaydedilecek bir şey yoksa null
 */
function serializeOnboardingAnswers(parsedUser) {
    if (!parsedUser || typeof parsedUser !== 'object') return null;
    const raw =
        parsedUser.onboardingAnswers && typeof parsedUser.onboardingAnswers === 'object'
            ? parsedUser.onboardingAnswers
            : {};
    const out = {};

    const expectation = cleanSlug(raw.aiPartnerExpectation ?? parsedUser.aiPartnerExpectation);
    if (expectation) out.aiPartnerExpectation = expectation;

    const preferredTime = cleanSlug(raw.aiPreferredTime ?? parsedUser.aiPreferredTime);
    if (preferredTime) out.aiPreferredTime = preferredTime;

    if (GENDER_VALUES.has(raw.companionGender)) out.companionGender = raw.companionGender;

    if (typeof raw.companionName === 'string') {
        const name = raw.companionName.trim().slice(0, 25);
        if (name) out.companionName = name;
    }

    // Onboarding'de eşleşen karakter; companionName bu karaktere takma ad olur.
    const agentId = Number(raw.companionAgentId);
    if (Number.isInteger(agentId) && agentId > 0) out.companionAgentId = agentId;

    for (const key of MULTI_KEYS) {
        const list = cleanSlugList(raw[key]);
        if (list && list.length) out[key] = list;
    }

    if (raw.statements && typeof raw.statements === 'object' && !Array.isArray(raw.statements)) {
        const statements = {};
        for (const [k, v] of Object.entries(raw.statements)) {
            const key = cleanSlug(k);
            if (key && ANSWER_VALUES.has(v)) statements[key] = v;
            if (Object.keys(statements).length >= 12) break;
        }
        if (Object.keys(statements).length) out.statements = statements;
    }

    return Object.keys(out).length ? JSON.stringify(out) : null;
}

function parseOnboardingAnswers(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const v = JSON.parse(raw);
            return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
        } catch (_) {
            return null;
        }
    }
    return null;
}

/**
 * Kullanıcının bu karaktere verdiği takma ad (yoksa null).
 * @param {unknown} rawAnswers users.onboarding_answers
 * @param {number|string} botId
 */
function companionNicknameFor(rawAnswers, botId) {
    const a = parseOnboardingAnswers(rawAnswers);
    if (!a) return null;
    const name = typeof a.companionName === 'string' ? a.companionName.trim() : '';
    if (!name) return null;
    return Number(a.companionAgentId) === Number(botId) ? name.slice(0, 25) : null;
}

module.exports = {
    serializeOnboardingAnswers,
    parseOnboardingAnswers,
    companionNicknameFor,
};
