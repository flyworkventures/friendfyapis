// Migration: bots + bot_catalog_overrides → zodiac, relationship_type
// + lookup tabloları zodiac_signs, relationship_types
// Kullanım: node scripts/apply_bots_zodiac_relationship.js
const { getQuery, query } = require('../db');

async function columnExists(table, field) {
  const cols = await getQuery(
    `SHOW COLUMNS FROM \`${table}\` WHERE Field = ?`,
    [field]
  );
  return !!(cols && cols.length);
}

async function tableExists(table) {
  const rows = await getQuery(`SHOW TABLES LIKE ?`, [table]);
  return !!(rows && rows.length);
}

async function addColumnIfMissing(table, field, alterSql) {
  if (await columnExists(table, field)) {
    console.log(`⏭️  ${table}.${field} zaten var`);
    return;
  }
  const ok = await query(alterSql);
  if (!ok) throw new Error(`ALTER failed: ${table}.${field}`);
  console.log(`✅ ${table}.${field} eklendi`);
}

async function runOrThrow(sql, label) {
  const ok = await query(sql);
  if (!ok) throw new Error(`Query failed: ${label}`);
  console.log(`✅ ${label}`);
}

const CREATE_ZODIAC = `
CREATE TABLE IF NOT EXISTS \`zodiac_signs\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`slug\` VARCHAR(32) NOT NULL,
  \`emoji\` VARCHAR(16) NOT NULL DEFAULT '',
  \`sort_order\` INT NOT NULL DEFAULT 0,
  \`label_tr\` VARCHAR(64) NOT NULL,
  \`label_en\` VARCHAR(64) NOT NULL,
  \`label_de\` VARCHAR(64) NULL,
  \`label_fr\` VARCHAR(64) NULL,
  \`label_pt\` VARCHAR(64) NULL,
  \`label_it\` VARCHAR(64) NULL,
  \`label_es\` VARCHAR(64) NULL,
  \`label_zh\` VARCHAR(64) NULL,
  \`label_ja\` VARCHAR(64) NULL,
  \`label_ru\` VARCHAR(64) NULL,
  \`label_hi\` VARCHAR(64) NULL,
  \`label_ko\` VARCHAR(64) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_zodiac_slug\` (\`slug\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_RELATIONSHIP = `
CREATE TABLE IF NOT EXISTS \`relationship_types\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`slug\` VARCHAR(64) NOT NULL,
  \`emoji\` VARCHAR(16) NOT NULL DEFAULT '',
  \`sort_order\` INT NOT NULL DEFAULT 0,
  \`label_tr\` VARCHAR(64) NOT NULL,
  \`label_en\` VARCHAR(64) NOT NULL,
  \`label_de\` VARCHAR(64) NULL,
  \`label_fr\` VARCHAR(64) NULL,
  \`label_pt\` VARCHAR(64) NULL,
  \`label_it\` VARCHAR(64) NULL,
  \`label_es\` VARCHAR(64) NULL,
  \`label_zh\` VARCHAR(64) NULL,
  \`label_ja\` VARCHAR(64) NULL,
  \`label_ru\` VARCHAR(64) NULL,
  \`label_hi\` VARCHAR(64) NULL,
  \`label_ko\` VARCHAR(64) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_relationship_slug\` (\`slug\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const SEED_ZODIAC = `
INSERT INTO \`zodiac_signs\`
  (\`slug\`, \`emoji\`, \`sort_order\`, \`label_tr\`, \`label_en\`, \`label_de\`, \`label_fr\`, \`label_pt\`, \`label_it\`, \`label_es\`, \`label_zh\`, \`label_ja\`, \`label_ru\`, \`label_hi\`, \`label_ko\`)
VALUES
  ('aries',       '♈', 1,  'Koç',       'Aries',       'Widder',      'Bélier',      'Áries',       'Ariete',      'Aries',       '白羊座', '牡羊座', 'Овен',       'मेष',      '양자리'),
  ('taurus',      '♉', 2,  'Boğa',      'Taurus',      'Stier',       'Taureau',     'Touro',       'Toro',        'Tauro',       '金牛座', '牡牛座', 'Телец',      'वृषभ',    '황소자리'),
  ('gemini',      '♊', 3,  'İkizler',   'Gemini',      'Zwillinge',   'Gémeaux',     'Gêmeos',      'Gemelli',     'Géminis',     '双子座', '双子座', 'Близнецы',   'मिथुन',   '쌍둥이자리'),
  ('cancer',      '♋', 4,  'Yengeç',    'Cancer',      'Krebs',       'Cancer',      'Câncer',      'Cancro',      'Cáncer',      '巨蟹座', '蟹座',   'Рак',        'कर्क',    '게자리'),
  ('leo',         '♌', 5,  'Aslan',     'Leo',         'Löwe',        'Lion',        'Leão',        'Leone',       'Leo',         '狮子座', '獅子座', 'Лев',        'सिंह',    '사자자리'),
  ('virgo',       '♍', 6,  'Başak',     'Virgo',       'Jungfrau',    'Vierge',      'Virgem',      'Vergine',     'Virgo',       '处女座', '乙女座', 'Дева',       'कन्या',   '처녀자리'),
  ('libra',       '♎', 7,  'Terazi',    'Libra',       'Waage',       'Balance',     'Libra',       'Bilancia',    'Libra',       '天秤座', '天秤座', 'Весы',      'तुला',    '천칭자리'),
  ('scorpio',     '♏', 8,  'Akrep',     'Scorpio',     'Skorpion',    'Scorpion',    'Escorpião',   'Scorpione',   'Escorpio',    '天蝎座', '蠍座',   'Скорпион',   'वृश्चिक', '전갈자리'),
  ('sagittarius', '♐', 9,  'Yay',       'Sagittarius', 'Schütze',     'Sagittaire',  'Sagitário',   'Sagittario',  'Sagitario',   '射手座', '射手座', 'Стрелец',    'धनु',     '사수자리'),
  ('capricorn',   '♑', 10, 'Oğlak',     'Capricorn',   'Steinbock',   'Capricorne',  'Capricórnio', 'Capricorno',  'Capricornio', '摩羯座', '山羊座', 'Козерог',    'मकर',     '염소자리'),
  ('aquarius',    '♒', 11, 'Kova',      'Aquarius',    'Wassermann',  'Verseau',     'Aquário',     'Acquario',    'Acuario',     '水瓶座', '水瓶座', 'Водолей',    'कुंभ',    '물병자리'),
  ('pisces',      '♓', 12, 'Balık',     'Pisces',      'Fische',      'Poissons',    'Peixes',      'Pesci',       'Piscis',      '双鱼座', '魚座',   'Рыбы',       'मीन',     '물고기자리')
ON DUPLICATE KEY UPDATE
  \`emoji\` = VALUES(\`emoji\`),
  \`sort_order\` = VALUES(\`sort_order\`),
  \`label_tr\` = VALUES(\`label_tr\`),
  \`label_en\` = VALUES(\`label_en\`)`;

const SEED_RELATIONSHIP = `
INSERT INTO \`relationship_types\`
  (\`slug\`, \`emoji\`, \`sort_order\`, \`label_tr\`, \`label_en\`, \`label_de\`, \`label_fr\`, \`label_pt\`, \`label_it\`, \`label_es\`, \`label_zh\`, \`label_ja\`, \`label_ru\`, \`label_hi\`, \`label_ko\`)
VALUES
  ('friend',    '🤝', 1, 'Arkadaş',       'Friend',          'Freund',           'Ami',              'Amigo',            'Amico',           'Amigo',           '朋友',   '友達',     'Друг',            'मित्र',       '친구'),
  ('flirt',     '💘', 2, 'Flört',         'Flirt',           'Flirt',            'Flirt',            'Flerte',           'Flirt',           'Ligoteo',         '暧昧',   'フラート', 'Флирт',           'फ्लर्ट',      '썸'),
  ('mentor',    '🧭', 3, 'Mentor',        'Mentor',          'Mentor',           'Mentor',           'Mentor',           'Mentore',         'Mentor',          '导师',   'メンター', 'Наставник',       'मेंटर',       '멘토'),
  ('coach',     '🏋️', 4, 'Koç',           'Coach',           'Coach',            'Coach',            'Treinador',        'Coach',           'Entrenador',      '教练',   'コーチ',   'Тренер',          'कोच',         '코치'),
  ('sibling',   '👯', 5, 'Kardeş',        'Sibling',         'Geschwister',      'Frère/Sœur',       'Irmão/Irmã',       'Fratello/Sorella','Hermano/Hermana', '兄弟姐妹', '兄弟姉妹', 'Брат/Сестра',     'भाई-बहन',    '형제/자매'),
  ('coworker',  '💼', 6, 'İş Arkadaşı',   'Coworker',        'Kollege',          'Collègue',         'Colega de trabalho','Collega',        'Compañero de trabajo', '同事', '同僚', 'Коллега', 'सहकर्मी', '동료')
ON DUPLICATE KEY UPDATE
  \`emoji\` = VALUES(\`emoji\`),
  \`sort_order\` = VALUES(\`sort_order\`),
  \`label_tr\` = VALUES(\`label_tr\`),
  \`label_en\` = VALUES(\`label_en\`)`;

(async () => {
  try {
    await runOrThrow(CREATE_ZODIAC, 'zodiac_signs tablosu');
    await runOrThrow(SEED_ZODIAC, 'zodiac_signs seed');
    await runOrThrow(CREATE_RELATIONSHIP, 'relationship_types tablosu');
    await runOrThrow(SEED_RELATIONSHIP, 'relationship_types seed');

    await addColumnIfMissing(
      'bots',
      'zodiac',
      "ALTER TABLE `bots` ADD COLUMN `zodiac` VARCHAR(32) NULL DEFAULT NULL COMMENT 'slug → zodiac_signs.slug' AFTER `gender`"
    );
    await addColumnIfMissing(
      'bots',
      'relationship_type',
      "ALTER TABLE `bots` ADD COLUMN `relationship_type` VARCHAR(64) NULL DEFAULT NULL COMMENT 'slug → relationship_types.slug' AFTER `zodiac`"
    );

    if (await tableExists('bot_catalog_overrides')) {
      await addColumnIfMissing(
        'bot_catalog_overrides',
        'zodiac',
        'ALTER TABLE `bot_catalog_overrides` ADD COLUMN `zodiac` VARCHAR(32) NULL DEFAULT NULL AFTER `gender`'
      );
      await addColumnIfMissing(
        'bot_catalog_overrides',
        'relationship_type',
        'ALTER TABLE `bot_catalog_overrides` ADD COLUMN `relationship_type` VARCHAR(64) NULL DEFAULT NULL AFTER `zodiac`'
      );
    } else {
      console.log(
        '⚠️  bot_catalog_overrides yok — önce bot_catalog_overrides.sql çalıştırın'
      );
    }

    // Mevcut botlara boşsa deterministik burç / ilişki türü ata (id’ye göre sabit).
    const backfill = await query(
      `UPDATE \`bots\`
       SET
         \`zodiac\` = IF(
           \`zodiac\` IS NULL OR TRIM(\`zodiac\`) = '',
           ELT(((\`id\` - 1) % 12) + 1,
             'aries','taurus','gemini','cancer','leo','virgo',
             'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
           ),
           \`zodiac\`
         ),
         \`relationship_type\` = IF(
           \`relationship_type\` IS NULL OR TRIM(\`relationship_type\`) = '',
           ELT(((\`id\` - 1) % 6) + 1,
             'friend','flirt','mentor','coach','sibling','coworker'
           ),
           \`relationship_type\`
         )
       WHERE \`zodiac\` IS NULL
          OR TRIM(COALESCE(\`zodiac\`, '')) = ''
          OR \`relationship_type\` IS NULL
          OR TRIM(COALESCE(\`relationship_type\`, '')) = ''`
    );
    console.log(
      `✅ bots backfill: affectedRows=${backfill?.affectedRows ?? backfill?.changedRows ?? '?'}`
    );

    const zCount = await getQuery('SELECT COUNT(*) AS c FROM `zodiac_signs`');
    const rCount = await getQuery('SELECT COUNT(*) AS c FROM `relationship_types`');
    const filled = await getQuery(
      `SELECT COUNT(*) AS total,
              SUM(\`zodiac\` IS NOT NULL AND TRIM(\`zodiac\`) <> '') AS with_z,
              SUM(\`relationship_type\` IS NOT NULL AND TRIM(\`relationship_type\`) <> '') AS with_r
       FROM \`bots\``
    );
    console.log(
      `✅ migration tamam. zodiac=${zCount[0].c}, relationship=${rCount[0].c}, bots filled=`,
      filled[0]
    );
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
