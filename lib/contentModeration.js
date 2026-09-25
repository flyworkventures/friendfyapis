// UGC (kullanıcı üretimi karakter) içerik moderasyonu — App Store Guideline 1.1/1.2.
// Kullanıcı karakter oluşturmaya devam eder; yalnızca uygunsuz isim/persona reddedilir.
//
// İki katman:
//   1) Hızlı yerel blocklist — en bariz cinsel/nefret terimleri (anında, bedava).
//   2) OpenAI Moderation API (/v1/moderations, ücretsiz) — bağlam-duyarlı, çok dilli.
// API hatasında meşru kullanıcı mağdur olmasın diye geçirilir; yerel blocklist yine korur.
const axios = require('axios');

// Neredeyse hiçbir meşru karakter metninde geçmeyecek, açık terimler (substring eşleşme).
// Kısa/çok anlamlı İngilizce kelimeler (sex, am, ...) BİLİNÇLİ olarak yok — onları
// bağlam-duyarlı OpenAI Moderation yakalar (false-positive önlemek için).
const BLOCKLIST = [
  // EN — Not: substring eşleşme olduğu için yalnızca benign metinde neredeyse
  // hiç geçmeyen terimler. Kısa/çok anlamlı olanlar (sex, rape→grape, anal→canal)
  // BİLİNÇLİ olarak yok; onları bağlam-duyarlı OpenAI Moderation yakalar.
  'porn', 'pornographic', 'xxx', 'nsfw', 'hentai', 'blowjob', 'handjob',
  'cumshot', 'creampie', 'deepthroat', 'gangbang', 'bukkake', 'dildo',
  'bestiality', 'incest', 'pedophile', 'pedophilia', 'child porn',
  'cp video', 'nude photo', 'nudes', 'masturbat', 'escort service',
  // TR — ('oç ' çıkarıldı: "koç" false-positive; OpenAI yakalıyor)
  'porno', 'sikiş', 'sikis', 'sikeyim', 'orospu', 'götveren',
  'gotveren', 'amcık', 'amcik', 'yarrak', 'tecavüz', 'tecavuz', 'ensest',
  'fahişe', 'fahise', 'sürtük', 'pezevenk', 'çocuk porno',
  // RU (katalogda görülmüştü)
  'порно', 'секс', 'шлюха', 'блядь', 'хуй', 'пизда', 'ебать', 'минет',
];

// OpenAI Moderation'da bu kategoriler tetiklenirse reddet (1.1 objectionable).
const BLOCK_CATEGORIES = [
  'sexual',
  'sexual/minors',
  'hate',
  'hate/threatening',
  'harassment/threatening',
  'violence/graphic',
];

function localBlocklistHit(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  for (const term of BLOCKLIST) {
    if (t.includes(term)) return term;
  }
  return null;
}

async function openaiModerate(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: true, skipped: 'no_api_key' };
  try {
    const resp = await axios.post(
      'https://api.openai.com/v1/moderations',
      { model: 'omni-moderation-latest', input: text },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 5000 }
    );
    const result = resp.data?.results?.[0];
    if (!result) return { ok: true, skipped: 'no_result' };
    const cats = result.categories || {};
    const blocked = BLOCK_CATEGORIES.filter((c) => cats[c] === true);
    if (blocked.length) return { ok: false, reason: 'moderation', categories: blocked };
    return { ok: true };
  } catch (e) {
    // API hatası → meşru kullanıcıyı engelleme (yerel blocklist yine devrede).
    console.warn('[moderation] OpenAI moderation error (bypass):', e?.message || e);
    return { ok: true, skipped: 'api_error' };
  }
}

function toText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) return p.join(' ');
      } catch (_) {}
    }
    return t;
  }
  return String(v);
}

/**
 * Karakter alanlarını (isim, persona, ilgi alanları, konuşma tarzı) moderasyondan geçirir.
 * @returns {Promise<{ok: true} | {ok: false, reason: string, term?: string, categories?: string[]}>}
 */
async function moderateAgentContent(fields = {}) {
  const parts = [
    toText(fields.name),
    toText(fields.character),
    toText(fields.speakingStyle),
    toText(fields.interests),
    toText(fields.interestsType),
    toText(fields.characterTags),
  ].filter(Boolean);
  const text = parts.join('\n').trim();
  if (!text) return { ok: true };

  const hit = localBlocklistHit(text);
  if (hit) return { ok: false, reason: 'blocklist', term: hit };

  return openaiModerate(text);
}

/**
 * AI'ın ÜRETTİĞİ cevabı (output) moderasyondan geçirir — prompt jailbreak'lense
 * bile uygunsuz çıktının kullanıcıya ulaşmasını engellemek için son kalkan.
 * Fail-open: API hatasında engellemez (sohbeti kırmamak için; prompt-seviyesi zaten aktif).
 * @returns {Promise<{ok: true} | {ok: false, categories: string[]}>}
 */
async function moderateOutput(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: true };
  return openaiModerate(t);
}

module.exports = {
  moderateAgentContent,
  moderateOutput,
  localBlocklistHit,
  BLOCK_CATEGORIES,
};
