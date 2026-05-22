/**
 * OpenAI Realtime Session (per-connection)
 *
 * Hybrid mode: we use OpenAI Realtime ONLY for:
 *   - Server-side VAD (low latency turn detection)
 *   - Input audio transcription (Whisper)
 *   - LLM text output (streamed as text.delta)
 *
 * TTS is handled externally by ElevenLabs WS streaming for
 * per-consultant custom voices.
 */

'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');

// NOT: Realtime API'ye erişim hesap bazlı. Bazı hesaplarda `gpt-4o-realtime-preview`
// dahi 404 dönebiliyor. Çalışan model adını `friendfyapis/.env` içine
// `OPENAI_REALTIME_MODEL=...` olarak ekle. Aday adlar (hesap erişimine göre):
//   - gpt-realtime                              (yeni GA model)
//   - gpt-4o-realtime-preview-2024-12-17        (dated stable)
//   - gpt-4o-mini-realtime-preview-2024-12-17   (dated mini)
//   - gpt-4o-realtime-preview                   (alias)
//   - gpt-4o-mini-realtime-preview              (alias)
// Hangisinin açık olduğunu öğrenmek için OpenAI dashboard > Limits.
const DEFAULT_MODEL =
  process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini-2025-12-15';

class OpenAIRealtimeSession extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.instructions  System instructions (includes chat history)
   * @param {string} [opts.language]    Response language code (e.g. "tr")
   * @param {string} [opts.model]
   */
  constructor(opts = {}) {
    super();
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');

    this.instructions = opts.instructions || 'You are a helpful AI assistant.';
    this.language = opts.language || 'tr';
    this.model = opts.model || DEFAULT_MODEL;

    this.ws = null;
    this.isReady = false;
    this.closed = false;
    this.sessionConfigured = false;
    this.currentResponseId = null;
  }

  /** Open the WebSocket connection to OpenAI and send session.update */
  async connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;
    console.log(`[OPENAI-RT] 🔌 Connecting — model=${this.model}`);

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.off('error', onErr);
        resolve();
      };
      const onErr = (err) => {
        this.ws.off('open', onOpen);
        reject(err);
      };
      this.ws.once('open', onOpen);
      this.ws.once('error', onErr);
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) reject(new Error('OpenAI connect timeout'));
      }, 10000);
    });

    this._attachHandlers();

    setTimeout(() => {
      if (!this.sessionConfigured && !this.closed && this.ws?.readyState === WebSocket.OPEN) {
        console.warn('[OPENAI-RT] ⚠️ session.updated timeout — enabling session');
        this.sessionConfigured = true;
        this.isReady = true;
        this.emit('session_ready');
      }
    }, 8000);

    // Language handling: auto-detect from the user's audio and mirror it.
    // Never switch to a different language mid-conversation on your own.
    // `this.language` is only used as a fallback (initial greeting) when
    // we haven't yet heard any user speech.
    const LANG_NAMES = {
      tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish',
      fr: 'French', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
      ja: 'Japanese', ko: 'Korean', zh: 'Chinese', hi: 'Hindi',
      ar: 'Arabic',
    };
    const defaultLanguage = LANG_NAMES[this.language] || this.language;

    const instructions = `${this.instructions}

LANGUAGE RULES (very important):
- Always respond in the exact same language the user is speaking right now.
- If you haven't heard the user yet, OR cannot clearly identify their language, you MUST respond in ${defaultLanguage} (code: ${this.language}).
- Never switch to another language unless the user does it first.
- Never mix languages in the same sentence.

TONE:
- This is a real phone call — keep replies natural, warm, conversational and concise.
- Avoid long monologues; one or two short sentences at a time.`;

    // GA Realtime (gpt-realtime*): nested audio.input — flat input_audio_* is rejected.
    this._send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions,
        output_modalities: ['text'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.55,
              prefix_padding_ms: 200,
              silence_duration_ms: 600,
              // Critical: we want to verify the transcript is NOT an echo of our
              // own TTS output before killing the AI response. So we disable
              // automatic interruption and automatic response creation — the
              // server layer (voiceChatServerV2) decides manually after it has
              // seen the full transcript.
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    });

    console.log(`[OPENAI-RT] 🔌 Connected — waiting for session.updated`);
  }

  /** Wire up raw WebSocket events to typed emitter events */
  _attachHandlers() {
    this.ws.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch (e) {
        console.warn('[OPENAI-RT] ⚠️ Non-JSON message received');
        return;
      }

      // TANI LOGU: GA Realtime API'da event şeması farklı olabilir.
      // Özellikle `conversation.item.added` ve `conversation.item.done`
      // payload'larını TAM dökerek user transcript'in nerede geldiğini bul.
      const t = event.type || 'unknown';
      if (t === 'conversation.item.added' ||
          t === 'conversation.item.done' ||
          t === 'conversation.item.created' ||
          t === 'conversation.item.input_audio_transcription.completed' ||
          t === 'conversation.item.input_audio_transcription.failed' ||
          t === 'conversation.item.input_audio_transcription.delta') {
        try {
          console.log(`[OPENAI-RT] ⇦ ${t} payload=${JSON.stringify(event).substring(0, 600)}`);
        } catch (_) {
          console.log(`[OPENAI-RT] ⇦ ${t}`);
        }
      } else if (t === 'input_audio_buffer.speech_started' ||
                 t === 'input_audio_buffer.speech_stopped' ||
                 t === 'input_audio_buffer.committed' ||
                 t === 'response.created' ||
                 t === 'response.done' ||
                 t === 'response.cancelled' ||
                 t === 'error') {
        const summary = (() => {
          if (t === 'error') return ` code=${event?.error?.code} msg="${event?.error?.message}"`;
          return '';
        })();
        console.log(`[OPENAI-RT] ⇦ ${t}${summary}`);
      } else if (!t.includes('delta') && !t.includes('audio')) {
        console.log(`[OPENAI-RT] ⇦ ${t}`);
      }

      switch (event.type) {
        case 'session.created':
          break;

        case 'session.updated':
          if (!this.sessionConfigured) {
            this.sessionConfigured = true;
            this.isReady = true;
            console.log('[OPENAI-RT] ✅ Session configured (session.updated)');
            this.emit('session_ready');
          }
          break;

        case 'input_audio_buffer.speech_started':
          // User started speaking — critical for barge-in
          this.emit('user_speech_started', event);
          break;

        case 'input_audio_buffer.speech_stopped':
          this.emit('user_speech_stopped', event);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.emit('user_transcript', {
            itemId: event.item_id,
            transcript: event.transcript || '',
          });
          break;

        case 'conversation.item.input_audio_transcription.failed':
          // Whisper transkribe edemedi (gürültü, çok kısa, vs.). Üst katmana
          // boş transcript yolla → o da state'i listening'e geri çevirir.
          console.log('[OPENAI-RT] ⚠️ transcription failed:', event?.error?.message || '');
          this.emit('user_transcript', { itemId: event.item_id, transcript: '' });
          break;

        // YENİ GA REALTIME API: kullanıcı sesi transkribe edildiğinde tek bir
        // `conversation.item.done` event'i geliyor — eski preview'daki ayrı
        // `input_audio_transcription.completed` yerine. Item içeriğinden
        // user transcript'ini çıkarıp aynı event'i emit ediyoruz ki üst
        // katman (voiceChatServerV2) hiçbir değişiklik yapmadan çalışsın.
        case 'conversation.item.done':
        case 'conversation.item.added': {
          const item = event?.item || {};
          if (item.role === 'user' && Array.isArray(item.content)) {
            for (const part of item.content) {
              const text =
                part?.transcript ||
                (part?.type === 'input_text' ? part?.text : '') ||
                '';
              if (text && typeof text === 'string') {
                console.log(`[OPENAI-RT] 📝 user transcript via ${event.type}: "${text.substring(0, 80)}"`);
                this.emit('user_transcript', {
                  itemId: item.id,
                  transcript: text,
                });
                break;
              }
            }
          }
          break;
        }

        case 'response.created':
          this.currentResponseId = event.response?.id || null;
          this.emit('response_created', event);
          break;

        case 'response.text.delta':
        case 'response.output_text.delta':
          if (event.delta) this.emit('text_delta', { delta: event.delta });
          break;

        case 'response.text.done':
        case 'response.output_text.done':
          this.emit('text_done', { text: event.text || '' });
          break;

        case 'response.done':
          this.currentResponseId = null;
          this.emit('response_done', event);
          break;

        case 'response.cancelled':
          this.currentResponseId = null;
          this.emit('response_cancelled', event);
          break;

        case 'error': {
          const code = event?.error?.code;
          const param = event?.error?.param;
          // Benign race: we asked to cancel but response already ended. Ignore quietly.
          if (code === 'response_cancel_not_active') {
            this.currentResponseId = null;
            break;
          }
          // Invalid audio chunk rejected by OpenAI — the buffer is unusable,
          // but the session itself is fine. Clear the buffer and keep going
          // (do NOT propagate to the app as a fatal error; otherwise the
          // Flutter client ends the call and the user sees a broken UX).
          if (
            code === 'invalid_value' &&
            (param === 'audio.audio' || param === 'audio')
          ) {
            console.warn('[OPENAI-RT] ⚠️ Invalid audio chunk — clearing input buffer');
            try {
              this._send({ type: 'input_audio_buffer.clear' });
            } catch (_) {}
            break;
          }
          console.error('[OPENAI-RT] ❌ API error:', JSON.stringify(event));
          this.emit('api_error', event);
          break;
        }

        default:
          // Ignore: response.output_item.added, response.content_part.*, rate_limits.updated, etc.
          break;
      }
    });

    this.ws.on('error', (err) => {
      console.error('[OPENAI-RT] ❌ WebSocket error:', err.message);
      this.emit('ws_error', err);
    });

    this.ws.on('close', (code, reason) => {
      this.closed = true;
      this.isReady = false;
      console.log(`[OPENAI-RT] 🔌 Closed — code=${code} reason=${reason?.toString()}`);
      this.emit('closed', { code, reason: reason?.toString() });
    });
  }

  /** Append PCM16 chunk to input audio buffer */
  appendAudio(pcmBuffer) {
    if (!this.isReady || this.closed) return;
    // Guard against empty / odd-sized / non-buffer inputs — OpenAI will
    // reject the event with `invalid_value` otherwise and drop the whole
    // realtime session.
    if (!Buffer.isBuffer(pcmBuffer)) return;
    if (pcmBuffer.length === 0) return;
    if (pcmBuffer.length % 2 !== 0) return; // PCM16 must be even-byte
    const base64 = pcmBuffer.toString('base64');
    if (!base64) return;
    this._send({ type: 'input_audio_buffer.append', audio: base64 });
  }

  /** Add a prior message (for history injection) — called BEFORE any response */
  addHistoryMessage(role, text) {
    if (!this.isReady || this.closed) return;
    if (!text || !text.trim()) return;
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role, // 'user' | 'assistant'
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
      },
    });
  }

  /** Force-create a response (e.g. for greeting) */
  createResponse(overrideInstructions = null) {
    if (!this.isReady || this.closed) return;
    const msg = { type: 'response.create', response: {} };
    if (overrideInstructions) msg.response.instructions = overrideInstructions;
    this._send(msg);
  }

  /** Cancel an in-flight response (for barge-in). No-op if no active response. */
  cancelResponse() {
    if (!this.ws || this.closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.currentResponseId) return; // nothing to cancel → avoid OpenAI "response_cancel_not_active" error
    this._send({ type: 'response.cancel' });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(); } catch (_) {}
    }
    this.closed = true;
    this.isReady = false;
    this.removeAllListeners();
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {
      console.error('[OPENAI-RT] ❌ send error:', e.message);
    }
  }
}

module.exports = OpenAIRealtimeSession;
