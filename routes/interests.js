const router = require('express').Router();
const { getQuery } = require('../db');

const SUPPORTED_LANGS = ['tr', 'en', 'de', 'fr', 'pt', 'it', 'zh', 'ja', 'ru', 'hi', 'ko'];

function pickLabel(row, lang) {
  const key = `interest_${lang}`;
  if (row[key]) return row[key];
  return row.interest_en || row.interest_tr;
}

// Tüm ilgi alanları (tüm diller)
router.post('/list', async (req, res) => {
  try {
    const rows = await getQuery(
      'SELECT id, slug, emoji, sort_order, interest_tr, interest_en, interest_de, interest_fr, interest_pt, interest_it, interest_zh, interest_ja, interest_ru, interest_hi, interest_ko FROM `interests` ORDER BY sort_order ASC, id ASC',
      []
    );
    return res.status(200).json({
      success: true,
      count: rows.length,
      interests: rows
    });
  } catch (error) {
    console.error('interests/list error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message
    });
  }
});

async function sendLocalizedList(req, res) {
  try {
    const lang = (req.body?.lang || req.query?.lang || 'en').toLowerCase();
    if (!SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({
        success: false,
        msg: `Invalid lang. Use one of: ${SUPPORTED_LANGS.join(', ')}`
      });
    }

    const rows = await getQuery(
      'SELECT id, slug, emoji, sort_order, interest_tr, interest_en, interest_de, interest_fr, interest_pt, interest_it, interest_zh, interest_ja, interest_ru, interest_hi, interest_ko FROM `interests` ORDER BY sort_order ASC, id ASC',
      []
    );

    const interests = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      emoji: row.emoji,
      sort_order: row.sort_order,
      label: pickLabel(row, lang)
    }));

    return res.status(200).json({
      success: true,
      lang,
      count: interests.length,
      interests
    });
  } catch (error) {
    console.error('interests/list-localized error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
      error: error.message
    });
  }
}

// Dil koduna göre sadeleştirilmiş liste: { id, slug, emoji, label }
router.post('/list-localized', sendLocalizedList);
// GET: /interests/list-localized?lang=tr
router.get('/list-localized', sendLocalizedList);

module.exports = router;
