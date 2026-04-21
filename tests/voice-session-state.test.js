const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionState,
  markChunkProcessed,
  isChunkProcessed
} = require('../voice/sessionState');

test('session state: chunk idempotency works', () => {
  const state = createSessionState({
    userId: 'u1',
    conversationId: 10,
    language: 'tr-TR'
  });

  assert.equal(isChunkProcessed(state, 'utt-1', 1), false);
  markChunkProcessed(state, 'utt-1', 1);
  assert.equal(isChunkProcessed(state, 'utt-1', 1), true);
  assert.equal(isChunkProcessed(state, 'utt-1', 2), false);
});

test('session state: defaults language to tr-TR in caller', () => {
  const state = createSessionState({
    userId: 'u2',
    conversationId: 11,
    language: 'tr-TR'
  });

  assert.equal(state.language, 'tr-TR');
  assert.ok(state.sessionId);
});
