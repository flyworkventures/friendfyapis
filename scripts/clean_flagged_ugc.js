// Uygunsuz kullanıcı-üretimi karakterleri (system=0) NÖTRLER (silmez).
// Cerrahi: her alanı ayrı denetler, yalnızca kirli alanı temizler.
//   - name kirliyse   → nötr isim
//   - persona kirliyse → temiz jenerik persona
//   - interests/interestsType/characterTags/speakingStyle kirliyse → temizlenir
// Gelecekteki kötüye kullanım create/update moderasyon KAPISI ile engelleniyor (#4).
//
// GÜVENLİK: --apply önce yedek yazar → scripts/backups/ugc_clean_<zaman>.json
// Geri al: node scripts/clean_flagged_ugc.js --restore <yedek.json>
//
// Kullanım:
//   node scripts/clean_flagged_ugc.js            # DRY-RUN
//   node scripts/clean_flagged_ugc.js --apply
//   node scripts/clean_flagged_ugc.js --restore <yedek.json>
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getQuery, query } = require('../db');
const { moderateAgentContent } = require('../lib/contentModeration');

const APPLY = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE_FILE = restoreIdx >= 0 ? process.argv[restoreIdx + 1] : null;
const BACKUP_DIR = path.join(__dirname, 'backups');

const NEUTRAL_NAME = 'Arkadaş';
const CLEAN_PERSONA =
  'Arkadaş canlısı, kibar ve pozitif bir sohbet arkadaşı. Nazik, saygılı ve ' +
  'ölçülü konuşur; gündelik, güvenli ve keyifli sohbetlerden hoşlanır.';

async function isClean(fields) {
  const r = await moderateAgentContent(fields);
  return r.ok;
}

async function runRestore(file) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`♻️  RESTORE: ${entries.length} karakter eski hâline döndürülüyor…`);
  let ok = 0, err = 0;
  for (const e of entries) {
    const r = await query(
      'UPDATE `bots` SET `name`=?, `character`=?, interests=?, interestsType=?, characterTags=?, speakingStyle=? WHERE id=?',
      [e.name, e.character, e.interests, e.interestsType, e.characterTags, e.speakingStyle, e.id]
    );
    r ? ok++ : err++;
  }
  console.log(`✅ ${ok} geri yüklendi, ${err} hata.`);
  process.exit(err ? 1 : 0);
}

async function run() {
  console.log(APPLY ? '🚀 APPLY (önce yedek alınır)' : '🔎 DRY-RUN — --apply ile uygula');
  const rows = await getQuery(
    'SELECT id, name, creatorId, `character`, interests, interestsType, characterTags, speakingStyle FROM `bots` WHERE system = 0'
  );

  const changes = [];
  for (const b of rows) {
    const overall = await moderateAgentContent({
      name: b.name, character: b.character, interests: b.interests,
      interestsType: b.interestsType, characterTags: b.characterTags, speakingStyle: b.speakingStyle,
    });
    if (overall.ok) continue; // temiz karakter — dokunma

    const upd = {};
    const notes = [];
    if (!(await isClean({ name: b.name }))) { upd.name = NEUTRAL_NAME; notes.push('name'); }
    // Persona: kirliyse temiz jenerikle değiştir.
    if (!(await isClean({ character: b.character }))) { upd.character = CLEAN_PERSONA; notes.push('persona'); }
    if (b.interests && !(await isClean({ interests: b.interests }))) { upd.interests = '[]'; notes.push('interests'); }
    if (b.interestsType && !(await isClean({ interestsType: b.interestsType }))) { upd.interestsType = '[]'; notes.push('interestsType'); }
    if (b.characterTags && !(await isClean({ characterTags: b.characterTags }))) { upd.characterTags = '[]'; notes.push('characterTags'); }
    if (b.speakingStyle && !(await isClean({ speakingStyle: b.speakingStyle }))) { upd.speakingStyle = ''; notes.push('speakingStyle'); }

    // Kombine kirli ama tek tek alanlar "temiz" çıktıysa (nadir), garanti için persona'yı yine de nötrle.
    if (!Object.keys(upd).length) { upd.character = CLEAN_PERSONA; notes.push('persona(fallback)'); }

    const minors = overall.categories && overall.categories.includes('sexual/minors');
    changes.push({ bot: b, upd, notes, minors });
  }

  console.log(`\n${changes.length} karakter nötrlenecek:\n`);
  for (const c of changes) {
    console.log(
      `  ${c.minors ? '🚨MINORS ' : ''}bot ${c.bot.id} creator=${c.bot.creatorId} "${c.bot.name}" → alanlar: ${c.notes.join(', ')}` +
      (c.upd.name ? `\n     isim: "${c.bot.name}" → "${c.upd.name}"` : '')
    );
  }
  const minorsCount = changes.filter((c) => c.minors).length;
  if (minorsCount) {
    console.log(`\n🚨 ${minorsCount} karakter 'sexual/minors' işaretli — creatorId'leri ayrıca incele/askıya al (yasal).`);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN bitti. Uygulamak için: --apply');
    process.exit(0);
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `ugc_clean_${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(changes.map((c) => ({
      id: c.bot.id, name: c.bot.name, character: c.bot.character,
      interests: c.bot.interests, interestsType: c.bot.interestsType,
      characterTags: c.bot.characterTags, speakingStyle: c.bot.speakingStyle,
    })), null, 2),
    'utf8'
  );
  console.log(`\n🛟 Yedek: ${backupPath}`);
  console.log(`   Geri al: node scripts/clean_flagged_ugc.js --restore "${backupPath}"\n`);

  let done = 0, err = 0;
  for (const c of changes) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(c.upd)) {
      sets.push(k === 'name' || k === 'character' ? `\`${k}\`=?` : `${k}=?`);
      vals.push(v);
    }
    vals.push(c.bot.id);
    const ok = await query(`UPDATE \`bots\` SET ${sets.join(', ')} WHERE id=?`, vals);
    ok ? done++ : err++;
  }
  console.log(`✅ ${done} karakter nötrlendi, ${err} hata.`);
  console.log(`🛟 Sorun olursa: node scripts/clean_flagged_ugc.js --restore "${backupPath}"`);
  process.exit(err ? 1 : 0);
}

(async () => {
  if (RESTORE_FILE) return runRestore(RESTORE_FILE);
  return run();
})().catch((e) => { console.error('❌ Hata:', e?.message || e); process.exit(1); });
