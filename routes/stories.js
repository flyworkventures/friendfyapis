const express = require('express');
const multer = require('multer');
const router = express.Router();
const middleware = require('../middleware/checkAuth');
const { getQuery, query, insertQuery } = require('../db');
const { assertJwtMatchesUserId } = require('./lib/assertJwtUserId');
const {
  uploadBufferToBunny,
  listBunnyImageUrls,
} = require('../lib/bunnyStorage');
const { generateCharacterReply } = require('./lib/chatReplyService');
const { normalizeLang } = require('./lib/agentLocalization');
const { localizeName } = require('./lib/nameLocalization');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const STORY_TTL_HOURS = 24;
const FIRST_SEED_MIN = 3;
/** Aynı karakter (bot) için viewer başına aynı günde / aktif pencerede max hikaye */
const MAX_STORIES_PER_CHARACTER = 3;

function toPhotoUrlArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((v) => typeof v === 'string' && v.trim() !== '');
  }
  if (typeof rawValue !== 'string') return [];
  const trimmed = rawValue.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => typeof v === 'string' && v.trim() !== '');
      }
    } catch (_) {}
  }
  return [trimmed];
}

function oppositeGender(userGender) {
  const g = String(userGender || '').toLowerCase();
  if (g === 'male' || g === 'man' || g === 'erkek') return 'female';
  if (g === 'female' || g === 'woman' || g === 'kadın' || g === 'kadin') {
    return 'male';
  }
  return null;
}

function onlyProactive(urls) {
  return (urls || []).filter((u) => /\/proactive\//i.test(String(u)));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function expiresAtSql() {
  return `DATE_ADD(NOW(), INTERVAL ${STORY_TTL_HOURS} HOUR)`;
}

function extractUrlsFromMessage(raw) {
  const out = [];
  if (raw == null) return out;
  const s = String(raw);
  if (/^https?:\/\//i.test(s.trim())) {
    out.push(s.trim());
    return out;
  }
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      for (const key of ['imageURL', 'imageUrl', 'url', 'mediaUrl', 'photoURL']) {
        const v = parsed[key];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push(v);
      }
    }
  } catch (_) {}
  const re = /https?:\/\/[^\s"'\\]+/gi;
  let m;
  while ((m = re.exec(s))) {
    out.push(m[0].replace(/[),.;]+$/, ''));
  }
  return out;
}

/**
 * Karakter story medyası: sohbetlerdeki proactive görseller + bot galerisi
 * `/proactive/` URL'leri. CDN klasör listesi yalnızca cache miss ve
 * DB'de hiç URL yoksa (yavaş) çağrılır.
 */
const _proactiveUrlCache = new Map(); // botId -> { at, urls }

async function loadBotProactiveMediaUrls(botId, photoURL, { allowCdnList = true } = {}) {
  const id = Number(botId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const cached = _proactiveUrlCache.get(id);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return cached.urls;
  }

  const urls = new Set();

  try {
    const msgRows = await getQuery(
      `SELECT m.message FROM \`messages\` m
       INNER JOIN \`coversations\` c ON c.id = m.conversationId
       WHERE c.botId = ?
         AND m.sender = 'bot'
         AND m.message LIKE '%/proactive/%'
       ORDER BY m.id DESC
       LIMIT 40`,
      [id]
    );
    for (const row of msgRows || []) {
      for (const u of extractUrlsFromMessage(row.message)) {
        if (/\/proactive\//i.test(u)) urls.add(u);
      }
    }
  } catch (_) {}

  for (const u of onlyProactive(toPhotoUrlArray(photoURL))) {
    urls.add(u);
  }

  // CDN list yavaş; yalnızca başka kaynak yoksa dene.
  if (allowCdnList && urls.size === 0) {
    try {
      const listed = await listBunnyImageUrls(`proactive/${id}/`);
      for (const u of listed) urls.add(u);
    } catch (_) {}
  }

  const list = [...urls];
  _proactiveUrlCache.set(id, { at: Date.now(), urls: list });
  return list;
}

/**
 * Gallery URL'li aktif story'leri aynı kayıt üzerinde proactive URL'ye çevir.
 * Story'yi expire ETMEZ (izlenme durumu kaybolmasın).
 * Zaten hepsi proactive ise no-op.
 */
async function repairStoriesWithProactive(userId) {
  const rows = await getQuery(
    `SELECT id, bot_id, media_url FROM \`user_feed_stories\`
     WHERE viewer_user_id = ? AND publisher_type = 'bot' AND expires_at > NOW()`,
    [userId]
  );
  const needsRepair = (rows || []).filter(
    (r) => !/\/proactive\//i.test(String(r.media_url || ''))
  );
  if (!needsRepair.length) return false;

  const usedMedia = await loadUsedMedia(userId);
  let changed = false;

  for (const row of needsRepair) {
    usedMedia.delete(String(row.media_url || ''));
    const botRows = await getQuery(
      'SELECT photoURL FROM `bots` WHERE id = ? LIMIT 1',
      [row.bot_id]
    );
    const urls = await loadBotProactiveMediaUrls(
      row.bot_id,
      botRows?.[0]?.photoURL,
      { allowCdnList: false }
    );
    const proactiveUrls = urls.filter((u) => /\/proactive\//i.test(u));
    if (!proactiveUrls.length) {
      // Proactive yoksa olduğu gibi bırak (yeni story üretip izlenmişleri sıfırlama).
      usedMedia.add(String(row.media_url || ''));
      continue;
    }
    const candidates = shuffle(
      proactiveUrls.filter((u) => !usedMedia.has(u))
    );
    const pick = candidates[0] || proactiveUrls[0];
    if (!pick || pick === row.media_url) {
      usedMedia.add(String(row.media_url || ''));
      continue;
    }
    try {
      const ok = await query(
        'UPDATE `user_feed_stories` SET `media_url` = ? WHERE id = ? LIMIT 1',
        [pick, row.id]
      );
      if (ok) {
        usedMedia.add(pick);
        changed = true;
      } else {
        usedMedia.add(String(row.media_url || ''));
      }
    } catch (_) {
      usedMedia.add(String(row.media_url || ''));
    }
  }
  return changed;
}

async function loadUser(userId) {
  const rows = await getQuery(
    'SELECT id, gender, photoURL, username FROM `users` WHERE id = ? LIMIT 1',
    [userId]
  );
  return rows?.[0] || null;
}

async function loadUsedMedia(userId) {
  const rows = await getQuery(
    'SELECT media_url FROM `user_feed_stories` WHERE viewer_user_id = ?',
    [userId]
  );
  return new Set((rows || []).map((r) => String(r.media_url)));
}

async function loadCandidateBots(targetGender) {
  let rows;
  if (targetGender) {
    rows = await getQuery(
      `SELECT id, name, gender, photoURL FROM \`bots\`
       WHERE system IN (1, 2) AND LOWER(gender) = ?
       ORDER BY id ASC`,
      [targetGender]
    );
  } else {
    rows = await getQuery(
      `SELECT id, name, gender, photoURL FROM \`bots\`
       WHERE system IN (1, 2)
       ORDER BY id ASC`
    );
  }

  // Feed hızı için: mesaj tablosu / CDN taraması YOK — yalnızca bot galerisi.
  // Proactive URL varsa onu tercih et; yoksa karakter fotoğrafları.
  const bots = [];
  for (const b of rows || []) {
    const all = toPhotoUrlArray(b.photoURL);
    const proactive = onlyProactive(all);
    const photoURLs = proactive.length ? proactive : all;
    if (!photoURLs.length) continue;
    bots.push({ ...b, photoURLs });
  }
  return bots;
}

async function insertFeedStory({
  viewerUserId,
  publisherType,
  publisherUserId = null,
  botId = null,
  mediaUrl,
  skipLimitCheck = false,
}) {
  try {
    if (
      !skipLimitCheck &&
      publisherType === 'bot' &&
      botId != null
    ) {
      const countRows = await getQuery(
        `SELECT COUNT(*) AS c FROM \`user_feed_stories\`
         WHERE viewer_user_id = ?
           AND publisher_type = 'bot'
           AND bot_id = ?
           AND expires_at > NOW()`,
        [viewerUserId, botId]
      );
      if (Number(countRows?.[0]?.c || 0) >= MAX_STORIES_PER_CHARACTER) {
        return null;
      }
    }
    const id = await insertQuery(
      `INSERT INTO \`user_feed_stories\`
        (\`viewer_user_id\`, \`publisher_type\`, \`publisher_user_id\`, \`bot_id\`, \`media_url\`, \`expires_at\`)
       VALUES (?, ?, ?, ?, ?, ${expiresAtSql()})`,
      [viewerUserId, publisherType, publisherUserId, botId, mediaUrl]
    );
    return id;
  } catch (e) {
    // unique media conflict → skip
    return null;
  }
}

/** Karakter başına 3'ten fazla aktif hikaye varsa eskileri düşür (en yeniler kalsın). */
async function enforceMaxStoriesPerCharacter(userId) {
  const rows = await getQuery(
    `SELECT id, bot_id FROM \`user_feed_stories\`
     WHERE viewer_user_id = ?
       AND publisher_type = 'bot'
       AND expires_at > NOW()
     ORDER BY bot_id ASC, created_at ASC, id ASC`,
    [userId]
  );
  const byBot = new Map();
  for (const row of rows || []) {
    const bid = row.bot_id;
    if (!byBot.has(bid)) byBot.set(bid, []);
    byBot.get(bid).push(row.id);
  }
  for (const ids of byBot.values()) {
    if (ids.length <= MAX_STORIES_PER_CHARACTER) continue;
    const excess = ids.slice(0, ids.length - MAX_STORIES_PER_CHARACTER);
    for (const id of excess) {
      await query(
        'UPDATE `user_feed_stories` SET `expires_at` = NOW() WHERE id = ? LIMIT 1',
        [id]
      ).catch(() => {});
    }
  }
}

async function ensureSeeded(userId, userGender) {
  const metaRows = await getQuery(
    'SELECT * FROM `user_story_seed_meta` WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const meta = metaRows?.[0] || null;
  const today = dayKey();

  const activeBotRows = await getQuery(
    `SELECT COUNT(DISTINCT bot_id) AS c FROM \`user_feed_stories\`
     WHERE viewer_user_id = ? AND publisher_type = 'bot' AND expires_at > NOW()`,
    [userId]
  );
  const activeBotCount = Number(activeBotRows?.[0]?.c || 0);

  const needsFirstSeed = !meta?.first_seeded_at;
  const needsDaily =
    !meta?.last_daily_key || String(meta.last_daily_key) !== today;

  if (!needsFirstSeed && !needsDaily && activeBotCount >= FIRST_SEED_MIN) {
    return false;
  }

  let toAdd = 0;
  if (needsFirstSeed || activeBotCount < FIRST_SEED_MIN) {
    toAdd = Math.max(0, FIRST_SEED_MIN - activeBotCount);
  }
  if (needsDaily && !needsFirstSeed) {
    // Günlük yeni paket: 0–5 arası ek karakter story
    toAdd = Math.floor(Math.random() * 6);
  }
  if (needsFirstSeed) {
    toAdd = Math.max(toAdd, Math.max(0, FIRST_SEED_MIN - activeBotCount));
  }

  if (toAdd === 0) {
    await query(
      `INSERT INTO \`user_story_seed_meta\` (user_id, first_seeded_at, last_daily_key)
       VALUES (?, COALESCE(?, NOW()), ?)
       ON DUPLICATE KEY UPDATE last_daily_key = VALUES(last_daily_key)`,
      [userId, meta?.first_seeded_at || null, today]
    );
    return false;
  }

  const targetGender = oppositeGender(userGender);
  const bots = shuffle(await loadCandidateBots(targetGender));
  const usedMedia = await loadUsedMedia(userId);

  const countRows = await getQuery(
    `SELECT bot_id, COUNT(*) AS c FROM \`user_feed_stories\`
     WHERE viewer_user_id = ? AND publisher_type = 'bot' AND expires_at > NOW()
     GROUP BY bot_id`,
    [userId]
  );
  const activeCountByBot = new Map();
  for (const row of countRows || []) {
    activeCountByBot.set(Number(row.bot_id), Number(row.c || 0));
  }

  let added = 0;
  const tryAddFrom = async (list) => {
    for (const bot of list) {
      if (added >= toAdd) break;
      const existing = activeCountByBot.get(Number(bot.id)) || 0;
      if (existing >= MAX_STORIES_PER_CHARACTER) continue;
      const candidates = shuffle(bot.photoURLs).filter((u) => !usedMedia.has(u));
      if (!candidates.length) continue;
      const mediaUrl = candidates[0];
      const id = await insertFeedStory({
        viewerUserId: userId,
        publisherType: 'bot',
        botId: bot.id,
        mediaUrl,
        skipLimitCheck: true,
      });
      if (id) {
        usedMedia.add(mediaUrl);
        activeCountByBot.set(Number(bot.id), existing + 1);
        added += 1;
      }
    }
  };

  await tryAddFrom(bots);

  if (
    (needsFirstSeed || activeBotCount + added < FIRST_SEED_MIN) &&
    targetGender
  ) {
    await tryAddFrom(shuffle(await loadCandidateBots(null)));
  }

  await query(
    `INSERT INTO \`user_story_seed_meta\` (user_id, first_seeded_at, last_daily_key)
     VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       first_seeded_at = COALESCE(first_seeded_at, VALUES(first_seeded_at)),
       last_daily_key = VALUES(last_daily_key)`,
    [userId, today]
  );
  return added > 0;
}

async function buildFeed(userId, lang = 'en') {
  const rows = await getQuery(
    `SELECT s.*,
            CASE WHEN v.feed_story_id IS NULL THEN 0 ELSE 1 END AS viewed,
            b.name AS bot_name,
            b.photoURL AS bot_photo,
            b.gender AS bot_gender,
            b.system AS bot_system
     FROM \`user_feed_stories\` s
     LEFT JOIN \`story_views\` v
       ON v.feed_story_id = s.id AND v.viewer_user_id = s.viewer_user_id
     LEFT JOIN \`bots\` b ON b.id = s.bot_id
     WHERE s.viewer_user_id = ? AND s.expires_at > NOW()
     ORDER BY s.created_at ASC`,
    [userId]
  );

  const selfItems = [];
  const byBot = new Map();

  for (const row of rows || []) {
    const item = {
      id: row.id,
      mediaUrl: row.media_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewed: Number(row.viewed) === 1,
      publisherType: row.publisher_type,
    };

    if (row.publisher_type === 'self') {
      selfItems.push(item);
      continue;
    }

    const botId = row.bot_id;
    if (!byBot.has(botId)) {
      const avatarUrls = toPhotoUrlArray(row.bot_photo);
      const sys = Number(row.bot_system);
      const rawName = row.bot_name || 'Character';
      const displayName =
        sys === 1 || sys === 2 ? localizeName(rawName, lang) : rawName;
      byBot.set(botId, {
        botId,
        name: displayName,
        avatarUrl: avatarUrls[0] || row.media_url,
        gender: row.bot_gender || null,
        items: [],
      });
    }
    byBot.get(botId).items.push(item);
  }

  const characters = [...byBot.values()].map((c) => {
    // Güvenlik: karakter başına max 3 (en yeni olanlar)
    if (c.items.length > MAX_STORIES_PER_CHARACTER) {
      c.items = c.items.slice(-MAX_STORIES_PER_CHARACTER);
    }
    const viewedAll = c.items.every((i) => i.viewed);
    return { ...c, viewedAll };
  });

  // İzlenmeyenler önde, izlenenler sonda (soluk)
  characters.sort((a, b) => {
    if (a.viewedAll !== b.viewedAll) return a.viewedAll ? 1 : -1;
    return 0;
  });

  const user = await loadUser(userId);
  return {
    self: {
      avatarUrl: user?.photoURL || null,
      name: user?.username || null,
      items: selfItems,
      viewedAll: selfItems.length === 0 || selfItems.every((i) => i.viewed),
    },
    characters,
  };
}

router.post('/feed', middleware, async (req, res) => {
  try {
    const { userId } = req.body || {};
    const lang = normalizeLang(req.body?.lang);
    if (!userId) {
      return res.status(400).json({ success: false, msg: 'User ID is required' });
    }
    const authCheck = assertJwtMatchesUserId(req, userId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json(authCheck.json);
    }

    const user = await loadUser(userId);
    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }

    // 1) Hızlı yol: mevcut feed'i hemen oku
    await enforceMaxStoriesPerCharacter(userId);
    let feed = await buildFeed(userId, lang);
    const charCount = (feed.characters || []).length;

    // 2) Hiç / yetersiz story varsa kısa seed (bloklar); aksi halde arka planda
    if (charCount < FIRST_SEED_MIN) {
      await ensureSeeded(userId, user.gender);
      feed = await buildFeed(userId, lang);
    } else {
      setImmediate(() => {
        ensureSeeded(userId, user.gender).catch((e) =>
          console.warn('[stories] bg seed:', e?.message || e)
        );
        repairStoriesWithProactive(userId).catch((e) =>
          console.warn('[stories] bg repair:', e?.message || e)
        );
      });
    }

    return res.status(200).json({ success: true, feed });
  } catch (error) {
    console.error('stories/feed error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message,
    });
  }
});

router.post('/view', middleware, async (req, res) => {
  try {
    const { userId, storyId, storyIds } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, msg: 'User ID is required' });
    }
    const authCheck = assertJwtMatchesUserId(req, userId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json(authCheck.json);
    }

    const ids = [];
    if (Array.isArray(storyIds)) {
      for (const id of storyIds) {
        const n = Number(id);
        if (Number.isFinite(n) && n > 0) ids.push(n);
      }
    }
    const single = Number(storyId);
    if (Number.isFinite(single) && single > 0) ids.push(single);
    if (!ids.length) {
      return res.status(400).json({ success: false, msg: 'storyId required' });
    }

    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 1) {
      await query(
        `INSERT IGNORE INTO \`story_views\` (viewer_user_id, feed_story_id)
         VALUES (?, ?)`,
        [userId, uniqueIds[0]]
      );
    } else if (uniqueIds.length > 1) {
      const placeholders = uniqueIds.map(() => '(?, ?)').join(', ');
      const params = [];
      for (const id of uniqueIds) {
        params.push(userId, id);
      }
      await query(
        `INSERT IGNORE INTO \`story_views\` (viewer_user_id, feed_story_id)
         VALUES ${placeholders}`,
        params
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('stories/view error:', error);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
});

router.post('/create', middleware, upload.single('photo'), async (req, res) => {
  try {
    const userId = req.body?.userId;
    if (!userId) {
      return res.status(400).json({ success: false, msg: 'User ID is required' });
    }
    const authCheck = assertJwtMatchesUserId(req, userId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json(authCheck.json);
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, msg: 'photo is required' });
    }

    const ext =
      (req.file.mimetype || '').includes('png')
        ? 'png'
        : (req.file.mimetype || '').includes('webp')
          ? 'webp'
          : 'jpg';
    const remotePath = `stories/user/${userId}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const mediaUrl = await uploadBufferToBunny(
      req.file.buffer,
      remotePath,
      req.file.mimetype || 'image/jpeg'
    );

    const id = await insertFeedStory({
      viewerUserId: Number(userId),
      publisherType: 'self',
      publisherUserId: Number(userId),
      mediaUrl,
    });

    return res.status(200).json({
      success: true,
      story: { id, mediaUrl },
    });
  } catch (error) {
    console.error('stories/create error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message,
    });
  }
});

/**
 * Story cevabı: sohbet oluştur/aç + alıntılı story mesajı.
 */
router.post('/reply', middleware, async (req, res) => {
  try {
    const { userId, botId, message, storyMediaUrl, lang } = req.body || {};
    if (!userId || !botId || !message) {
      return res.status(400).json({
        success: false,
        msg: 'userId, botId and message are required',
      });
    }
    const authCheck = assertJwtMatchesUserId(req, userId);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json(authCheck.json);
    }

    let conversations = await getQuery(
      'SELECT * FROM `coversations` WHERE userId = ? AND botId = ? LIMIT 1',
      [userId, botId]
    );
    let conversationId = conversations?.[0]?.id;
    if (!conversationId) {
      conversationId = await insertQuery(
        'INSERT INTO `coversations` (`userId`, `botId`, `current_chat_state`, `lastMessage`, `last_message_at`, `started_at`) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, botId, 'normal', null, null, null]
      );
    }
    if (!conversationId) {
      return res.status(500).json({ success: false, msg: 'Could not open chat' });
    }

    const botRows = await getQuery(
      'SELECT name FROM `bots` WHERE id = ? LIMIT 1',
      [botId]
    );
    const botName = botRows?.[0]?.name || null;

    const text = String(message).trim();
    const payload = JSON.stringify({
      text,
      storyMediaUrl: storyMediaUrl ? String(storyMediaUrl).trim() : null,
      storyBotName: botName,
    });

    const ok = await query(
      "INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`, `message_type`) VALUES (?, 'user', ?, NOW(), 'story_reply')",
      [conversationId, payload]
    );
    if (!ok) {
      return res.status(500).json({ success: false, msg: 'Could not send message' });
    }

    await query(
      'UPDATE `coversations` SET `lastMessage` = ?, `last_message_at` = NOW() WHERE id = ? LIMIT 1',
      [text.slice(0, 500), conversationId]
    ).catch(() => {});

    // Story'den yazılan mesaja karakter de cevap versin (chat send-message ile aynı akış).
    const replyLang = normalizeLang(lang);
    query(
      "UPDATE `coversations` SET `current_chat_state` = 'bot_typing' WHERE id = ? LIMIT 1",
      [conversationId]
    ).catch(() => {});
    generateCharacterReply(conversationId, replyLang, text)
      .catch((err) => {
        console.error('[stories/reply] character reply error:', err?.message || err);
      })
      .finally(() => {
        query(
          "UPDATE `coversations` SET `current_chat_state` = 'normal' WHERE id = ? LIMIT 1",
          [conversationId]
        ).catch(() => {});
      });

    return res.status(200).json({
      success: true,
      conversationId,
    });
  } catch (error) {
    console.error('stories/reply error:', error);
    return res.status(500).json({ success: false, msg: 'Server error' });
  }
});

module.exports = router;
