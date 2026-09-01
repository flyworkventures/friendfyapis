-- Sohbet sabitleme (cihazlar arası senkron).
ALTER TABLE `coversations`
  ADD COLUMN `is_pinned` TINYINT(1) NOT NULL DEFAULT 0 AFTER `last_message_at`;

ALTER TABLE `coversations`
  ADD COLUMN `pinned_at` DATETIME NULL AFTER `is_pinned`;

CREATE INDEX `idx_coversations_user_pinned`
  ON `coversations` (`userId`, `is_pinned`, `pinned_at`);
