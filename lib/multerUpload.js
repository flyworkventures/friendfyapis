const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'friendify-uploads');

function ensureUploadTmpDir() {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

/** Geçici disk storage — büyük upload'larda heap yerine dosya sistemi kullanır. */
function createMulterUpload(options = {}) {
  ensureUploadTmpDir();
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    }),
    limits: options.limits,
  });
}

function hasMulterPayload(file) {
  return Boolean(file && ((file.buffer && file.buffer.length) || file.path));
}

async function readMulterFileBuffer(file) {
  if (!file) return null;
  if (file.buffer && file.buffer.length) return file.buffer;
  if (!file.path) return null;
  try {
    return await fs.promises.readFile(file.path);
  } finally {
    await unlinkMulterFile(file);
  }
}

async function readMulterFileHead(file, byteCount = 12) {
  if (!file) return null;
  if (file.buffer && file.buffer.length) {
    return file.buffer.subarray(0, Math.min(byteCount, file.buffer.length));
  }
  if (!file.path) return null;
  const fh = await fs.promises.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(byteCount);
    const { bytesRead } = await fh.read(buf, 0, byteCount, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function multerFileReadStream(file) {
  if (!file) return null;
  if (file.path) return fs.createReadStream(file.path);
  if (file.buffer && file.buffer.length) return file.buffer;
  return null;
}

function unlinkMulterFile(file) {
  if (!file?.path) return Promise.resolve();
  return fs.promises.unlink(file.path).catch(() => {});
}

module.exports = {
  createMulterUpload,
  hasMulterPayload,
  readMulterFileBuffer,
  readMulterFileHead,
  multerFileReadStream,
  unlinkMulterFile,
};
