const { getQuery } = require('../../db');

const VISIBLE = '(m.`scheduled_at` IS NULL OR m.`scheduled_at` <= NOW())';

/**
 * Konuşma id'leri için okunmamış bot mesajı sayısı ve son (görünür) mesajı gönderen.
 * Tek toplu sorgu (N+1 yok). last_read_at sütunu henüz yoksa sessizce boş döner.
 * @returns {Promise<Map<number, {unread_count: number, last_message_sender: string|null}>>}
 */
async function loadUnreadInfo(conversationIds) {
  const out = new Map();
  if (!conversationIds.length) return out;
  const ph = conversationIds.map(() => '?').join(', ');
  try {
    const counts = await getQuery(
      `SELECT m.conversationId AS cid, COUNT(*) AS c
       FROM \`messages\` m
       JOIN \`coversations\` c ON c.id = m.conversationId
       WHERE m.conversationId IN (${ph})
         AND m.sender = 'bot'
         AND ${VISIBLE}
         AND m.created_at > COALESCE(c.last_read_at, '1970-01-01')
       GROUP BY m.conversationId`,
      conversationIds
    );
    const lasts = await getQuery(
      `SELECT m.conversationId AS cid, m.sender AS sender
       FROM \`messages\` m
       JOIN (
         SELECT m.conversationId, MAX(m.id) AS mid FROM \`messages\` m
         WHERE m.conversationId IN (${ph}) AND ${VISIBLE}
         GROUP BY m.conversationId
       ) x ON x.mid = m.id`,
      conversationIds
    );
    for (const id of conversationIds) {
      out.set(id, { unread_count: 0, last_message_sender: null });
    }
    for (const r of counts || []) {
      const e = out.get(r.cid);
      if (e) e.unread_count = Number(r.c) || 0;
    }
    for (const r of lasts || []) {
      const e = out.get(r.cid);
      if (e) e.last_message_sender = r.sender === 'user' || r.sender === 'bot' ? r.sender : null;
    }
  } catch (err) {
    console.error('loadUnreadInfo error:', err?.message || err);
    return new Map();
  }
  return out;
}

module.exports = { loadUnreadInfo };
