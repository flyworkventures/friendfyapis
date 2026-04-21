# Voice Streaming WebSocket Contract (Production)

Bu doküman `/ws/voice` endpoint’i için production-grade kontratı ve audio.chunk formatını kesinleştirir.

## Feature flag

- `VOICE_STREAMING_ENABLED=true` değilse WS `503` döner.

## URL

- `ws(s)://<host>/ws/voice`

## Auth

Öncelik sırası:

1. `Authorization: Bearer <JWT>`
2. Query: `?token=<JWT>`
3. `x-auth-token: <JWT>`

JWT secret: `JWT_SECRET` (fallback: `key`)

## Session state (zorunlu)

- `sessionId`: client-generated veya server-generated
- `userId`: JWT’den (payload)
- `conversationId`: client gönderir (opsiyonel ama önerilir)
- `botId`: opsiyonel (conversationId verilirse DB’den çözümlenir)

## Event Envelope

Tüm mesajlar JSON’dur:

```json
{
  "type": "event.type",
  "requestId": "client-req-uuid",
  "payload": {}
}
```

Server yanıtları:

```json
{
  "type": "event.type",
  "ts": 1710000000000,
  "requestId": "client-req-uuid",
  "payload": {}
}
```

`requestId` client’ten geldiyse echo edilir.

---

## Server -> Client Eventleri

### `connection.ready`

Bağlantı kabul edildiğinde:

```json
{
  "type": "connection.ready",
  "payload": {
    "featureEnabled": true,
    "defaultLanguage": "tr-TR",
    "server": {
      "sttProvider": "mock|deepgram",
      "ttsProvider": "elevenlabs|mock"
    }
  }
}
```

### `session.ready`

`session.start` sonrası:

```json
{
  "type": "session.ready",
  "requestId": "r1",
  "payload": {
    "sessionId": "sess-1",
    "userId": "42",
    "conversationId": 555,
    "botId": 140,
    "language": "tr-TR",
    "audio": {
      "codec": "pcm16le",
      "sampleRate": 16000,
      "channels": 1,
      "frameMs": 20
    },
    "voiceId": "elevenlabsVoiceIdOrNull"
  }
}
```

### `stt.partial`

```json
{
  "type": "stt.partial",
  "payload": {
    "sessionId": "sess-1",
    "utteranceId": "utt-1",
    "language": "tr-TR",
    "transcript": "merhaba ..."
  }
}
```

### `stt.final`

```json
{
  "type": "stt.final",
  "payload": {
    "sessionId": "sess-1",
    "utteranceId": "utt-1",
    "language": "tr-TR",
    "transcript": "merhaba nasılsın"
  }
}
```

### `ai.response`

```json
{
  "type": "ai.response",
  "payload": {
    "utteranceId": "utt-1",
    "text": "Anladım: merhaba nasılsın",
    "source": "echo|webhook"
  }
}
```

### `tts.start / tts.chunk / tts.end`

TTS stream aktifse:

```json
{ "type": "tts.start", "payload": { "utteranceId": "utt-1", "format": "audio/mpeg", "sampleRate": 22050 } }
```

```json
{
  "type": "tts.chunk",
  "payload": {
    "utteranceId": "utt-1",
    "chunkSeq": 0,
    "audioBase64": "<base64_mpeg_bytes>",
    "isLast": false
  }
}
```

```json
{ "type": "tts.end", "payload": { "utteranceId": "utt-1" } }
```

### `ack`

İdempotency için:

```json
{
  "type": "ack",
  "requestId": "r2",
  "payload": {
    "ackType": "audio.chunk",
    "utteranceId": "utt-1",
    "chunkSeq": 12,
    "duplicate": false
  }
}
```

---

## Client -> Server Eventleri

### `session.start`

```json
{
  "type": "session.start",
  "requestId": "r1",
  "payload": {
    "sessionId": "sess-1",
    "conversationId": 555,
    "transport": "ws",
    "language": "tr-TR",
    "audio": {
      "codec": "pcm16le",
      "sampleRate": 16000,
      "channels": 1,
      "frameMs": 20
    }
  }
}
```

`transport`:
- `ws`: audio chunk ile klasik websocket
- `webrtc`: WebRTC SDP/ICE eventleri ile media track

### `audio.chunk` (KESİN FORMAT)

**Codec zorunlu standard:** `pcm16le` (little-endian, signed 16-bit, mono).

- `sampleRate`: 16000 önerilir (STT için stabil)
- `channels`: 1
- `frameMs`: 20 (veya 10/40; 20 önerilir)
- `audioBase64`: *raw PCM bytes* base64
- `chunkSeq`: aynı `utteranceId` içinde artan integer, yeniden gönderimlerde aynı kalmalı

```json
{
  "type": "audio.chunk",
  "requestId": "r2",
  "payload": {
    "utteranceId": "utt-1",
    "chunkSeq": 12,
    "language": "tr-TR",
    "audio": { "codec": "pcm16le", "sampleRate": 16000, "channels": 1, "frameMs": 20 },
    "audioBase64": "<base64_pcm_bytes>"
  }
}
```

### `utterance.end`

```json
{ "type": "utterance.end", "requestId": "r3", "payload": { "utteranceId": "utt-1" } }
```

### `vad.event`

```json
{ "type": "vad.event", "requestId": "r4", "payload": { "utteranceId": "utt-1", "isSpeech": false } }
```

### `speech.start` / `speech.stop`

OpenAI benzeri barge-in davranışı için önerilir:

```json
{ "type": "speech.start", "requestId": "r6", "payload": { "utteranceId": "utt-2" } }
```

```json
{ "type": "speech.stop", "requestId": "r7", "payload": { "utteranceId": "utt-2" } }
```

### `webrtc.offer`

```json
{ "type": "webrtc.offer", "requestId": "r8", "payload": { "sdp": "v=0..." } }
```

### `webrtc.ice`

```json
{ "type": "webrtc.ice", "requestId": "r9", "payload": { "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } } }
```

### `tts.request`

```json
{ "type": "tts.request", "requestId": "r5", "payload": { "utteranceId": "utt-1", "text": "Merhaba", "voiceId": "optional" } }
```

---

## Error Event (recoverable mapping)

```json
{
  "type": "error",
  "payload": {
    "code": "BAD_AUDIO_CHUNK",
    "message": "audioBase64 gerekli",
    "retryable": true,
    "stage": "session|stt|ai_pipeline|tts|vad",
    "requestId": "r2"
  }
}
```

### Recoverable örnekler

- STT provider timeout / connection reset
- geçici upstream 5xx

### Non-recoverable örnekler

- Auth invalid
- desteklenmeyen codec
- webrtc runtime eksik (wrtc)
- provider config eksik

---

## Timeout / Retry / Backoff

- STT chunk push: 2 retry, kısa backoff
- AI webhook: 3 retry, exponential backoff
- TTS stream: 2 retry (başlangıç request’i), stream sırasında error => `retryable` false

## Turn/Interrupt Eventleri

Server aşağıdaki eventleri de döner:

- `turn.state`: `listening | thinking | speaking`
- `ai.interrupted`: kullanıcı konuşmaya başlayıp barge-in olduğunda
- `tts.stop`: aktif TTS stream kesildiğinde

