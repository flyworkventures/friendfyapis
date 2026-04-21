-- Config Table
-- Bu tablo uygulama genel ayarlarını saklar
-- Tek satır kullanılır (id=1), tüm ayarlar bu satırda tutulur

CREATE TABLE IF NOT EXISTS `config` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `app_name` VARCHAR(100) DEFAULT 'FriendFy' COMMENT 'Uygulama adı',
  `app_version` VARCHAR(20) DEFAULT '1.0.0' COMMENT 'Uygulama versiyonu',
  `maintenance_mode` TINYINT(1) DEFAULT 0 COMMENT 'Bakım modu (0: kapalı, 1: açık)',
  `max_agents_per_user` INT(11) DEFAULT 10 COMMENT 'Kullanıcı başına maksimum agent sayısı',
  `max_conversations_per_user` INT(11) DEFAULT 100 COMMENT 'Kullanıcı başına maksimum konuşma sayısı',
  `jwt_expires_in` VARCHAR(20) DEFAULT '7d' COMMENT 'JWT token geçerlilik süresi',
  `refresh_token_expires_in` VARCHAR(20) DEFAULT '30d' COMMENT 'Refresh token geçerlilik süresi',
  `max_message_length` INT(11) DEFAULT 5000 COMMENT 'Maksimum mesaj uzunluğu',
  `enable_registration` TINYINT(1) DEFAULT 1 COMMENT 'Kayıt açık mı? (0: kapalı, 1: açık)',
  `enable_google_auth` TINYINT(1) DEFAULT 1 COMMENT 'Google ile giriş aktif mi?',
  `enable_apple_auth` TINYINT(1) DEFAULT 1 COMMENT 'Apple ile giriş aktif mi?',
  `api_rate_limit` INT(11) DEFAULT 100 COMMENT 'API rate limit (dakika başına istek)',
  `support_email` VARCHAR(100) DEFAULT NULL COMMENT 'Destek e-posta adresi',
  `support_url` VARCHAR(255) DEFAULT NULL COMMENT 'Destek URL',
  `privacy_policy_url` VARCHAR(255) DEFAULT NULL COMMENT 'Gizlilik politikası URL',
  `terms_of_service_url` VARCHAR(255) DEFAULT NULL COMMENT 'Kullanım şartları URL',
  `feature_flags` JSON DEFAULT NULL COMMENT 'Özellik bayrakları (JSON formatında)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Uygulama genel ayarları';

-- Varsayılan config kaydını ekle (id=1)
INSERT INTO `config` (
  `app_name`,
  `app_version`,
  `maintenance_mode`,
  `max_agents_per_user`,
  `max_conversations_per_user`,
  `jwt_expires_in`,
  `refresh_token_expires_in`,
  `max_message_length`,
  `enable_registration`,
  `enable_google_auth`,
  `enable_apple_auth`,
  `api_rate_limit`,
  `support_email`,
  `support_url`,
  `privacy_policy_url`,
  `terms_of_service_url`,
  `feature_flags`
) VALUES (
  'FriendFy',
  '1.0.0',
  0,
  10,
  100,
  '7d',
  '30d',
  5000,
  1,
  1,
  1,
  100,
  'support@friendfy.com',
  'https://friendfy.com/support',
  'https://friendfy.com/privacy',
  'https://friendfy.com/terms',
  '{"new_feature": true, "beta_mode": false}'
) ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- Not: Bu tablo tek satır kullanır (id=1)
-- Yeni ayar eklemek için ALTER TABLE kullanın:
-- ALTER TABLE `config` ADD COLUMN `yeni_ayar` VARCHAR(255) DEFAULT NULL COMMENT 'Açıklama';
