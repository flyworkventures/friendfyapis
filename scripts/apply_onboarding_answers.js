// Tek seferlik migration: users.onboarding_answers kolonunu (yoksa) ekler.
// Kayıt akışındaki tercih soruları (AI arkadaş cinsiyeti/adı, çoklu seçimler,
// ifade kartları) bu JSON kolonunda tutulur.
// Kullanım: node scripts/apply_onboarding_answers.js
const { getQuery, query } = require('../db');

(async () => {
    try {
        const cols = await getQuery(
            "SHOW COLUMNS FROM `users` WHERE Field = 'onboarding_answers'"
        );
        if (cols && cols.length) {
            console.log('✅ onboarding_answers zaten mevcut, işlem yok.');
            process.exit(0);
        }
        const ok = await query(
            'ALTER TABLE `users` ADD COLUMN `onboarding_answers` JSON NULL AFTER `hobbies`'
        );
        console.log(
            ok
                ? '✅ onboarding_answers kolonu eklendi.'
                : '❌ ALTER başarısız.'
        );
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error('❌ Migration hatası:', e?.message || e);
        process.exit(1);
    }
})();
