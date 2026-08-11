// Migration: users.referral_code (XXX-YYY) + mevcut kullanıcılara unique backfill
// Kullanım: node scripts/apply_users_referral_code.js
'use strict';

const { getQuery, query } = require('../db');
const {
  allocateUniqueReferralCode,
  isValidReferralCode,
} = require('../routes/lib/referralCode');

async function columnExists(field) {
  const cols = await getQuery(
    'SHOW COLUMNS FROM `users` WHERE Field = ?',
    [field]
  );
  return !!(cols && cols.length);
}

async function ensureColumn() {
  if (await columnExists('referral_code')) {
    console.log('⏭️  users.referral_code zaten var');
    return;
  }
  const ok = await query(
    `ALTER TABLE \`users\`
     ADD COLUMN \`referral_code\` CHAR(7) NULL DEFAULT NULL
       COMMENT 'Unique invite/referral code XXX-YYY'
       AFTER \`email\``
  );
  if (!ok) throw new Error('ALTER referral_code failed');
  console.log('✅ users.referral_code eklendi');
}

async function ensureUniqueIndex() {
  try {
    const idx = await getQuery(
      `SHOW INDEX FROM \`users\` WHERE Key_name = 'uq_users_referral_code'`
    );
    if (idx && idx.length) {
      console.log('⏭️  uq_users_referral_code zaten var');
      return;
    }
  } catch (_) {}
  const ok = await query(
    'CREATE UNIQUE INDEX `uq_users_referral_code` ON `users` (`referral_code`)'
  );
  if (!ok) throw new Error('CREATE UNIQUE INDEX failed');
  console.log('✅ uq_users_referral_code eklendi');
}

async function backfillMissing() {
  const missing = await getQuery(
    `SELECT id FROM \`users\`
     WHERE \`referral_code\` IS NULL
        OR TRIM(\`referral_code\`) = ''
     ORDER BY id ASC`
  );
  const rows = missing || [];
  console.log(`Backfill adayı: ${rows.length}`);
  let filled = 0;
  for (const row of rows) {
    let code = await allocateUniqueReferralCode();
    // Race / collision: unique ihlali olursa yeniden dene
    for (let attempt = 0; attempt < 8; attempt++) {
      const ok = await query(
        'UPDATE `users` SET `referral_code` = ? WHERE id = ? AND (`referral_code` IS NULL OR TRIM(`referral_code`) = \'\') LIMIT 1',
        [code, row.id]
      );
      if (ok) {
        filled++;
        break;
      }
      code = await allocateUniqueReferralCode();
    }
    if (filled % 200 === 0 && filled > 0) {
      console.log(`  … ${filled}/${rows.length}`);
    }
  }
  console.log(`✅ backfill tamam: ${filled} kullanıcı`);
}

async function validateSample() {
  const stats = await getQuery(
    `SELECT
       COUNT(*) AS total,
       SUM(\`referral_code\` IS NOT NULL AND TRIM(\`referral_code\`) <> '') AS with_code,
       COUNT(DISTINCT \`referral_code\`) AS distinct_codes
     FROM \`users\``
  );
  console.log('stats', stats[0]);
  const sample = await getQuery(
    'SELECT id, email, referral_code FROM `users` WHERE referral_code IS NOT NULL ORDER BY id DESC LIMIT 5'
  );
  for (const s of sample || []) {
    const ok = isValidReferralCode(s.referral_code);
    console.log(`  #${s.id} ${s.referral_code} ${ok ? '✓' : '✗'}`);
  }
}

(async () => {
  try {
    await ensureColumn();
    await ensureUniqueIndex();
    await backfillMissing();
    await validateSample();
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
