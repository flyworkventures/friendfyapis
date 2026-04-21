const axios = require('axios');
const { VoiceStreamError } = require('./errors');
const { retryWithBackoff } = require('./retry');
const { getQuery } = require('../db');

function normalizeMessageText(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.text === 'string') return parsed.text;
      if (typeof parsed?.message === 'string') return parsed.message;
      return trimmed;
    } catch (_) {
      return trimmed;
    }
  }
  return trimmed;
}

async function fetchConversationContext(conversationId) {
  if (!conversationId) return { history: [], botPersona: null };

  const rows = await getQuery(
    'SELECT sender, message FROM `messages` WHERE conversationId = ? ORDER BY id DESC LIMIT 10',
    [conversationId]
  );
  const history = [...rows]
    .reverse()
    .map((r) => {
      const sender = String(r.sender || '').toLowerCase();
      const role = sender === 'user' ? 'user' : 'assistant';
      return {
        role,
        content: normalizeMessageText(r.message)
      };
    })
    .filter((m) => m.content);

  const botRows = await getQuery(
    'SELECT b.name, b.character, b.speakingStyle FROM `coversations` c JOIN `bots` b ON c.botId = b.id WHERE c.id = ? LIMIT 1',
    [conversationId]
  );
  const botPersona = botRows[0] || null;
  return { history, botPersona };
}

async function callOpenAIChat({ transcript, conversationId, userId, sessionId }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new VoiceStreamError('OPENAI_API_KEY_MISSING', 'OPENAI_API_KEY tanımlı değil', { recoverable: false });
  }
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
  const { history, botPersona } = await fetchConversationContext(conversationId);
  const temperatureRaw = Number(process.env.OPENAI_CHAT_TEMPERATURE);
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.2;

  const systemContent = botPersona
    ? `Sen ${botPersona.name || 'Friendify botu'} isimli bir yapay zeka arkadaşsın. Karakterin: ${botPersona.character || ''}. Konuşma tarzın: ${botPersona.speakingStyle || ''}. Cevaplarını Türkçe, doğal, kısa-orta uzunlukta ver. Kullanıcının söylemediği bilgi ve detayları uydurma. Deşifre belirsizse kısa bir netleştirme sorusu sor.`
    : 'Sen Friendify içinde çalışan bir yapay zeka arkadaşsın. Cevaplarını Türkçe, doğal ve kısa-orta uzunlukta ver. Kullanıcının söylemediği bilgi ve detayları uydurma. Deşifre belirsizse kısa bir netleştirme sorusu sor.';

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: transcript }
  ];

  const response = await retryWithBackoff(async () => {
    return axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages,
      temperature,
      user: String(userId || sessionId || 'voice-user')
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
  }, { retries: 2, baseDelayMs: 250 });

  const text = response.data?.choices?.[0]?.message?.content || '';
  return {
    text: String(text).trim(),
    source: 'openai',
    model
  };
}

async function runAiPipeline({ transcript, conversationId, userId, sessionId }) {
  const mode = (process.env.VOICE_AI_MODE || 'echo').toLowerCase();

  if (mode === 'echo') {
    return {
      text: `Anladım: ${transcript}`,
      source: 'echo'
    };
  }

  if (mode === 'webhook') {
    const webhookUrl = process.env.VOICE_AI_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new VoiceStreamError('AI_WEBHOOK_MISSING', 'VOICE_AI_WEBHOOK_URL tanımlı değil', { recoverable: false });
    }

    const response = await retryWithBackoff(async () => {
      const result = await axios.post(
        webhookUrl,
        {
          transcript,
          conversationId,
          userId,
          sessionId
        },
        {
          timeout: 8000
        }
      );
      return result;
    });

    return {
      text: response.data?.text || response.data?.reply || '',
      source: 'webhook',
      raw: response.data
    };
  }

  if (mode === 'openai') {
    return callOpenAIChat({ transcript, conversationId, userId, sessionId });
  }

  throw new VoiceStreamError('AI_MODE_INVALID', `Desteklenmeyen VOICE_AI_MODE: ${mode}`, { recoverable: false });
}

module.exports = {
  runAiPipeline
};
