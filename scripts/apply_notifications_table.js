/**
 * notifications tablosunu oluşturur.
 * Çalıştır: node scripts/apply_notifications_table.js
 */
require('dotenv').config();
const { pool } = require('../db');

const SQL = `
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'system',
  payload TEXT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user_created (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function run() {
  try {
    await pool.query(SQL);
    console.log('✅ notifications tablosu oluşturuldu/mevcut.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Hata:', e.message);
    process.exit(1);
  }
}

run();
