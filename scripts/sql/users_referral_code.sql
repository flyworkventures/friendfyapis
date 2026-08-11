-- Kullanıcı referans kodu: XXX-YYY (ör. XVY-FRN), unique.
-- İdempotent uygulama: node scripts/apply_users_referral_code.js
ALTER TABLE `users`
  ADD COLUMN `referral_code` CHAR(7) NULL DEFAULT NULL
    COMMENT 'Unique invite/referral code XXX-YYY'
    AFTER `email`;

CREATE UNIQUE INDEX `uq_users_referral_code`
  ON `users` (`referral_code`);
