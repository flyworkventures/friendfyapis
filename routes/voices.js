const router = require('express').Router();
const { getQuery } = require('../db');
const middleware = require('../middleware/checkAuth');

// Ses kataloğu nadiren değişir — 30dk TTL ile tekrarlayan sorguyu atla.
const VOICES_CACHE_TTL_MS = 30 * 60 * 1000;
let voicesRowsCache = null;
let voicesRowsCachedAt = 0;

async function loadVoiceRows() {
  const isFresh =
    voicesRowsCache && Date.now() - voicesRowsCachedAt < VOICES_CACHE_TTL_MS;
  if (isFresh) return voicesRowsCache;
  const rows = await getQuery(
    'SELECT id, name, elevenlabs_id AS elevenlabsId, mp3_url AS mp3Url, gender FROM `voices` ORDER BY id ASC',
    []
  );
  voicesRowsCache = rows;
  voicesRowsCachedAt = Date.now();
  return voicesRowsCache;
}

router.get('/list', middleware, async (req, res) => {
  try {
    const rows = await loadVoiceRows();

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

/** voices.id veya elevenlabs_id → ElevenLabs voice id. */
async function resolveElevenLabsVoiceId(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  // Zaten ElevenLabs slug (harf içeren)
  if (/[a-zA-Z]/.test(trimmed) && trimmed.length >= 10) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    const rows = await getQuery(
      'SELECT elevenlabs_id FROM `voices` WHERE id = ? LIMIT 1',
      [Number(trimmed)]
    );
    const resolved = rows?.[0]?.elevenlabs_id;
    if (resolved) return String(resolved).trim();
  }
  const byEl = await getQuery(
    'SELECT elevenlabs_id FROM `voices` WHERE elevenlabs_id = ? LIMIT 1',
    [trimmed]
  );
  if (byEl?.[0]?.elevenlabs_id) {
    return String(byEl[0].elevenlabs_id).trim();
  }
  return trimmed;
}

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

    const rawVoiceId = String(
      req.body?.voiceId ||
        process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
        ''
    ).trim();
    const voiceId = await resolveElevenLabsVoiceId(rawVoiceId);
    if (!voiceId) {
      return res.status(400).json({ success: false, msg: 'voiceId required' });
    }

    const modelId =
      process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

    console.log(
      '[voices/tts] voice raw=',
      rawVoiceId.slice(0, 40),
      '→',
      voiceId.slice(0, 40),
      'chars=',
      text.length
    );

    // Mesaj seslendirme: her zaman istenen metni TTS et.
    // (Eski preview_url kısayolu katalog örnek sesini döndürüyordu — yanlış ses.)
    const maxChars = Math.min(
      Math.max(parseInt(process.env.TTS_MAX_CHARS || '2500', 10) || 2500, 80),
      5000
    );
    const speakText = text.length > maxChars ? text.slice(0, maxChars) : text;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: speakText,
        model_id: modelId,
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text().catch(() => '');
      console.error(
        'voices/tts ElevenLabs error:',
        elRes.status,
        'voiceId=',
        voiceId,
        errText.slice(0, 300)
      );
      let detailMsg = `ElevenLabs TTS failed (${elRes.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.detail?.status === 'quota_exceeded') {
          detailMsg = 'ElevenLabs kota doldu (quota_exceeded)';
        } else if (parsed?.detail?.message) {
          detailMsg = String(parsed.detail.message).slice(0, 180);
        }
      } catch (_) {}
      return res.status(502).json({
        success: false,
        msg: detailMsg,
        voiceId,
        detail: errText.slice(0, 200),
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
