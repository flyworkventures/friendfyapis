// MEVCUT kullanıcı-üretimi karakterlerin isim/persona metnini geriye dönük tarar.
// (create/update kapısı yalnızca YENİ içeriği engeller; bu script eskileri denetler.)
// Salt-okunur: uygunsuzları LİSTELER, silmez. App Store Guideline 1.1/1.2.
//
// DB erişimi gerekir → sunucudan çalıştırın.
//
// Kullanım:
//   node scripts/audit_ugc_text_moderation.js            # kullanıcı karakterleri (system 0)
//   node scripts/audit_ugc_text_moderation.js --all      # katalog (system 1,2) dahil
//   node scripts/audit_ugc_text_moderation.js --concurrency 5
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getQuery } = require('../db');
const { moderateAgentContent } = require('../lib/contentModeration');

const INCLUDE_ALL = process.argv.includes('--all');
const ci = process.argv.indexOf('--concurrency');
const CONCURRENCY = Math.max(1, Math.min(8, (ci >= 0 && Number(process.argv[ci + 1])) || 4));
const BACKUP_DIR = path.join(__dirname, 'backups');

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

(async () => {
  const where = INCLUDE_ALL ? 'system IN (0,1,2)' : 'system = 0';
  const rows = await getQuery(
    `SELECT id, name, creatorId, system, \`character\`, interests, interestsType, characterTags, speakingStyle
     FROM \`bots\` WHERE ${where}`
  );
  console.log(`${rows.length} karakter taranıyor (${INCLUDE_ALL ? 'system 0,1,2' : 'system 0 = kullanıcı üretimi'}, eşzamanlı=${CONCURRENCY})…\n`);

  let done = 0;
  const results = await mapLimit(rows, CONCURRENCY, async (b) => {
    const mod = await moderateAgentContent({
      name: b.name,
      character: b.character,
      interests: b.interests,
      interestsType: b.interestsType,
      characterTags: b.characterTags,
      speakingStyle: b.speakingStyle,
    });
    done++;
    if (done % 25 === 0) process.stdout.write(`  …${done}/${rows.length}\n`);
    return { bot: b, mod };
  });

  const flagged = results
    .filter((r) => !r.mod.ok)
    .sort((a, b) => (a.mod.reason > b.mod.reason ? 1 : -1));

  console.log(`\n════════ UYGUNSUZ KARAKTERLER (${flagged.length}) ════════`);
  if (!flagged.length) {
    console.log('Uygunsuz isim/persona bulunamadı. 🎉');
  } else {
    for (const { bot, mod } of flagged) {
      const why = mod.reason === 'blocklist'
        ? `blocklist:${mod.term}`
        : `moderation:${(mod.categories || []).join(',')}`;
      console.log(
        `  bot ${bot.id} sys=${bot.system} creator=${bot.creatorId} "${bot.name}" (${why})\n` +
        `    persona: ${String(bot.character || '').replace(/\s+/g, ' ').slice(0, 100)}`
      );
    }
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(BACKUP_DIR, `ugc_text_audit_${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      flagged.map(({ bot, mod }) => ({
        id: bot.id, system: bot.system, creatorId: bot.creatorId,
        name: bot.name, character: bot.character, reason: mod.reason,
        term: mod.term, categories: mod.categories,
      })),
      null, 2
    ),
    'utf8'
  );
  console.log(`\n── ÖZET ── tarandı:${rows.length} uygunsuz:${flagged.length}`);
  console.log(`Tam rapor: ${outPath}`);
  process.exit(0);
})().catch((e) => {
  console.error('❌ Hata:', e?.message || e);
  process.exit(1);
});
