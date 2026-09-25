// Tüm karakterlerde (bots) "oyun/game" izi tarar — SALT-OKUNUR, değiştirmez.
// Alanlar: name, character (persona/konuşma konusu), interests, interestsType, characterTags.
//
// Kullanım:
//   node scripts/audit_gaming_references.js
require('dotenv').config();
const { getQuery } = require('../db');

// Kelime sınırlı eşleşme → "koyun"(sheep) gibi false-positive'leri eler.
// ("oyuncu" = oyuncu/gamer eşleşir; snippet'e bakıp karar verilir.)
const GAME_RE = /\b(oyun\w*|game\w*|gaming|gamer\w*|e-?spor\w*|espor\w*|moba|konsol\w*|playstation|xbox|gamingandentertainment)\b/i;

function fieldText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(' | ');
  const t = String(v).trim();
  if (t.startsWith('[')) {
    try { const p = JSON.parse(t); if (Array.isArray(p)) return p.join(' | '); } catch (_) {}
  }
  return t;
}

function hit(text) {
  const m = GAME_RE.exec(String(text || ''));
  return m ? m[0] : null;
}

(async () => {
  const rows = await getQuery(
    'SELECT id, name, system, `character`, interests, interestsType, characterTags FROM `bots`'
  );
  const flagged = [];
  for (const b of rows) {
    const fields = {};
    const nameHit = hit(b.name); if (nameHit) fields.name = nameHit;
    const persHit = hit(b.character); if (persHit) fields.persona = persHit;
    const intHit = hit(fieldText(b.interests)); if (intHit) fields.interests = intHit;
    const typHit = hit(fieldText(b.interestsType)); if (typHit) fields.interestsType = typHit;
    const tagHit = hit(fieldText(b.characterTags)); if (tagHit) fields.characterTags = tagHit;
    if (Object.keys(fields).length) flagged.push({ b, fields });
  }

  console.log(`${rows.length} karakter tarandı — "oyun/game" izi olan: ${flagged.length}\n`);
  for (const { b, fields } of flagged) {
    const where = Object.entries(fields).map(([k, v]) => `${k}:"${v}"`).join(', ');
    console.log(`bot ${b.id} sys=${b.system} "${b.name}" → ${where}`);
    if (fields.persona) {
      console.log(`   persona: ${String(b.character || '').replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  if (!flagged.length) console.log('Temiz — hiçbir karakterde oyun/game izi yok. 🎉');
  process.exit(0);
})().catch((e) => { console.error('❌ Hata:', e?.message || e); process.exit(1); });
