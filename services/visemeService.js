'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const ENABLE_RHUBARB = process.env.ENABLE_RHUBARB_VISEME === 'true';
const FFMPEG_BIN = process.env.VISEME_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg';

function resolveRhubarbBin() {
  const candidates = [
    process.env.RHUBARB_BIN,
    process.env.VISEME_RHUBARB_BIN,
    path.join(__dirname, '..', 'tools', 'rhubarb', 'rhubarb'),
    '/opt/rhubarb/rhubarb',
    '/usr/local/bin/rhubarb',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return candidates[0] || '/opt/rhubarb/rhubarb';
}

const RHUBARB_BIN = resolveRhubarbBin();
if (ENABLE_RHUBARB) {
  if (fs.existsSync(RHUBARB_BIN)) {
    console.log(`[VISEME] Rhubarb enabled: ${RHUBARB_BIN}`);
  } else {
    console.warn(
      `[VISEME] ENABLE_RHUBARB_VISEME=true but binary missing at ${RHUBARB_BIN}. ` +
        'Run: bash scripts/install-rhubarb-mac.sh'
    );
  }
}

const TEMP_DIR = path.join(os.tmpdir(), 'mindcoach-viseme');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Rhubarb -> Microsoft Viseme map
const RHUBARB_MAP = {
  A: 2, B: 8, C: 18, D: 1, E: 2, F: 11, G: 20, H: 1, I: 2, J: 18, K: 20,
  L: 12, M: 8, N: 1, O: 6, P: 8, Q: 20, R: 1, S: 15, T: 1, U: 7, V: 11,
  W: 7, X: 0, Y: 1, Z: 15,
};

function _q(p) {
  return `"${String(p).replace(/"/g, '\\"')}"`;
}

async function safeUnlink(p) {
  try {
    await fs.promises.unlink(p);
  } catch (_) {
    // dosya zaten yoksa/silinemezse yoksay — sadece geçici temizlik.
  }
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr || stdout || err.message || 'exec failed');
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

function _mapRhubarbToVisemes(raw) {
  const cues = Array.isArray(raw?.mouthCues) ? raw.mouthCues : [];
  return cues.map((cue) => ({
    id: RHUBARB_MAP[cue.value] ?? 0,
    time: Number(Number(cue.start || 0).toFixed(3)),
  }));
}

async function generateVisemesFromWavFile(wavPath) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const jsonPath = path.join(TEMP_DIR, `${id}.json`);
  try {
    await execPromise(
      `${_q(RHUBARB_BIN)} ${_q(wavPath)} -f json -o ${_q(jsonPath)}`
    );
    const raw = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
    return _mapRhubarbToVisemes(raw);
  } finally {
    await safeUnlink(jsonPath);
  }
}

async function generateVisemesFromPcm24k(pcmBuffer, opts = {}) {
  if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length < 2) return [];
  // Fast local fallback: no ffmpeg/rhubarb dependency required.
  if (!ENABLE_RHUBARB) {
    return generateEnergyVisemesFromPcm24k(pcmBuffer);
  }
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pcmPath = path.join(TEMP_DIR, `${id}.pcm`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  try {
    await fs.promises.writeFile(pcmPath, pcmBuffer);
    await execPromise(
      `${_q(FFMPEG_BIN)} -y -f s16le -ar 24000 -ac 1 -i ${_q(pcmPath)} -ac 1 -ar 16000 ${_q(wavPath)}`
    );
    return await generateVisemesFromWavFile(wavPath);
  } catch (err) {
    if (opts.connectionId) {
      console.warn(`[VISEME] [${opts.connectionId}] generation failed: ${err.message}`);
    } else {
      console.warn(`[VISEME] generation failed: ${err.message}`);
    }
    // If external tools are unavailable, degrade gracefully to local fallback.
    return generateEnergyVisemesFromPcm24k(pcmBuffer);
  } finally {
    await safeUnlink(pcmPath);
    await safeUnlink(wavPath);
  }
}

function generateEnergyVisemesFromPcm24k(pcmBuffer) {
  const bytesPerSample = 2;
  const totalSamples = Math.floor(pcmBuffer.length / bytesPerSample);
  if (totalSamples <= 0) return [];
  // Rhubarb kapalıyken energy fallback: saniyede ~13 viseme update.
  const windowMs = 75;
  const samplesPerWindow = Math.max(1, Math.floor((24000 * windowMs) / 1000));
  const result = [];
  let lastId = -1;
  for (let start = 0; start < totalSamples; start += samplesPerWindow) {
    const end = Math.min(totalSamples, start + samplesPerWindow);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const s = pcmBuffer.readInt16LE(i * 2);
      sumSq += s * s;
      count++;
    }
    if (count === 0) continue;
    const rms = Math.sqrt(sumSq / count);
    // Full Rhubarb-style mouth set (not only 0/2/8) when Rhubarb binary is off.
    const energyToViseme = [0, 1, 2, 6, 8, 11, 12, 15, 18, 20];
    let level = 0;
    if (rms > 350) level = 1;
    if (rms > 700) level = 2;
    if (rms > 1100) level = 3;
    if (rms > 1600) level = 4;
    if (rms > 2200) level = 5;
    if (rms > 3000) level = 6;
    if (rms > 4000) level = 7;
    if (rms > 5200) level = 8;
    const id = energyToViseme[level];
    // Aynı id arka arkaya geldiğinde araya kısa bir close (id=0) sok →
    // mouth flicker olsun, statik kalmasın.
    if (id !== 0 && id === lastId) {
      result.push({
        id: 0,
        time: Number(((start / 24000)).toFixed(3)),
      });
    }
    result.push({
      id,
      time: Number((((start + Math.floor(samplesPerWindow / 4)) / 24000)).toFixed(3)),
    });
    lastId = id;
  }
  return result;
}

async function generateVisemesFromAudioUrl(audioUrl) {
  if (!audioUrl) throw new Error('audioUrl is required');
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputPath = path.join(TEMP_DIR, `${id}.input`);
  const wavPath = path.join(TEMP_DIR, `${id}.wav`);
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error('Audio download failed');
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(inputPath, buffer);
    await execPromise(`ffmpeg -y -i ${_q(inputPath)} -ac 1 -ar 16000 ${_q(wavPath)}`);
    return await generateVisemesFromWavFile(wavPath);
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(wavPath);
  }
}

module.exports = {
  generateVisemesFromWavFile,
  generateVisemesFromPcm24k,
  generateVisemesFromAudioUrl,
  generateEnergyVisemesFromPcm24k,
  RHUBARB_MAP,
};