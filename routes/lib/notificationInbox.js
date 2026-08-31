'use strict';

const { insertQuery } = require('../../db');

/**
 * Bildirimler sayfası (inbox) kaydı — push/yerel bildirim zamanına göre görünür.
 */
async function insertScheduledInboxNotification({
  userId,
  title,
  body,
  type = 'reminder',
  payload,
  visibleAt,
}) {
  if (userId == null || !title || !body) return false;
  try {
    const at = visibleAt instanceof Date ? visibleAt : new Date();
    await insertQuery(
      `INSERT INTO notifications (user_id, title, body, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, String(title).trim(), String(body).trim(), type, payload || null, at]
    );
    return true;
  } catch (e) {
    console.warn('[notificationInbox] insert failed:', e?.message || e);
    return false;
  }
}

module.exports = { insertScheduledInboxNotification };
