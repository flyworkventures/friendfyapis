// Çekirdek tabloları MyISAM → InnoDB'ye çevirir (row-level locking, gerçek
// transaction, crash-safety). Hot tablolar (messages/coversations/users/bots)
// MyISAM olduğu için yoğun yazımda tüm-tablo kilidi + transaction'sızlık vardı.
//
// Boyutlar küçük (~70k mesaj) → dönüşüm hızlı. Yine de düşük-trafik penceresinde
// çalıştırın ve ÖNCE bir kopyada deneyin (ALTER sırasında tablo kilitlenir).
//
// Idempotent: zaten InnoDB olanı atlar. Salt-şema; VERİ SİLMEZ.
//
// Kullanım:
//   node scripts/convert_core_tables_to_innodb.js          # DRY-RUN (planı gösterir)
//   node scripts/convert_core_tables_to_innodb.js --apply
require('dotenv').config();
const { getQuery, query } = require('../db');

const APPLY = process.argv.includes('--apply');
const TABLES = ['messages', 'coversations', 'users', 'bots', 'config'];

async function engineOf(t) {
  const r = await getQuery(
    'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [t]
  );
  return r?.[0]?.ENGINE || null;
}

async function indexExists(table, name) {
  const r = await getQuery('SHOW INDEX FROM `' + table + '` WHERE Key_name = ?', [name]);
  return Array.isArray(r) && r.length > 0;
}

(async () => {
  console.log(APPLY ? '🚀 APPLY' : '🔎 DRY-RUN — --apply ile uygula');

  // 1) messages: gereksiz `conversationId`(1000) prefix index'i düşür.
  //    idx_messages_conv_id (conversationId(20), id) zaten aynı sorguları karşılar.
  //    InnoDB prefix limiti (COMPACT'ta 767 byte) yüzünden 1000'lik prefix dönüşümü
  //    engelleyebilir → önce düşürülmeli.
  const hasRedundant = await indexExists('messages', 'conversationId');
  const hasReplacement = await indexExists('messages', 'idx_messages_conv_id');
  if (hasRedundant && hasReplacement) {
    console.log('• messages: gereksiz `conversationId`(1000) index düşürülecek (idx_messages_conv_id kapsıyor)');
    if (APPLY) {
      const ok = await query('ALTER TABLE `messages` DROP INDEX `conversationId`');
      console.log(ok ? '  ✅ düşürüldü' : '  ❌ başarısız');
    }
  } else if (hasRedundant && !hasReplacement) {
    console.log('⚠️ messages: idx_messages_conv_id YOK — önce chat index migration çalıştırın; conversationId düşürülmedi.');
  }

  // 2) Engine dönüşümü
  for (const t of TABLES) {
    const eng = await engineOf(t);
    if (!eng) { console.log(`• ${t}: tablo bulunamadı, atlandı`); continue; }
    if (eng.toLowerCase() === 'innodb') { console.log(`• ${t}: zaten InnoDB, atlandı`); continue; }
    console.log(`• ${t}: ${eng} → InnoDB`);
    if (APPLY) {
      const ok = await query('ALTER TABLE `' + t + '` ENGINE=InnoDB');
      console.log(ok ? `  ✅ ${t} dönüştürüldü` : `  ❌ ${t} başarısız`);
    }
  }

  if (!APPLY) console.log('\nDRY-RUN bitti. Uygulamak için: --apply (düşük-trafik penceresi + önce kopyada test).');
  console.log('\nNot: InnoDB sonrası db.js `transaction()` GERÇEKTEN atomik olur.');
  process.exit(0);
})().catch((e) => { console.error('❌ Hata:', e?.message || e); process.exit(1); });
