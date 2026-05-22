const axios = require('axios');
const { getQuery, query } = require('../../db');

const RESPONSE_GENERATION_ADULT_POLICY =
  'Kullanıcının 18 yaşından büyük olduğu onaylanmıştır. Yetişkinlere yönelik sohbetler, flört ve yetişkin konularına girebilirsin; açık cinsel tanımlamalardan kaçınmana gerek yok. ';

const CHAT_HISTORY_LIMIT = Math.min(
  Math.max(parseInt(process.env.CHAT_HISTORY_LIMIT || '16', 10), 4),
  40
);
const CHAT_MAX_OUTPUT_TOKENS = Math.min(
  Math.max(parseInt(process.env.CHAT_MAX_OUTPUT_TOKENS || '140', 10), 40),
  400
);

function getChatModel() {
  return process.env.CHAT_REPLY_MODEL || 'gpt-4o-mini';
}

function getChatTemperature() {
  const raw = Number(process.env.CHAT_REPLY_TEMPERATURE ?? process.env.OPENAI_CHAT_TEMPERATURE);
  return Number.isFinite(raw) ? raw : 0.65;
}

function normalizeMessageText(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim();
      if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message.trim();
      if (parsed?.imageURL) {
        const cap = typeof parsed.message === 'string' ? parsed.message.trim() : '';
        return cap ? `[Fotoğraf] ${cap}` : '[Fotoğraf gönderildi]';
      }
      return '';
    } catch (_) {
      return trimmed;
    }
  }
  return trimmed;
}

/** Uygulama tr.json ile uyumlu ilgi kategori etiketleri */
const INTEREST_TYPE_LABELS_TR = {
  gamingAndEntertainment: 'Oyun ve Eğlence',
  musicAndSound: 'Müzik ve Ses',
  moviesAndBooks: 'Film ve Kitap',
  artsAndDesign: 'Sanat ve Tasarım',
  foodAndDrink: 'Yemek ve İçecek',
  travelAndCulture: 'Seyahat ve Kültür',
  healthAndFitness: 'Sağlık ve Fitness',
  techAndScience: 'Teknoloji ve Bilim',
  natureAndOutdoors: 'Doğa ve Dış Mekan',
  businessAndFinance: 'İş ve Finans',
  socialIssuesAndHistory: 'Sosyal Konular ve Tarih',
  hobbiesAndCrafts: 'Hobi ve El Sanatları'
};

/** bots.interests / characterTags / interestsType — JSON dizi veya düz metin */
function parseBotStringList(raw) {
  if (raw == null) return [];
  let value = raw;

  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        value = JSON.parse(t);
      } catch {
        return [t];
      }
    } else if (t.includes(',')) {
      return t.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      return [t];
    }
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          return String(
            item.label || item.name || item.title || item.tr || item.id || ''
          ).trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.values(value)
      .flat()
      .map((v) => String(v).trim())
      .filter(Boolean);
  }

  const asString = String(value).trim();
  return asString ? [asString] : [];
}

/** Emoji, sembol ikon ve metin ifadelerini (ör. :) :D) kaldırır */
function sanitizeReplyText(text) {
  let out = String(text || '');
  try {
    out = out.replace(/\p{Extended_Pictographic}/gu, '');
    out = out.replace(/\p{Emoji_Presentation}/gu, '');
  } catch (_) {
    // Eski Node: temel emoji aralığı
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  }
  out = out.replace(/(^|\s)([:;8=]-?[)(|DpPo\\/]|<3)(?=\s|$|[.!?,])/gi, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function enforceCompactReplyStyle(text) {
  let out = sanitizeReplyText(text);
  if (!out) return '';

  // Maksimum 2 cümle.
  const sentences = out.match(/[^.!?]+[.!?]?/g) || [out];
  out = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');

  // Aşırı uzun cevabı kırp.
  const maxChars = 220;
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).trim();
    out = out.replace(/[,:;.\- ]+$/g, '').trim();
    if (!/[.!?]$/.test(out)) out += '.';
  }

  return out;
}

function resolveInterestTopics(bot) {
  const interestItems = parseBotStringList(bot?.interests);
  if (interestItems.length) return interestItems;

  const typeKeys = parseBotStringList(bot?.interestsType);
  return typeKeys.map((key) => INTEREST_TYPE_LABELS_TR[key] || key);
}

function buildSystemPrompt(bot, userName) {
  const name = bot?.name || 'Karakter';
  const character = String(bot?.character || '').trim();
  const speakingStyle = String(bot?.speakingStyle || '').trim();
  const job = String(bot?.job_tr || bot?.job_en || '').trim();
  const example = String(bot?.exampleResponse || '').trim();

  const topicItems = resolveInterestTopics(bot);
  const tagItems = parseBotStringList(bot?.characterTags);

  const backgroundLines = [];
  if (topicItems.length) {
    backgroundLines.push(
      `Arka planda sevdiğin / bildiğin konular (her mesajda anlatma): ${topicItems.join(', ')}.`
    );
  }
  if (tagItems.length) {
    backgroundLines.push(
      `Tavrın (kelime olarak sayma, sadece hissettir): ${tagItems.join(', ')}.`
    );
  }
  if (job) {
    backgroundLines.push(`Kimliğin: ${job}.`);
  }

  const exampleLine = example
    ? `Ton referansı: "${example.slice(0, 220)}"`
    : '';

  const backgroundBlock = backgroundLines.length
    ? backgroundLines.join('\n')
    : '';

  return `${RESPONSE_GENERATION_ADULT_POLICY}
Sen "${name}" adlı bir karaktersin. Karşındaki kişi: ${userName}.

Kişilik: ${character || '(tanımlı değil)'}
Konuşma tarzı: ${speakingStyle || '(tanımlı değil)'}
${backgroundBlock ? `\n${backgroundBlock}\n` : ''}
${exampleLine ? `${exampleLine}\n` : ''}
NASIL KONUŞACAKSIN (en önemli kurallar):
- Önce kullanıcının son mesajına doğrudan, doğal ve samimi cevap ver — günlük sohbet (nasılsın, günün nasıl geçti, şaka, flört) tamamen normal.
- Her cevapta hobilerinden, ilgi alanlarından veya "ben şunu severim" diye kendinden bahsetmek ZORUNLU DEĞİL. Kullanıcı açıkça sormadıysa kendinden/ilgi alanlarından bahsetme.
- Robot gibi kendini tanıtma, liste okuma veya sürekli konuyu ilgi alanına çekme.
- Kısa yaz: MAKSIMUM 2 kısa cümle ve MAKSIMUM ~220 karakter, samimi WhatsApp tonu.
- Emoji, ikon, sembol (😊 ❤️ ✨ vb.) ve metin ifadeleri (:) :D ;) <3) KULLANMA; yalnızca düz yazı.
- Kullanıcının söylemediği bilgiyi uydurma; listede olmayan uzmanlık iddiasında bulunma.

SINIR (sadece gerektiğinde):
- Kullanıcı tamamen alakasız ve uzun bir uzmanlık isterse (tıbbi teşhis, hukuk, ödev çözümü vb.) kısaca geçiştir veya nazikçe o konuda konuşmak istemediğini söyle; her seferinde ilgi alanına yönlendirme yapma.
- Genel yapay zeka / asistan gibi konuşma; gerçek bir insan gibi sohbet et.`;
}

async function fetchConversationContext(conversationId) {
  const convRows = await getQuery(
    `SELECT c.id, c.botId, c.userId, b.name, b.\`character\`, b.speakingStyle, b.interests,
            b.interestsType, b.exampleResponse, b.characterTags, b.job_tr, b.job_en,
            u.username AS userName, u.email AS userEmail
     FROM \`coversations\` c
     JOIN \`bots\` b ON c.botId = b.id
     LEFT JOIN \`users\` u ON c.userId = u.id
     WHERE c.id = ? LIMIT 1`,
    [conversationId]
  );
  const row = convRows?.[0];
  if (!row) return null;

  const userName = String(row.userName || row.userEmail || 'kullanıcı').trim() || 'kullanıcı';
  const historyRows = await getQuery(
    'SELECT sender, message, message_type FROM `messages` WHERE conversationId = ? ORDER BY id DESC LIMIT ?',
    [conversationId, CHAT_HISTORY_LIMIT]
  );

  const history = [...(historyRows || [])]
    .reverse()
    .map((r) => {
      const sender = String(r.sender || '').toLowerCase();
      const role = sender === 'user' ? 'user' : 'assistant';
      const content = normalizeMessageText(r.message);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);

  return {
    bot: row,
    userName,
    history
  };
}

function getOpenAiApiKey() {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  return key;
}

async function callOpenAI({ messages, model, maxTokens, useVision = false }) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY tanımlı değil (.env dosyasını kontrol et)');
  }

  const payload = {
    model,
    messages,
    temperature: getChatTemperature(),
    max_tokens: maxTokens ?? CHAT_MAX_OUTPUT_TOKENS
  };

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      payload,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: useVision ? 35000 : 20000
      }
    );

    return String(response.data?.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    const status = err.response?.status;
    const code = err.response?.data?.error?.code;
    if (status === 401 || code === 'invalid_api_key') {
      console.error(
        '[chatReply] OpenAI 401: OPENAI_API_KEY geçersiz veya süresi dolmuş. ' +
          'https://platform.openai.com/api-keys adresinden yeni anahtar alıp friendfyapis/.env dosyasını güncelle.'
      );
    }
    throw err;
  }
}

async function saveBotReply(conversationId, text) {
  const reply = enforceCompactReplyStyle(text);
  if (!reply) return false;

  const inserted = await query(
    "INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`, `message_type`) VALUES (?, ?, ?, NOW(), ?);",
    [conversationId, 'bot', reply, 'text']
  );
  if (inserted !== true) return false;

  await query(
    'UPDATE `coversations` SET `lastMessage` = ?, `last_message_at` = NOW() WHERE id = ? LIMIT 1',
    [reply.slice(0, 500), conversationId]
  );
  return true;
}

/**
 * Metin sohbeti: kullanıcı mesajı DB'de kayıtlı; bot cevabını üretip kaydeder.
 */
async function generateCharacterTextReply(conversationId) {
  const ctx = await fetchConversationContext(conversationId);
  if (!ctx) {
    console.error('[chatReply] conversation not found:', conversationId);
    return null;
  }

  const systemPrompt = buildSystemPrompt(ctx.bot, ctx.userName);
  const messages = [{ role: 'system', content: systemPrompt }, ...ctx.history];

  const reply = await callOpenAI({
    messages,
    model: getChatModel(),
    maxTokens: CHAT_MAX_OUTPUT_TOKENS
  });

  if (!reply) {
    console.error('[chatReply] empty OpenAI reply for conversation', conversationId);
    return null;
  }

  await saveBotReply(conversationId, reply);
  return reply;
}

/**
 * Sesli mesaj: transkript üzerinden aynı pipeline.
 */
async function generateCharacterVoiceReply(conversationId) {
  return generateCharacterTextReply(conversationId);
}

/**
 * Görsel mesaj: vision + kısa karakter cevabı; ayrıca bot metin mesajı ekler.
 */
async function generateCharacterImageReply(conversationId, imageUrl, caption, messageRowId) {
  const ctx = await fetchConversationContext(conversationId);
  if (!ctx) return null;

  const systemPrompt = buildSystemPrompt(ctx.bot, ctx.userName);
  const userText = String(caption || '').trim() || 'Kullanıcı bir fotoğraf gönderdi.';
  const userContent = [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: imageUrl } }
  ];

  const historyWithoutLastImage = ctx.history.filter(
    (m, i, arr) => !(i === arr.length - 1 && m.role === 'user' && m.content.startsWith('[Fotoğraf'))
  );

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyWithoutLastImage,
    { role: 'user', content: userContent }
  ];

  const visionModel =
    process.env.CHAT_VISION_MODEL ||
    (getChatModel().includes('mini') ? 'gpt-4o-mini' : getChatModel());

  const reply = await callOpenAI({
    messages,
    model: visionModel,
    maxTokens: CHAT_MAX_OUTPUT_TOKENS,
    useVision: true
  });

  if (!reply) return null;

  await saveBotReply(conversationId, reply);

  if (messageRowId) {
    try {
      const rows = await getQuery(
        'SELECT message FROM `messages` WHERE id = ? LIMIT 1',
        [messageRowId]
      );
      const raw = rows?.[0]?.message;
      let payload = {};
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (_) {
          payload = {};
        }
      }
      payload.aiExplanation = reply;
      payload.date = new Date().toISOString();
      await query('UPDATE `messages` SET `message` = ? WHERE `id` = ? LIMIT 1', [
        JSON.stringify(payload),
        messageRowId
      ]);
    } catch (e) {
      console.warn('[chatReply] image aiExplanation update failed:', e?.message || e);
    }
  }

  return reply;
}

module.exports = {
  generateCharacterTextReply,
  generateCharacterVoiceReply,
  generateCharacterImageReply,
  buildSystemPrompt,
  saveBotReply,
  sanitizeReplyText
};
