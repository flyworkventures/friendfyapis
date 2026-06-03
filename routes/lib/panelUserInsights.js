const { getQuery } = require('../../db');
const { systemToAgentType } = require('./panelAgentMapper');

async function findUserLinkedAgents(userId, limit = 50) {
    const rows = await getQuery(
        `
        SELECT
            b.id AS agentId,
            b.name AS agentName,
            b.system,
            b.gender,
            MIN(COALESCE(c.started_at, c.last_message_at)) AS firstChatAt,
            MAX(COALESCE(c.last_message_at, c.started_at)) AS lastMessageAt,
            COUNT(DISTINCT c.id) AS conversationCount,
            (
                SELECT COUNT(*)
                FROM \`messages\` m
                WHERE m.conversationId IN (
                    SELECT c2.id FROM \`coversations\` c2
                    WHERE c2.userId = ? AND c2.botId = b.id
                )
            ) AS messageCount
        FROM \`coversations\` c
        INNER JOIN \`bots\` b ON b.id = c.botId
        WHERE c.userId = ?
          AND EXISTS (
              SELECT 1 FROM \`messages\` m WHERE m.conversationId = c.id LIMIT 1
          )
        GROUP BY b.id, b.name, b.system, b.gender
        ORDER BY lastMessageAt DESC
        LIMIT ?
        `,
        [userId, userId, limit]
    );

    return (rows || []).map((row) => ({
        agentId: String(row.agentId),
        displayName: row.agentName != null ? String(row.agentName) : null,
        agentType: systemToAgentType(Number(row.system)),
        gender: row.gender ?? null,
        firstChatAt: row.firstChatAt ? new Date(row.firstChatAt).toISOString() : null,
        lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
        conversationCount: Number(row.conversationCount) || 0,
        messageCount: Number(row.messageCount) || 0
    }));
}

async function findUserOwnedAgents(userId, limit = 50) {
    const rows = await getQuery(
        `
        SELECT id, name, system, gender, created_at
        FROM \`bots\`
        WHERE creatorId = ? AND system = 0
        ORDER BY id DESC
        LIMIT ?
        `,
        [userId, limit]
    );

    return (rows || []).map((row) => ({
        agentId: String(row.id),
        displayName: row.name != null ? String(row.name) : null,
        agentType: systemToAgentType(Number(row.system)),
        gender: row.gender ?? null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    }));
}

async function findUserConversationStats(userId) {
    const [row] = await getQuery(
        `
        SELECT
            COUNT(DISTINCT c.id) AS conversationCount,
            COUNT(DISTINCT c.botId) AS linkedAgentCount,
            (
                SELECT COUNT(*)
                FROM \`messages\` m
                INNER JOIN \`coversations\` c2 ON c2.id = m.conversationId
                WHERE c2.userId = ?
            ) AS messageCount
        FROM \`coversations\` c
        WHERE c.userId = ?
          AND EXISTS (
              SELECT 1 FROM \`messages\` m WHERE m.conversationId = c.id LIMIT 1
          )
        `,
        [userId, userId]
    );

    const [ownedRow] = await getQuery(
        'SELECT COUNT(*) AS cnt FROM `bots` WHERE creatorId = ? AND system = 0',
        [userId]
    );

    return {
        conversationCount: Number(row?.conversationCount) || 0,
        linkedAgentCount: Number(row?.linkedAgentCount) || 0,
        messageCount: Number(row?.messageCount) || 0,
        ownedAgentCount: Number(ownedRow?.cnt) || 0
    };
}

async function buildUserInsights(userId) {
    const [linkedAgents, ownedAgents, summary] = await Promise.all([
        findUserLinkedAgents(userId),
        findUserOwnedAgents(userId),
        findUserConversationStats(userId)
    ]);

    return {
        summary,
        linkedAgents,
        ownedAgents
    };
}

module.exports = {
    buildUserInsights,
    findUserLinkedAgents,
    findUserOwnedAgents,
    findUserConversationStats
};
