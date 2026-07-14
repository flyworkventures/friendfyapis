// Tek seferlik migration: users.notification_preferences kolonunu (yoksa) ekler.
// Kullanım: node scripts/apply_notification_preferences.js
const { getQuery, query } = require('../db');

(async () => {
    try {
        const cols = await getQuery(
            "SHOW COLUMNS FROM `users` WHERE Field = 'notification_preferences'"
        );
        if (cols && cols.length) {
            console.log('✅ notification_preferences zaten mevcut, işlem yok.');
            process.exit(0);
        }
        const ok = await query(
            'ALTER TABLE `users` ADD COLUMN `notification_preferences` JSON NULL AFTER `hobbies`'
        );
        console.log(
            ok
                ? '✅ notification_preferences kolonu eklendi.'
                : '❌ ALTER başarısız.'
        );
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error('❌ Migration hatası:', e?.message || e);
        process.exit(1);
    }
})();
