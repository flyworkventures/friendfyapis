const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { getQuery, query } = require('../db');

const BUNNY_STORAGE_ZONE = 'fakefriendstorage';
const BUNNY_PULL_ZONE_BASE = 'https://fakefriend.b-cdn.net';
const BUNNY_STORAGE_BASE = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}`;
const BUNNY_ACCESS_KEY = '68664abb-b19e-47e7-acd67dba78a5-e90a-4386';

const CHARACTER_ROOT = path.join(__dirname, '..', 'database', 'friendify_yeni_karakterler');
const UPLOAD_PREFIX = 'friendify-yeni-karakterler';

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
  return fileName.toLowerCase().includes('female') ? 'Kadın' : 'Erkek';
}

async function getVoiceIdByGender(gender) {
  const wanted = gender === 'Kadın' ? 'female' : 'male';
  const rows = await getQuery(
    'SELECT elevenlabs_id FROM `voices` WHERE gender = ? ORDER BY id ASC LIMIT 1',
    [wanted]
  );
  return rows?.[0]?.elevenlabs_id || null;
}

async function run() {
  const dirEntries = await fs.readdir(CHARACTER_ROOT, { withFileTypes: true });
  const charDirs = dirEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('char'))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.replace('char', '')) - Number(b.replace('char', '')));

  const results = [];

  for (let i = 0; i < charDirs.length; i += 1) {
    const charDir = charDirs[i];
    const absDir = path.join(CHARACTER_ROOT, charDir);
    const files = await fs.readdir(absDir);
    const photoFile = files.find((f) => /^char.*\.png$/i.test(f)) || files.find((f) => f.toLowerCase().endsWith('.png'));
    const rivFile = files.find((f) => f.toLowerCase().endsWith('.riv'));

    if (!photoFile || !rivFile) {
      results.push({ charDir, status: 'skipped_missing_files' });
      continue;
    }

    const gender = inferGenderFromFileName(rivFile);
    const voiceId = await getVoiceIdByGender(gender);
    const photoRemotePath = `${UPLOAD_PREFIX}/${charDir}/${photoFile}`;
    const riveRemotePath = `${UPLOAD_PREFIX}/${charDir}/${rivFile}`;

    const photoUrl = await uploadToBunny(path.join(absDir, photoFile), photoRemotePath, 'image/png');
    const riveAvatarUrl = await uploadToBunny(path.join(absDir, rivFile), riveRemotePath, 'application/octet-stream');

    const exists = await getQuery(
      'SELECT id FROM `bots` WHERE rive_avatar = ? LIMIT 1',
      [riveAvatarUrl]
    );
    if (exists.length > 0) {
      results.push({ charDir, status: 'already_exists', botId: exists[0].id, photoUrl, riveAvatarUrl });
      continue;
    }

    const interests = pickFromPool(INTERESTS_POOL, 6, i + 5);
    const interestsType = pickFromPool(INTEREST_TYPES_POOL, 3, i + 2);
    const tags = pickFromPool(TAG_POOL, 4, i + 1);
    const age = 21 + (i % 7);
    const name = NAME_POOL[i % NAME_POOL.length];

    const insertSql = `
      INSERT INTO bots
      (name, creatorId, \`character\`, photoURL, rive_avatar, system, gender, age, exampleResponse, speakingStyle, interests, country, characterTags, voiceId, interestsType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insertValues = [
      name,
      '0',
      `${name}, pozitif ve sohbeti akici tasiyan bir karakterdir.`,
      JSON.stringify([photoUrl]),
      riveAvatarUrl,
      2,
      gender,
      age,
      `Merhaba! Ben ${name}, istersen hemen sohbete baslayabiliriz.`,
      'Samimi, akici ve pozitif bir tonla konusur.',
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
      photoUrl,
      riveAvatarUrl
    });
  }

  console.log(JSON.stringify({ total: results.length, results }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
