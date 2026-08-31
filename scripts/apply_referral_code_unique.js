// Migration: referral_code_redemptions.code unique (tek kullanım)
// Kullanım: node scripts/apply_referral_code_unique.js
'use strict';

const { getQuery, query } = require('../db');

async function indexExists(name) {
  const rows = await getQuery(
    'SHOW INDEX FROM `referral_code_redemptions` WHERE Key_name = ?',
    [name]
  );
  return !!(rows && rows.length);
}

async function main() {
  const table = await getQuery("SHOW TABLES LIKE 'referral_code_redemptions'");
  if (!table || table.length === 0) {
    console.error('❌ referral_code_redemptions yok — önce apply_referral_redemptions.js');
    process.exit(1);
  }

  if (await indexExists('uq_referral_code')) {
    console.log('⏭️  uq_referral_code zaten var');
    process.exit(0);
  }

  const dupes = await getQuery(
    `SELECT \`code\`, COUNT(*) AS cnt
     FROM \`referral_code_redemptions\`
     GROUP BY \`code\`
     HAVING cnt > 1`
  );
  if (dupes && dupes.length > 0) {
    console.error('❌ Aynı kodla birden fazla kayıt var; unique index eklenemedi:', dupes);
    process.exit(1);
  }

  const ok = await query(
    'ALTER TABLE `referral_code_redemptions` ADD UNIQUE KEY `uq_referral_code` (`code`)'
  );
  if (!ok) throw new Error('ALTER uq_referral_code failed');

  console.log('✅ uq_referral_code eklendi');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
