// Tek seferlik migration: users tablosuna ban alanlarını ekler (yoksa).
// Kullanım: node scripts/apply_user_ban_columns.js
const { getQuery, query } = require('../db');

const COLUMNS = [
  { name: 'is_banned', ddl: "ALTER TABLE `users` ADD COLUMN `is_banned` tinyint(1) NOT NULL DEFAULT 0" },
  { name: 'banned_at', ddl: "ALTER TABLE `users` ADD COLUMN `banned_at` datetime NULL DEFAULT NULL" },
  { name: 'ban_reason', ddl: "ALTER TABLE `users` ADD COLUMN `ban_reason` varchar(255) NULL DEFAULT NULL" },
];

async function columnExists(name) {
  const rows = await getQuery('SHOW COLUMNS FROM `users` WHERE Field = ?', [name]);
  return Array.isArray(rows) && rows.length > 0;
}

(async () => {
  let created = 0, skipped = 0;
  try {
    for (const col of COLUMNS) {
      if (await columnExists(col.name)) { console.log(`⏭️  ${col.name} zaten var, atlandı.`); skipped++; continue; }
      const ok = await query(col.ddl);
      console.log(ok ? `✅ ${col.name} eklendi.` : `❌ ${col.name} eklenemedi.`);
      if (ok) created++; else process.exit(1);
    }
    // Ban sorgusu için index (WHERE is_banned = 1)
    const idx = await getQuery("SHOW INDEX FROM `users` WHERE Key_name = 'idx_users_is_banned'");
    if (!idx || !idx.length) {
      const ok = await query('ALTER TABLE `users` ADD INDEX `idx_users_is_banned` (`is_banned`)');
      console.log(ok ? '✅ idx_users_is_banned eklendi.' : '⚠️ index eklenemedi (kritik değil).');
    } else {
      console.log('⏭️  idx_users_is_banned zaten var.');
    }
    console.log(`\nBitti — ${created} kolon eklendi, ${skipped} atlandı.`);
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
