// Tek seferlik migration: coversations.memory_summary kolonlarını (yoksa) ekler.
// Kullanım: node scripts/apply_memory_summary.js
const { getQuery, query } = require('../db');

const COLUMNS = [
  {
    table: 'coversations',
    name: 'memory_summary',
    ddl:
      'ALTER TABLE `coversations` ADD COLUMN `memory_summary` TEXT NULL AFTER `last_message_at`',
  },
  {
    table: 'coversations',
    name: 'memory_message_count',
    ddl:
      'ALTER TABLE `coversations` ADD COLUMN `memory_message_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `memory_summary`',
  },
];

async function columnExists(table, column) {
  const rows = await getQuery(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  for (const col of COLUMNS) {
    const exists = await columnExists(col.table, col.name);
    if (exists) {
      console.log(`[skip] ${col.table}.${col.name} already exists`);
      continue;
    }
    console.log(`[apply] ${col.table}.${col.name}`);
    await query(col.ddl);
    console.log(`[ok] ${col.table}.${col.name}`);
  }
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
