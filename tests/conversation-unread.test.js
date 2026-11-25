const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// db.js ve auth ara katmanı mock'lanır (DB'ye bağlanmadan).
const calls = [];
let handlers = [];
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getQuery: async (sql, params) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (sql.includes(h.match)) return h.rows(params);
      }
      return [];
    },
    query: async (sql, params) => {
      calls.push({ sql, params });
      return true;
    },
    insertQuery: async () => 1,
  },
};
const mwPath = require.resolve('../middleware/checkAuth');
require.cache[mwPath] = {
  id: mwPath,
  filename: mwPath,
  loaded: true,
  exports: (req, res, next) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ success: false });
    req.user = { id };
    next();
  },
};

const express = require('express');
const { loadUnreadInfo } = require('../routes/lib/conversationUnread');

async function withServer(fn) {
  const router = require('../routes/chat');
  const app = express();
  app.use(express.json());
  app.use('/chat', router);
  const server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, body, user) => {
    const res = await fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    await fn(post);
  } finally {
    server.close();
  }
}

test('loadUnreadInfo: tek toplu sorgu çifti, sayı ve son gönderen', async () => {
  calls.length = 0;
  handlers = [
    { match: 'COUNT(*)', rows: () => [{ cid: 1, c: 3 }] },
    { match: 'MAX(m.id)', rows: () => [{ cid: 1, sender: 'bot' }, { cid: 2, sender: 'user' }] },
  ];
  const m = await loadUnreadInfo([1, 2, 3]);
  assert.equal(calls.length, 2);
  assert.deepEqual(m.get(1), { unread_count: 3, last_message_sender: 'bot' });
  assert.deepEqual(m.get(2), { unread_count: 0, last_message_sender: 'user' });
  assert.deepEqual(m.get(3), { unread_count: 0, last_message_sender: null });
});

test('loadUnreadInfo: sütun yoksa (migration öncesi) boş döner, hata atmaz', async () => {
  handlers = [{ match: 'COUNT(*)', rows: () => { throw new Error('Unknown column last_read_at'); } }];
  const m = await loadUnreadInfo([1]);
  assert.equal(m.size, 0);
});

test('mark-conversation-read: 401 / 403 / 400 / 404 / mutlu yol', async () => {
  await withServer(async (post) => {
    handlers = [];
    assert.equal((await post('/chat/mark-conversation-read', { userId: 5, conversationId: 1 })).status, 401);
    assert.equal((await post('/chat/mark-conversation-read', { userId: 6, conversationId: 1 }, '5')).status, 403);
    assert.equal((await post('/chat/mark-conversation-read', { userId: 5, conversationId: 'x' }, '5')).status, 400);
    // sahiplik: başkasının sohbeti → 404
    handlers = [{ match: 'SELECT id FROM `coversations`', rows: () => [] }];
    assert.equal((await post('/chat/mark-conversation-read', { userId: 5, conversationId: 9 }, '5')).status, 404);
    // mutlu yol
    handlers = [{ match: 'SELECT id FROM `coversations`', rows: () => [{ id: 9 }] }];
    calls.length = 0;
    const ok = await post('/chat/mark-conversation-read', { userId: 5, conversationId: 9 }, '5');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { success: true, conversationId: 9, unread_count: 0 });
    assert.ok(calls.some((c) => c.sql.includes('SET `last_read_at` = NOW()') && c.params[1] === 5));
  });
});

test('get-conversations: conversationData unread alanlarını içerir, mevcut alanlar korunur', async () => {
  await withServer(async (post) => {
    handlers = [
      { match: 'SELECT c.*', rows: () => [{ id: 1, botId: 7, userId: 5 }] },
      { match: 'FROM `bots`', rows: () => [{ id: 7, name: 'Ada', system: 0 }] },
      { match: 'COUNT(*)', rows: () => [{ cid: 1, c: 2 }] },
      { match: 'MAX(m.id)', rows: () => [{ cid: 1, sender: 'user' }] },
    ];
    const r = await post('/chat/get-conversations', { userId: 5 }, '5');
    assert.equal(r.status, 200);
    assert.equal(r.body[0].conversationData.id, 1);
    assert.equal(r.body[0].conversationData.unread_count, 2);
    assert.equal(r.body[0].conversationData.last_message_sender, 'user');
    assert.equal(r.body[0].botData.name, 'Ada');
  });
});

// routes/chat.js içe aktarma zinciri açık tutamaçlar (zamanlayıcı / bağlantı) bırakıyor.
test.after(() => setImmediate(() => process.exit(0)));
