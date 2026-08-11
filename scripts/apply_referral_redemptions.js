// Migration: referral_code_redemptions tablosu
// Kullanım: node scripts/apply_referral_redemptions.js
'use strict';

const fs = require('fs');
const path = require('path');
const { getQuery, query } = require('../db');

async function tableExists(name) {
  const rows = await getQuery('SHOW TABLES LIKE ?', [name]);
  return !!(rows && rows.length);
}

async function main() {
  if (await tableExists('referral_code_redemptions')) {
    console.log('⏭️  referral_code_redemptions zaten var');
    process.exit(0);
  }

  const sqlPath = path.join(__dirname, 'sql', 'referral_code_redemptions.sql');
  const sql = fs
    .readFileSync(sqlPath, 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const stmt of sql) {
    const ok = await query(stmt);
    if (!ok) throw new Error(`SQL failed: ${stmt.slice(0, 80)}…`);
  }

  console.log('✅ referral_code_redemptions oluşturuldu');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
