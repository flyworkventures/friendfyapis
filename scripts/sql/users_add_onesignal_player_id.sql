-- Opsiyonel: OneSignal subscription id yedek saklama (asıl hedef external_user_id).
ALTER TABLE `users`
  ADD COLUMN `onesignal_player_id` VARCHAR(128) NULL DEFAULT NULL AFTER `notification_preferences`;
