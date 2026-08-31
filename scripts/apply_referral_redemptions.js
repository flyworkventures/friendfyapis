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

/** Satır başı -- yorumlarını kaldırır; CREATE TABLE gibi çok satırlı SQL korunur. */
function stripSqlComments(raw) {
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

async function main() {
  if (await tableExists('referral_code_redemptions')) {
    console.log('⏭️  referral_code_redemptions zaten var');
    process.exit(0);
  }

  const sqlPath = path.join(__dirname, 'sql', 'referral_code_redemptions.sql');
  const cleaned = stripSqlComments(fs.readFileSync(sqlPath, 'utf8'));
  const statements = cleaned
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    throw new Error('No SQL statements found in referral_code_redemptions.sql');
  }

  for (const stmt of statements) {
    const ok = await query(stmt);
    if (!ok) throw new Error(`SQL failed: ${stmt.slice(0, 80)}…`);
  }

  if (!(await tableExists('referral_code_redemptions'))) {
    throw new Error('referral_code_redemptions tablosu oluşturulamadı');
  }

  console.log('✅ referral_code_redemptions oluşturuldu');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
