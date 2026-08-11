// Migration: stories tables
// Kullanım: node scripts/apply_stories.js
const { getQuery, query } = require('../db');

async function tableExists(table) {
  const rows = await getQuery(`SHOW TABLES LIKE ?`, [table]);
  return !!(rows && rows.length);
}

async function createIfMissing(name, sql) {
  if (await tableExists(name)) {
    console.log(`⏭️  ${name} zaten var`);
    return;
  }
  const ok = await query(sql);
  if (!ok) throw new Error(`CREATE ${name} failed`);
  console.log(`✅ ${name} oluşturuldu`);
}

async function main() {
  await createIfMissing(
    'user_feed_stories',
    `CREATE TABLE IF NOT EXISTS \`user_feed_stories\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`viewer_user_id\` INT NOT NULL,
  \`publisher_type\` ENUM('self','bot') NOT NULL,
  \`publisher_user_id\` INT NULL,
  \`bot_id\` INT NULL,
  \`media_url\` VARCHAR(512) NOT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`expires_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_feed_viewer_expires\` (\`viewer_user_id\`, \`expires_at\`),
  KEY \`idx_feed_bot\` (\`bot_id\`),
  UNIQUE KEY \`uq_viewer_media\` (\`viewer_user_id\`, \`media_url\`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await createIfMissing(
    'story_views',
    `CREATE TABLE IF NOT EXISTS \`story_views\` (
  \`viewer_user_id\` INT NOT NULL,
  \`feed_story_id\` BIGINT NOT NULL,
  \`viewed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`viewer_user_id\`, \`feed_story_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await createIfMissing(
    'user_story_seed_meta',
    `CREATE TABLE IF NOT EXISTS \`user_story_seed_meta\` (
  \`user_id\` INT NOT NULL,
  \`first_seeded_at\` DATETIME NULL,
  \`last_daily_key\` VARCHAR(16) NULL,
  PRIMARY KEY (\`user_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
