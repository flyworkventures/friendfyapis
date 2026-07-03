-- RevenueCat müşteri (App User Id / customer) eşlemesi.
-- Webhook ve sync sırasında anonim → alias durumlarında kullanıcıyı bulmak için.
-- İdempotent uygulama için: node scripts/apply_revenuecat_customer_id.js
ALTER TABLE `users`
  ADD COLUMN `revenuecat_customer_id` VARCHAR(191) NULL AFTER `memberships`;

CREATE INDEX `idx_users_revenuecat_customer_id`
  ON `users` (`revenuecat_customer_id`);
