const WebSocket = require('ws');
const JWT = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { createSttProvider } = require('./providers');
const { runAiPipeline } = require('./aiPipeline');
const { VoiceStreamError, isRecoverableError } = require('./errors');
const { retryWithBackoff } = require('./retry');
const { createSessionState, markChunkProcessed, isChunkProcessed, clearVadTimer } = require('./sessionState');
const { streamElevenLabsTts, buildVisemesFromElevenLabsAlignment } = require('./elevenlabsTts');
const { generateVisemesFromAudioBuffer, isVisemeEnabled } = require('./viseme');
const { WebRtcTransport, hasWebRtcRuntime } = require('./webrtcTransport');
const { getQuery, query } = require('../db');

function isVoiceStreamingEnabled() {
  return String(process.env.VOICE_STREAMING_ENABLED || 'false').toLowerCase() === 'true';
}

function isVoiceDebugEnabled() {
  return String(process.env.VOICE_DEBUG_LOGS || 'false').toLowerCase() === 'true';
}

function voiceDebugLog(message) {
  if (isVoiceDebugEnabled()) {
    console.log(`[VOICE_DEBUG] ${message}`);
  }
}

function sendEvent(ws, type, payload = {}, requestId = null) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type,
    ts: Date.now(),
    requestId,
    payload
  }));
}

function envInt(name, fallback) {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDefaultAudioConfig() {
  return {
    codec: process.env.VOICE_AUDIO_CODEC || 'pcm16le',
    sampleRate: envInt('VOICE_AUDIO_SAMPLE_RATE', 16000),
    channels: envInt('VOICE_AUDIO_CHANNELS', 1),
    frameMs: envInt('VOICE_AUDIO_FRAME_MS', 20)
  };
}

function isWebRtcEnabled() {
  return String(process.env.WEBRTC_ENABLED || 'false').toLowerCase() === 'true';
}

function isVoiceChatPersistenceEnabled() {
  // Voice/Video call konusmalari varsayilan olarak chat mesajlarina yazilmaz.
  return String(process.env.VOICE_PERSIST_TO_CHAT || 'false').toLowerCase() === 'true';
}

function getVisemeProvider() {
  return String(process.env.VISEME_PROVIDER || 'rhubarb').toLowerCase();
}

function isVisemeBlockingEnabled() {
  return String(process.env.VISEME_BLOCKING || 'true').toLowerCase() === 'true';
}

function stabilizeVisemeTimeline(input) {
  const minGapSecRaw = Number(process.env.VISEME_MIN_GAP_SEC);
  const minGapSec = Number.isFinite(minGapSecRaw) ? minGapSecRaw : 0.04;
  const list = Array.isArray(input) ? input : [];
  const sorted = [...list]
    .map((v) => ({
      id: Number(v?.id || 0),
      time: Number(v?.time || 0)
    }))
    .filter((v) => Number.isFinite(v.time) && v.time >= 0 && Number.isFinite(v.id))
    .sort((a, b) => a.time - b.time);

  const stabilized = [];
  for (const item of sorted) {
    const current = { id: item.id, time: Number(item.time.toFixed(3)) };
    const prev = stabilized[stabilized.length - 1];
    if (!prev) {
      stabilized.push(current);
      continue;
    }
    if (current.time - prev.time < minGapSec) continue;
    if (current.id === prev.id) continue;
    stabilized.push(current);
  }
  if (stabilized.length === 0) return [{ id: 0, time: 0 }];
  if (stabilized[0].time > 0) stabilized.unshift({ id: 0, time: 0 });
  return stabilized;
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch (_) {
    throw new VoiceStreamError('BAD_JSON', 'Geçersiz JSON payload', { recoverable: true });
  }
}

function extractToken(request, parsedUrl) {
  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  const queryToken = parsedUrl.searchParams.get('token');
  if (queryToken) return queryToken;
  const protocolToken = request.headers['x-auth-token'];
  return protocolToken || null;
}

function normalizeChunkPayload(payload) {
  const utteranceId = payload.utteranceId || 'default';
  const chunkSeq = Number(payload.chunkSeq);
  if (!Number.isInteger(chunkSeq) || chunkSeq < 0) {
    throw new VoiceStreamError('BAD_CHUNK_SEQ', 'chunkSeq integer olmalı', { recoverable: true });
  }
  if (!payload.audioBase64 && !payload.textHint) {
    throw new VoiceStreamError('BAD_AUDIO_CHUNK', 'audioBase64 veya textHint gerekli', { recoverable: true });
  }
  const audio = payload.audio || {};
  const codec = (audio.codec || payload.codec || 'pcm16le').toLowerCase();
  const sampleRate = Number(audio.sampleRate || payload.sampleRate || 16000);
  const channels = Number(audio.channels || payload.channels || 1);
  const frameMs = Number(audio.frameMs || payload.frameMs || 20);
  if (codec !== 'pcm16le') {
    const err = new VoiceStreamError('UNSUPPORTED_CODEC', `Desteklenmeyen codec: ${codec}`, { recoverable: false });
    err.stage = 'stt';
    throw err;
  }
  if (![8000, 16000, 24000, 48000].includes(sampleRate)) {
    const err = new VoiceStreamError('BAD_SAMPLE_RATE', `sampleRate desteklenmiyor: ${sampleRate}`, { recoverable: true });
    err.stage = 'stt';
    throw err;
  }
  if (channels !== 1) {
    const err = new VoiceStreamError('BAD_CHANNELS', 'channels=1 olmalı', { recoverable: false });
    err.stage = 'stt';
    throw err;
  }
  return {
    utteranceId,
    chunkSeq,
    audioBase64: payload.audioBase64 || null,
    textHint: payload.textHint || null,
    language: payload.language || 'tr-TR',
    audio: { codec, sampleRate, channels, frameMs }
  };
}

async function emitVisemeTimeline(ws, utteranceId, audioBytes, options = {}) {
  if (!utteranceId) return;

  if (!isVisemeEnabled()) {
    sendEvent(ws, 'viseme.unavailable', {
      utteranceId,
      reason: 'provider_no_viseme'
    });
    return;
  }

  try {
    let visemes = [];
    if (getVisemeProvider() === 'elevenlabs') {
      visemes = await buildVisemesFromElevenLabsAlignment({
        text: options.text || '',
        voiceId: options.voiceId || null,
        modelId: options.modelId || null
      });
    } else {
      const result = await generateVisemesFromAudioBuffer(audioBytes, 'mp3');
      visemes = Array.isArray(result?.visemes) ? result.visemes : [];
    }
    visemes = stabilizeVisemeTimeline(visemes);
    const first = visemes[0] || null;
    const last = visemes.length > 0 ? visemes[visemes.length - 1] : null;
    console.log(
      `[VOICE] viseme.generated | utteranceId=${utteranceId} count=${visemes.length} first=${first ? `${first.time}:${first.id}` : 'null'} last=${last ? `${last.time}:${last.id}` : 'null'}`
    );
    console.log(
      `[VOICE] viseme.sent | ${JSON.stringify({
        utteranceId,
        visemes,
        isLast: true
      })}`
    );

    sendEvent(ws, 'viseme.timeline', {
      utteranceId,
      visemes,
      isLast: true
    });
  } catch (error) {
    console.log(
      `[VOICE] viseme.error | utteranceId=${utteranceId} message=${error?.message || 'unknown'}`
    );
    sendEvent(ws, 'viseme.unavailable', {
      utteranceId,
      reason: 'provider_no_viseme'
    });
  }
}

async function handleTtsRequest(ws, context, payload) {
  const text = payload?.text || '';
  const utteranceId = payload?.utteranceId || context.session.activeUtteranceId || randomUUID();
  const voiceId = payload?.voiceId || context.session.voiceId || null;
  console.log(
    `[VOICE] tts.request | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId} voiceId=${voiceId || 'null'} textLen=${text.length}`
  );

  context.session.aiSpeaking = true;
  context.session.currentAiUtteranceId = utteranceId;
  context.session.turnState = 'speaking';
  sendEvent(ws, 'turn.state', { sessionId: context.session.sessionId, state: context.session.turnState, reason: 'tts_start' });
  sendEvent(ws, 'tts.start', { utteranceId, format: 'audio/mpeg' });

  let stream;
  try {
    stream = await streamElevenLabsTts({
      text,
      voiceId,
      modelId: payload?.modelId
    });
  } catch (e) {
    e.stage = 'tts';
    throw e;
  }

  let chunkSeq = 0;
  let sentChunkCount = 0;
  let sentBytes = 0;
  const ttsAudioChunks = [];
  await new Promise((resolve, reject) => {
    context.session.ttsStream = stream;
    stream.on('data', (buf) => {
      if (!context.session.aiSpeaking) {
        try { stream.destroy(); } catch (_) {}
        return;
      }
      ttsAudioChunks.push(Buffer.from(buf));
      sentBytes += Buffer.byteLength(buf);
      sendEvent(ws, 'tts.chunk', {
        utteranceId,
        chunkSeq,
        audioBase64: Buffer.from(buf).toString('base64'),
        isLast: false
      });
      chunkSeq += 1;
      sentChunkCount += 1;
    });
    stream.on('end', async () => {
      // Mobile tarafının finalize tetiklemesi için explicit last marker
      sendEvent(ws, 'tts.chunk', {
        utteranceId,
        chunkSeq,
        audioBase64: '',
        isLast: true
      });

      if (isVisemeBlockingEnabled()) {
        await emitVisemeTimeline(ws, utteranceId, Buffer.concat(ttsAudioChunks), {
          text,
          voiceId,
          modelId: payload?.modelId || null
        });
        sendEvent(ws, 'tts.end', { utteranceId });
      } else {
        sendEvent(ws, 'tts.end', { utteranceId });
        // viseme uretimini tts.end'i bekletmeden arka planda calistir.
        Promise.resolve()
          .then(() => emitVisemeTimeline(ws, utteranceId, Buffer.concat(ttsAudioChunks), {
            text,
            voiceId,
            modelId: payload?.modelId || null
          }))
          .catch((err) => {
            console.log(
              `[VOICE] viseme.background.error | utteranceId=${utteranceId} message=${err?.message || 'unknown'}`
            );
          });
      }
      context.session.aiSpeaking = false;
      context.session.currentAiUtteranceId = null;
      context.session.ttsStream = null;
      context.session.turnState = 'listening';
      console.log(
        `[VOICE] tts.completed | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId} chunks=${sentChunkCount} bytes=${sentBytes}`
      );
      sendEvent(ws, 'turn.state', { sessionId: context.session.sessionId, state: context.session.turnState, reason: 'tts_end' });
      resolve();
    });
    stream.on('error', (err) => {
      console.log(
        `[VOICE] tts.stream.error | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId} message=${err?.message || 'unknown'}`
      );
      context.session.aiSpeaking = false;
      context.session.currentAiUtteranceId = null;
      context.session.ttsStream = null;
      context.session.turnState = 'listening';
      sendEvent(ws, 'turn.state', { sessionId: context.session.sessionId, state: context.session.turnState, reason: 'tts_error' });
      reject(err);
    });
  });
}

function interruptAiIfSpeaking(ws, context, reason = 'user_speaking') {
  if (!context?.session?.aiSpeaking) return;
  context.session.aiSpeaking = false;
  const interruptedUtteranceId = context.session.currentAiUtteranceId;
  console.log(
    `[VOICE] tts.interrupt | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${interruptedUtteranceId || 'null'} reason=${reason}`
  );
  context.session.currentAiUtteranceId = null;
  try {
    if (context.session.ttsStream) context.session.ttsStream.destroy();
  } catch (_) {}
  context.session.ttsStream = null;
  context.session.turnState = 'listening';
  sendEvent(ws, 'tts.stop', {
    utteranceId: interruptedUtteranceId,
    reason
  });
  // Some clients finalize playback only on end markers. Emit both stop and explicit final markers.
  sendEvent(ws, 'tts.chunk', {
    utteranceId: interruptedUtteranceId,
    chunkSeq: -1,
    audioBase64: '',
    isLast: true,
    interrupted: true,
    reason
  });
  sendEvent(ws, 'tts.end', {
    utteranceId: interruptedUtteranceId,
    interrupted: true,
    reason
  });
  sendEvent(ws, 'ai.interrupted', {
    utteranceId: interruptedUtteranceId,
    reason
  });
  sendEvent(ws, 'turn.state', { sessionId: context.session.sessionId, state: context.session.turnState, reason });
}

async function resolveConversationContext(conversationId) {
  if (!conversationId) return { conversationId: null, botId: null, voiceId: null };
  const conv = await getQuery('SELECT * FROM `coversations` WHERE id = ?', [conversationId]);
  const botId = conv?.[0]?.botId || null;
  if (!botId) return { conversationId, botId: null, voiceId: null };
  const bot = await getQuery('SELECT * FROM `bots` WHERE id = ?', [botId]);
  const voiceId = bot?.[0]?.voiceId || null;
  return { conversationId, botId, voiceId };
}

async function initializeSession(context, payload) {
  const defaultLanguage = process.env.VOICE_DEFAULT_LANGUAGE || 'tr-TR';
  const requestedAudio = payload.audio || {};
  const defaultAudio = getDefaultAudioConfig();
  const audio = {
    codec: (requestedAudio.codec || defaultAudio.codec || 'pcm16le').toLowerCase(),
    sampleRate: Number(requestedAudio.sampleRate || defaultAudio.sampleRate || 16000),
    channels: Number(requestedAudio.channels || defaultAudio.channels || 1),
    frameMs: Number(requestedAudio.frameMs || defaultAudio.frameMs || 20)
  };
  if (audio.codec !== 'pcm16le') {
    const err = new VoiceStreamError('UNSUPPORTED_CODEC', `Desteklenmeyen codec: ${audio.codec}`, { recoverable: false });
    err.stage = 'session';
    throw err;
  }
  if (audio.channels !== 1) {
    const err = new VoiceStreamError('BAD_CHANNELS', 'channels=1 olmalı', { recoverable: false });
    err.stage = 'session';
    throw err;
  }

  const convCtx = await resolveConversationContext(payload.conversationId || null);
  const session = createSessionState({
    sessionId: payload.sessionId,
    userId: context.userId,
    conversationId: convCtx.conversationId,
    language: payload.language || defaultLanguage,
    sampleRate: audio.sampleRate
  });
  session.vad.silenceMs = envInt('VOICE_VAD_SILENCE_MS', session.vad.silenceMs || 900);
  session.audio = audio;
  session.transport = (payload.transport || 'ws').toLowerCase();
  session.webrtc = {
    audioFrameSeq: 0
  };
  session.finalizedUtterances = new Set();
  session.finalizingUtterances = new Set();
  session.botId = convCtx.botId;
  session.voiceId = convCtx.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || null;
  context.session = session;
  context.provider = createSttProvider({
    provider: process.env.STT_PROVIDER || 'mock',
    language: session.language,
    sampleRate: session.sampleRate
  });
  await context.provider.startSession({
    sessionId: session.sessionId,
    userId: session.userId,
    conversationId: session.conversationId
  });
}

function setupProviderListeners(ws, context) {
  context.provider.on('partial', (data) => {
    sendEvent(ws, 'stt.partial', {
      sessionId: context.session.sessionId,
      ...data
    });
  });

  context.provider.on('final', async (data) => {
    const transcript = String(data?.transcript || '').trim();
    const noSpeech = data?.noSpeech === true || !transcript;
    const shouldPersistToChat = isVoiceChatPersistenceEnabled();

    if (shouldPersistToChat && context.session.conversationId) {
      await query(
        'INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`) VALUES (?, ?, ?, NOW())',
        [context.session.conversationId, 'user', transcript]
      );
    }

    sendEvent(ws, 'stt.final', {
      sessionId: context.session.sessionId,
      ...data,
      transcript
    });

    if (noSpeech) {
      context.session.turnState = 'listening';
      sendEvent(ws, 'turn.state', {
        sessionId: context.session.sessionId,
        state: context.session.turnState,
        reason: 'stt_no_speech'
      });
      return;
    }

    context.session.turnState = 'thinking';
    sendEvent(ws, 'turn.state', { sessionId: context.session.sessionId, state: context.session.turnState, reason: 'stt_final' });

    try {
      const aiResult = await runAiPipeline({
        transcript,
        conversationId: context.session.conversationId,
        userId: context.session.userId,
        sessionId: context.session.sessionId
      });
      sendEvent(ws, 'ai.response', {
        utteranceId: data.utteranceId,
        text: aiResult.text,
        source: aiResult.source
      });

      if (shouldPersistToChat && context.session.conversationId && aiResult.text) {
        await query(
          'INSERT INTO `messages` (`conversationId`, `sender`, `message`, `created_at`) VALUES (?, ?, ?, NOW())',
          [context.session.conversationId, 'assistant', aiResult.text]
        );
      }

      if (String(process.env.TTS_STREAMING_ENABLED || 'false').toLowerCase() === 'true') {
        await handleTtsRequest(ws, context, {
          text: aiResult.text,
          utteranceId: data.utteranceId
        });
      }
    } catch (error) {
      sendEvent(ws, 'error', {
        code: error.code || 'AI_PIPELINE_ERROR',
        message: error.message || 'AI pipeline hatası',
        retryable: isRecoverableError(error),
        stage: 'ai_pipeline'
      });
    }
  });
}

async function finalizeUtterance(ws, context, utteranceId, reason = 'manual') {
  if (!utteranceId) return;
  clearVadTimer(context.session);

  if (context.session.finalizedUtterances?.has(utteranceId)) {
    voiceDebugLog(
      `finalize skipped (already finalized) | sessionId=${context.session.sessionId} utteranceId=${utteranceId} reason=${reason}`
    );
    return;
  }
  if (context.session.finalizingUtterances?.has(utteranceId)) {
    voiceDebugLog(
      `finalize skipped (in progress) | sessionId=${context.session.sessionId} utteranceId=${utteranceId} reason=${reason}`
    );
    return;
  }

  context.session.finalizingUtterances?.add(utteranceId);
  context.session.activeUtteranceId = utteranceId;
  try {
    await retryWithBackoff(() => context.provider.finalizeUtterance(utteranceId), {
      retries: 2,
      baseDelayMs: 120
    });
    context.session.finalizedUtterances?.add(utteranceId);
    console.log(
      `[VOICE] utterance.finalized | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId} reason=${reason}`
    );
    sendEvent(ws, 'ack', {
      ackType: 'utterance.finalized',
      utteranceId,
      reason
    });
  } finally {
    context.session.finalizingUtterances?.delete(utteranceId);
  }
}

async function ingestAudioChunk(ws, context, normalized, requestId = null) {
  if (isChunkProcessed(context.session, normalized.utteranceId, normalized.chunkSeq)) {
    sendEvent(ws, 'ack', {
      ackType: 'audio.chunk',
      utteranceId: normalized.utteranceId,
      chunkSeq: normalized.chunkSeq,
      duplicate: true
    }, requestId);
    return;
  }

  markChunkProcessed(context.session, normalized.utteranceId, normalized.chunkSeq);
  context.session.lastChunkAt = Date.now();
  context.session.activeUtteranceId = normalized.utteranceId;
  context.session.audioChunkCount = (context.session.audioChunkCount || 0) + 1;
  voiceDebugLog(
    `audio.chunk received | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${normalized.utteranceId} chunkSeq=${normalized.chunkSeq} total=${context.session.audioChunkCount}`
  );

  interruptAiIfSpeaking(ws, context, 'barge_in');

  let audioBytes = normalized.audioBytes || null;
  if (!audioBytes && normalized.audioBase64) {
    audioBytes = Buffer.from(normalized.audioBase64, 'base64');
  }

  await retryWithBackoff(() => context.provider.pushAudioChunk({
    ...normalized,
    audioBytes
  }), {
    retries: 2,
    baseDelayMs: 80
  });

  scheduleVadFinalization(ws, context, normalized.utteranceId);

  sendEvent(ws, 'ack', {
    ackType: 'audio.chunk',
    utteranceId: normalized.utteranceId,
    chunkSeq: normalized.chunkSeq,
    duplicate: false
  }, requestId);
}

function scheduleVadFinalization(ws, context, utteranceId) {
  clearVadTimer(context.session);
  if (!context.session.vad.enabled) return;
  context.session.vad.timer = setTimeout(async () => {
    try {
      await finalizeUtterance(ws, context, utteranceId, 'silence_timeout');
    } catch (error) {
      sendEvent(ws, 'error', {
        code: error.code || 'VAD_FINALIZE_ERROR',
        message: error.message || 'VAD finalize hatası',
        retryable: isRecoverableError(error),
        stage: 'vad'
      });
    }
  }, context.session.vad.silenceMs);
}

async function handleEvent(ws, context, message) {
  const { type, payload = {}, requestId = null } = message;
  if (!type) {
    throw new VoiceStreamError('MISSING_EVENT_TYPE', 'type alanı gerekli', { recoverable: true });
  }

  if (type === 'ping') {
    sendEvent(ws, 'pong', { ok: true }, requestId);
    return;
  }

  if (type === 'session.start') {
    await initializeSession(context, payload);
    console.log(
      `[VOICE] session.start connected | userId=${context.session.userId} sessionId=${context.session.sessionId} conversationId=${context.session.conversationId || 'null'} transport=${context.session.transport} language=${context.session.language}`
    );
    setupProviderListeners(ws, context);
    sendEvent(ws, 'session.ready', {
      sessionId: context.session.sessionId,
      userId: context.session.userId,
      conversationId: context.session.conversationId,
      language: context.session.language,
      botId: context.session.botId,
      transport: context.session.transport,
      audio: context.session.audio,
      voiceId: context.session.voiceId,
      sttProvider: process.env.STT_PROVIDER || 'mock'
    }, requestId);
    return;
  }

  if (!context.session || !context.provider) {
    throw new VoiceStreamError('SESSION_NOT_STARTED', 'Önce session.start gönderilmeli', { recoverable: true });
  }

  if (type === 'audio.chunk') {
    const normalized = normalizeChunkPayload(payload);
    await ingestAudioChunk(ws, context, normalized, requestId);
    return;
  }

  if (type === 'utterance.end') {
    await finalizeUtterance(ws, context, payload.utteranceId || context.session.activeUtteranceId, 'client_end');
    return;
  }

  if (type === 'vad.event') {
    const { utteranceId, isSpeech } = payload;
    if (isSpeech === true) {
      interruptAiIfSpeaking(ws, context, 'user_speech_detected');
    }
    if (isSpeech === false) {
      await finalizeUtterance(ws, context, utteranceId || context.session.activeUtteranceId, 'vad_event');
    }
    sendEvent(ws, 'ack', { ackType: 'vad.event' }, requestId);
    return;
  }

  if (type === 'speech.start') {
    const utteranceId = payload.utteranceId || randomUUID();
    context.session.activeUtteranceId = utteranceId;
    console.log(
      `[VOICE] speech.start | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId}`
    );
    interruptAiIfSpeaking(ws, context, 'speech.start');
    sendEvent(ws, 'ack', { ackType: 'speech.start', utteranceId }, requestId);
    return;
  }

  if (type === 'speech.stop') {
    const utteranceId = payload.utteranceId || context.session.activeUtteranceId;
    console.log(
      `[VOICE] speech.stop | userId=${context.session.userId} sessionId=${context.session.sessionId} utteranceId=${utteranceId || 'null'}`
    );
    await finalizeUtterance(ws, context, utteranceId, 'speech.stop');
    return;
  }

  if (type === 'webrtc.offer') {
    if (!isWebRtcEnabled()) {
      const err = new VoiceStreamError('WEBRTC_DISABLED', 'WEBRTC_ENABLED=false', { recoverable: false });
      err.stage = 'session';
      throw err;
    }
    if (!hasWebRtcRuntime()) {
      const err = new VoiceStreamError('WEBRTC_RUNTIME_MISSING', 'wrtc modülü kurulu değil', { recoverable: false });
      err.stage = 'session';
      throw err;
    }
    if (!context.webrtcTransport) {
      context.webrtcTransport = new WebRtcTransport({
        onTrack: (track) => {
          if (!context.session) return;
          console.log(
            `[VOICE] webrtc.track | userId=${context.session.userId} sessionId=${context.session.sessionId} kind=${track.kind} id=${track.id}`
          );
          sendEvent(ws, 'webrtc.track', {
            sessionId: context.session.sessionId,
            ...track
          });
        },
        onPcmFrame: async (frame) => {
          if (!context.session || !context.provider) return;
          const utteranceId = context.session.activeUtteranceId || `utt-${context.session.sessionId}`;
          context.session.webrtc.audioFrameSeq += 1;
          const normalized = {
            utteranceId,
            chunkSeq: context.session.webrtc.audioFrameSeq,
            audioBase64: null,
            textHint: null,
            language: context.session.language,
            audio: {
              codec: 'pcm16le',
              sampleRate: frame.sampleRate || context.session.sampleRate,
              channels: frame.channels || 1,
              frameMs: context.session.audio?.frameMs || 20
            },
            audioBytes: frame.audioBytes
          };
          try {
            await ingestAudioChunk(ws, context, normalized, null);
          } catch (e) {
            sendEvent(ws, 'error', {
              code: e.code || 'WEBRTC_AUDIO_INGEST_ERROR',
              message: e.message || 'WebRTC audio ingest failed',
              retryable: isRecoverableError(e),
              stage: 'stt'
            });
          }
        }
      });
    }

    const sdp = payload?.sdp;
    if (!sdp) {
      throw new VoiceStreamError('BAD_WEBRTC_OFFER', 'sdp gerekli', { recoverable: true });
    }
    const answerSdp = await context.webrtcTransport.createAnswerFromOffer(sdp);
    console.log(`[VOICE] webrtc.offer accepted | userId=${context.session.userId} sessionId=${context.session.sessionId}`);
    sendEvent(ws, 'webrtc.answer', {
      sdp: answerSdp
    }, requestId);
    return;
  }

  if (type === 'webrtc.ice') {
    if (!context.webrtcTransport) {
      throw new VoiceStreamError('WEBRTC_NOT_STARTED', 'Önce webrtc.offer gönderilmeli', { recoverable: true });
    }
    await context.webrtcTransport.addIceCandidate(payload?.candidate || null);
    voiceDebugLog(`webrtc.ice candidate received | sessionId=${context.session.sessionId}`);
    sendEvent(ws, 'ack', { ackType: 'webrtc.ice' }, requestId);
    return;
  }

  if (type === 'tts.request') {
    await handleTtsRequest(ws, context, payload);
    return;
  }

  throw new VoiceStreamError('UNKNOWN_EVENT', `Bilinmeyen event: ${type}`, { recoverable: true });
}

async function cleanupContext(context) {
  try {
    clearVadTimer(context.session);
    if (context.webrtcTransport) {
      context.webrtcTransport.close();
      context.webrtcTransport = null;
    }
    if (context.provider) {
      await context.provider.close();
    }
  } catch (_) {}
}

function createVoiceGateway(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });
  const clientContexts = new Map();

  httpServer.on('upgrade', (request, socket, head) => {
    const parsedUrl = new URL(request.url, 'http://localhost');
    if (parsedUrl.pathname !== '/ws/voice') {
      // Not our route; let other upgrade handlers (e.g. /ws/video) process it.
      return;
    }

    if (!isVoiceStreamingEnabled()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const token = extractToken(request, parsedUrl);
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const payload = JWT.verify(token, process.env.JWT_SECRET || 'key');
      request.user = payload;
    } catch (_) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    const context = {
      userId: request.user?.id || request.user?.userId || request.user?.email || null,
      session: null,
      provider: null,
      webrtcTransport: null
    };
    clientContexts.set(ws, context);
    console.log(`[VOICE] websocket connected | userId=${context.userId || 'unknown'}`);

    sendEvent(ws, 'connection.ready', {
      featureEnabled: true,
      defaultLanguage: process.env.VOICE_DEFAULT_LANGUAGE || 'tr-TR',
      server: {
        sttProvider: process.env.STT_PROVIDER || 'mock',
        ttsProvider: 'elevenlabs',
        supportsWebRtc: isWebRtcEnabled(),
        webRtcRuntime: hasWebRtcRuntime()
      },
      userId: context.userId
    });

    ws.on('message', async (raw) => {
      let parsed = null;
      try {
        parsed = parseMessage(raw);
        voiceDebugLog(`event received | type=${parsed?.type || 'unknown'} requestId=${parsed?.requestId || 'null'}`);
        await handleEvent(ws, context, parsed);
      } catch (error) {
        const retryable = isRecoverableError(error);
        sendEvent(ws, 'error', {
          code: error.code || 'UNEXPECTED_ERROR',
          message: error.message || 'Beklenmeyen hata',
          retryable,
          stage: error.stage || 'ws',
          requestId: parsed?.requestId || null
        });
        if (!retryable && ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'non_recoverable_error');
        }
      }
    });

    ws.on('close', async () => {
      await cleanupContext(context);
      if (context.session?.sessionId) {
        console.log(`[VOICE] websocket closed | userId=${context.userId || 'unknown'} sessionId=${context.session.sessionId}`);
      } else {
        console.log(`[VOICE] websocket closed | userId=${context.userId || 'unknown'}`);
      }
      clientContexts.delete(ws);
    });

    ws.on('error', async () => {
      await cleanupContext(context);
      clientContexts.delete(ws);
    });
  });

  return { wss };
}

module.exports = {
  createVoiceGateway,
  isVoiceStreamingEnabled
};
