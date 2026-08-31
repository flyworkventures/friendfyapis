const crypto = require('crypto');
const { uploadBufferToBunny } = require('../../lib/bunnyStorage');
const { hasMulterPayload, readMulterFileBuffer } = require('../../lib/multerUpload');

const PHOTO_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = Number(process.env.PANEL_AGENT_MAX_PHOTO_BYTES) || 8 * 1024 * 1024;
const MAX_RIV_BYTES = Number(process.env.PANEL_AGENT_MAX_RIV_BYTES) || 25 * 1024 * 1024;
const UPLOAD_PREFIX = process.env.PANEL_AGENT_UPLOAD_PREFIX || 'panel-agents';
/** Panelden eklenen her karakter (custom / catalog / template) için sabit kural */
const REQUIRED_PHOTO_COUNT = 3;

function validationError(message, code = 'INVALID_FILE') {
    const err = new Error(message);
    err.code = code;
    return err;
}

function extensionForPhoto(mimetype, originalname) {
    const mime = String(mimetype || '').toLowerCase();
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    const name = String(originalname || '').toLowerCase();
    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.webp')) return 'webp';
    return 'jpg';
}

function collectPhotoFiles(files) {
    if (!files || typeof files !== 'object') return [];
    const ordered = [];
    for (const key of ['photo1', 'photo2', 'photo3']) {
        const f = files[key]?.[0];
        if (f) ordered.push(f);
    }
    if (Array.isArray(files.photos)) {
        for (const f of files.photos) {
            if (f && !ordered.includes(f)) ordered.push(f);
        }
    }
    return ordered.slice(0, 3);
}

function collectRiveFile(files) {
    if (!files) return null;
    return (
        files.riveFile?.[0] ||
        files.rive?.[0] ||
        files.rive_avatar?.[0] ||
        null
    );
}

function hasAnyUploadedFiles(files) {
    return collectPhotoFiles(files).length > 0 || !!collectRiveFile(files);
}

function getPhotoUrlsFromBody(body) {
    const { toPhotoUrlArray } = require('./panelAgentMapper');
    const raw =
        body?.photoURLs ??
        body?.photos ??
        body?.photoURL ??
        body?.extras?.photoURLs ??
        body?.extras?.photoURL;
    return toPhotoUrlArray(raw);
}

function hasRiveInBody(body) {
    const r = body?.riveAvatar ?? body?.rive_avatar ?? body?.extras?.riveAvatar;
    return r != null && String(r).trim() !== '';
}

/**
 * Panel POST /agents — dosyalar Bunny'ye yüklenmeden önce (tam 3 foto + riv).
 */
function assertCreateMultipartMedia(files) {
    const photoFiles = collectPhotoFiles(files);
    const riveFile = collectRiveFile(files);

    if (photoFiles.length !== REQUIRED_PHOTO_COUNT) {
        throw validationError(
            `Karakter eklemek için tam ${REQUIRED_PHOTO_COUNT} fotoğraf dosyası gerekir (photo1, photo2, photo3). Gönderilen: ${photoFiles.length}`,
            'PHOTOS_COUNT_REQUIRED'
        );
    }
    if (!riveFile) {
        throw validationError(
            'Karakter eklemek için Rive dosyası gerekir (riveFile alanı, .riv)',
            'RIVE_REQUIRED'
        );
    }
}

/**
 * Yükleme sonrası veya JSON ile gönderimde nihai gövde kontrolü.
 */
function assertAgentMediaComplete(body) {
    const urls = getPhotoUrlsFromBody(body);
    if (urls.length !== REQUIRED_PHOTO_COUNT) {
        throw validationError(
            `Her karakterin tam ${REQUIRED_PHOTO_COUNT} fotoğrafı olmalıdır (şu an: ${urls.length})`,
            'PHOTOS_COUNT_REQUIRED'
        );
    }
    if (!hasRiveInBody(body)) {
        throw validationError(
            'Her karakter için riveAvatar (CDN URL) veya riveFile yüklemesi gerekir',
            'RIVE_REQUIRED'
        );
    }
}

/**
 * PATCH — yalnızca medya güncelleniyorsa 3'lü foto kuralı.
 */
function assertPatchMediaIfProvided(body, files) {
    const photoFiles = collectPhotoFiles(files);
    const riveFile = collectRiveFile(files);
    const bodyPhotoCount = getPhotoUrlsFromBody(body).length;

    if (photoFiles.length > 0 && photoFiles.length !== REQUIRED_PHOTO_COUNT) {
        throw validationError(
            `Fotoğraf güncellerken tam ${REQUIRED_PHOTO_COUNT} dosya gönderin (photo1, photo2, photo3)`,
            'PHOTOS_COUNT_REQUIRED'
        );
    }
    if (bodyPhotoCount > 0 && bodyPhotoCount !== REQUIRED_PHOTO_COUNT) {
        throw validationError(
            `photoURLs dizisi tam ${REQUIRED_PHOTO_COUNT} URL içermelidir`,
            'PHOTOS_COUNT_REQUIRED'
        );
    }
    const updatingPhotos = photoFiles.length === REQUIRED_PHOTO_COUNT || bodyPhotoCount === REQUIRED_PHOTO_COUNT;
    if (updatingPhotos && !riveFile && !hasRiveInBody(body)) {
        throw validationError(
            'Fotoğraflar güncellenirken Rive (.riv) de sağlanmalıdır',
            'RIVE_REQUIRED'
        );
    }
}

function validatePhotoFile(file) {
    if (!hasMulterPayload(file)) {
        const err = new Error('Empty photo file');
        err.code = 'INVALID_FILE';
        throw err;
    }
    if (file.size > MAX_PHOTO_BYTES) {
        const err = new Error(`Photo exceeds ${MAX_PHOTO_BYTES} bytes`);
        err.code = 'FILE_TOO_LARGE';
        throw err;
    }
    const mime = String(file.mimetype || '').toLowerCase();
    if (!PHOTO_MIMES.has(mime)) {
        const err = new Error(`Unsupported photo type: ${mime || 'unknown'}`);
        err.code = 'INVALID_FILE_TYPE';
        throw err;
    }
}

function validateRiveFile(file) {
    if (!hasMulterPayload(file)) {
        const err = new Error('Empty Rive file');
        err.code = 'INVALID_FILE';
        throw err;
    }
    if (file.size > MAX_RIV_BYTES) {
        const err = new Error(`Rive file exceeds ${MAX_RIV_BYTES} bytes`);
        err.code = 'FILE_TOO_LARGE';
        throw err;
    }
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const okName = name.endsWith('.riv');
    const okMime =
        !mime ||
        mime === 'application/octet-stream' ||
        mime.includes('riv');
    if (!okName && !okMime) {
        const err = new Error('Rive file must be .riv');
        err.code = 'INVALID_FILE_TYPE';
        throw err;
    }
}

function makeAgentUploadSlug() {
    return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * @param {import('multer').File[]} photoFiles
 * @param {import('multer').File | null} riveFile
 * @param {{ slug?: string }} opts
 */
async function uploadPanelAgentAssets(files, opts = {}) {
    const slug = opts.slug || makeAgentUploadSlug();
    const base = `${UPLOAD_PREFIX}/${slug}`;

    const photoFiles = collectPhotoFiles(files);
    const riveFile = collectRiveFile(files);

    if (opts.requireThreePhotos && photoFiles.length !== REQUIRED_PHOTO_COUNT) {
        throw validationError(
            `Tam ${REQUIRED_PHOTO_COUNT} fotoğraf dosyası gerekir`,
            'PHOTOS_COUNT_REQUIRED'
        );
    }

    const photoURLs = [];
    for (let i = 0; i < photoFiles.length; i++) {
        validatePhotoFile(photoFiles[i]);
        const ext = extensionForPhoto(photoFiles[i].mimetype, photoFiles[i].originalname);
        const buffer = await readMulterFileBuffer(photoFiles[i]);
        if (!buffer) {
            throw validationError('Empty photo file', 'INVALID_FILE');
        }
        const url = await uploadBufferToBunny(
            buffer,
            `${base}/photo-${i + 1}.${ext}`,
            photoFiles[i].mimetype
        );
        photoURLs.push(url);
    }

    let riveAvatarUrl = null;
    if (riveFile) {
        validateRiveFile(riveFile);
        const riveBuffer = await readMulterFileBuffer(riveFile);
        if (!riveBuffer) {
            throw validationError('Empty Rive file', 'INVALID_FILE');
        }
        riveAvatarUrl = await uploadBufferToBunny(
            riveBuffer,
            `${base}/avatar.riv`,
            'application/octet-stream'
        );
    }

    return { photoURLs, riveAvatarUrl, uploadSlug: slug };
}

/**
 * multipart/form-data alanlarını JSON gövdeye çevirir
 */
function parsePanelAgentFormBody(req) {
    const raw = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const jsonKeys = [
        'interests',
        'interestsType',
        'characterTags',
        'photoURLs',
        'extras'
    ];
    for (const key of jsonKeys) {
        if (typeof raw[key] === 'string' && raw[key].trim().startsWith('[')) {
            try {
                raw[key] = JSON.parse(raw[key]);
            } catch {
                /* string kalsın */
            }
        }
        if (typeof raw[key] === 'string' && raw[key].trim().startsWith('{') && key === 'extras') {
            try {
                raw[key] = JSON.parse(raw[key]);
            } catch {
                /* */
            }
        }
    }
    if (raw.age !== undefined && raw.age !== '') {
        raw.age = Number(raw.age);
    }
    if (raw.system !== undefined && raw.system !== '') {
        raw.system = Number(raw.system);
    }
    return raw;
}

function mapUploadErrorToResponse(error) {
    const code = error?.code || 'UPLOAD_ERROR';
    if (code === 'CDN_UPLOAD_FAILED' || code === 'CDN_NOT_CONFIGURED') {
        return { status: 502, json: { ok: false, code, msg: error.message } };
    }
    if (
        code === 'INVALID_FILE' ||
        code === 'INVALID_FILE_TYPE' ||
        code === 'FILE_TOO_LARGE' ||
        code === 'PHOTOS_COUNT_REQUIRED' ||
        code === 'RIVE_REQUIRED'
    ) {
        return { status: 400, json: { ok: false, code, msg: error.message } };
    }
    return { status: 500, json: { ok: false, code: 'UPLOAD_ERROR', msg: error.message } };
}

module.exports = {
    REQUIRED_PHOTO_COUNT,
    uploadPanelAgentAssets,
    parsePanelAgentFormBody,
    hasAnyUploadedFiles,
    collectPhotoFiles,
    collectRiveFile,
    makeAgentUploadSlug,
    mapUploadErrorToResponse,
    assertCreateMultipartMedia,
    assertAgentMediaComplete,
    assertPatchMediaIfProvided,
    getPhotoUrlsFromBody,
    hasRiveInBody,
    validationError
};
