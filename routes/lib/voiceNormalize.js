const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Kullanıcının kaydettiği sesli mesajın ses seviyesini standarda çeker.
 *
 * Telefon mikrofonu kaydı karakterin TTS sesinden ~13 dB daha kısık çıkıyor
 * (ölçüm: kullanıcı ort. -32 dB, karakter ort. -19 dB). ffmpeg `loudnorm`
 * ile -16 LUFS'a normalize edip AAC/m4a olarak döner.
 *
 * ffmpeg yoksa ya da hata/zaman aşımı olursa orijinal dosya aynen döner —
 * sesli mesaj gönderimi hiçbir durumda bu adım yüzünden bozulmaz.
 */
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const TIMEOUT_MS = 15000;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, { timeout: TIMEOUT_MS }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function normalizeVoiceBuffer(buffer, ext) {
  const original = { buffer, ext, mime: null, normalized: false };
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) return original;

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `voice_in_${id}.${ext || 'm4a'}`);
  const outPath = path.join(os.tmpdir(), `voice_out_${id}.m4a`);
  try {
    await fs.promises.writeFile(inPath, buffer);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ac', '1',
      '-ar', '44100',
      '-c:a', 'aac',
      '-b:a', '96k',
      outPath,
    ]);
    const out = await fs.promises.readFile(outPath);
    if (!out || out.length < 512) return original;
    return { buffer: out, ext: 'm4a', mime: 'audio/mp4', normalized: true };
  } catch (err) {
    console.warn('[voiceNormalize] skipped:', err?.code || err?.message || err);
    return original;
  } finally {
    fs.promises.unlink(inPath).catch(() => {});
    fs.promises.unlink(outPath).catch(() => {});
  }
}

module.exports = { normalizeVoiceBuffer };
