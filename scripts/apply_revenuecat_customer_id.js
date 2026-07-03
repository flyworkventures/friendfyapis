// Tek seferlik migration: users.revenuecat_customer_id kolonunu (yoksa) ekler.
// Kullanım: node scripts/apply_revenuecat_customer_id.js
const { getQuery, query } = require('../db');

(async () => {
    try {
        const cols = await getQuery(
            "SHOW COLUMNS FROM `users` WHERE Field = 'revenuecat_customer_id'"
        );
        if (cols && cols.length) {
            console.log('✅ revenuecat_customer_id zaten mevcut, işlem yok.');
            process.exit(0);
        }
        const ok = await query(
            'ALTER TABLE `users` ADD COLUMN `revenuecat_customer_id` VARCHAR(191) NULL AFTER `memberships`'
        );
        if (ok) {
            // Index oluşturma (varsa hata yut).
            await query(
                'CREATE INDEX `idx_users_revenuecat_customer_id` ON `users` (`revenuecat_customer_id`)'
            );
        }
        console.log(
            ok ? '✅ revenuecat_customer_id kolonu eklendi.' : '❌ ALTER başarısız.'
        );
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error('❌ Migration hatası:', e?.message || e);
        process.exit(1);
    }
})();
