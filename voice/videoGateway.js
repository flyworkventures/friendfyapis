const WebSocket = require('ws');
const JWT = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { VoiceStreamError, isRecoverableError } = require('./errors');
const { WebRtcTransport, hasWebRtcRuntime } = require('./webrtcTransport');
const { streamElevenLabsTts, buildVisemesFromElevenLabsAlignment } = require('./elevenlabsTts');
const { generateVisemesFromAudioBuffer, isVisemeEnabled } = require('./viseme');
const { getQuery } = require('../db');

function isVideoCallEnabled() {
  return String(process.env.VIDEO_CALL_ENABLED || 'false').toLowerCase() === 'true';
}

function isWebRtcEnabled() {
  return String(process.env.WEBRTC_ENABLED || 'false').toLowerCase() === 'true';
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

function sendEvent(ws, type, payload = {}, requestId = null) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type,
    ts: Date.now(),
    requestId,
    payload
  }));
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch (_) {
    throw new VoiceStreamError('BAD_JSON', 'Gecersiz JSON payload', { recoverable: true });
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

async function resolveVideoConversationContext(conversationId) {
  if (!conversationId) return { conversationId: null, botId: null, voiceId: null };
  const conv = await getQuery('SELECT * FROM `coversations` WHERE id = ?', [conversationId]);
  const botId = conv?.[0]?.botId || null;
  if (!botId) return { conversationId, botId: null, voiceId: null };
  const bot = await getQuery('SELECT * FROM `bots` WHERE id = ?', [botId]);
  const voiceId = bot?.[0]?.voiceId || null;
  return { conversationId, botId, voiceId };
}

async function emitVideoVisemeTimeline(ws, utteranceId, audioBytes, options = {}) {
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
      `[VIDEO] viseme.generated | utteranceId=${utteranceId} count=${visemes.length} first=${first ? `${first.time}:${first.id}` : 'null'} last=${last ? `${last.time}:${last.id}` : 'null'}`
    );
    console.log(
      `[VIDEO] viseme.sent | ${JSON.stringify({
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
    console.log(`[VIDEO] viseme.error | utteranceId=${utteranceId} message=${error?.message || 'unknown'}`);
    sendEvent(ws, 'viseme.unavailable', {
      utteranceId,
      reason: 'provider_no_viseme'
    });
  }
}

async function handleVideoTtsRequest(ws, context, payload = {}) {
  const text = String(payload?.text || '').trim();
  if (!text) {
    throw new VoiceStreamError('BAD_TTS_TEXT', 'text alani gerekli', { recoverable: true });
  }
  const utteranceId = payload?.utteranceId || randomUUID();
  const voiceId = payload?.voiceId || context?.session?.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || null;

  let stream;
  try {
    stream = await streamElevenLabsTts({
      text,
      voiceId,
      modelId: payload?.modelId
    });
  } catch (e) {
    e.stage = 'video_tts';
    throw e;
  }

  sendEvent(ws, 'tts.start', { utteranceId, format: 'audio/mpeg' });

  let chunkSeq = 0;
  const ttsAudioChunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (buf) => {
      const chunkBuffer = Buffer.from(buf);
      ttsAudioChunks.push(chunkBuffer);
      sendEvent(ws, 'tts.chunk', {
        utteranceId,
        chunkSeq,
        audioBase64: chunkBuffer.toString('base64'),
        isLast: false
      });
      chunkSeq += 1;
    });
    stream.on('end', async () => {
      sendEvent(ws, 'tts.chunk', {
        utteranceId,
        chunkSeq,
        audioBase64: '',
        isLast: true
      });
      if (isVisemeBlockingEnabled()) {
        await emitVideoVisemeTimeline(ws, utteranceId, Buffer.concat(ttsAudioChunks), {
          text,
          voiceId,
          modelId: payload?.modelId || null
        });
        sendEvent(ws, 'tts.end', { utteranceId });
      } else {
        sendEvent(ws, 'tts.end', { utteranceId });
        Promise.resolve()
          .then(() => emitVideoVisemeTimeline(ws, utteranceId, Buffer.concat(ttsAudioChunks), {
            text,
            voiceId,
            modelId: payload?.modelId || null
          }))
          .catch((err) => {
            console.log(
              `[VIDEO] viseme.background.error | utteranceId=${utteranceId} message=${err?.message || 'unknown'}`
            );
          });
      }
      resolve();
    });
    stream.on('error', (err) => reject(err));
  });
}

async function handleEvent(ws, context, message) {
  const { type, payload = {}, requestId = null } = message;
  if (!type) {
    throw new VoiceStreamError('MISSING_EVENT_TYPE', 'type alani gerekli', { recoverable: true });
  }

  if (type === 'ping') {
    sendEvent(ws, 'pong', { ok: true }, requestId);
    return;
  }

  if (type === 'video.session.start') {
    const convCtx = await resolveVideoConversationContext(payload.conversationId || null);
    context.session = {
      sessionId: payload.sessionId || randomUUID(),
      userId: context.userId,
      conversationId: convCtx.conversationId,
      botId: convCtx.botId,
      voiceId: payload.voiceId || convCtx.voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || null,
      startedAt: Date.now()
    };
    console.log(
      `[VIDEO] session.start | userId=${context.session.userId} sessionId=${context.session.sessionId} conversationId=${context.session.conversationId || 'null'}`
    );
    sendEvent(ws, 'video.session.ready', {
      sessionId: context.session.sessionId,
      userId: context.session.userId,
      conversationId: context.session.conversationId,
      botId: context.session.botId,
      voiceId: context.session.voiceId,
      supportsWebRtc: isWebRtcEnabled(),
      webRtcRuntime: hasWebRtcRuntime()
    }, requestId);
    return;
  }

  if (!context.session) {
    throw new VoiceStreamError('SESSION_NOT_STARTED', 'Once video.session.start gonderilmeli', { recoverable: true });
  }

  if (type === 'video.webrtc.offer') {
    if (!isWebRtcEnabled()) {
      const err = new VoiceStreamError('WEBRTC_DISABLED', 'WEBRTC_ENABLED=false', { recoverable: false });
      err.stage = 'video_session';
      throw err;
    }
    if (!hasWebRtcRuntime()) {
      const err = new VoiceStreamError('WEBRTC_RUNTIME_MISSING', 'wrtc modulu kurulu degil', { recoverable: false });
      err.stage = 'video_session';
      throw err;
    }
    if (!context.webrtcTransport) {
      context.webrtcTransport = new WebRtcTransport({
        onTrack: (track) => {
          if (!context.session) return;
          console.log(
            `[VIDEO] track | userId=${context.session.userId} sessionId=${context.session.sessionId} kind=${track.kind} id=${track.id}`
          );
          sendEvent(ws, 'video.webrtc.track', {
            sessionId: context.session.sessionId,
            ...track
          });
        },
        onPcmFrame: null
      });
    }

    const sdp = payload?.sdp;
    if (!sdp) {
      throw new VoiceStreamError('BAD_WEBRTC_OFFER', 'sdp gerekli', { recoverable: true });
    }

    const answerSdp = await context.webrtcTransport.createAnswerFromOffer(sdp);
    sendEvent(ws, 'video.webrtc.answer', { sdp: answerSdp }, requestId);
    return;
  }

  if (type === 'video.webrtc.ice') {
    if (!context.webrtcTransport) {
      throw new VoiceStreamError('WEBRTC_NOT_STARTED', 'Once video.webrtc.offer gonderilmeli', { recoverable: true });
    }
    await context.webrtcTransport.addIceCandidate(payload?.candidate || null);
    sendEvent(ws, 'ack', { ackType: 'video.webrtc.ice' }, requestId);
    return;
  }

  if (type === 'video.camera.toggle') {
    const enabled = payload?.enabled !== false;
    sendEvent(ws, 'video.camera.state', {
      sessionId: context.session.sessionId,
      enabled
    }, requestId);
    return;
  }

  if (type === 'video.call.end') {
    sendEvent(ws, 'video.call.ended', {
      sessionId: context.session.sessionId,
      reason: payload?.reason || 'client_end'
    }, requestId);
    ws.close(1000, 'video_call_end');
    return;
  }

  if (type === 'video.tts.request') {
    await handleVideoTtsRequest(ws, context, payload);
    return;
  }

  throw new VoiceStreamError('UNKNOWN_EVENT', `Bilinmeyen event: ${type}`, { recoverable: true });
}

function cleanupContext(context) {
  try {
    if (context.webrtcTransport) {
      context.webrtcTransport.close();
      context.webrtcTransport = null;
    }
  } catch (_) {}
}

function createVideoGateway(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const parsedUrl = new URL(request.url, 'http://localhost');
    if (parsedUrl.pathname !== '/ws/video') {
      return;
    }

    if (!isVideoCallEnabled()) {
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
      webrtcTransport: null
    };

    console.log(`[VIDEO] websocket connected | userId=${context.userId || 'unknown'}`);
    sendEvent(ws, 'video.connection.ready', {
      featureEnabled: true,
      userId: context.userId,
      supportsWebRtc: isWebRtcEnabled(),
      webRtcRuntime: hasWebRtcRuntime()
    });

    ws.on('message', async (raw) => {
      let parsed = null;
      try {
        parsed = parseMessage(raw);
        await handleEvent(ws, context, parsed);
      } catch (error) {
        const retryable = isRecoverableError(error);
        sendEvent(ws, 'video.error', {
          code: error.code || 'UNEXPECTED_ERROR',
          message: error.message || 'Beklenmeyen hata',
          retryable,
          stage: error.stage || 'video_ws',
          requestId: parsed?.requestId || null
        });
        if (!retryable && ws.readyState === WebSocket.OPEN) {
          ws.close(1011, 'non_recoverable_error');
        }
      }
    });

    ws.on('close', () => {
      cleanupContext(context);
      if (context.session?.sessionId) {
        console.log(`[VIDEO] websocket closed | userId=${context.userId || 'unknown'} sessionId=${context.session.sessionId}`);
      } else {
        console.log(`[VIDEO] websocket closed | userId=${context.userId || 'unknown'}`);
      }
    });

    ws.on('error', () => {
      cleanupContext(context);
    });
  });

  return { wss };
}

module.exports = {
  createVideoGateway,
  isVideoCallEnabled
};
