/**
 * system=2 şablonlarında cinsiyet/voiceId düzeltmesi:
 * - Kadın karakterler (son CDN ile güncellenen female_char batch): id 220–230
 * - Erkek karakterler (güncellenmemiş erkek şablonları): id 232–236
 *
 * Gerekirse id listelerini güncelle.
 */
const { getQuery, query } = require('../db');

const FEMALE_BOT_IDS = [220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230];
const MALE_BOT_IDS = [232, 233, 234, 235, 236];

async function getVoiceIdByGender(genderDb) {
  const wanted = genderDb === 'Kadın' ? 'female' : 'male';
  const rows = await getQuery(
    'SELECT elevenlabs_id FROM `voices` WHERE gender = ? ORDER BY id ASC LIMIT 1',
    [wanted]
  );
  return rows?.[0]?.elevenlabs_id ?? null;
}

async function run() {
  const femaleVoice = await getVoiceIdByGender('Kadın');
  const maleVoice = await getVoiceIdByGender('Erkek');

  const rows = await getQuery(
    'SELECT id, name, gender FROM `bots` WHERE system = 2 ORDER BY id ASC',
    []
  );
  console.log(
    'Mevcut system=2:',
    rows.map((r) => ({ id: r.id, name: r.name, gender: r.gender }))
  );

  for (const id of FEMALE_BOT_IDS) {
    const ok = await query(
      'UPDATE `bots` SET gender = ?, voiceId = ? WHERE id = ? AND system = 2 LIMIT 1',
      ['Kadın', femaleVoice, id]
    );
    console.log(`UPDATE female ${id}:`, ok ? 'ok' : 'fail');
  }

  for (const id of MALE_BOT_IDS) {
    const ok = await query(
      'UPDATE `bots` SET gender = ?, voiceId = ? WHERE id = ? AND system = 2 LIMIT 1',
      ['Erkek', maleVoice, id]
    );
    console.log(`UPDATE male ${id}:`, ok ? 'ok' : 'fail');
  }

  const after = await getQuery(
    'SELECT id, name, gender, voiceId FROM `bots` WHERE system = 2 ORDER BY id ASC',
    []
  );
  console.log('Son durum:', JSON.stringify(after, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
