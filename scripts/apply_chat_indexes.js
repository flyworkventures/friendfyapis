// Tek seferlik migration: chat hot-path index'lerini (yoksa) ekler.
// Kullanım: node scripts/apply_chat_indexes.js
//
// Her index için önce SHOW INDEX ile varlığını kontrol eder — tekrar
// çalıştırmak güvenlidir (var olanı atlar). MySQL 5.7'de
// `ADD INDEX IF NOT EXISTS` desteklenmediği için manuel kontrol gerekir.
const { getQuery, query } = require('../db');

const INDEXES = [
  {
    table: 'messages',
    name: 'idx_messages_conv_id',
    // conversationId varchar(9999) — prefix(20) sayısal id için yeterli.
    ddl:
      'ALTER TABLE `messages` ADD INDEX `idx_messages_conv_id` (`conversationId`(20), `id`)',
  },
  {
    table: 'messages',
    name: 'idx_messages_reply_to',
    ddl:
      'ALTER TABLE `messages` ADD INDEX `idx_messages_reply_to` (`reply_to_message_id`)',
  },
  {
    table: 'coversations',
    name: 'idx_coversations_user_bot',
    ddl:
      'ALTER TABLE `coversations` ADD INDEX `idx_coversations_user_bot` (`userId`, `botId`)',
  },
  {
    table: 'coversations',
    name: 'idx_coversations_chat_state',
    // current_chat_state TEXT → prefix(16) gerekli.
    ddl:
      'ALTER TABLE `coversations` ADD INDEX `idx_coversations_chat_state` (`current_chat_state`(16))',
  },
  {
    table: 'users',
    name: 'idx_users_account_created',
    ddl:
      'ALTER TABLE `users` ADD INDEX `idx_users_account_created` (`accountCreatedDate`)',
  },
  {
    table: 'coversations',
    name: 'idx_coversations_last_message_at',
    ddl:
      'ALTER TABLE `coversations` ADD INDEX `idx_coversations_last_message_at` (`last_message_at`)',
  },
  {
    table: 'coversations',
    name: 'idx_coversations_started_at',
    ddl:
      'ALTER TABLE `coversations` ADD INDEX `idx_coversations_started_at` (`started_at`)',
  },
  {
    table: 'bots',
    name: 'idx_bots_created_at_system',
    ddl:
      'ALTER TABLE `bots` ADD INDEX `idx_bots_created_at_system` (`created_at`, `system`)',
  },
];

async function indexExists(table, name) {
  const rows = await getQuery(
    'SHOW INDEX FROM `' + table + '` WHERE Key_name = ?',
    [name]
  );
  return Array.isArray(rows) && rows.length > 0;
}

(async () => {
  let created = 0;
  let skipped = 0;
  try {
    for (const idx of INDEXES) {
      if (await indexExists(idx.table, idx.name)) {
        console.log(`⏭️  ${idx.name} zaten mevcut, atlandı.`);
        skipped++;
        continue;
      }
      const ok = await query(idx.ddl);
      if (ok) {
        console.log(`✅ ${idx.name} eklendi (${idx.table}).`);
        created++;
      } else {
        console.error(`❌ ${idx.name} eklenemedi.`);
        process.exit(1);
      }
    }
    console.log(`\nBitti — ${created} eklendi, ${skipped} atlandı.`);
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration hatası:', e?.message || e);
    process.exit(1);
  }
})();
