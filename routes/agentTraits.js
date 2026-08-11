const router = require('express').Router();
const { getQuery } = require('../db');

const SUPPORTED_LANGS = [
  'tr', 'en', 'de', 'fr', 'pt', 'it', 'es', 'zh', 'ja', 'ru', 'hi', 'ko',
];

function pickLabel(row, lang) {
  const key = `label_${lang}`;
  if (row[key]) return row[key];
  return row.label_en || row.label_tr;
}

function localizeRows(rows, lang) {
  return (rows || []).map((row) => ({
    id: row.id,
    slug: row.slug,
    emoji: row.emoji,
    sort_order: row.sort_order,
    label: pickLabel(row, lang),
  }));
}

async function listTable(table) {
  return getQuery(
    `SELECT id, slug, emoji, sort_order,
            label_tr, label_en, label_de, label_fr, label_pt, label_it,
            label_es, label_zh, label_ja, label_ru, label_hi, label_ko
     FROM \`${table}\`
     ORDER BY sort_order ASC, id ASC`,
    []
  );
}

function resolveLang(req) {
  return String(req.body?.lang || req.query?.lang || 'en').toLowerCase();
}

// POST/GET /agent-traits/zodiac?lang=tr
async function listZodiac(req, res) {
  try {
    const lang = resolveLang(req);
    if (!SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({
        success: false,
        msg: `Invalid lang. Use one of: ${SUPPORTED_LANGS.join(', ')}`,
      });
    }
    const rows = await listTable('zodiac_signs');
    return res.status(200).json({
      success: true,
      lang,
      count: rows.length,
      zodiac: localizeRows(rows, lang),
    });
  } catch (error) {
    console.error('agent-traits/zodiac error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message,
    });
  }
}

// POST/GET /agent-traits/relationship-types?lang=tr
async function listRelationshipTypes(req, res) {
  try {
    const lang = resolveLang(req);
    if (!SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({
        success: false,
        msg: `Invalid lang. Use one of: ${SUPPORTED_LANGS.join(', ')}`,
      });
    }
    const rows = await listTable('relationship_types');
    return res.status(200).json({
      success: true,
      lang,
      count: rows.length,
      relationshipTypes: localizeRows(rows, lang),
    });
  } catch (error) {
    console.error('agent-traits/relationship-types error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message,
    });
  }
}

router.get('/zodiac', listZodiac);
router.post('/zodiac', listZodiac);
router.get('/relationship-types', listRelationshipTypes);
router.post('/relationship-types', listRelationshipTypes);

module.exports = router;
