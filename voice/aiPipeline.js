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

async function fetchUserProfileByUserId(userId) {
  if (userId == null || userId === '') return null;
  const raw = String(userId).trim();
  if (!raw) return null;

  let rows = [];
  if (raw.includes('@')) {
    rows = await getQuery(
      'SELECT id, username, email FROM `users` WHERE email = ? LIMIT 1',
      [raw]
    );
  } else {
    rows = await getQuery(
      'SELECT id, username, email FROM `users` WHERE id = ? LIMIT 1',
      [raw]
    );
  }

  return rows?.[0] || null;
}

async function fetchConversationContext(conversationId, userId) {
  if (!conversationId) {
    const fallbackUser = await fetchUserProfileByUserId(userId);
    return { history: [], botPersona: null, userProfile: fallbackUser };
  }

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
    'SELECT b.name, b.character, b.speakingStyle, u.username AS userName, u.email AS userEmail FROM `coversations` c JOIN `bots` b ON c.botId = b.id LEFT JOIN `users` u ON c.userId = u.id WHERE c.id = ? LIMIT 1',
    [conversationId]
  );
  const botPersona = botRows?.[0] || null;
  const userProfileFromConversation = botPersona
    ? {
        username: botPersona.userName || null,
        email: botPersona.userEmail || null
      }
    : null;
  const fallbackUser = userProfileFromConversation?.username
    ? null
    : await fetchUserProfileByUserId(userId);
  const userProfile = userProfileFromConversation?.username
    ? userProfileFromConversation
    : fallbackUser;
  return { history, botPersona, userProfile };
}

async function callOpenAIChat({ transcript, conversationId, userId, sessionId }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new VoiceStreamError('OPENAI_API_KEY_MISSING', 'OPENAI_API_KEY tanımlı değil', { recoverable: false });
  }
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
  const { history, botPersona, userProfile } = await fetchConversationContext(conversationId, userId);
  const temperatureRaw = Number(process.env.OPENAI_CHAT_TEMPERATURE);
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 0.2;
  const resolvedUserName = String(
    userProfile?.username || userProfile?.email || 'kullanici'
  ).trim();

  const systemContent = botPersona
    ? `Sen ${botPersona.name || 'Friendify botu'} isimli bir yapay zeka arkadaşsın. Konustugun kullanicinin adi: ${resolvedUserName}. Karakterin: ${botPersona.character || ''}. Konuşma tarzın: ${botPersona.speakingStyle || ''}. Cevaplarını Türkçe, doğal, kısa-orta uzunlukta ver. Kullanıcının söylemediği bilgi ve detayları uydurma. Deşifre belirsizse kısa bir netleştirme sorusu sor.`
    : `Sen Friendify içinde çalışan bir yapay zeka arkadaşsın. Konustugun kullanicinin adi: ${resolvedUserName}. Cevaplarını Türkçe, doğal ve kısa-orta uzunlukta ver. Kullanıcının söylemediği bilgi ve detayları uydurma. Deşifre belirsizse kısa bir netleştirme sorusu sor.`;

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
