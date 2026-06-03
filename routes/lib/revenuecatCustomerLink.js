const { query } = require('../../db');

function pickRevenueCatCustomerId(body) {
    const rc = body?.revenuecat;
    if (!rc || typeof rc !== 'object') return null;
    const id =
        rc.originalAppUserId ||
        rc.appUserId ||
        rc.customerId ||
        null;
    if (id == null) return null;
    const trimmed = String(id).trim();
    return trimmed || null;
}

async function persistRevenueCatCustomerId(userId, customerId) {
    if (!userId || !customerId) return false;
    try {
        await query(
            'UPDATE `users` SET `revenuecat_customer_id` = ? WHERE id = ? LIMIT 1',
            [customerId, userId]
        );
        return true;
    } catch (error) {
        if (error?.code === 'ER_BAD_FIELD_ERROR') {
            console.warn(
                '[revenuecat] revenuecat_customer_id kolonu yok — scripts/sql/users_revenuecat_customer_id.sql çalıştırın'
            );
            return false;
        }
        throw error;
    }
}

module.exports = {
    pickRevenueCatCustomerId,
    persistRevenueCatCustomerId
};
