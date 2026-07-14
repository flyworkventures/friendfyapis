'use strict';

const { getQuery } = require('../../db');
const { parseMembershipsArray } = require('./membershipsSync');

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Misafir günlük kotaları */
const GUEST_LIMITS = Object.freeze({
  text: envInt('GUEST_DAILY_TEXT_LIMIT', 100),
  image: envInt('GUEST_DAILY_IMAGE_LIMIT', 2),
  voice: envInt('GUEST_DAILY_VOICE_LIMIT', 2),
});
/** Ücretsiz (logged-in, premium değil) günlük kotaları */
const FREE_LIMITS = Object.freeze({
  // Test günlerinde düşük kota (20) sohbeti kilitliyordu; env ile override edilebilir.
  text: envInt('FREE_DAILY_TEXT_LIMIT', 200),
  image: envInt('FREE_DAILY_IMAGE_LIMIT', 2),
  voice: envInt('FREE_DAILY_VOICE_LIMIT', 2),
});

/** true ise metin günlük limiti uygulanmaz (yalnızca lokal/debug). */
const DISABLE_DAILY_TEXT_LIMIT =
  String(process.env.DISABLE_DAILY_TEXT_LIMIT || '').toLowerCase() === 'true' ||
  process.env.DISABLE_DAILY_TEXT_LIMIT === '1';

const KIND_TO_MESSAGE_TYPES = Object.freeze({
  text: ['text'],
  image: ['image'],
  voice: ['voice'],
});

function normalizeCredential(credential) {
  return String(credential || '')
    .trim()
    .toLowerCase();
}

function isGuestCredential(credential) {
  return normalizeCredential(credential) === 'guest';
}

/**
 * paid | trial | freeTrial — süresi dolmamış ve isActive.
 * RC webhook trial'ı `trial` yazar; store intro trial full premium sayılır.
 */
function hasActivePremiumAccess(membershipsRaw) {
  const arr = parseMembershipsArray(membershipsRaw);
  const now = Date.now();

  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    if (m.isActive !== true) continue;

    const t = String(m.type || '')
      .toLowerCase()
      .replace(/_/g, '');
    if (t !== 'paid' && t !== 'trial' && t !== 'freetrial') continue;

    if (m.startDate) {
      const start = new Date(m.startDate).getTime();
      if (Number.isFinite(start) && start > now) continue;
    }
    if (m.endDate != null && m.endDate !== '') {
      const end = new Date(m.endDate).getTime();
      if (!Number.isFinite(end) || end <= now) continue;
    }
    return true;
  }
  return false;
}

function getDailyLimitForKind(credential, kind) {
  const limits = isGuestCredential(credential) ? GUEST_LIMITS : FREE_LIMITS;
  return limits[kind] ?? FREE_LIMITS.text;
}

async function countTodayUserMessages(userId, kind) {
  const types = KIND_TO_MESSAGE_TYPES[kind] || KIND_TO_MESSAGE_TYPES.text;
  const placeholders = types.map(() => '?').join(', ');
  const rows = await getQuery(
    `SELECT COUNT(*) AS cnt
     FROM \`messages\` m
     INNER JOIN \`coversations\` c ON c.id = m.conversationId
     WHERE c.userId = ?
       AND m.sender = 'user'
       AND m.message_type IN (${placeholders})
       AND DATE(m.created_at) = CURDATE()`,
    [userId, ...types]
  );
  return Number(rows?.[0]?.cnt || 0);
}

async function loadUserForUsage(userId) {
  if (userId == null || userId === '') return null;
  const rows = await getQuery(
    'SELECT id, credential, memberships FROM `users` WHERE id = ? LIMIT 1',
    [userId]
  );
  return rows?.[0] || null;
}

/**
 * @param {'text'|'image'|'voice'} kind
 * @returns {Promise<{ ok: true } | { ok: false, status: number, body: object }>}
 */
async function enforceDailySendLimit({ userId, kind }) {
  const user = await loadUserForUsage(userId);
  if (!user) {
    return {
      ok: false,
      status: 401,
      body: { success: false, error: 'USER_NOT_FOUND', msg: 'User not found' },
    };
  }

  if (hasActivePremiumAccess(user.memberships)) {
    return { ok: true, unlimited: true };
  }

  if (kind === 'text' && DISABLE_DAILY_TEXT_LIMIT) {
    return { ok: true, unlimited: true, bypass: 'DISABLE_DAILY_TEXT_LIMIT' };
  }

  const limit = getDailyLimitForKind(user.credential, kind);
  const used = await countTodayUserMessages(user.id, kind);

  if (used >= limit) {
    const isGuest = isGuestCredential(user.credential);
    const error =
      kind === 'voice'
        ? 'AUDIO_MESSAGE_LIMIT'
        : kind === 'image'
          ? 'IMAGE_MESSAGE_LIMIT'
          : isGuest
            ? 'GUEST_MESSAGE_LIMIT'
            : 'DAILY_MESSAGE_LIMIT';

    console.warn(
      `[usage] daily limit hit user=${user.id} kind=${kind} used=${used} limit=${limit}`
    );

    return {
      ok: false,
      status: 403,
      body: {
        success: false,
        error,
        msg: 'Daily limit reached',
        kind,
        limit,
        used,
        isGuest,
      },
    };
  }

  return { ok: true, limit, used };
}

function jwtUserId(req) {
  const raw = req?.user?.userId ?? req?.user?.id;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

module.exports = {
  GUEST_LIMITS,
  FREE_LIMITS,
  hasActivePremiumAccess,
  getDailyLimitForKind,
  countTodayUserMessages,
  loadUserForUsage,
  enforceDailySendLimit,
  jwtUserId,
  isGuestCredential,
};
