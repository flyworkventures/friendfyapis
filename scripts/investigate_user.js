// Bir kullanıcının tam ayak izini çıkarır (kötüye kullanım/yasal inceleme için).
// SALT-OKUNUR — hiçbir şeyi değiştirmez. Delil koruma amaçlı JSON de yazar.
//
// Kullanım:
//   node scripts/investigate_user.js 1936
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getQuery } = require('../db');

const userId = process.argv[2];
if (!userId) { console.error('Kullanım: node scripts/investigate_user.js <userId>'); process.exit(1); }

(async () => {
  const [u] = await getQuery(
    `SELECT id, username, email, country, accountCreatedDate, guest_device_id,
            appleUserIdentifier, revenuecat_customer_id, onesignal_player_id, phoneNumber
     FROM \`users\` WHERE id = ?`, [userId]
  );
  console.log('════════ HESAP ════════');
  if (!u) { console.log('Kullanıcı bulunamadı:', userId); process.exit(0); }
  for (const [k, v] of Object.entries(u)) console.log(`  ${k}: ${v ?? '-'}`);

  const bots = await getQuery(
    'SELECT id, name, system, `character`, created_at FROM `bots` WHERE creatorId = ? ORDER BY id', [userId]
  );
  console.log(`\n════════ YARATTIĞI KARAKTERLER (${bots.length}) ════════`);
  for (const b of bots) {
    console.log(`  bot ${b.id} sys=${b.system} "${b.name}" (${b.created_at || '-'})`);
    console.log(`    persona: ${String(b.character || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  }

  let convCount = 0, reportCount = 0;
  try { const [c] = await getQuery('SELECT COUNT(*) n FROM `coversations` WHERE userId = ?', [userId]); convCount = c?.n || 0; } catch (_) {}
  try { const [r] = await getQuery('SELECT COUNT(*) n FROM `reports` WHERE userId = ?', [userId]); reportCount = r?.n || 0; } catch (_) {}
  console.log(`\n════════ AKTİVİTE ════════`);
  console.log(`  konuşma: ${convCount} | açtığı report: ${reportCount}`);

  // Delil koruma: hesap + karakterleri zaman damgalı bir dosyaya yaz.
  const dir = path.join(__dirname, 'evidence');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(dir, `user_${userId}_${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), user: u, bots, convCount, reportCount }, null, 2), 'utf8');
  console.log(`\n🗄️  Delil dosyası (koru, silme): ${outPath}`);
  process.exit(0);
})().catch((e) => { console.error('❌ Hata:', e?.message || e); process.exit(1); });
