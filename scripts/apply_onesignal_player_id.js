'use strict';

// Tek seferlik: users.onesignal_player_id kolonunu ekler (yoksa).
// Kullanım: node scripts/apply_onesignal_player_id.js

const { getQuery, query } = require('../db');

(async () => {
  try {
    const cols = await getQuery(
      "SHOW COLUMNS FROM `users` WHERE Field = 'onesignal_player_id'"
    );
    if (cols.length > 0) {
      console.log('✅ onesignal_player_id zaten mevcut.');
      process.exit(0);
    }
    await query(
      'ALTER TABLE `users` ADD COLUMN `onesignal_player_id` VARCHAR(128) NULL DEFAULT NULL AFTER `notification_preferences`'
    );
    console.log('✅ onesignal_player_id kolonu eklendi.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message || err);
    process.exit(1);
  }
})();
