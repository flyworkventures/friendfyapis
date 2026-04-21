const axios = require('axios');
const { VoiceStreamError } = require('./errors');
const { retryWithBackoff } = require('./retry');

function isTtsDebugEnabled() {
  return String(process.env.VOICE_DEBUG_LOGS || 'false').toLowerCase() === 'true';
}

function ttsDebugLog(message) {
  if (isTtsDebugEnabled()) {
    console.log(`[VOICE_TTS] ${message}`);
  }
}

async function streamElevenLabsTts({ text, voiceId, modelId }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new VoiceStreamError('ELEVENLABS_API_KEY_MISSING', 'ELEVENLABS_API_KEY tanımlı değil', { recoverable: false });
  }

  const resolvedVoiceId = voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!resolvedVoiceId) {
    throw new VoiceStreamError('ELEVENLABS_VOICE_ID_MISSING', 'voiceId bulunamadı', { recoverable: false });
  }

  const resolvedModelId = modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/stream`;
  ttsDebugLog(`request start | voiceId=${resolvedVoiceId} modelId=${resolvedModelId} textLen=${String(text || '').length}`);

  let response;
  try {
    response = await retryWithBackoff(async () => {
      return axios.post(
        url,
        {
          text,
          model_id: resolvedModelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        },
        {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg'
          },
          responseType: 'stream',
          timeout: 15000
        }
      );
    }, { retries: 2, baseDelayMs: 200 });
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    ttsDebugLog(`request failed | status=${status || 'unknown'} message=${error?.message || 'unknown'}`);
    throw new VoiceStreamError(
      'ELEVENLABS_TTS_FAILED',
      `ElevenLabs TTS failed${status ? ` (${status})` : ''}`,
      {
        recoverable: [429, 500, 502, 503, 504].includes(status),
        details: data || error?.message || null
      }
    );
  }

  ttsDebugLog(
    `request success | status=${response.status} contentType=${response.headers?.['content-type'] || 'unknown'}`
  );

  return response.data; // Node stream
}

module.exports = {
  streamElevenLabsTts
};

