# Mobile Cursor AI Handoff (Sürekli Algılama + Barge-in)

Bu doküman mobil Cursor AI ajanına verilecek kesin talimattır.
Hedef: **bas-konuş yok**, **sürekli dinleme + konuşma algılama**.

## Nihai akış (zorunlu)

1. Kullanıcı voice call’a bağlanır (`/ws/voice`).
2. İlgili agent session’a bağlanır (`conversationId` üzerinden bot/voiceId çözülür).
3. Kullanıcı konuşmaya başlar (`onSpeechStart`) -> **AI sesi anında durdurulur**.
4. Kullanıcı susar (`onSpeechEnd`) -> backend ses akışını **Whisper/STT** ile çözer.
5. Çıkan metin, backend içinde **son 10 mesaj + yeni kullanıcı mesajı** ile **OpenAI GPT-4o**’ya gönderilir.  
   > Webhook kullanılmaz.
6. Gelen AI cevabı agent’ın `voiceId` ile ElevenLabs’e gönderilir.
7. Üretilen ses `tts.chunk` eventleri ile mobile döner ve oynatılır.

## Bas-konuş kesinlikle yok

- Press-and-hold mantığı kaldırılacak.
- Mikrofon butonu sadece `call start/end` için kalacak.
- Konuşma algılama otomatik olacak.

## Mobile event zorunlulukları

Client -> Server:
- `session.start`
- `webrtc.offer`, `webrtc.ice` (ana yol)
- `speech.start` (kullanıcı konuşmaya başladığı an)
- `speech.stop` (kullanıcı sustuğu an)
- `audio.chunk` (WS fallback yolunda)

Server -> Client:
- `connection.ready`
- `session.ready`
- `webrtc.answer`, `webrtc.track`
- `turn.state` (`listening|thinking|speaking`)
- `stt.partial`, `stt.final`
- `ai.response`
- `tts.start`, `tts.chunk`, `tts.end`
- `tts.stop`, `ai.interrupted`
- `error`

Kontrat referansı: `docs/voice-streaming-contract.md`

## Video call (Adim 1 - aktif)

Backend artik WebRTC `ontrack` event'ini mobile'a geciyor. Bu event ile video track'in server tarafina ulasip ulasmadigini net gorursunuz.

### Server -> Client yeni event

```json
{
  "type": "webrtc.track",
  "payload": {
    "sessionId": "sess-uuid",
    "kind": "video",
    "id": "d3d8...",
    "enabled": true,
    "muted": false,
    "readyState": "live"
  }
}
```

### Mobil tarafta yapilacaklar

1. `getUserMedia` ile **audio + video** track alin:
   - `audio: true`
   - `video: { facingMode: "user" }`
2. Bu stream'i `RTCPeerConnection`'a ekleyin.
3. `webrtc.offer` gonderin, `webrtc.answer` alin.
4. `webrtc.track` eventi geldiginde:
   - `kind=video` ise "Video baglandi" UI state'ine gecin.
   - 5-10 sn icinde hic `kind=video` gelmezse "Sadece ses baglandi" fallback'i gosterin.

### Flutter pseudo akisi

```dart
pc.onTrack = (event) {
  // remote media track
};

ws.onMessage((msg) {
  final type = msg['type'];
  final payload = msg['payload'] ?? {};
  if (type == 'webrtc.track' && payload['kind'] == 'video') {
    // UI: video connected badge on
  }
});
```

## Flutter implementasyonu (Cursor AI için yapılacaklar)

## 1) WS bağlantısı

`wss://api-domain/ws/voice?token=<jwt>`

`connection.ready` bekle.

## 2) Session başlat

```json
{
  "type": "session.start",
  "requestId": "r1",
  "payload": {
    "sessionId": "sess-uuid",
    "conversationId": 555,
    "transport": "webrtc",
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

## 3) WebRTC signaling

1. `flutter_webrtc` ile `RTCPeerConnection`
2. mic track ekle
3. `webrtc.offer` gönder
4. `webrtc.answer` al, `setRemoteDescription`
5. ICE candidate’ları `webrtc.ice` ile gönder

## 4) Sürekli algılama (VAD)

Mobilde energy/VAD detector koşacak.

- `onSpeechStart` tetiklenince:
  - yeni `utteranceId` üret
  - local player’da agent sesini hemen durdur
  - WS `speech.start` gönder

```json
{ "type": "speech.start", "payload": { "utteranceId": "utt-1001" } }
```

- `onSpeechEnd` tetiklenince:
  - WS `speech.stop` gönder

```json
{ "type": "speech.stop", "payload": { "utteranceId": "utt-1001" } }
```

## 5) Barge-in davranışı

AI konuşurken kullanıcı konuşursa:

1. Mobile local playback’i anında kes
2. `speech.start` gönder
3. Server’dan `tts.stop` + `ai.interrupted` bekle
4. Yeni turn `listening -> thinking -> speaking` akışına gir

## 6) UI bağlama

- `stt.partial`: canlı transcript
- `stt.final`: kullanıcı nihai metni
- `ai.response`: text bubble
- `tts.chunk`: audio player buffer/play
- `turn.state`: animasyon/state

## 7) Reconnect ve idempotency

- WS reconnect exponential backoff: 0.5s, 1s, 2s, 4s, max 10s
- yeniden bağlanınca aynı `sessionId` ile `session.start`
- in-flight paketler için `utteranceId + chunkSeq` korunacak

## 8) Fallback (geçici)

WebRTC/WS sorununda:

- `/chat/send-audio-message` fallback akışına dön
- kullanıcıya “anlık mod yerine kayıt modu” bilgisi ver

## Backend tarafı (bu repoda uygulanmış)

- STT provider: `openai-whisper`
  - kullanıcı susunca (`speech.stop`) utterance finalize edilir
  - ses OpenAI Whisper ile çözümlenir
- LLM: `VOICE_AI_MODE=openai`
  - webhook kullanılmaz
  - `conversationId` için DB’den son 10 mesaj çekilir
  - yeni transcript ile birlikte GPT-4o’ya gönderilir
- TTS: ElevenLabs stream
  - `bots.voiceId` kullanılır (conversation -> bot -> voiceId)
  - `tts.start/chunk/end` eventleri mobile döner

## Çalışma checklist (Cursor AI)

- [ ] Push-to-talk kodu kaldırıldı
- [ ] `speech.start/stop` VAD tetiklerine bağlandı
- [ ] Barge-in sırasında local TTS anında kesiliyor
- [ ] `turn.state` UI’a bağlandı
- [ ] Reconnect + idempotency eklendi
- [ ] Fallback `/chat/send-audio-message` hazır

## Gerekli backend env (zorunlu)

```env
VOICE_STREAMING_ENABLED=true
WEBRTC_ENABLED=true

STT_PROVIDER=openai-whisper
VOICE_DEFAULT_LANGUAGE=tr-TR
VOICE_AUDIO_CODEC=pcm16le
VOICE_AUDIO_SAMPLE_RATE=16000
VOICE_AUDIO_CHANNELS=1
VOICE_AUDIO_FRAME_MS=20

VOICE_AI_MODE=openai
OPENAI_API_KEY=...
OPENAI_STT_MODEL=whisper-1
OPENAI_CHAT_MODEL=gpt-4o

ELEVENLABS_API_KEY=...
ELEVENLABS_DEFAULT_VOICE_ID=...
```

