-- Referral kod redeem kayıtları (3 günlük premium)
-- Uygulama: node scripts/apply_referral_redemptions.js

CREATE TABLE IF NOT EXISTS `referral_code_redemptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` CHAR(7) NOT NULL,
  `code_owner_user_id` BIGINT NOT NULL,
  `redeemed_by_user_id` BIGINT NOT NULL,
  `is_self_claim` TINYINT(1) NOT NULL DEFAULT 0,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referral_redeemer` (`redeemed_by_user_id`),
  KEY `idx_referral_code` (`code`),
  KEY `idx_referral_owner` (`code_owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
