-- Reports Table
-- Bu tablo kullanıcıların sohbetler hakkında yaptığı bildirimleri saklar

CREATE TABLE IF NOT EXISTS `reports` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `userId` INT(11) NOT NULL,
  `conversationId` INT(11) NOT NULL,
  `botId` INT(11) DEFAULT NULL,
  `reason` VARCHAR(100) NOT NULL COMMENT 'Bildirim nedeni: inappropriate_content, harassment, spam, violence, hate_speech, other',
  `description` TEXT NOT NULL COMMENT 'Kullanıcının detaylı açıklaması',
  `status` ENUM('pending', 'reviewed', 'resolved', 'rejected') DEFAULT 'pending' COMMENT 'Bildirimin durumu',
  `admin_notes` TEXT DEFAULT NULL COMMENT 'Admin notları',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_userId` (`userId`),
  KEY `idx_conversationId` (`conversationId`),
  KEY `idx_botId` (`botId`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Kullanıcı bildirim kayıtları';

-- Index açıklamaları:
-- idx_userId: Belirli bir kullanıcının yaptığı tüm bildirimleri hızlı sorgulamak için
-- idx_conversationId: Belirli bir sohbet hakkındaki bildirimleri sorgulamak için
-- idx_botId: Belirli bir bot hakkındaki bildirimleri sorgulamak için
-- idx_status: Bekleyen, incelenmiş bildirimleri filtrelemek için
-- idx_created_at: Tarihe göre sıralama ve filtreleme için

-- Örnek veri ekleme:
-- INSERT INTO `reports` (`userId`, `conversationId`, `botId`, `reason`, `description`, `status`) 
-- VALUES (1, 5, 3, 'inappropriate_content', 'Bot uygunsuz içerik paylaştı', 'pending');

