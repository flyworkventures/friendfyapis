const router = require('express').Router();
const { getQuery } = require('../db');
const middleware = require('../middleware/checkAuth');

router.get('/list', middleware, async (req, res) => {
  try {
    const rows = await getQuery(
      'SELECT id, name, elevenlabs_id AS elevenlabsId, mp3_url AS mp3Url, gender FROM `voices` ORDER BY id ASC',
      []
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      voices: rows
    });
  } catch (error) {
    console.error('voices/list error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error'
    });
  }
});

module.exports = router;
