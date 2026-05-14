-- Katalog (system 1/2) botları için kullanıcıya özel alan override'ları.
-- /agent/update-agent (katalog düzenlemesi) buraya yazar; /agent/get-system-agents JWT kullanıcısı için birleştirir.

CREATE TABLE IF NOT EXISTS `bot_catalog_overrides` (
  `user_id` VARCHAR(128) NOT NULL,
  `bot_id` INT NOT NULL,
  `name` VARCHAR(512) NOT NULL,
  `character` TEXT NOT NULL,
  `age` INT NOT NULL DEFAULT 18,
  `gender` VARCHAR(64) NOT NULL DEFAULT 'female',
  `interests` TEXT NOT NULL,
  `interestsType` TEXT NOT NULL,
  `photoURL` LONGTEXT NOT NULL,
  `characterTags` TEXT NOT NULL,
  `speakingStyle` TEXT NOT NULL,
  `voiceId` VARCHAR(255) NOT NULL,
  `country` VARCHAR(255) NOT NULL DEFAULT '',
  `rive_avatar` VARCHAR(2048) NULL DEFAULT NULL COMMENT '.riv CDN URL',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `bot_id`),
  KEY `idx_bot_catalog_overrides_bot` (`bot_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
