const axios = require('axios');
const { getQuery } = require('../../db');

const SUPPORTED_LANGS = ['tr', 'en', 'de', 'fr', 'pt', 'it', 'es', 'zh', 'ja', 'ru', 'hi', 'ko'];

const LANG_NAMES = {
    tr: 'Turkish',
    en: 'English',
    de: 'German',
    fr: 'French',
    pt: 'Portuguese',
    it: 'Italian',
    es: 'Spanish',
    zh: 'Chinese',
    ja: 'Japanese',
    ru: 'Russian',
    hi: 'Hindi',
    ko: 'Korean'
};

const translationCache = new Map();

let interestCatalogCache = null;

function normalizeLang(raw) {
    const lang = String(raw || 'en').toLowerCase().split(/[-_]/)[0];
    return SUPPORTED_LANGS.includes(lang) ? lang : 'en';
}

function parseArrayLike(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map((v) => String(v).trim()).filter(Boolean);
                }
            } catch (_) {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    return [String(value)];
}

function pickInterestLabel(row, lang) {
    const key = `interest_${lang}`;
    if (row[key]) return row[key];
    return row.interest_en || row.interest_tr || row.slug;
}

async function loadInterestCatalog() {
    if (interestCatalogCache) return interestCatalogCache;

    const rows = await getQuery(
        'SELECT slug, interest_tr, interest_en, interest_de, interest_fr, interest_pt, interest_it, interest_zh, interest_ja, interest_ru, interest_hi, interest_ko FROM `interests` ORDER BY sort_order ASC, id ASC',
        []
    );

    const slugToLabels = new Map();
    const labelToSlug = new Map();

    for (const row of rows || []) {
        const slug = String(row.slug || '').trim();
        if (!slug) continue;
        const labels = {};
        for (const lang of SUPPORTED_LANGS) {
            const label = pickInterestLabel(row, lang);
            if (label) labels[lang] = label;
        }
        slugToLabels.set(slug, labels);
        for (const lang of SUPPORTED_LANGS) {
            const label = labels[lang];
            if (!label) continue;
            const mapKey = `${lang}:${label.toLowerCase()}`;
            labelToSlug.set(mapKey, slug);
        }
    }

    interestCatalogCache = { slugToLabels, labelToSlug };
    return interestCatalogCache;
}

function resolveInterestLabel(catalog, value, lang) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;

    const slugLabels = catalog.slugToLabels.get(trimmed);
    if (slugLabels) {
        return slugLabels[lang] || slugLabels.en || slugLabels.tr || trimmed;
    }

    for (const code of SUPPORTED_LANGS) {
        const slug = catalog.labelToSlug.get(`${code}:${trimmed.toLowerCase()}`);
        if (slug) {
            const labels = catalog.slugToLabels.get(slug) || {};
            return labels[lang] || labels.en || labels.tr || trimmed;
        }
    }

    return trimmed;
}

function looksTurkish(text) {
    if (/[ğıüşöçİĞÜŞÖÇ]/.test(text)) return true;
    return /\b(ve|bir|için|ile|olan|kişilik|enerjik|yardımsever)\b/i.test(text);
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value != null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return '';
}

function textMatchesLang(text, lang) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    if (lang === 'tr') return looksTurkish(trimmed);
    if (lang === 'en') return !looksTurkish(trimmed);
    return false;
}

function englishCharacterFallback(gender) {
    const g = String(gender || '').toLowerCase();
    if (g.includes('kad') || g.includes('female') || g === 'f') {
        return 'Has a striking, energetic and exciting personality. Helpful and sensitive, a game enthusiast and technology lover.';
    }
    return 'Charismatic, confident and attentive. Warm, engaging, and keeps conversations flowing naturally.';
}

function turkishCharacterFallback(gender) {
    const g = String(gender || '').toLowerCase();
    if (g.includes('kad') || g.includes('female') || g === 'f') {
        return 'Göz alıcı, enerjik ve heyecan verici bir kişiliğe sahip. Yardımsever ve duyarlı; oyun meraklısı ve teknoloji aşığı.';
    }
    return 'Karizmatik, kendinden emin ve ilgili. Sıcak, samimi ve sohbeti doğal bir şekilde ilerletir.';
}

function englishSpeakingStyleFallback(gender) {
    const g = String(gender || '').toLowerCase();
    if (g.includes('kad') || g.includes('female') || g === 'f') {
        return 'Speaks in a cheerful, energetic tone. Warm and engaging, sometimes chatty and playful.';
    }
    return 'Speaks in a clear, informative tone. Shares knowledge with a touch of humor when it fits.';
}

function turkishSpeakingStyleFallback(gender) {
    const g = String(gender || '').toLowerCase();
    if (g.includes('kad') || g.includes('female') || g === 'f') {
        return 'Neşeli ve enerjik bir tonda konuşur. Sıcak ve samimi; bazen sohbetçi ve oyuncu.';
    }
    return 'Açık ve bilgilendirici bir tonda konuşur. Uygun olduğunda hafif bir mizahla bilgi paylaşır.';
}

function characterFallback(gender, lang) {
    return lang === 'tr'
        ? turkishCharacterFallback(gender)
        : englishCharacterFallback(gender);
}

function speakingStyleFallback(gender, lang) {
    return lang === 'tr'
        ? turkishSpeakingStyleFallback(gender)
        : englishSpeakingStyleFallback(gender);
}

async function translateAgentText(text, targetLang) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';

    const normalizedLang = normalizeLang(targetLang);
    if (textMatchesLang(trimmed, normalizedLang)) return trimmed;

    const cacheKey = `${normalizedLang}:${trimmed}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return trimmed;

    const targetName = LANG_NAMES[normalizedLang] || normalizedLang;
    const model = process.env.AGENT_TRANSLATION_MODEL || process.env.CHAT_REPLY_MODEL || 'gpt-4o-mini';

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model,
                temperature: 0.2,
                max_tokens: 220,
                messages: [
                    {
                        role: 'system',
                        content:
                            `Translate the following AI character description into ${targetName}. ` +
                            'Preserve tone, personality, and length. Return only the translation.'
                    },
                    { role: 'user', content: trimmed }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 12000
            }
        );

        const translated = response.data?.choices?.[0]?.message?.content?.trim();
        if (translated) {
            translationCache.set(cacheKey, translated);
            return translated;
        }
    } catch (error) {
        console.warn('[agentLocalization] translate failed:', error.message);
    }

    return trimmed;
}

function pickLocalizedField(row, prefix, lang) {
    const localizedCol = row[`${prefix}_${lang}`];
    const en = row[`${prefix}_en`];
    const tr = row[`${prefix}_tr`];
    const base = String(row[prefix] || '').trim();

    if (localizedCol && String(localizedCol).trim()) {
        return String(localizedCol).trim();
    }
    if (lang === 'tr' && tr && String(tr).trim()) return String(tr).trim();
    if (lang === 'en' && en && String(en).trim()) return String(en).trim();
    if (base && textMatchesLang(base, lang)) return base;

    return firstNonEmpty(
        en,
        base && !looksTurkish(base) ? base : null,
        tr,
        base
    );
}

function pickSpeakingStyleSync(row, lang) {
    const picked = pickLocalizedField(row, 'speakingStyle', lang);
    if (picked && textMatchesLang(picked, lang)) return picked;
    if (lang === 'tr' && picked && !looksTurkish(picked)) {
        return speakingStyleFallback(row.gender, lang);
    }
    if (picked) return picked;
    return speakingStyleFallback(row.gender, lang);
}

function pickCharacterSync(row, lang) {
    const picked = pickLocalizedField(row, 'character', lang);
    if (picked && textMatchesLang(picked, lang)) return picked;
    if (lang === 'tr' && picked && !looksTurkish(picked)) {
        return characterFallback(row.gender, lang);
    }
    if (picked) return picked;
    return characterFallback(row.gender, lang);
}

async function pickSpeakingStyle(row, lang, { translate = false } = {}) {
    const picked = pickLocalizedField(row, 'speakingStyle', lang);
    if (picked && textMatchesLang(picked, lang)) return picked;
    if (translate && picked) {
        const translated = await translateAgentText(picked, lang);
        if (translated) return translated;
    }
    if (lang === 'tr' && picked && !looksTurkish(picked)) {
        return speakingStyleFallback(row.gender, lang);
    }
    if (picked) return picked;
    return speakingStyleFallback(row.gender, lang);
}

async function pickCharacter(row, lang, { translate = false } = {}) {
    const picked = pickLocalizedField(row, 'character', lang);
    if (picked && textMatchesLang(picked, lang)) return picked;
    if (translate && picked) {
        const translated = await translateAgentText(picked, lang);
        if (translated) return translated;
    }
    if (lang === 'tr' && picked && !looksTurkish(picked)) {
        return characterFallback(row.gender, lang);
    }
    if (picked) return picked;
    return characterFallback(row.gender, lang);
}

async function localizeAgentRow(row, lang, options = {}) {
    const normalizedLang = normalizeLang(lang);
    const translate = options.translate === true;
    const catalog = await loadInterestCatalog();
    const out = { ...row };

    const slugs = parseArrayLike(row.interestsType);
    if (slugs.length > 0) {
        const labels = slugs.map((slug) => resolveInterestLabel(catalog, slug, normalizedLang));
        out.interests = JSON.stringify(labels);
    } else {
        const rawItems = parseArrayLike(row.interests);
        if (rawItems.length > 0) {
            const labels = rawItems.map((item) =>
                resolveInterestLabel(catalog, item, normalizedLang)
            );
            out.interests = JSON.stringify(labels);
        }
    }

    if (translate) {
        out.character = await pickCharacter(row, normalizedLang, { translate: true });
        out.speakingStyle = await pickSpeakingStyle(row, normalizedLang, { translate: true });
    } else {
        out.character = pickCharacterSync(row, normalizedLang);
        out.speakingStyle = pickSpeakingStyleSync(row, normalizedLang);
    }
    return out;
}

async function localizeAgents(rows, lang, options = {}) {
    if (!lang || !rows || !rows.length) return rows;
    const localized = [];
    for (const row of rows) {
        localized.push(await localizeAgentRow(row, lang, options));
    }
    return localized;
}

module.exports = {
    normalizeLang,
    localizeAgentRow,
    localizeAgents
};
