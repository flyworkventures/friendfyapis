/**
 * ElevenLabs WebSocket Streaming TTS Session (per AI turn)
 *
 * Endpoint: wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
 *
 * Flow:
 *   1. open()                              — connect + BOS message
 *   2. sendText(chunk, flush=false)        — as LLM produces text deltas
 *   3. finish()                            — send empty text (EOS)
 *   4. emits 'audio' (PCM16 16kHz) chunks + 'done'
 *   5. close() / abort() for barge-in
 */

'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');

// Turbo v2.5 delivers much more natural prosody than Flash at a small (~200ms)
// latency cost — better tradeoff for a phone-like voice chat experience.
const TTS_MODEL = process.env.ELEVENLABS_VOICE_CHAT_MODEL || 'eleven_turbo_v2_5';
const OUTPUT_FORMAT = 'pcm_24000'; // 24kHz PCM16 mono — matches OpenAI Realtime

class ElevenLabsTTSSession extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.voiceId
   * @param {Object} [opts.voiceSettings]
   */
  constructor(opts) {
    super();
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    if (!this.apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
    if (!opts?.voiceId) throw new Error('voiceId is required');

    this.voiceId = opts.voiceId;
    this.voiceSettings = opts.voiceSettings || {
      stability: 0.5,        // lower = more expressive, less robotic
      similarity_boost: 0.82,
      style: 0.18,           // a bit more expressiveness
      use_speaker_boost: true,
    };

    this.ws = null;
    this.opened = false;
    this.finished = false;
    this.aborted = false;
    // Buffer for sendText/finish calls issued before the socket opens.
    // Otherwise fast callers (e.g. canned short messages) lose their text.
    this._pendingSends = [];
  }

  async open() {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream-input` +
      `?model_id=${TTS_MODEL}` +
      `&output_format=${OUTPUT_FORMAT}` +
      // auto_mode=false lets us control chunking via chunk_length_schedule.
      // Auto mode kept splitting mid-word which produced choppy speech.
      `&auto_mode=false` +
      `&inactivity_timeout=60`;

    this.ws = new WebSocket(url);

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
        if (this.ws.readyState !== WebSocket.OPEN) reject(new Error('ElevenLabs connect timeout'));
      }, 8000);
    });

    this._attachHandlers();

    // BOS — initial config message (empty text triggers config only)
    this._send({
      text: ' ',
      voice_settings: this.voiceSettings,
      xi_api_key: this.apiKey,
      generation_config: {
        // Small first chunk → much lower time-to-first-audio. The 1st
        // sentence of most responses is short (greeting, acknowledgement)
        // so 50 chars usually captures it. Later chunks grow so longer
        // responses still benefit from enough prosody context.
        chunk_length_schedule: [50, 120, 220, 350],
      },
    });

    this.opened = true;

    // Flush anything queued while we were still connecting.
    if (this._pendingSends.length > 0) {
      for (const payload of this._pendingSends) this._send(payload);
      this._pendingSends = [];
    }
  }

  _attachHandlers() {
    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }

      if (msg.audio) {
        const pcm = Buffer.from(msg.audio, 'base64');
        if (pcm.length > 0 && !this.aborted) this.emit('audio', pcm);
      }

      if (msg.isFinal) {
        this.emit('done');
      }

      if (msg.error) {
        // Ignore errors after abort (barge-in) — session was intentionally torn down.
        if (this.aborted) return;
        console.error('[ELEVEN-WS] ❌ Error message:', msg.error);
        this.emit('tts_error', msg.error);
      }
    });

    this.ws.on('error', (err) => {
      if (!this.aborted) {
        console.error('[ELEVEN-WS] ❌ WS error:', err.message);
        this.emit('tts_error', err);
      }
    });

    this.ws.on('close', () => {
      this.opened = false;
      this.emit('closed');
    });
  }

  /** Send a text chunk as it arrives from the LLM */
  sendText(text, flush = false) {
    if (this.aborted || this.finished) return;
    if (!text) return;
    const payload = { text, try_trigger_generation: flush };
    if (!this.opened) {
      // Queue until the WebSocket connects; flushed in open().
      this._pendingSends.push(payload);
      return;
    }
    this._send(payload);
  }

  /** Signal end of text (EOS) so remaining audio is flushed */
  finish() {
    if (this.aborted || this.finished) return;
    this.finished = true;
    const payload = { text: '' };
    if (!this.opened) {
      this._pendingSends.push(payload);
      return;
    }
    this._send(payload);
  }

  /** Immediate abort for barge-in */
  abort() {
    this.aborted = true;
    this.opened = false;
    this._pendingSends = [];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch (_) { }
    }
    this.removeAllListeners();
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (e) {
      console.error('[ELEVEN-WS] ❌ send error:', e.message);
    }
  }
}

module.exports = ElevenLabsTTSSession;
