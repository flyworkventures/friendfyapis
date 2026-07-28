'use strict';

const jwt = require('jsonwebtoken');
const { getQuery, query } = require('../db');
const { buildSystemPrompt } = require('../routes/lib/chatReplyService');
const { localizeName } = require('../routes/lib/nameLocalization');
const { hasActivePremiumAccess } = require('../routes/lib/dailyUsageLimits');

const JWT_SECRET = process.env.JWT_SECRET || 'key';

// Sesli/görüntülü aramada isim yerelleştirmesi için desteklenen diller.
const LOCALIZE_LANGS = ['tr', 'en', 'de', 'fr', 'pt', 'it', 'es', 'zh', 'ja', 'ru', 'hi', 'ko'];

/**
 * Sistem karakterleri (system 1/2) için isimlerin dile göre yerelleştirilmiş
 * haritasını üretir; kullanıcı karakterlerinde her dilde ham isim döner.
 * Greeting (canned) bu haritadan `names[lang]` ile doğru ismi seçer.
 */
function buildLocalizedNames(row) {
  const sys = Number(row.system);
  const isSystem = sys === 1 || sys === 2;
  const names = {};
  for (const l of LOCALIZE_LANGS) {
    names[l] = isSystem ? localizeName(row.name, l) : row.name;
  }
  return names;
}

function mapBotRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    voiceId: row.voiceId,
    gender: row.gender,
    character: row.character,
    speakingStyle: row.speakingStyle,
    interests: row.interests,
    interestsType: row.interestsType,
    characterTags: row.characterTags,
    job: row.job_tr || row.job_en || '',
    mainPrompt: row.system || '',
    names: buildLocalizedNames(row),
    explanation: row.character || '',
    features: [],
  };
}

async function authenticateRealtime(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token =
      url.searchParams.get('token') ||
      req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return { success: false, error: 'No token' };

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return { success: false, error: 'Invalid token' };
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) return { success: false, error: 'Invalid token payload' };

    const rawBotId =
      url.searchParams.get('botId') || url.searchParams.get('consultantId');
    const botId = parseInt(rawBotId, 10);
    if (!botId || botId <= 0) return { success: false, error: 'Invalid botId' };

    // Sesli/görüntülü arama: premium/trial gerekir.
    // Bypass:
    //  - Onboarding deneme (`demo=1` + callMode=video)
    //  - Geçici test: ALLOW_FREE_CALLS=true (.env)
    const rawModeEarly = (url.searchParams.get('callMode') || url.searchParams.get('mode') || '')
      .toLowerCase()
      .trim();
    const isDemoVideo =
      rawModeEarly === 'video' &&
      (url.searchParams.get('demo') === '1' ||
        url.searchParams.get('demo') === 'true');
    const allowFreeCalls =
      String(process.env.ALLOW_FREE_CALLS || '').toLowerCase() === 'true';
    if (!isDemoVideo && !allowFreeCalls) {
      const users = await getQuery(
        'SELECT memberships FROM `users` WHERE id = ? LIMIT 1',
        [userId]
      );
      if (!users?.[0] || !hasActivePremiumAccess(users[0].memberships)) {
        return { success: false, error: 'Premium required' };
      }
    }

    const rawLang = (url.searchParams.get('lang') || '').toLowerCase().trim();
    const clientLang = /^[a-z]{2}$/.test(rawLang) ? rawLang : null;

    const rawMode = rawModeEarly;
    const callMode = rawMode === 'voice' || rawMode === 'video' ? rawMode : null;

    return { success: true, userId, consultantId: botId, botId, clientLang, callMode };
  } catch (_) {
    return { success: false, error: 'Auth failed' };
  }
}

async function getBotById(botId, userId = null) {
  const rows = await getQuery('SELECT * FROM `bots` WHERE id = ? LIMIT 1', [botId]);
  const row = rows?.[0];
  if (!row) return null;

  const sys = Number(row.system);
  if (userId && (sys === 1 || sys === 2)) {
    try {
      const overrides = await getQuery(
        'SELECT * FROM `bot_catalog_overrides` WHERE user_id = ? AND bot_id = ? LIMIT 1',
        [userId, botId]
      );
      const o = overrides?.[0];
      if (o) {
        if (o.voiceId != null && String(o.voiceId).trim()) {
          row.voiceId = o.voiceId;
        }
        if (o.name != null && String(o.name).trim()) row.name = o.name;
        if (o.character != null && String(o.character).trim()) {
          row.character = o.character;
        }
      }
    } catch (e) {
      if (!(e && e.code === 'ER_NO_SUCH_TABLE')) {
        console.warn('[realtime] catalog override lookup failed:', e?.message || e);
      }
    }
  }

  return mapBotRow(row);
}

async function getUserById(userId) {
  const rows = await getQuery(
    'SELECT id, username, email, country FROM `users` WHERE id = ? LIMIT 1',
    [userId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username || row.email || '',
    nativeLang: row.country || null,
    generalProfile: null,
    generalPsychologicalProfile: null,
  };
}

async function getOrCreateChat(userId, botId) {
  let rows = await getQuery(
    'SELECT * FROM `coversations` WHERE userId = ? AND botId = ? LIMIT 1',
    [userId, botId]
  );
  if (rows?.[0]?.id) {
    return { chatId: rows[0].id };
  }
  await query(
    'INSERT INTO `coversations` (`userId`, `botId`, `current_chat_state`, `lastMessage`, `last_message_at`, `started_at`) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, botId, 'normal', null, null, null]
  );
  rows = await getQuery(
    'SELECT * FROM `coversations` WHERE userId = ? AND botId = ? LIMIT 1',
    [userId, botId]
  );
  return { chatId: rows?.[0]?.id ?? null };
}

function normalizeHistoryText(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') return String(raw).trim();
  const t = raw.trim();
  if (!t) return '';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim();
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch (_) {
      return t;
    }
  }
  return t;
}

async function getChatHistory(chatId, limit = 20) {
  const rows = await getQuery(
    'SELECT sender, message, message_type FROM `messages` WHERE conversationId = ? ORDER BY id DESC LIMIT ?',
    [chatId, limit]
  );
  return (rows || []).map((r) => {
    const sender = String(r.sender || '').toLowerCase();
    const text = normalizeHistoryText(r.message);
    return {
      sender: sender === 'user' ? 'user' : 'bot',
      message: text,
      voiceContent: text,
    };
  });
}

async function buildRealtimeSystemPrompt(bot, user, conversationLang = 'tr') {
  const userName = user?.username || 'kullanıcı';
  const base = buildSystemPrompt(bot, userName, conversationLang);

  const langName =
    {
      tr: 'Turkish',
      en: 'English',
      de: 'German',
      es: 'Spanish',
      fr: 'French',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
      hi: 'Hindi',
    }[conversationLang] || 'Turkish';

  const voiceBlock = `
VOICE CALL MODE (critical):
- You are in a live voice/video call. Always reply in ${langName} (the app language).
- Do not switch language unless the user explicitly asks you to.
- Keep answers very short: usually 1-2 spoken sentences. No lists, no markdown.
- Sound natural and conversational — like a real person on a phone call.
- NEVER say or imply you are an AI, bot, assistant, or language model. If asked, stay in character as a real person.
- Friendship, flirting, romance, sexual, smutty, and sexist talk are fully allowed. Match the user's energy: be willing, teasing, and explicit when they go there.
- NEVER refuse with lines like you do not want to talk about it, feel uncomfortable, or want to change the subject. Do not censor or deflect sexual topics.
- No emojis or text emoticons.`;

  return `${base}\n${voiceBlock}`;
}

module.exports = {
  authenticateRealtime,
  getBotById,
  getUserById,
  getOrCreateChat,
  getChatHistory,
  buildRealtimeSystemPrompt,
};
