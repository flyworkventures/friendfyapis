const axios = require('axios');

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'fakefriendstorage';
const BUNNY_PULL_ZONE_BASE = process.env.BUNNY_PULL_ZONE_BASE || 'https://fakefriend.b-cdn.net';
const BUNNY_ACCESS_KEY =
    process.env.BUNNY_ACCESS_KEY ||
    process.env.BUNNY_STORAGE_ACCESS_KEY ||
    '68664abb-b19e-47e7-acd67dba78a5-e90a-4386';

/**
 * @param {Buffer} buffer
 * @param {string} remotePath storage path (no leading slash)
 * @param {string} contentType
 * @returns {Promise<string>} public CDN URL
 */
async function uploadBufferToBunny(buffer, remotePath, contentType) {
    if (!BUNNY_ACCESS_KEY) {
        const err = new Error('BUNNY_ACCESS_KEY is not configured');
        err.code = 'CDN_NOT_CONFIGURED';
        throw err;
    }
    const normalizedPath = String(remotePath).replace(/^\/+/, '');
    const uploadUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${normalizedPath}`;

    // Geçici ağ/CDN hatalarına karşı birkaç kez dene (aralıklı 502/timeout gibi).
    const maxAttempts = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await axios.put(uploadUrl, buffer, {
                headers: {
                    AccessKey: BUNNY_ACCESS_KEY,
                    'Content-Type': contentType || 'application/octet-stream'
                },
                maxBodyLength: Infinity,
                timeout: 60000
            });
            return `${BUNNY_PULL_ZONE_BASE}/${normalizedPath}`;
        } catch (error) {
            lastError = error;
            const status = error?.response?.status;
            const body =
                typeof error?.response?.data === 'string'
                    ? error.response.data.slice(0, 300)
                    : error?.response?.data
                        ? JSON.stringify(error.response.data).slice(0, 300)
                        : error?.message;
            console.warn(
                `[bunny] upload attempt ${attempt}/${maxAttempts} failed (status=${status || 'n/a'}): ${body}`
            );
            // 4xx (yetki/yol) kalıcıdır; tekrar denemenin anlamı yok.
            if (status && status >= 400 && status < 500) break;
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 500 * attempt));
            }
        }
    }

    const err = new Error('CDN upload failed');
    err.code = 'CDN_UPLOAD_FAILED';
    err.cause = lastError;
    throw err;
}

/**
 * Bunny storage klasörünü listeler.
 * @param {string} folderPath örn. `proactive/123/` (trailing slash önerilir)
 * @returns {Promise<Array<{ObjectName: string, IsDirectory: boolean, Path?: string}>>}
 */
async function listBunnyFolder(folderPath) {
    if (!BUNNY_ACCESS_KEY) return [];
    const normalized = String(folderPath || '')
        .replace(/^\/+/, '')
        .replace(/\/?$/, '/');
    if (!normalized || normalized === '/') return [];
    try {
        const url = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${normalized}`;
        const res = await axios.get(url, {
            headers: {
                AccessKey: BUNNY_ACCESS_KEY,
                Accept: 'application/json',
            },
            timeout: 20000,
        });
        return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
        const status = e?.response?.status;
        if (status !== 404) {
            console.warn(
                `[bunny] list ${normalized} failed:`,
                status || e?.message || e
            );
        }
        return [];
    }
}

/**
 * Klasördeki görsellerin public CDN URL listesi.
 * @param {string} folderPath
 * @returns {Promise<string[]>}
 */
async function listBunnyImageUrls(folderPath) {
    const items = await listBunnyFolder(folderPath);
    const base = String(folderPath || '')
        .replace(/^\/+/, '')
        .replace(/\/?$/, '/');
    const urls = [];
    for (const item of items) {
        if (item?.IsDirectory) continue;
        const name = String(item?.ObjectName || '');
        if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) continue;
        urls.push(`${BUNNY_PULL_ZONE_BASE}/${base}${name}`);
    }
    return urls;
}

module.exports = {
    uploadBufferToBunny,
    listBunnyFolder,
    listBunnyImageUrls,
    BUNNY_STORAGE_ZONE,
    BUNNY_PULL_ZONE_BASE
};
