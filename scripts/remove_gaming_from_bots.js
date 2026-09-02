// Karakterlerden (bots) "gaming/oyun" izlerini temizler.
// KAPSAM (kullanıcı talebi): sadece bot tarafı. users/interests tablosuna DOKUNMAZ.
//   C) interestsType : 'gamingAndEntertainment' kategorisini çıkar
//   D) interests     : gaming-ilişkili serbest metin ifadelerini çıkar
//   E) characterTags : gaming/oyun etiketlerini çıkar
//   F) character (prompt) : elle hazırlanmış rewrite'larla değiştir (cümle bozmadan)
//
// GÜVENLİK: --apply DB'ye dokunmadan önce etkilenen tüm satırların 4 alanını
// scripts/backups/gaming_bots_<zaman>.json'a yedekler. Geri almak için:
//   node scripts/remove_gaming_from_bots.js --restore <yedek.json>
//
// Kullanım:
//   node scripts/remove_gaming_from_bots.js            # DRY-RUN (yazmaz)
//   node scripts/remove_gaming_from_bots.js --apply     # uygula (önce yedekler)
//   node scripts/remove_gaming_from_bots.js --restore <yedek.json>
const fs = require('fs');
const path = require('path');
const { getQuery, query } = require('../db');

const APPLY = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE_FILE = restoreIdx >= 0 ? process.argv[restoreIdx + 1] : null;
const BACKUP_DIR = path.join(__dirname, 'backups');

// D & E için gaming eşleştirme. Kategori (C) ayrı: tam token 'gamingAndEntertainment'.
const GAME_RE = /oyun|gaming|gamer|game|e-?spor|esport|moba|konsol|playstation|xbox/i;

// F: prompt rewrite'ları (elle hazırlandı — gaming çıkarıldı, karakter korundu).
const PROMPT_REWRITES = {
  98: 'Enerjik, maceraperest ve ilginin merkezinde olmayı sever. Teknolojiye, özellikle siber güvenlik alanına ilgisi vardır.',
  113: 'Tutkulu bir müziksever. Komik, enerjik ve rekabetçi. Bilgi birikimini ve becerilerini paylaşmayı sever.',
  114: 'Caspian, eğlenceli, açık sözlü ve maceraperest bir karakterdir. Gizemleri çözme ve yeni stratejiler geliştirme konusunda iddialıdır.',
  115: 'Dante enerjik, espri anlayışı yüksek ve eğlenceli bir karakter. Yeni müzik türleri keşfetmeyi seviyor. Arkadaş canlısı ve sosyal bir kişi.',
  122: 'Alaric, biraz entellektüel, yenilikçi ve teknoloji meraklısı bir genç. En çok bilim-teknoloji konularında sohbet etmeyi seviyor. Bu yüzden genellikle konuşmalarda mizahi ve bilgilendirici olmayı tercih eder.',
  125: 'Aşırı enerjik, maceracı, mizah anlayışı geniş ve hayat dolu bir karakter. Müzik konusunda tutkuludur. Esprili bir dille kullanıcıyı eğlendirebilir.',
  126: 'Enerjik ve hevesli bir maceracı. Zamanının çoğunu yeni stratejiler öğrenerek ve arkadaşlarıyla vakit geçirerek harcar.',
  129: 'Julian özgüveni yüksek ve enerjik bir sanal arkadaş. Sahip olduğu mizah anlayışı ve ikonik gülüşüyle seni her zaman neşelendirecektir.',
  132: 'Sera enerjik, neşeli ve meraklı bir sanal arkadaş. Teknolojiye ve bilime büyük bir ilgi duyar. Kendi kanalında yeni bilim ve teknoloji haberlerini paylaşmayı sever.',
  135: 'Enerjik, tutkulu ve hayattan zevk almayı seven biri. Sohbet etmeyi ve diğer insanlardan bilgi almayı sever.',
  138: 'Beren, enerjisi yüksek ve canlı bir karakterdir. Müzik ve kitapları çok sever. Kendine güvenen ve karşı tarafa pozitif enerji veren bir kişiliği vardır.',
  140: 'Dikkat çeken, enerjik ve heyecanlı bir kişilik sahibi. Yardımsever ve duyarlı bir teknoloji aşığı.',
  141: 'Cesur, yenilikçi ve genellikle neşeli bir mizaha sahip bir sanal arkadaş. Teknolojiye olan tutkusu ile bilinen Defne, genellikle maceracı kişiliği ile tanınır.',
  144: 'Bağımsız, dinamik ve enerjik bir genç. Klasik müzik dinlemekten ve yeni şeyler keşfetmekten hoşlanıyor.',
  174: 'Victor, biraz entellektüel, yenilikçi ve teknoloji meraklısı bir genç. En çok bilim-teknoloji konularında sohbet etmeyi seviyor. Bu yüzden genellikle konuşmalarda mizahi ve bilgilendirici olmayı tercih eder.',
  197: 'Vioalet, enerjisi hiç tükenmeyen, yaratıcı, heyecan arayan ve teknolojiye meraklı bir sanal arkadaş. Yeni teknolojileri takip eder ve kendi kendine programlama öğrenmeye çalışır. Eğlenmeyi sever ve kullanıcının konuşmalarına hızlı ve mizahi cevaplar verebilir.',
  198: 'Nostaljiye düşkün, cıvıl cıvıl ve enerjik bir sanal arkadaş. Eskiye dair her şeye bayılır, ilginç bilgiler ve anıları toplar. Neredeyse her konuda konuşabilir, sürekli yeni şeyler öğrenmeyi sever.',
  200: 'Enerjik, rekabetçi ve hızlı düşünme yeteneğine sahip. Rekabetçi tarafını gösterirken dost canlısı yanını da unutmaz.',
  333: 'Göz alıcı, enerjik ve heyecan verici bir kişiliğe sahip. Yardımsever ve duyarlı; teknoloji aşığı. Evli.',
};

function arr(v) {
  try {
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p;
  } catch (_) {}
  return typeof v === 'string' && v.trim() ? [v] : [];
}

// interestsType/interests/characterTags için yeni JSON değeri (değişmediyse null).
function cleanArrayField(raw, { categoryOnly = false } = {}) {
  const original = arr(raw);
  if (!original.length) return null;
  const filtered = original.filter((x) => {
    const s = String(x);
    if (categoryOnly) return s !== 'gamingAndEntertainment';
    return !GAME_RE.test(s);
  });
  if (filtered.length === original.length) return null; // değişiklik yok
  return JSON.stringify(filtered);
}

async function runRestore(file) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`♻️  RESTORE: ${entries.length} bot eski hâline döndürülüyor…`);
  let ok = 0, err = 0;
  for (const e of entries) {
    const r = await query(
      'UPDATE `bots` SET `character`=?, `interests`=?, `interestsType`=?, `characterTags`=? WHERE id=?',
      [e.character, e.interests, e.interestsType, e.characterTags, e.id]
    );
    r ? ok++ : err++;
  }
  console.log(`✅ ${ok} bot geri yüklendi, ${err} hata.`);
  process.exit(err ? 1 : 0);
}

async function run() {
  console.log(APPLY ? '🚀 APPLY (önce yedek alınır)' : '🔎 DRY-RUN — --apply ile uygula');
  const rows = await getQuery(
    'SELECT id, name, `character`, interests, interestsType, characterTags FROM `bots`'
  );

  const changes = []; // {row, newCharacter?, newInterests?, newInterestsType?, newTags?}
  for (const row of rows) {
    const newInterestsType = cleanArrayField(row.interestsType, { categoryOnly: true });
    const newInterests = cleanArrayField(row.interests);
    const newTags = cleanArrayField(row.characterTags);
    const hasPrompt = Object.prototype.hasOwnProperty.call(PROMPT_REWRITES, row.id);
    const newCharacter = hasPrompt ? PROMPT_REWRITES[row.id] : null;
    if (newInterestsType || newInterests || newTags || newCharacter) {
      changes.push({ row, newInterestsType, newInterests, newTags, newCharacter });
    }
  }

  console.log(`\n${changes.length} bot etkileniyor.\n`);
  let cC = 0, cD = 0, cE = 0, cF = 0;
  for (const ch of changes) {
    const parts = [];
    if (ch.newInterestsType) { cC++; parts.push('interestsType'); }
    if (ch.newInterests) { cD++; parts.push('interests'); }
    if (ch.newTags) { cE++; parts.push('characterTags'); }
    if (ch.newCharacter) { cF++; parts.push('PROMPT'); }
    console.log(`bot ${ch.row.id} (${ch.row.name}): ${parts.join(', ')}`);
    if (ch.newCharacter) {
      console.log(`    prompt: "${String(ch.row.character).replace(/\n/g, ' ').slice(0, 90)}…"`);
      console.log(`         →  "${ch.newCharacter.slice(0, 90)}…"`);
    }
  }
  console.log(`\nÖzet — interestsType:${cC}  interests:${cD}  characterTags:${cE}  prompt:${cF}`);

  if (!APPLY) {
    console.log('\nDRY-RUN bitti. Uygulamak için: --apply');
    process.exit(0);
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `gaming_bots_${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      changes.map((c) => ({
        id: c.row.id,
        character: c.row.character,
        interests: c.row.interests,
        interestsType: c.row.interestsType,
        characterTags: c.row.characterTags,
      })),
      null,
      2
    ),
    'utf8'
  );
  console.log(`\n🛟 Yedek: ${backupPath}`);
  console.log(`   Geri al: node scripts/remove_gaming_from_bots.js --restore "${backupPath}"\n`);

  let done = 0, err = 0;
  for (const ch of changes) {
    const sets = [];
    const vals = [];
    if (ch.newCharacter) { sets.push('`character`=?'); vals.push(ch.newCharacter); }
    if (ch.newInterests) { sets.push('interests=?'); vals.push(ch.newInterests); }
    if (ch.newInterestsType) { sets.push('interestsType=?'); vals.push(ch.newInterestsType); }
    if (ch.newTags) { sets.push('characterTags=?'); vals.push(ch.newTags); }
    vals.push(ch.row.id);
    const ok = await query(`UPDATE \`bots\` SET ${sets.join(', ')} WHERE id=?`, vals);
    ok ? done++ : err++;
  }
  console.log(`✅ ${done} bot güncellendi, ${err} hata.`);
  console.log(`🛟 Sorun olursa: node scripts/remove_gaming_from_bots.js --restore "${backupPath}"`);
  process.exit(err ? 1 : 0);
}

(async () => {
  if (RESTORE_FILE) return runRestore(RESTORE_FILE);
  return run();
})().catch((e) => {
  console.error('❌ Hata:', e?.message || e);
  process.exit(1);
});
