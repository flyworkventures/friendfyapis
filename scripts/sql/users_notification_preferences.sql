-- Kullanıcı bildirim / arama tercihleri (JSON).
-- Uygulama: node scripts/apply_notification_preferences.js
ALTER TABLE `users`
  ADD COLUMN `notification_preferences` JSON NULL AFTER `hobbies`;
