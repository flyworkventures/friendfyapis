-- Cihaz başına bir kez 3 günlük deneme (fingerprint hash, ham id saklanmaz).
CREATE TABLE IF NOT EXISTS `device_trial_claims` (
  `fingerprint_hash` CHAR(64) NOT NULL COMMENT 'SHA256(pepper + normalized fingerprint)',
  `user_id` VARCHAR(64) NOT NULL,
  `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fingerprint_hash`),
  KEY `idx_device_trial_claims_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
