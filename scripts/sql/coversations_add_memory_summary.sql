-- Uzun sohbet hafızası: eski mesajların özeti coversations tablosunda tutulur.
-- Güvenli tekrar çalıştırma için apply_memory_summary.js kullanın.

ALTER TABLE `coversations`
  ADD COLUMN `memory_summary` TEXT NULL AFTER `last_message_at`;

ALTER TABLE `coversations`
  ADD COLUMN `memory_message_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `memory_summary`;
