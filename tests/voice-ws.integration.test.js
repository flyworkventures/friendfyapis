const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const JWT = require('jsonwebtoken');
const { createVoiceGateway } = require('../voice/voiceGateway');

function onceEvent(ws, expectedType, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for event: ${expectedType}`));
    }, timeoutMs);

    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type === expectedType) {
        cleanup();
        resolve(message);
      }
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    }

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

test('voice websocket end-to-end emits partial/final/ai', async () => {
  process.env.VOICE_STREAMING_ENABLED = 'true';
  process.env.STT_PROVIDER = 'mock';
  process.env.VOICE_AI_MODE = 'echo';
  process.env.JWT_SECRET = 'test-secret';

  const app = express();
  const server = http.createServer(app);
  createVoiceGateway(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const token = JWT.sign({ userId: 42, email: 'test@example.com' }, process.env.JWT_SECRET);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/voice?token=${token}`);

  await onceEvent(ws, 'connection.ready');

  ws.send(JSON.stringify({
    type: 'session.start',
    payload: {
      sessionId: 'sess-1',
      conversationId: 555,
      language: 'tr-TR'
    }
  }));
  await onceEvent(ws, 'session.ready');

  ws.send(JSON.stringify({
    type: 'audio.chunk',
    payload: {
      utteranceId: 'utt-1',
      chunkSeq: 1,
      textHint: 'merhaba nasılsın',
      audio: { codec: 'pcm16le', sampleRate: 16000, channels: 1, frameMs: 20 }
    }
  }));

  const partial = await onceEvent(ws, 'stt.partial');
  assert.equal(partial.payload.utteranceId, 'utt-1');

  ws.send(JSON.stringify({
    type: 'utterance.end',
    payload: {
      utteranceId: 'utt-1'
    }
  }));

  const finalEvent = await onceEvent(ws, 'stt.final');
  assert.equal(finalEvent.payload.utteranceId, 'utt-1');
  assert.ok(finalEvent.payload.transcript.includes('merhaba'));

  const aiEvent = await onceEvent(ws, 'ai.response');
  assert.ok(aiEvent.payload.text.includes('Anladım'));

  ws.close();
  await new Promise((resolve) => server.close(resolve));
});
