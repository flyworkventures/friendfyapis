# friendfyapis/ — Node.js Backend

Express + WebSocket. Port 3000 (varsayılan).

## Endpoint Grupları
- `/realtime` — Voice Chat v2 (OpenAI Realtime + ElevenLabs TTS). Bkz. `realtime/`.
- `/ws/voice` — eski voice streaming gateway.
- `/ws/video` — video call gateway.
- REST: `routes/` altında (premium sync vb.).

## Realtime Voice (OpenAI)
- `realtime/openaiRealtimeSession.js`
  - **Default model: `gpt-4o-realtime-preview-2024-12-17`** (dated/stable). Bazı OpenAI hesapları alias `gpt-4o-realtime-preview`'a / `gpt-4o-mini-realtime-preview`'a 404 dönüyor → dated isim daha güvenli.
  - Alternatif adlar (hesap erişimine göre): `gpt-realtime`, `gpt-4o-mini-realtime-preview-2024-12-17`.
  - Override: `.env` → `OPENAI_REALTIME_MODEL=...`.
  - Hybrid: OpenAI yalnız VAD + STT + LLM text üretiyor; TTS ElevenLabs WS ile yapılıyor.
- Kullanıcı semptomu: model erişilemezse `openai_session_closed` event'i hemen frontend'e iletiliyor, çağrı "kopmuş" gibi görünüyor.

## Env Değişkenleri (`.env`)
Önemliler:
- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL` (opsiyonel override)
- `OPENAI_STT_MODEL=gpt-4o-transcribe`
- `OPENAI_CHAT_MODEL=gpt-4o`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`

## Çalıştırma
```bash
npm start    # nodemon app.js
```

Port 3000 doluysa: `kill -9 $(lsof -t -i:3000)`.

## Realtime Voice/Video Call (voiceChatServerV2.js)

Mindcoach pattern'ine göre çalışıyor: OpenAI Realtime → text.delta → ElevenLabs WS TTS → PCM → client.

### Kritik Kurallar (geçmişte bug'a yol açmış noktalar)
1. **TTS PCM yalnızca binary frame olarak gönderilir.** Asla JSON `tts.chunk { audioBase64 }` ile aynı PCM'i kopyalama — Flutter iki yolu da aynı buffer'a ekler → "alo Furkan alo Furkan" gibi her şey iki kere çalar. `tts.chunk` JSON event'i yalnızca `isLast: true, audioBase64: ''` ile **control** mesajı olarak kullanılır.
2. **Echo guard her zaman aktif.** `_findEchoMatch(raw, echoCandidates, 0.6)` koşulsuz çağrılmalı. Önceki sürüm `echoGuardActive ? null : _findEchoMatch(...)` şeklinde ters mantık içeriyordu → AI konuşurken (yankı en olası anda) yankıyı yakalamıyordu, kendi sesini user input zannedip aynı yanıtı tekrar üretiyordu.
3. **Greeting fallback timing.**
   - Voice call: 1200ms — voice'de avatar yok, client `session.ready` alır almaz `avatar.ready` gönderir, greeting hemen başlar; fallback sadece bağlantı sorunu için.
   - Video call: 6000ms — Rive avatar CDN'den 8MB+ inebiliyor; client gerçekten `avatar.ready` gönderene kadar AI konuşmaya başlamasın (ağzı kıpırdamayan rive üzerine ses gelmesin). Client tarafında da 4sn (`_scheduleAvatarReadyFallback`) ve 8sn (`_riveReadyFallbackTimer`, fotoğraf fallback) ayrı güvenlik zamanlayıcıları var.

### Trigger Akışı
- Sunucu OpenAI connect olur olmaz `setTimeout(greetingDelayMs, _triggerGreeting)` arms.
- Client `avatar.ready` gönderirse de `_triggerGreeting` çağrılır.
- `_triggerGreeting` içindeki `greetingPlayed` flag çift tetiklenmeyi engeller.

## Premium Sync
- `routes/` altında `/sync-memberships` endpoint'i Flutter tarafından çağrılıyor.
- Client optimistic update yaptığı için endpoint yavaş cevap verse bile UI bloklanmıyor; ama server-side receipt validation eklenirse client'ın gönderdiği memberships override edilebilir.
