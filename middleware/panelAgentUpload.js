const multer = require('multer');

const MAX_PHOTO_BYTES = Number(process.env.PANEL_AGENT_MAX_PHOTO_BYTES) || 8 * 1024 * 1024;
const MAX_RIV_BYTES = Number(process.env.PANEL_AGENT_MAX_RIV_BYTES) || 25 * 1024 * 1024;

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: Math.max(MAX_PHOTO_BYTES, MAX_RIV_BYTES),
        files: 5
    }
});

/** 3 foto (photo1–3 veya photos[]) + 1 Rive (.riv) */
const panelAgentUpload = upload.fields([
    { name: 'photo1', maxCount: 1 },
    { name: 'photo2', maxCount: 1 },
    { name: 'photo3', maxCount: 1 },
    { name: 'photos', maxCount: 3 },
    { name: 'riveFile', maxCount: 1 },
    { name: 'rive', maxCount: 1 },
    { name: 'rive_avatar', maxCount: 1 }
]);

module.exports = panelAgentUpload;
