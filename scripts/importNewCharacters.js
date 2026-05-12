const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { getQuery, query } = require('../db');

const BUNNY_STORAGE_ZONE = 'fakefriendstorage';
const BUNNY_PULL_ZONE_BASE = 'https://fakefriend.b-cdn.net';
const BUNNY_STORAGE_BASE = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}`;
const BUNNY_ACCESS_KEY = '68664abb-b19e-47e7-acd67dba78a5-e90a-4386';

const args = process.argv.slice(2);
const CHARACTER_ROOT = args[0]
  ? path.resolve(args[0])
  : path.join(__dirname, '..', 'database', 'friendify_yeni_karakterler');
const UPLOAD_PREFIX = args[1] || 'friendify-yeni-karakterler';
/** Boş: system=2 güncelle (4. arg opsiyonel CDN alt klasörü). male | female: cinsiyete göre şablon güncelle — her klasördeki TÜM "ChatGPT Image*.png" CDN'e gider, photoURL JSON dizisi olur. male-insert | male-resync-english: erkek akışları. */
const MODE = (args[2] || '').toLowerCase();

/** Yeni eklenen erkek şablonları için (Türkçe olmayan) isimler — klasör sırasıyla eşlenir */
const ENGLISH_MALE_NAMES = [
  'Marcus',
  'Ethan',
  'Julian',
  'Adrian',
  'Leo',
  'Owen',
  'Felix',
  'Oscar',
  'Victor',
  'Simon',
  'Damian',
  'Albert'
];

const INTERESTS_POOL = [
  'video oyunları (pc/steam)',
  'müzik festivali gezmek',
  'fotoğrafçılık (portre)',
  'yeni mutfakları keşfetmek',
  'doğa yürüyüşü ve kampçılık',
  'bilim kurgu ve fantazi filmleri',
  'programlama ve kodlama',
  'podcast dinlemek',
  'anime ve manga',
  'dijital sanat ve illüstrasyon',
  'satranç ve strateji oyunları',
  'girişimcilik ve start-up kurmak'
];

const INTEREST_TYPES_POOL = [
  'gamingAndEntertainment',
  'musicAndSound',
  'moviesAndBooks',
  'artsAndDesign',
  'foodAndDrink',
  'natureAndOutdoors',
  'techAndScience',
  'businessAndFinance'
];

const TAG_POOL = [
  'enerjik',
  'samimi',
  'mizahi',
  'yaratıcı',
  'özgüvenli',
  'yardımsever',
  'meraklı',
  'sıcakkanlı'
];

const NAME_POOL = [
  'Lina',
  'Nora',
  'Mina',
  'Aden',
  'Selin',
  'Yelda',
  'Duru',
  'İlay',
  'Sena',
  'Miraç',
  'Alin'
];

const MALE_NAME_POOL = [
  'Kuzey',
  'Eren',
  'Doruk',
  'Baris',
  'Arin',
  'Mert',
  'Tuna',
  'Deniz',
  'Kaan',
  'Arel'
];

function pickFromPool(pool, count, seed) {
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    const index = (seed + i * 3) % pool.length;
    chosen.push(pool[index]);
  }
  return [...new Set(chosen)];
}

async function uploadToBunny(localFilePath, remotePath, contentType) {
  const fileBuffer = await fs.readFile(localFilePath);
  const uploadUrl = `${BUNNY_STORAGE_BASE}/${remotePath}`;
  await axios.put(uploadUrl, fileBuffer, {
    headers: {
      AccessKey: BUNNY_ACCESS_KEY,
      'Content-Type': contentType
    },
    maxBodyLength: Infinity
  });
  return `${BUNNY_PULL_ZONE_BASE}/${remotePath}`;
}

function inferGenderFromFileName(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('female')) return 'Kadın';
  if (lower.includes('male')) return 'Erkek';
  return 'Erkek';
}

/**
 * Tek görsel seçimi (fallback): ChatGPT yoksa Gemini / male_N.png / char*.png vb.
 */
function listChatGptPngFiles(files) {
  return files
    .filter((f) => f.toLowerCase().endsWith('.png') && /chatgpt\s+image/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function pickPhotoFileAsync(absDir, files, charDir) {
  const pngs = files.filter((f) => f.toLowerCase().endsWith('.png'));
  if (!pngs.length) return null;

  async function newestOf(list) {
    if (!list.length) return null;
    const withStat = await Promise.all(
      list.map(async (f) => {
        const st = await fs.stat(path.join(absDir, f));
        return { f, mtime: st.mtimeMs };
      })
    );
    withStat.sort((a, b) => b.mtime - a.mtime);
    return withStat[0].f;
  }

  const chatgpt = pngs.filter((f) => /chatgpt\s+image/i.test(f));
  if (chatgpt.length) return await newestOf(chatgpt);

  const gemini = pngs.filter((f) => /gemini_generated/i.test(f));
  if (gemini.length) return await newestOf(gemini);

  const num = (charDir.match(/\d+/) || [])[0];
  const dirLower = charDir.toLowerCase();
  if (dirLower.startsWith('male_') && num) {
    const exact = pngs.find((f) => f.toLowerCase() === `male_${num}.png`);
    if (exact) return exact;
  }
  if (dirLower.startsWith('female_') && num) {
    const exact = pngs.find((f) => f.toLowerCase() === `female_${num}.png`);
    if (exact) return exact;
  }
  const charPref = pngs.find((f) => /^char.*\.png$/i.test(f));
  if (charPref) return charPref;
  return await newestOf(pngs);
}

/**
 * photoURL dizisi: önce klasördeki TÜM ChatGPT Image PNG'leri CDN'e yüklenir.
 * Hiç yoksa tek görsel fallback (pickPhotoFileAsync).
 */
async function uploadChatGptPortraitUrls(absDir, charDir, remoteFolderBase, files) {
  let pngFiles = listChatGptPngFiles(files);
  if (!pngFiles.length) {
    const one = await pickPhotoFileAsync(absDir, files, charDir);
    if (!one) return { urls: [], pickedFiles: [] };
    pngFiles = [one];
  }
  const urls = [];
  for (const fileName of pngFiles) {
    const remotePath = `${remoteFolderBase}/${fileName}`;
    const url = await uploadToBunny(path.join(absDir, fileName), remotePath, 'image/png');
    urls.push(url);
  }
  return { urls, pickedFiles: pngFiles };
}

async function getVoiceIdByGender(gender) {
  const wanted = gender === 'Kadın' ? 'female' : 'male';
  const rows = await getQuery(
    'SELECT elevenlabs_id FROM `voices` WHERE gender = ? ORDER BY id ASC LIMIT 1',
    [wanted]
  );
  return rows?.[0]?.elevenlabs_id || null;
}

/** Erkek klasörlerini CDN'e yükleyip yeni system=2 bot kaydı oluşturur (mevcut şablonlara dokunmaz). */
async function runInsertMaleTemplates() {
  const dirEntries = await fs.readdir(CHARACTER_ROOT, { withFileTypes: true });
  const charDirs = dirEntries
    .filter((e) => e.isDirectory() && e.name.startsWith('male_'))
    .map((e) => e.name)
    .sort((a, b) => {
      const ai = Number((a.match(/\d+/) || ['0'])[0]);
      const bi = Number((b.match(/\d+/) || ['0'])[0]);
      return ai - bi;
    });

  if (!charDirs.length) {
    throw new Error('No male_* folders found.');
  }

  /** Önceki CDN güncellemeleriyle çakışmasın: alt klasör (4. arg veya new-<timestamp>) */
  const cdnSegment = args[3] || `new-${Date.now()}`;
  console.warn(
    `[importNewCharacters] Mod: male-insert — yeni system=2 (Erkek) kayıtları; CDN alt yol: ${UPLOAD_PREFIX}/${cdnSegment}/…`
  );
  const gender = 'Erkek';
  const voiceId = await getVoiceIdByGender(gender);
  const results = [];

  for (let i = 0; i < charDirs.length; i += 1) {
    const charDir = charDirs[i];
    const name = ENGLISH_MALE_NAMES[i % ENGLISH_MALE_NAMES.length];
    const absDir = path.join(CHARACTER_ROOT, charDir);
    const files = await fs.readdir(absDir);
    const remoteFolderBase = `${UPLOAD_PREFIX}/${cdnSegment}/${charDir}`;
    const { urls: photoUrls, pickedFiles } = await uploadChatGptPortraitUrls(
      absDir,
      charDir,
      remoteFolderBase,
      files
    );
    const rivFile = files.find((f) => f.toLowerCase().endsWith('.riv'));

    if (!photoUrls.length || !rivFile) {
      results.push({
        charDir,
        status: 'skipped_missing_files',
        photoCount: photoUrls.length,
        hasRiv: !!rivFile
      });
      continue;
    }

    const riveRemotePath = `${remoteFolderBase}/${rivFile}`;
    const riveAvatarUrl = await uploadToBunny(path.join(absDir, rivFile), riveRemotePath, 'application/octet-stream');

    const dup = await getQuery('SELECT id FROM `bots` WHERE rive_avatar = ? LIMIT 1', [riveAvatarUrl]);
    if (dup.length > 0) {
      results.push({
        charDir,
        status: 'already_exists',
        botId: dup[0].id,
        photoUrls,
        pickedFiles,
        riveAvatarUrl
      });
      continue;
    }

    const age = 22 + (i % 8);
    const interests = pickFromPool(INTERESTS_POOL, 6, i + 11);
    const interestsType = pickFromPool(INTEREST_TYPES_POOL, 3, i + 3);
    const tags = pickFromPool(TAG_POOL, 4, i + 7);

    const insertSql = `
      INSERT INTO bots
      (name, creatorId, \`character\`, photoURL, rive_avatar, system, gender, age, exampleResponse, speakingStyle, interests, country, characterTags, voiceId, interestsType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insertValues = [
      name,
      '0',
      `${name} is upbeat, friendly, and keeps the conversation flowing naturally.`,
      JSON.stringify(photoUrls),
      riveAvatarUrl,
      2,
      gender,
      age,
      `Hi! I'm ${name} — want to chat?`,
      'Warm, clear, and conversational.',
      JSON.stringify(interests),
      'tr',
      JSON.stringify(tags),
      voiceId,
      JSON.stringify(interestsType)
    ];

    const inserted = await query(insertSql, insertValues);
    results.push({
      charDir,
      status: inserted ? 'inserted' : 'insert_failed',
      name,
      gender,
      photoUrls,
      pickedFiles,
      riveAvatarUrl
    });
  }

  console.log(JSON.stringify({ mode: 'male-insert', total: results.length, results }, null, 2));
}

/**
 * Marcus–Leo: klasördeki tüm ChatGPT görsellerini photoURL dizisi olarak yazar.
 */
async function runResyncEnglishMaleTemplates() {
  const dirEntries = await fs.readdir(CHARACTER_ROOT, { withFileTypes: true });
  const charDirs = dirEntries
    .filter((e) => e.isDirectory() && e.name.startsWith('male_'))
    .map((e) => e.name)
    .sort((a, b) => {
      const ai = Number((a.match(/\d+/) || ['0'])[0]);
      const bi = Number((b.match(/\d+/) || ['0'])[0]);
      return ai - bi;
    });

  if (!charDirs.length) {
    throw new Error('No male_* folders found.');
  }

  const names = charDirs.map((_, i) => ENGLISH_MALE_NAMES[i % ENGLISH_MALE_NAMES.length]);
  const ph = names.map(() => '?').join(',');
  const rows = await getQuery(
    `SELECT id, name FROM bots WHERE system = 2 AND gender = 'Erkek' AND name IN (${ph}) ORDER BY FIELD(name, ${ph}), id ASC`,
    [...names, ...names]
  );

  const byName = {};
  for (const row of rows) {
    if (!byName[row.name]) byName[row.name] = row;
  }

  if (names.some((n) => !byName[n])) {
    console.warn(
      '[male-resync-english] Bazı isimler DB\'de yok. Beklenen:',
      names,
      'Eksik:',
      names.filter((n) => !byName[n])
    );
  }

  const cdnSegment = args[3] || `resync-${Date.now()}`;
  console.warn(
    `[importNewCharacters] Mod: male-resync-english — CDN: ${UPLOAD_PREFIX}/${cdnSegment}/…`
  );

  const gender = 'Erkek';
  const voiceId = await getVoiceIdByGender(gender);
  const results = [];

  for (let i = 0; i < charDirs.length; i += 1) {
    const charDir = charDirs[i];
    const name = names[i];
    const targetBot = byName[name];
    if (!targetBot) {
      results.push({ charDir, name, status: 'no_db_bot' });
      continue;
    }

    const absDir = path.join(CHARACTER_ROOT, charDir);
    const files = await fs.readdir(absDir);
    const remoteFolderBase = `${UPLOAD_PREFIX}/${cdnSegment}/${charDir}`;
    const { urls: photoUrls, pickedFiles } = await uploadChatGptPortraitUrls(
      absDir,
      charDir,
      remoteFolderBase,
      files
    );
    const rivFile = files.find((f) => f.toLowerCase().endsWith('.riv'));

    if (!photoUrls.length || !rivFile) {
      results.push({
        charDir,
        botId: targetBot.id,
        status: 'skipped_missing_files',
        photoCount: photoUrls.length,
        hasRiv: !!rivFile
      });
      continue;
    }

    const riveRemotePath = `${remoteFolderBase}/${rivFile}`;
    const riveAvatarUrl = await uploadToBunny(path.join(absDir, rivFile), riveRemotePath, 'application/octet-stream');

    const updateSql = `
      UPDATE bots
      SET photoURL = ?, rive_avatar = ?, voiceId = ?, gender = ?
      WHERE id = ? AND system = 2
      LIMIT 1
    `;
    const updated = await query(updateSql, [
      JSON.stringify(photoUrls),
      riveAvatarUrl,
      voiceId,
      gender,
      targetBot.id
    ]);

    results.push({
      charDir,
      botId: targetBot.id,
      name: targetBot.name,
      status: updated ? 'updated' : 'update_failed',
      photoUrls,
      pickedFiles,
      riveAvatarUrl
    });
  }

  console.log(JSON.stringify({ mode: 'male-resync-english', total: results.length, results }, null, 2));
}

async function run() {
  if (MODE === 'male-insert') {
    await runInsertMaleTemplates();
    return;
  }
  if (MODE === 'male-resync-english') {
    await runResyncEnglishMaleTemplates();
    return;
  }

  const dirEntries = await fs.readdir(CHARACTER_ROOT, { withFileTypes: true });
  let charDirs = dirEntries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.startsWith('char') || entry.name.startsWith('male_') || entry.name.startsWith('female_'))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const ai = Number((a.match(/\d+/) || ['0'])[0]);
      const bi = Number((b.match(/\d+/) || ['0'])[0]);
      return ai - bi;
    });

  if (MODE === 'male') {
    charDirs = charDirs.filter((name) => name.startsWith('male_'));
  } else if (MODE === 'female') {
    charDirs = charDirs.filter(
      (name) => name.startsWith('char') || name.startsWith('female_')
    );
  }

  let existingSystemTwoBots;
  if (MODE === 'male') {
    existingSystemTwoBots = await getQuery(
      'SELECT id, name, rive_avatar, photoURL FROM `bots` WHERE system = 2 AND gender = ? ORDER BY id ASC',
      ['Erkek']
    );
  } else if (MODE === 'female') {
    existingSystemTwoBots = await getQuery(
      'SELECT id, name, rive_avatar, photoURL FROM `bots` WHERE system = 2 AND gender = ? ORDER BY id ASC',
      ['Kadın']
    );
  } else {
    existingSystemTwoBots = await getQuery(
      'SELECT id, name, rive_avatar, photoURL FROM `bots` WHERE system = 2 ORDER BY id ASC',
      []
    );
  }
  if (!existingSystemTwoBots.length) {
    throw new Error('No system=2 bots found to update.');
  }
  if (!charDirs.length) {
    throw new Error('No character folders found under CHARACTER_ROOT.');
  }

  if (MODE === 'male' || MODE === 'female') {
    console.warn(`[importNewCharacters] Mod: ${MODE} — klasör ve DB cinsiyeti eşlemesi kullanılıyor.`);
  }

  const updateCount = Math.min(charDirs.length, existingSystemTwoBots.length);
  if (charDirs.length < existingSystemTwoBots.length) {
    console.warn(
      `[importNewCharacters] Klasör sayısı (${charDirs.length}) system=2 kayıt sayısından (${existingSystemTwoBots.length}) az; ` +
        `yalnızca ilk ${updateCount} bot güncellenecek. Güncellenmeyen bot id'leri: ` +
        existingSystemTwoBots.slice(updateCount).map((b) => b.id).join(', ')
    );
  }

  const results = [];

  for (let i = 0; i < updateCount; i += 1) {
    const charDir = charDirs[i];
    const absDir = path.join(CHARACTER_ROOT, charDir);
    const files = await fs.readdir(absDir);
    const batchSeg = args[3];
    const remoteFolderBase = batchSeg
      ? `${UPLOAD_PREFIX}/${batchSeg}/${charDir}`
      : `${UPLOAD_PREFIX}/${charDir}`;
    const { urls: photoUrls, pickedFiles } = await uploadChatGptPortraitUrls(
      absDir,
      charDir,
      remoteFolderBase,
      files
    );
    const rivFile = files.find((f) => f.toLowerCase().endsWith('.riv'));

    if (!photoUrls.length || !rivFile) {
      results.push({
        charDir,
        status: 'skipped_missing_files',
        photoCount: photoUrls.length,
        hasRiv: !!rivFile
      });
      continue;
    }

    const gender = inferGenderFromFileName(rivFile);
    const voiceId = await getVoiceIdByGender(gender);
    const riveRemotePath = `${remoteFolderBase}/${rivFile}`;
    const riveAvatarUrl = await uploadToBunny(path.join(absDir, rivFile), riveRemotePath, 'application/octet-stream');
    const targetBot = existingSystemTwoBots[i];
    const updateSql = `
      UPDATE bots
      SET photoURL = ?, rive_avatar = ?, voiceId = ?, gender = ?
      WHERE id = ? AND system = 2
      LIMIT 1
    `;
    const updated = await query(updateSql, [
      JSON.stringify(photoUrls),
      riveAvatarUrl,
      voiceId,
      gender,
      targetBot.id
    ]);
    results.push({
      charDir,
      status: updated ? 'updated' : 'update_failed',
      botId: targetBot.id,
      name: targetBot.name,
      gender,
      photoUrls,
      pickedFiles,
      riveAvatarUrl
    });
  }

  console.log(
    JSON.stringify(
      {
        total: results.length,
        updatedBots: updateCount,
        skippedBotsNoFolder:
          existingSystemTwoBots.length > updateCount
            ? existingSystemTwoBots.slice(updateCount).map((b) => ({ id: b.id, name: b.name }))
            : [],
        results
      },
      null,
      2
    )
  );
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
