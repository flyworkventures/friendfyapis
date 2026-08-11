'use strict';

const crypto = require('crypto');
const { getQuery } = require('../../db');

/** I/O hariç — 1/0 karışıklığı olmasın. Format: XXX-YYY (ör. XVY-FRN). */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[A-Z]{3}-[A-Z]{3}$/;

function randomSegment(len = 3) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CHARS[crypto.randomInt(0, CHARS.length)];
  }
  return out;
}

/** Yeni rastgele kod (DB kontrolü yok). */
function generateReferralCode() {
  return `${randomSegment(3)}-${randomSegment(3)}`;
}

function isValidReferralCode(code) {
  return CODE_RE.test(String(code || '').trim().toUpperCase());
}

/** Girdi → XXX-YYY (boşluk/tire toleranslı). Geçersizse normalize edilmiş ham string. */
function normalizeReferralCodeInput(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (CODE_RE.test(s)) return s;
  const compact = s.replace(/-/g, '');
  if (/^[A-Z]{6}$/.test(compact)) {
    return `${compact.slice(0, 3)}-${compact.slice(3)}`;
  }
  return s;
}

/**
 * DB'de unique bir referral_code üretir.
 * @param {number} [maxAttempts=40]
 */
async function allocateUniqueReferralCode(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateReferralCode();
    const rows = await getQuery(
      'SELECT id FROM `users` WHERE `referral_code` = ? LIMIT 1',
      [code]
    );
    if (!rows || rows.length === 0) return code;
  }
  throw new Error('Could not allocate unique referral_code');
}

module.exports = {
  generateReferralCode,
  allocateUniqueReferralCode,
  isValidReferralCode,
  normalizeReferralCodeInput,
  CHARS,
  CODE_RE,
};
