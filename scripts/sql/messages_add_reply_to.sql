-- Alıntı/cevap için parent mesaj referansı
ALTER TABLE `messages`
  ADD COLUMN `reply_to_message_id` INT NULL DEFAULT NULL AFTER `message_type`;
