// Migration: coversations.last_read_at (okunmamış mesaj sayısı için)
// Kullanım: node scripts/apply_conversation_last_read.js
const { getQuery, query } = require('../db');

(async () => {
  try {
    const cols = await getQuery(
      "SHOW COLUMNS FROM `coversations` WHERE Field = 'last_read_at'"
    );
    if (cols && cols.length) {
      console.log('⏭️  last_read_at zaten mevcut, işlem yok.');
      process.exit(0);
    }
    const ok = await query(
      'ALTER TABLE `coversations` ADD COLUMN `last_read_at` DATETIME NULL DEFAULT NULL'
    );
    if (!ok) throw new Error('ALTER coversations failed');
    // Mevcut sohbetler güncellemeden sonra okunmamış görünmesin.
    await query(
      'UPDATE `coversations` SET `last_read_at` = COALESCE(`last_message_at`, NOW()) WHERE `last_read_at` IS NULL'
    );
    console.log('✅ last_read_at eklendi ve dolduruldu.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
