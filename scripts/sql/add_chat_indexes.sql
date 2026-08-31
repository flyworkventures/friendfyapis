-- Chat hot-path index'leri: messages + coversations tablolarında
-- filtreleme/join/sıralama yapılan kolonlar. `listen-messages` poll'ü
-- (~700ms) ve get-conversations bu index'ler olmadan tam tablo taraması yapar.
--
-- NOT: MySQL 5.7 `ADD INDEX IF NOT EXISTS` desteklemez; idempotent kurulum
-- için scripts/apply_chat_indexes.js kullanın (var olanı atlar).

-- messages: WHERE conversationId = ? ORDER BY id DESC (ana chat fetch + EXISTS)
-- NOT: conversationId `varchar(9999)` — sadece sayısal id tutuyor; utf8mb4 key
-- limiti (1000 byte) için prefix(20) yeterli (bigint max 19 hane).
-- Uzun vadede kolon BIGINT'e çevrilmeli (bkz. rapor takip önerisi).
ALTER TABLE `messages`
  ADD INDEX `idx_messages_conv_id` (`conversationId`(20), `id`);

-- messages: reply/alıntı çözümlemesi (WHERE reply_to_message_id = ?)
ALTER TABLE `messages`
  ADD INDEX `idx_messages_reply_to` (`reply_to_message_id`);

-- coversations: WHERE userId = ? [AND botId = ?] — composite, userId-only
-- sorguları da leftmost-prefix ile karşılar.
ALTER TABLE `coversations`
  ADD INDEX `idx_coversations_user_bot` (`userId`, `botId`);

-- coversations: startup'taki 'bot_typing' reset + state filtreleri.
-- current_chat_state `TEXT` → prefix(16) gerekli ('bot_typing' = 10 char).
ALTER TABLE `coversations`
  ADD INDEX `idx_coversations_chat_state` (`current_chat_state`(16));

-- Panel analytics: sargable WHERE (col >= ? AND col < ?) için
ALTER TABLE `users`
  ADD INDEX `idx_users_account_created` (`accountCreatedDate`);

ALTER TABLE `coversations`
  ADD INDEX `idx_coversations_last_message_at` (`last_message_at`);

ALTER TABLE `coversations`
  ADD INDEX `idx_coversations_started_at` (`started_at`);

-- get-recent-bots: WHERE created_at >= ? ORDER BY created_at DESC
ALTER TABLE `bots`
  ADD INDEX `idx_bots_created_at_system` (`created_at`, `system`);
