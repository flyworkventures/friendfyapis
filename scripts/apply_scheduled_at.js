// Tek seferlik migration: messages.scheduled_at kolonunu (yoksa) ekler.
// Kullanım: node scripts/apply_scheduled_at.js
const { getQuery, query } = require('../db');

(async () => {
  try {
    const cols = await getQuery(
      "SHOW COLUMNS FROM `messages` WHERE Field = 'scheduled_at'"
    );
    if (cols && cols.length) {
      console.log('✅ scheduled_at zaten mevcut, işlem yok.');
      process.exit(0);
    }
    const ok = await query(
      'ALTER TABLE `messages` ADD COLUMN `scheduled_at` DATETIME NULL DEFAULT NULL AFTER `created_at`'
    );
    console.log(ok ? '✅ scheduled_at kolonu eklendi.' : '❌ ALTER başarısız.');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
