// messages.reply_to_message_id kolonunu (yoksa) ekler.
// Kullanım: node scripts/apply_reply_to_message_id.js
const { getQuery, query } = require('../db');

(async () => {
  try {
    const cols = await getQuery(
      "SHOW COLUMNS FROM `messages` WHERE Field = 'reply_to_message_id'"
    );
    if (cols && cols.length) {
      console.log('✅ reply_to_message_id zaten mevcut, işlem yok.');
      process.exit(0);
    }
    const ok = await query(
      'ALTER TABLE `messages` ADD COLUMN `reply_to_message_id` INT NULL DEFAULT NULL AFTER `message_type`'
    );
    if (!ok) {
      console.error('❌ ALTER TABLE başarısız');
      process.exit(1);
    }
    console.log('✅ reply_to_message_id eklendi.');
    process.exit(0);
  } catch (e) {
    console.error('❌', e?.message || e);
    process.exit(1);
  }
})();
