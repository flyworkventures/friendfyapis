// Migration: login_streak_days tablosu
// Kullanım: node scripts/apply_login_streak_days.js
const { getQuery, query } = require('../db');

async function tableExists(table) {
  const rows = await getQuery(`SHOW TABLES LIKE ?`, [table]);
  return !!(rows && rows.length);
}

async function main() {
  if (await tableExists('login_streak_days')) {
    console.log('⏭️  login_streak_days zaten var');
    process.exit(0);
  }

  const ok = await query(`
CREATE TABLE IF NOT EXISTS \`login_streak_days\` (
  \`user_id\` INT NOT NULL,
  \`day_date\` DATE NOT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`user_id\`, \`day_date\`),
  KEY \`idx_login_streak_user_date\` (\`user_id\`, \`day_date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  if (!ok) throw new Error('CREATE login_streak_days failed');
  console.log('✅ login_streak_days oluşturuldu');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
