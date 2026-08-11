-- Login streak: kullanıcı başına günlük uygulama girişi
CREATE TABLE IF NOT EXISTS `login_streak_days` (
  `user_id` INT NOT NULL,
  `day_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `day_date`),
  KEY `idx_login_streak_user_date` (`user_id`, `day_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
