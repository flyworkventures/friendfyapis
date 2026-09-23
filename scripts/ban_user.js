// Kullanıcı banla / ban kaldır.
// Kullanım:
//   node scripts/ban_user.js <userId> "sebep"     # banla
//   node scripts/ban_user.js --unban <userId>     # ban kaldır
//   node scripts/ban_user.js --list               # banlı kullanıcıları listele
const { getQuery, query } = require('../db');

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--list') {
      const rows = await getQuery('SELECT id, username, email, banned_at, ban_reason FROM `users` WHERE is_banned = 1 ORDER BY banned_at DESC');
      console.log(`Banlı kullanıcı: ${rows.length}`);
      for (const r of rows) console.log(`  ${r.id} "${r.username}" (${r.email || '-'}) — ${r.banned_at || '?'} — ${r.ban_reason || '-'}`);
      process.exit(0);
    }
    if (args[0] === '--unban') {
      const id = args[1];
      if (!id) { console.error('userId gerekli'); process.exit(1); }
      const ok = await query('UPDATE `users` SET is_banned = 0, banned_at = NULL, ban_reason = NULL WHERE id = ?', [id]);
      console.log(ok ? `✅ ${id} ban kaldırıldı (cache 60sn içinde güncellenir).` : `❌ başarısız`);
      process.exit(ok ? 0 : 1);
    }
    const id = args[0];
    const reason = args[1] || 'Topluluk kurallarını ihlal';
    if (!id) { console.error('Kullanım: node scripts/ban_user.js <userId> "sebep"'); process.exit(1); }
    const [u] = await getQuery('SELECT id, username, email FROM `users` WHERE id = ?', [id]);
    if (!u) { console.error('Kullanıcı bulunamadı:', id); process.exit(1); }
    const ok = await query('UPDATE `users` SET is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?', [reason, id]);
    console.log(ok
      ? `✅ BANLANDI: ${u.id} "${u.username}" (${u.email || '-'})\n   sebep: ${reason}\n   (auth cache 60sn içinde devreye girer; kullanıcı sonraki istekte 403 ACCOUNT_BANNED alır)`
      : `❌ başarısız`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('❌ Hata:', e?.message || e);
    process.exit(1);
  }
})();
