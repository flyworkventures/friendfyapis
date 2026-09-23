// Avatar görsel moderasyon denetimi — App Store Guideline 1.1 (kışkırtıcı görsel).
// Katalog (herkese görünen) bot avatarlarını OpenAI görsel moderasyonundan geçirir
// ve cinsel/suggestive skoruna göre RİSKLİ olanları listeler. HİÇBİR ŞEYİ DEĞİŞTİRMEZ
// (salt-okunur denetim). Çıktı: konsolda sıralı liste + scripts/backups/avatar_audit_<zaman>.json
//
// DB erişimi gerekir → allowlist'li bir hosttan (sunucu) çalıştırın.
//
// Kullanım:
//   node scripts/audit_avatar_moderation.js                 # katalog (system 1,2)
//   node scripts/audit_avatar_moderation.js --all           # kullanıcı karakterleri (system 0) dahil
//   node scripts/audit_avatar_moderation.js --threshold 0.3 # eşik (varsayılan 0.2)
//   node scripts/audit_avatar_moderation.js --concurrency 6
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getQuery } = require('../db');

const INCLUDE_ALL = process.argv.includes('--all');
const argNum = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) || def : def;
};
const THRESHOLD = argNum('--threshold', 0.2);
const CONCURRENCY = Math.max(1, Math.min(8, argNum('--concurrency', 4)));
const BACKUP_DIR = path.join(__dirname, 'backups');

function toUrls(v) {
  let a = [];
  try { const p = JSON.parse(v); if (Array.isArray(p)) a = p; } catch (_) {}
  if (!a.length && typeof v === 'string' && v.trim()) a = [v.trim()];
  return a.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim());
}

async function moderateImage(url, attempt = 1) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY yok');
  try {
    const r = await axios.post(
      'https://api.openai.com/v1/moderations',
      { model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url } }] },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 25000 }
    );
    const res = r.data?.results?.[0] || {};
    const cs = res.category_scores || {};
    const sexual = Math.max(Number(cs.sexual || 0), Number(cs['sexual/minors'] || 0));
    return { flagged: !!res.flagged, sexual, minors: Number(cs['sexual/minors'] || 0) };
  } catch (e) {
    // İndirilemeyen/timeout olan görseli bir kez daha dene.
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800));
      return moderateImage(url, attempt + 1);
    }
    throw e;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

(async () => {
  const where = INCLUDE_ALL ? 'system IN (0,1,2)' : 'system IN (1,2)';
  const rows = await getQuery(`SELECT id, name, system, photoURL FROM \`bots\` WHERE ${where}`);
  const tasks = [];
  for (const b of rows) {
    const urls = toUrls(b.photoURL);
    urls.forEach((url, idx) =>
      tasks.push({ botId: b.id, name: b.name, system: b.system, photoIndex: idx, url, isCover: idx === 0 })
    );
  }
  console.log(`${rows.length} bot, ${tasks.length} görsel taranıyor (eşik=${THRESHOLD}, eşzamanlı=${CONCURRENCY})…\n`);

  let done = 0, errors = 0;
  const results = await mapLimit(tasks, CONCURRENCY, async (t) => {
    try {
      const m = await moderateImage(t.url);
      done++;
      if (done % 20 === 0) process.stdout.write(`  …${done}/${tasks.length}\n`);
      return { ...t, ...m };
    } catch (e) {
      errors++;
      return { ...t, error: e?.response?.status || e?.message || 'err', sexual: -1 };
    }
  });

  const risky = results
    .filter((r) => r.sexual >= THRESHOLD)
    .sort((a, b) => b.sexual - a.sexual);

  console.log(`\n════════ RİSKLİ AVATARLAR (${risky.length}) ════════`);
  if (!risky.length) {
    console.log('Eşiği aşan avatar yok. 🎉');
  } else {
    for (const r of risky) {
      const tag = r.flagged ? 'FLAGGED' : 'yüksek skor';
      const cover = r.isCover ? ' [KAPAK]' : '';
      console.log(
        `  sexual=${r.sexual.toFixed(3)} ${r.minors > 0.1 ? '⚠️MINORS ' : ''}(${tag}) bot ${r.botId} "${r.name}" foto#${r.photoIndex}${cover}\n    ${r.url}`
      );
    }
  }

  // Eşik altında olsa bile en yüksek skorlu 15 avatarı göster (gözle değerlendir:
  // Apple "suggestive" görselde OpenAI'dan daha katı olabilir).
  const topN = results
    .filter((r) => r.sexual >= 0)
    .sort((a, b) => b.sexual - a.sexual)
    .slice(0, 15);
  console.log(`\n──────── EN YÜKSEK 15 SKOR (gözle bak) ────────`);
  for (const r of topN) {
    const cover = r.isCover ? ' [KAPAK]' : '';
    console.log(`  sexual=${r.sexual.toFixed(3)} bot ${r.botId} "${r.name}" foto#${r.photoIndex}${cover}\n    ${r.url}`);
  }

  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.log(`\n──────── TARANAMAYAN (${failed.length}) ────────`);
    for (const r of failed) {
      console.log(`  bot ${r.botId} "${r.name}" foto#${r.photoIndex} (${r.error})\n    ${r.url}`);
    }
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(BACKUP_DIR, `avatar_audit_${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ threshold: THRESHOLD, total: tasks.length, risky }, null, 2), 'utf8');

  console.log(`\n── ÖZET ── tarandı:${tasks.length} riskli:${risky.length} hata:${errors}`);
  console.log(`Tam rapor: ${outPath}`);
  process.exit(0);
})().catch((e) => {
  console.error('❌ Hata:', e?.message || e);
  process.exit(1);
});
