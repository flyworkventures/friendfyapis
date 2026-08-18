const routes = require('express').Router();
const middleware = require('../middleware/checkAuth');
const { getQuery, query, insertQuery } = require('../db');

// GET /notifications — kullanıcının bildirimlerini getir
routes.get('/', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    const rows = await getQuery(
      `SELECT id, title, body, type, payload, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );

    const notifications = rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      body: r.body,
      type: r.type,
      payload: r.payload || null,
      isRead: r.is_read === 1,
      createdAt: r.created_at,
    }));

    return res.json({ notifications });
  } catch (e) {
    console.error('[notifications] GET error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

// POST /notifications — yeni bildirim ekle
routes.post('/', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    const { title, body, type, payload, createdAt } = req.body;
    if (!title || !body) {
      return res.status(400).json({ msg: 'title and body required' });
    }

    const insertId = await insertQuery(
      `INSERT INTO notifications (user_id, title, body, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        title,
        body,
        type || 'system',
        payload || null,
        createdAt || new Date(),
      ]
    );

    if (!insertId) {
      return res.status(500).json({ msg: 'Insert failed' });
    }

    return res.status(201).json({ id: String(insertId) });
  } catch (e) {
    console.error('[notifications] POST error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

// PATCH /notifications/:id/read — bildirimi okundu işaretle
routes.patch('/:id/read', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    await query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [req.params.id, userId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications] PATCH read error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

// PATCH /notifications/read-all — tüm bildirimleri okundu işaretle
routes.patch('/read-all', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    await query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ?`,
      [userId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications] PATCH read-all error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

// DELETE /notifications/:id
routes.delete('/:id', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    await query(
      `DELETE FROM notifications WHERE id = ? AND user_id = ?`,
      [req.params.id, userId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications] DELETE error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

// DELETE /notifications — tüm bildirimleri sil (logout)
routes.delete('/', middleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });

    await query(`DELETE FROM notifications WHERE user_id = ?`, [userId]);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[notifications] DELETE all error', e.message);
    return res.status(500).json({ msg: 'Internal error' });
  }
});

module.exports = routes;
