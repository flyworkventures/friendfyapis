const { getQuery, query } = require('../../db');
const { parseMembershipsArray } = require('./membershipsSync');
const { normalizeUserId } = require('./assertJwtUserId');

/**
 * RevenueCat webhook entegrasyonu.
 *
 * Amaç: Uygulama kapalıyken bile abonelik durumunu (yenileme, iptal, süre
 * dolması, ödeme sorunu) sunucuda güncel tutmak. Ücretsiz deneme artık yalnızca
 * paywall satın almasıyla (App Store/Play tanıtım teklifi) başladığından, trial
 * dönemi de RevenueCat'te `period_type = TRIAL` olan aktif bir abonelik olarak
 * gelir ve burada `paid` üyelik olarak işlenir (deneme boyunca kullanıcı premium).
 */

/** Erişimi AKTİF hale getiren/uzatan olaylar. */
const GRANT_EVENTS = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
    'SUBSCRIPTION_EXTENDED',
    'NON_RENEWING_PURCHASE'
]);

/** Erişimi hemen SONLANDIRAN olaylar. */
const REVOKE_EVENTS = new Set([
    'EXPIRATION',
    'SUBSCRIPTION_PAUSED'
]);

/**
 * CANCELLATION ve BILLING_ISSUE erişimi hemen kesmez; kullanıcı dönem sonuna
 * (expiration_at_ms) kadar premium kalır. Bu yüzden bunlar da "grant" gibi
 * değerlendirilir ancak isActive hesabı expiration'a göre yapılır.
 */
const KEEP_UNTIL_EXPIRATION_EVENTS = new Set(['CANCELLATION', 'BILLING_ISSUE']);

/** RevenueCat panelinde ayarlanan Authorization header değerini doğrular. */
function verifyWebhookAuth(req) {
    const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
    // Secret tanımlı değilse (yanlış yapılandırma) güvenli tarafta kal: reddet.
    if (!expected) {
        console.warn(
            '[revenuecat-webhook] REVENUECAT_WEBHOOK_AUTH tanımlı değil — istek reddedildi'
        );
        return false;
    }
    const got = req.header('authorization') || req.header('Authorization') || '';
    return got === expected;
}

function toIsoOrNull(ms) {
    if (ms == null) return null;
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n).toISOString();
}

function isFreeTrialEntry(m) {
    if (!m || typeof m !== 'object') return false;
    return (
        String(m.type || '')
            .toLowerCase()
            .replace(/_/g, '') === 'freetrial'
    );
}

/**
 * Olaydan kullanıcıyı çözer.
 * Öncelik: app_user_id (sayısal user id) → aliases → revenuecat_customer_id.
 * @returns {Promise<{userRow: object, userId: string} | null>}
 */
async function resolveUser(event) {
    const candidates = [];
    const push = (v) => {
        const s = normalizeUserId(v);
        if (s && !candidates.includes(s)) candidates.push(s);
    };
    push(event.app_user_id);
    push(event.original_app_user_id);
    if (Array.isArray(event.aliases)) {
        event.aliases.forEach(push);
    }

    // 1) Sayısal user id ile users.id eşleşmesi
    for (const c of candidates) {
        if (!/^\d+$/.test(c)) continue;
        const rows = await getQuery('SELECT * FROM `users` WHERE id = ? LIMIT 1', [c]);
        if (rows && rows.length > 0) {
            return { userRow: rows[0], userId: String(rows[0].id) };
        }
    }

    // 2) revenuecat_customer_id ile eşleşme (anonim → alias durumları)
    for (const c of candidates) {
        try {
            const rows = await getQuery(
                'SELECT * FROM `users` WHERE `revenuecat_customer_id` = ? LIMIT 1',
                [c]
            );
            if (rows && rows.length > 0) {
                return { userRow: rows[0], userId: String(rows[0].id) };
            }
        } catch (error) {
            if (error?.code === 'ER_BAD_FIELD_ERROR') {
                // Kolon yoksa bu arama yolunu atla.
                break;
            }
            throw error;
        }
    }

    return null;
}

/**
 * Verilen memberships dizisinde `paid` kayıtlarını (ve device freeTrial'ı)
 * kaldırıp yeni hesaplanan ücretli üyeliği yerleştirir. Kullanıcı tarafından
 * eklenmiş diğer (device dışı) freeTrial kayıtları korunur.
 */
function upsertPaidMembership(dbArr, newPaid) {
    const preserved = dbArr.filter((m) => {
        if (!m || typeof m !== 'object') return false;
        const t = String(m.type || '').toLowerCase();
        if (t === 'paid') return false; // eski paid kayıtları değiştir
        return true;
    });
    if (newPaid) preserved.push(newPaid);
    return preserved;
}

/**
 * Olayı işleyip users.memberships günceller.
 * @returns {Promise<{ handled: boolean, reason?: string, userId?: string }>}
 */
async function applyRevenueCatEvent(event) {
    if (!event || typeof event !== 'object') {
        return { handled: false, reason: 'invalid_event' };
    }

    const type = String(event.type || '').toUpperCase();

    // Test olayı: bağlantı doğrulaması, işlem yok.
    if (type === 'TEST') {
        return { handled: true, reason: 'test' };
    }

    // TRANSFER: ürün/expiration güvenilir gelmez; istemci bir sonraki açılışta
    // RevenueCat ile senkron olur. Burada işlem yapmadan 200 dönüyoruz.
    if (type === 'TRANSFER') {
        return { handled: true, reason: 'transfer_ignored' };
    }

    const resolved = await resolveUser(event);
    if (!resolved) {
        return { handled: false, reason: 'user_not_found' };
    }

    const { userRow, userId } = resolved;

    const productId = String(event.product_id || event.presented_offering_id || 'unknown');
    const startIso = toIsoOrNull(event.purchased_at_ms) || new Date().toISOString();
    const endIso = toIsoOrNull(event.expiration_at_ms);
    const now = Date.now();

    let isActive;
    if (REVOKE_EVENTS.has(type)) {
        isActive = false;
    } else if (GRANT_EVENTS.has(type) || KEEP_UNTIL_EXPIRATION_EVENTS.has(type)) {
        // expiration yoksa (kalıcı/non-renewing) aktif; varsa geleceğe bak.
        isActive = endIso == null ? true : Number(event.expiration_at_ms) > now;
    } else {
        // Bilinmeyen olay türü: mevcut duruma dokunma.
        return { handled: true, reason: `unhandled_type_${type}`, userId };
    }

    const dbArr = parseMembershipsArray(userRow.memberships);

    let newArr;
    if (!isActive) {
        // Erişim bitti: paid kayıtları kaldır (device freeTrial dışı üyelikleri koru).
        newArr = dbArr.filter((m) => String(m?.type || '').toLowerCase() !== 'paid');
    } else {
        const newPaid = {
            startDate: startIso,
            endDate: endIso,
            productId,
            type: 'paid',
            isActive: true,
            purchasedAt: startIso
        };
        newArr = upsertPaidMembership(dbArr, newPaid);
    }

    // Sunucu tarafında güvenilmeyen device freeTrial kayıtlarını da temizle.
    newArr = newArr.filter(
        (m) => !(isFreeTrialEntry(m) && String(m?.productId || '').includes('device_free_trial'))
    );

    const ok = await query('UPDATE `users` SET `memberships` = ? WHERE id = ? LIMIT 1', [
        JSON.stringify(newArr),
        userId
    ]);

    if (!ok) {
        return { handled: false, reason: 'db_update_failed', userId };
    }

    return { handled: true, reason: `applied_${type}`, userId, isActive };
}

module.exports = {
    verifyWebhookAuth,
    applyRevenueCatEvent,
    resolveUser,
    GRANT_EVENTS,
    REVOKE_EVENTS
};
