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

/**
 * Client TTS proxy — ElevenLabs key yalnızca sunucuda kalır.
 * Body: { text, voiceId? }
 * Response: audio/mpeg
 */
router.post('/tts', middleware, async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        msg: 'ELEVENLABS_API_KEY tanımlı değil',
      });
    }

    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, msg: 'text required' });
    }

    const voiceId = String(
      req.body?.voiceId ||
        process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
        ''
    ).trim();
    if (!voiceId) {
      return res.status(400).json({ success: false, msg: 'voiceId required' });
    }

    const modelId =
      process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text().catch(() => '');
      console.error('voices/tts ElevenLabs error:', elRes.status, errText.slice(0, 300));
      return res.status(elRes.status).json({
        success: false,
        msg: `ElevenLabs TTS failed (${elRes.status})`,
      });
    }

    const buf = Buffer.from(await elRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    return res.status(200).send(buf);
  } catch (error) {
    console.error('voices/tts error:', error);
    return res.status(500).json({
      success: false,
      msg: 'Server error',
    });
  }
});

module.exports = router;
