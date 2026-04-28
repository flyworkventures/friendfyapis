# Friendfy Sesli/Video Konusma Sistemi - Teknik Dokuman

Bu dokuman, backend tarafindaki gercek zamanli sesli ve video gorusme altyapisini
AI baglantisindan mobil istemciye donen eventlere kadar uctan uca aciklar.

## 1) Genel Mimari

Sistem 3 ana katmandan olusur:

- HTTP API (`express`) + WS upgrade (`http.createServer`)
- Voice Gateway (`/ws/voice`) - sesli sohbet akisi
- Video Gateway (`/ws/video`) - video odakli ayri kanal

Temel dosyalar:

- `app.js` -> sunucu giris noktasi, route/gateway kaydi
- `voice/voiceGateway.js` -> sesli WS state machine
- `voice/videoGateway.js` -> video WS state machine
- `voice/providers/OpenAiWhisperSttProvider.js` -> STT
- `voice/aiPipeline.js` -> AI (OpenAI/webhook/echo)
- `voice/elevenlabsTts.js` -> TTS stream
- `voice/viseme.js` -> viseme timeline uretimi + `POST /viseme`
- `voice/webrtcTransport.js` -> WebRTC server transport

## 2) Sunucu Baslangici ve Feature Flag'ler

`app.js`:

- `VOICE_STREAMING_ENABLED=true` ise `/ws/voice` aktif olur.
- `VIDEO_CALL_ENABLED=true` ise `/ws/video` aktif olur.
- `createVisemeRouter()` ile `POST /viseme` HTTP endpoint'i kayitlidir.

Kritik not:

- Voice ve video iki farkli WS endpoint'tir.
- Upgrade cakismini onlemek icin `/ws/voice` handler'i kendi path'i degilse socket'i yok etmez, diger handler'a birakir.

## 3) Endpoint ve Kanal Ayrimi

- Voice call WS: `ws://<host>:3000/ws/voice`
- Video call WS: `ws://<host>:3000/ws/video`
- Viseme HTTP: `POST http://<host>:3000/viseme`

Prod'da `wss://` kullanilir.

## 4) Auth Mekanizmasi (WS)

Hem voice hem video upgrade asamasinda JWT dogrulanir.

Token alma sirasi:

1. `Authorization: Bearer <token>`
2. Query param `?token=<token>`
3. `x-auth-token` header

Token yoksa veya gecersizse:

- upgrade `401 Unauthorized` ile kapatilir.

## 5) Voice Call Uctan Uca Akis (`/ws/voice`)

### 5.1 Baglanti ve Session

1. Client `/ws/voice` baglanir.
2. Server `connection.ready` gonderir.
3. Client `session.start` gonderir:
   - `sessionId`
   - `conversationId` (opsiyonel ama onerilir)
   - `transport` (`ws` veya `webrtc`)
   - `language` (`tr-TR`)
   - `audio` (`pcm16le`, `sampleRate`, `channels`, `frameMs`)
4. Server `session.ready` doner.

Server session state:

- `turnState`: `listening | thinking | speaking`
- `aiSpeaking`
- `currentAiUtteranceId`
- `processedChunks` (idempotency)
- `vad.silenceMs` (varsayilan env ile)
- `voiceId` (conversation -> bot -> voiceId)

### 5.2 Kullanici Sesinin Alinmasi

Iki yol vardir:

- WS chunk: `audio.chunk` (base64 PCM)
- WebRTC audio: `webrtc.offer/ice` + server `RTCAudioSink` ile PCM frame

Validasyon:

- codec yalniz `pcm16le`
- sampleRate izinli: `8000|16000|24000|48000`
- channels yalniz `1`

Idempotency:

- `utteranceId + chunkSeq` set'te tutulur.
- tekrar gelen chunk `duplicate:true ack` ile gecilir.

### 5.3 VAD ve Finalization

Konusma sonlandirma tetikleri:

- `speech.stop`
- `utterance.end`
- `vad.event isSpeech=false`
- sessizlik timeout (`VOICE_VAD_SILENCE_MS`)

Finalization:

- Ayni utterance icin paralel/cift finalize engellenir
  (`finalizingUtterances` + `finalizedUtterances`).

### 5.4 STT (Whisper/OpenAI)

`OpenAiWhisperSttProvider`:

- Gelen PCM chunk'lari toplar.
- finalize'da WAV'a cevirir (`audioUtils.pcm16ToWavBuffer`).
- OpenAI `audio/transcriptions` cagrisi yapar.
- Dil TR ise `language=tr` gonderir.
- `prompt` ve `temperature` env ile ayarlanir.

Kalite guvenceleri:

- `STT_MIN_AUDIO_BYTES` altindaysa transcribe etmeden no-speech fallback.
- `STT_MIN_TRANSCRIPT_CHARS` ile cok kisa metinler elenir.

Eventler:

- `stt.partial`
- `stt.final` (noSpeech olabilir)

### 5.5 AI Pipeline

`aiPipeline.js` asamalari:

1. Son 10 mesaji DB'den ceker (`messages`).
2. Bot persona bilgisini ceker (`coversations` + `bots`).
3. Kullanici adini prompt'a ekler (`users`).
4. `VOICE_AI_MODE`'a gore yanit uretir:
   - `openai` (varsayilan)
   - `webhook`
   - `echo`

OpenAI modunda:

- `OPENAI_CHAT_MODEL` kullanilir (orn. `gpt-4o`)
- `OPENAI_CHAT_TEMPERATURE` uygulanir.
- Sistem prompt'u:
  - Turkce, dogal, kisa-orta cevap
  - uydurma yapmama
  - belirsizde netlestirme sorma
  - kullanici adi dahil

Event:

- `ai.response`

### 5.6 TTS ve Barge-in

`handleTtsRequest`:

1. `tts.start`
2. stream boyunca `tts.chunk`
3. son marker: bos `tts.chunk` + `isLast:true`
4. `tts.end`

TTS provider:

- ElevenLabs stream endpoint:
  `/v1/text-to-speech/{voiceId}/stream`

Barge-in:

- Kullanici konusmaya baslarsa aktif TTS kesilir.
- Gonderilen eventler:
  - `tts.stop`
  - `ai.interrupted`
  - finalize icin `isLast:true` marker + `tts.end` (interrupt senaryosunda)

## 6) Viseme Akisi

### 6.1 HTTP Endpoint (`POST /viseme`)

Body:

- `audioUrl`

Output format (korunmustur):

- `{ "visemes": [ { "id": <int>, "time": <double> } ] }`

Pipeline:

1. Audio indirme
2. `ffmpeg` ile 16kHz mono WAV
3. `rhubarb` ile mouth cues JSON
4. Rhubarb -> viseme map

### 6.2 WS Uzerinden Viseme (Voice + Video)

TTS sonrasinda:

- `viseme.timeline`:
  - `utteranceId` (tts ile ayni)
  - `visemes` (zaman sirali)
  - `isLast: true`

Uretilemezse:

- `viseme.unavailable`:
  - `reason: provider_no_viseme`

## 7) Video Call Akisi (`/ws/video`)

Video kanali voice'dan tamamen ayridir.

### 7.1 Session ve WebRTC

Client -> Server:

- `video.session.start`
- `video.webrtc.offer`
- `video.webrtc.ice`

Server -> Client:

- `video.connection.ready`
- `video.session.ready`
- `video.webrtc.answer`
- `video.webrtc.track` (kind/id/muted/readyState)

### 7.2 Video Kanalinda TTS + Viseme

Client -> Server:

- `video.tts.request`

Server -> Client sira:

1. `tts.start`
2. `tts.chunk`
3. `viseme.timeline` (veya `viseme.unavailable`)
4. `tts.end`

Ek eventler:

- `video.camera.toggle` / `video.camera.state`
- `video.call.end` / `video.call.ended`

## 8) Hata Modeli ve Retry

Custom hata:

- `VoiceStreamError(code, message, recoverable, details)`

Recoverable karar:

- `error.recoverable === true` veya
- transient kodlar (`ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`, `STT_TEMPORARY_FAILURE`)

Retry:

- `retryWithBackoff(fn, retries, baseDelayMs, factor)`
- STT/AI/TTS kritik cagrilarinda kullanilir.

WS hata eventi:

- Voice: `error`
- Video: `video.error`
- payload:
  - `code`
  - `message`
  - `retryable`
  - `stage`
  - `requestId`

## 9) Veritabani Baglantili Noktalar

Kullanilan tablolar:

- `coversations`: session -> bot/user baglantisi
- `bots`: `voiceId`, persona alanlari
- `messages`: gecmis + yeni mesaj kaydi
- `users`: kullanici adi/email (prompt'ta kullanilir)

Mesaj kaydi:

- `stt.final` sonrasinda user mesaji yazilir.
- `ai.response` sonrasinda assistant mesaji yazilir.

## 10) Ortam Degiskenleri (Ozet)

Core:

- `PORT`
- `JWT_SECRET`

Gateway:

- `VOICE_STREAMING_ENABLED`
- `VIDEO_CALL_ENABLED`
- `WEBRTC_ENABLED`
- `WEBRTC_ICE_SERVERS`

Voice/STT:

- `STT_PROVIDER`
- `VOICE_DEFAULT_LANGUAGE`
- `VOICE_AUDIO_CODEC`
- `VOICE_AUDIO_SAMPLE_RATE`
- `VOICE_AUDIO_CHANNELS`
- `VOICE_AUDIO_FRAME_MS`
- `VOICE_VAD_SILENCE_MS`
- `OPENAI_STT_MODEL`
- `OPENAI_STT_PROMPT`
- `OPENAI_STT_TEMPERATURE`
- `STT_MIN_TRANSCRIPT_CHARS`
- `STT_MIN_AUDIO_BYTES`

AI:

- `VOICE_AI_MODE`
- `VOICE_AI_WEBHOOK_URL`
- `OPENAI_CHAT_MODEL`
- `OPENAI_CHAT_TEMPERATURE`
- `OPENAI_API_KEY`

TTS/Viseme:

- `TTS_STREAMING_ENABLED`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_MODEL_ID`
- `ELEVENLABS_DEFAULT_VOICE_ID`
- `VISEME_ENABLED`
- `VISEME_FFMPEG_BIN`
- `VISEME_RHUBARB_BIN`

Debug:

- `VOICE_DEBUG_LOGS`

## 11) Mobil Tarafindan Beklenen Kritik Kurallar

- `utteranceId` tum ses/viseme eventlerinde tutarli olmalidir.
- `viseme.time` saniye cinsinden ve audio baslangicina gore relatif olmalidir.
- `tts.chunk` son marker (`isLast:true`) mutlaka handle edilmelidir.
- `viseme.timeline` bos bile gelse fallback icin event islenmelidir.
- Voice ve video endpoint karistirilmamalidir:
  - voice: `/ws/voice`
  - video: `/ws/video`

## 12) Operasyonel Kontrol Listesi

1. Server acilisinda loglari dogrula:
   - `Voice streaming gateway active at /ws/voice`
   - `Video call gateway active at /ws/video`
2. Token'siz baglantida `401` geldigini test et.
3. `session.start` / `video.session.start` akisini dogrula.
4. STT -> AI -> TTS zincirinde event sirasini izle.
5. `VISEME_ENABLED=true` iken `viseme.timeline`, degilken `viseme.unavailable` geldigini test et.
6. Barge-in'de aktif TTS'in kesildigini test et.

---

Bu dosya uygulamanin mevcut koduna gore hazirlandi. Yeni provider/event eklendikce
aynı dokuman guncellenmelidir.
