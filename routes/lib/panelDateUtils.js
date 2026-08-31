'use strict';

// Istanbul UTC+3 sabit (Türkiye 2016'dan beri DST kullanmıyor); mevcut
// sorgulardaki hardcoded '+03:00' ile birebir tutarlı.
const IST_OFFSET_MIN = 180;

// Istanbul yerel gün başlangıcını (00:00 +03:00) UTC 'YYYY-MM-DD HH:MM:SS'
// olarak döndürür. daysAgo=0 → bugünün yerel gün başı, 1 → dün, -1 → yarın.
function istLocalDayStartUtc(daysAgo) {
    const now = new Date();
    const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
    const istMidnightMs = Date.UTC(
        ist.getUTCFullYear(),
        ist.getUTCMonth(),
        ist.getUTCDate() - daysAgo,
        0, 0, 0
    );
    const utcMs = istMidnightMs - IST_OFFSET_MIN * 60000;
    return new Date(utcMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** UTC datetime → Istanbul yerel gün anahtarı (YYYY-MM-DD). */
function istLocalDayKeyFromUtcDate(value) {
    if (value == null) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Bugünden [daysAgo] gün öncesinin Istanbul gün anahtarı. */
function istDayKeyDaysAgo(daysAgo) {
    return istLocalDayKeyFromUtcDate(istLocalDayStartUtc(daysAgo));
}

module.exports = {
    istLocalDayStartUtc,
    istLocalDayKeyFromUtcDate,
    istDayKeyDaysAgo,
};
