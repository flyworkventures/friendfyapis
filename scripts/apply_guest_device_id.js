// Tek seferlik migration: users.guest_device_id kolonunu (yoksa) ekler.
// Kullanım: node scripts/apply_guest_device_id.js
const { getQuery, query } = require('../db');

(async () => {
  try {
    const cols = await getQuery(
      "SHOW COLUMNS FROM `users` WHERE Field = 'guest_device_id'"
    );
    if (cols && cols.length) {
      console.log('✅ guest_device_id zaten mevcut, işlem yok.');
      process.exit(0);
    }
    const ok = await query(
      'ALTER TABLE `users` ADD COLUMN `guest_device_id` VARCHAR(128) NULL DEFAULT NULL AFTER `credential`'
    );
    if (!ok) {
      console.error('❌ ALTER başarısız.');
      process.exit(1);
    }
    // Unique index — aynı deviceId ile ikinci guest oluşmasın.
    try {
      await query(
        'CREATE UNIQUE INDEX `idx_users_guest_device_id` ON `users` (`guest_device_id`)'
      );
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/Duplicate|exists/i.test(msg)) throw e;
    }
    console.log('✅ guest_device_id kolonu eklendi.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
