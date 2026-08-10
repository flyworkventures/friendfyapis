-- Misafir hesapları cihaza bağlamak için (cihaz başına tek guest user).
ALTER TABLE `users`
  ADD COLUMN `guest_device_id` VARCHAR(128) NULL DEFAULT NULL AFTER `credential`;

CREATE UNIQUE INDEX `idx_users_guest_device_id`
  ON `users` (`guest_device_id`);
