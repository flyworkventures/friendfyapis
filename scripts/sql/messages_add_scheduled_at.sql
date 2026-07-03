-- Proaktif (zamanlanmış) karakter mesajları için görünürlük zamanı.
-- scheduled_at NULL veya <= NOW() olan mesajlar kullanıcıya gösterilir;
-- gelecekteki bir tarih ise mesaj o zamana kadar sohbette görünmez.
ALTER TABLE `messages`
  ADD COLUMN `scheduled_at` DATETIME NULL DEFAULT NULL AFTER `created_at`;
