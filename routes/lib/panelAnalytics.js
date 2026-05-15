const { getQuery } = require('../../db');
const { PANEL_TIMEZONE } = require('./panelUserMapper');

const DAILY_RANGE_DAYS = Math.min(
    90,
    Math.max(7, Number(process.env.PANEL_ANALYTICS_DAYS) || 30)
);

async function fetchNewUsersDaily(days) {
    const rows = await getQuery(
        `
        SELECT DATE(CONVERT_TZ(accountCreatedDate, '+00:00', '+03:00')) AS day_key,
               COUNT(*) AS cnt
        FROM \`users\`
        WHERE accountCreatedDate IS NOT NULL
          AND DATE(CONVERT_TZ(accountCreatedDate, '+00:00', '+03:00')) >= DATE(
              CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')
          ) - INTERVAL ? DAY
        GROUP BY day_key
        ORDER BY day_key ASC
        `,
        [days]
    );
    const map = new Map();
    for (const r of rows || []) {
        const key =
            r.day_key instanceof Date
                ? r.day_key.toISOString().slice(0, 10)
                : String(r.day_key).slice(0, 10);
        map.set(key, Number(r.cnt) || 0);
    }
    return map;
}

async function fetchActivityDaily(days) {
    const rows = await getQuery(
        `
        SELECT day_key, COUNT(DISTINCT userId) AS cnt
        FROM (
            SELECT DATE(CONVERT_TZ(COALESCE(last_message_at, started_at), '+00:00', '+03:00')) AS day_key,
                   userId
            FROM \`coversations\`
            WHERE COALESCE(last_message_at, started_at) IS NOT NULL
              AND DATE(CONVERT_TZ(COALESCE(last_message_at, started_at), '+00:00', '+03:00')) >= DATE(
                  CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')
              ) - INTERVAL ? DAY
        ) t
        GROUP BY day_key
        ORDER BY day_key ASC
        `,
        [days]
    );
    const map = new Map();
    for (const r of rows || []) {
        const key =
            r.day_key instanceof Date
                ? r.day_key.toISOString().slice(0, 10)
                : String(r.day_key).slice(0, 10);
        map.set(key, Number(r.cnt) || 0);
    }
    return map;
}

function buildDailySeries(newUsersMap, activityMap, days) {
    const series = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        series.push({
            date,
            logins: activityMap.get(date) || 0,
            newUsers: newUsersMap.get(date) || 0
        });
    }
    return series;
}

async function buildAnalysePayload() {
    const days = DAILY_RANGE_DAYS;

    const [totalRow] = await getQuery('SELECT COUNT(*) AS total FROM `users`', []);
    const totalUsers = Number(totalRow?.total) || 0;

    const [newTodayRow] = await getQuery(
        `
        SELECT COUNT(*) AS cnt FROM \`users\`
        WHERE accountCreatedDate IS NOT NULL
          AND DATE(CONVERT_TZ(accountCreatedDate, '+00:00', '+03:00')) = DATE(
              CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')
          )
        `,
        []
    );
    const newUsersToday = Number(newTodayRow?.cnt) || 0;

    const [activityTodayRow] = await getQuery(
        `
        SELECT COUNT(DISTINCT userId) AS cnt FROM \`coversations\`
        WHERE COALESCE(last_message_at, started_at) IS NOT NULL
          AND DATE(CONVERT_TZ(COALESCE(last_message_at, started_at), '+00:00', '+03:00')) = DATE(
              CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')
          )
        `,
        []
    );
    const loginsToday = Number(activityTodayRow?.cnt) || 0;

    const newUsersMap = await fetchNewUsersDaily(days);
    const activityMap = await fetchActivityDaily(days);
    const daily = buildDailySeries(newUsersMap, activityMap, days);

    return {
        contractVersion: '2',
        generatedAt: new Date().toISOString(),
        timezone: PANEL_TIMEZONE,
        summary: {
            totalUsers,
            loginsToday,
            newUsersToday
        },
        metricsNotes: {
            loginsToday:
                'Bugün sohbet aktivitesi olan benzersiz kullanıcı (coversations.last_message_at / started_at). lastLogins dolu olsa bile bu metrik aktivite tabanlıdır.',
            newUsersToday: 'accountCreatedDate bugün (Europe/Istanbul gün sınırı, UTC+3).'
        },
        daily
    };
}

module.exports = {
    DAILY_RANGE_DAYS,
    buildAnalysePayload
};
