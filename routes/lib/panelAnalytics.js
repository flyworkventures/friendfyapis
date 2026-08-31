const { getQuery } = require('../../db');
const { PANEL_TIMEZONE } = require('./panelUserMapper');
const { buildAgentsAnalyseSummary } = require('./panelAgentService');
const {
    istLocalDayStartUtc,
    istLocalDayKeyFromUtcDate,
    istDayKeyDaysAgo,
} = require('./panelDateUtils');

const DAILY_RANGE_DAYS = Math.min(
    90,
    Math.max(7, Number(process.env.PANEL_ANALYTICS_DAYS) || 30)
);

async function fetchNewUsersDaily(days) {
    const since = istLocalDayStartUtc(days);
    const rows = await getQuery(
        `
        SELECT accountCreatedDate
        FROM \`users\`
        WHERE accountCreatedDate >= ?
        `,
        [since]
    );
    const map = new Map();
    for (const r of rows || []) {
        const key = istLocalDayKeyFromUtcDate(r.accountCreatedDate);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
}

async function fetchActivityDaily(days) {
    const since = istLocalDayStartUtc(days);
    const rows = await getQuery(
        `
        SELECT userId, last_message_at, started_at
        FROM \`coversations\`
        WHERE last_message_at >= ?
           OR (last_message_at IS NULL AND started_at >= ?)
        `,
        [since, since]
    );
    const map = new Map();
    const seenByDay = new Map();

    for (const r of rows || []) {
        const ts = r.last_message_at || r.started_at;
        const key = istLocalDayKeyFromUtcDate(ts);
        const userId = r.userId;
        if (!key || userId == null) continue;
        if (!seenByDay.has(key)) seenByDay.set(key, new Set());
        const seen = seenByDay.get(key);
        if (seen.has(userId)) continue;
        seen.add(userId);
        map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
}

function buildDailySeries(newUsersMap, activityMap, days) {
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = istDayKeyDaysAgo(i);
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

    const todayStart = istLocalDayStartUtc(0);
    const tomorrowStart = istLocalDayStartUtc(-1);

    const [newTodayRow] = await getQuery(
        `
        SELECT COUNT(*) AS cnt FROM \`users\`
        WHERE accountCreatedDate >= ?
          AND accountCreatedDate < ?
        `,
        [todayStart, tomorrowStart]
    );
    const newUsersToday = Number(newTodayRow?.cnt) || 0;

    const [activityTodayRow] = await getQuery(
        `
        SELECT COUNT(DISTINCT userId) AS cnt FROM \`coversations\`
        WHERE (last_message_at >= ? AND last_message_at < ?)
           OR (last_message_at IS NULL AND started_at >= ? AND started_at < ?)
        `,
        [todayStart, tomorrowStart, todayStart, tomorrowStart]
    );
    const loginsToday = Number(activityTodayRow?.cnt) || 0;

    const newUsersMap = await fetchNewUsersDaily(days);
    const activityMap = await fetchActivityDaily(days);
    const daily = buildDailySeries(newUsersMap, activityMap, days);
    const agentsSummary = await buildAgentsAnalyseSummary();

    return {
        contractVersion: '2',
        generatedAt: new Date().toISOString(),
        timezone: PANEL_TIMEZONE,
        summary: {
            totalUsers,
            loginsToday,
            newUsersToday
        },
        agentsSummary,
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
