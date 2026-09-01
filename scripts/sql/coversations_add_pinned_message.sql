-- Sohbet içi tek sabitlenmiş mesaj (cihazlar arası senkron).
ALTER TABLE `coversations`
  ADD COLUMN `pinned_message_id` INT UNSIGNED NULL AFTER `pinned_at`;

CREATE INDEX `idx_coversations_pinned_message`
  ON `coversations` (`pinned_message_id`);
