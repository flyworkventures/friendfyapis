const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');

const TEMP_DIR = path.join(os.tmpdir(), 'friendfy-viseme-temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Rhubarb → Microsoft Viseme map
const RHUBARB_MAP = {
  A: 2,   // AEI
  B: 8,   // BMP
  C: 18,
  D: 1,
  E: 2,
  F: 11,  // FV
  G: 20,
  H: 1,
  I: 2,
  J: 18,
  K: 20,
  L: 12,
  M: 8,
  N: 1,
  O: 6,
  P: 8,
  Q: 20,
  R: 1,
  S: 15,
  T: 1,
  U: 7,
  V: 11,
  W: 7,
  X: 0,   // REST
  Y: 1,
  Z: 15,
};

function getRhubarbPath() {
  return process.env.VISEME_RHUBARB_BIN || '/opt/rhubarb/rhubarb';
}

function getFfmpegPath() {
  return process.env.VISEME_FFMPEG_BIN || 'ffmpeg';
}

function isVisemeEnabled() {
  return String(process.env.VISEME_ENABLED || 'false').toLowerCase() === 'true';
}

/**
 * Ses / dudak senkronu: uygulama tarafında animasyon kısaldığında API zaman damgalarını sıkıştırır.
 * Varsayılan 1.35 ≈ %35 daha hızlı zaman çizelgesi (time /= speedup, minGap de aynı oranda küçülür).
 */
function getVisemePlaybackSpeedup() {
  const raw = Number(process.env.VISEME_PLAYBACK_SPEEDUP);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 1.35;
}

function finalizeVisemeTimelineForClient(input) {
  const speedup = getVisemePlaybackSpeedup();
  const minGapSecRaw = Number(process.env.VISEME_MIN_GAP_SEC);
  const baseMinGap = Number.isFinite(minGapSecRaw) ? minGapSecRaw : 0.04;
  const minGapSec = baseMinGap / speedup;

  const list = Array.isArray(input) ? input : [];
  const sorted = [...list]
    .map((v) => ({
      id: Number(v?.id || 0),
      time: Number(((Number(v?.time || 0)) / speedup).toFixed(3))
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

function execFilePromise(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err) => (err ? reject(err) : resolve()));
  });
}

function mapRhubarbToVisemes(raw) {
  const mouthCues = Array.isArray(raw?.mouthCues) ? raw.mouthCues : [];
  return mouthCues.map((cue) => ({
    id: RHUBARB_MAP[cue.value] ?? 0,
    time: Number(Number(cue.start || 0).toFixed(3))
  }));
}

async function runVisemePipeline(inputPath, id) {
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  const jsonPath = path.join(TEMP_DIR, `${id}.json`);
  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`viseme input missing before ffmpeg: ${inputPath}`);
    }
    await execFilePromise(getFfmpegPath(), ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', wavPath]);
    await execFilePromise(getRhubarbPath(), [wavPath, '-f', 'json', '-o', jsonPath]);
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return { visemes: mapRhubarbToVisemes(raw) };
  } finally {
    [wavPath, jsonPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
}

async function generateVisemesFromAudioUrl(audioUrl) {
  if (!audioUrl) {
    const err = new Error('audioUrl is required');
    err.statusCode = 400;
    throw err;
  }

  const id = randomUUID();
  const inputPath = path.join(TEMP_DIR, `${id}.input`);
  try {
    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 20000
    });
    fs.writeFileSync(inputPath, Buffer.from(response.data));
    const result = await runVisemePipeline(inputPath, id);
    return result;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}

async function generateVisemesFromAudioBuffer(audioBuffer, inputExt = 'mp3') {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    return { visemes: [] };
  }
  const id = randomUUID();
  const safeExt = String(inputExt || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
  const inputPath = path.join(TEMP_DIR, `${id}.${safeExt}`);
  try {
    fs.writeFileSync(inputPath, audioBuffer);
    const result = await runVisemePipeline(inputPath, id);
    return result;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}

function createVisemeRouter() {
  const router = express.Router();

  router.post('/viseme', async (req, res) => {
    const { audioUrl } = req.body || {};
    try {
      const result = await generateVisemesFromAudioUrl(audioUrl);
      const visemes = finalizeVisemeTimelineForClient(result.visemes || []);
      return res.json({ visemes });
    } catch (err) {
      if (err?.statusCode === 400) {
        return res.status(400).json({ error: 'audioUrl is required' });
      }
      console.error(err);
      return res.status(500).json({ error: 'viseme generation failed' });
    }
  });

  return router;
}

module.exports = {
  createVisemeRouter,
  generateVisemesFromAudioUrl,
  generateVisemesFromAudioBuffer,
  isVisemeEnabled,
  finalizeVisemeTimelineForClient,
  getVisemePlaybackSpeedup
};
