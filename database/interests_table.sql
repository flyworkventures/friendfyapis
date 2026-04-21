-- İlgi alanları (çok dilli)
-- Diller: tr, en, de, fr, pt, it, zh, ja, ru, hi, ko

CREATE TABLE IF NOT EXISTS `interests` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL COMMENT 'Sabit anahtar (örn. hiking)',
  `emoji` VARCHAR(16) NOT NULL DEFAULT '',
  `sort_order` INT(11) NOT NULL DEFAULT 0,
  `interest_tr` VARCHAR(128) NOT NULL,
  `interest_en` VARCHAR(128) NOT NULL,
  `interest_de` VARCHAR(128) NOT NULL,
  `interest_fr` VARCHAR(128) NOT NULL,
  `interest_pt` VARCHAR(128) NOT NULL,
  `interest_it` VARCHAR(128) NOT NULL,
  `interest_zh` VARCHAR(128) NOT NULL,
  `interest_ja` VARCHAR(128) NOT NULL,
  `interest_ru` VARCHAR(128) NOT NULL,
  `interest_hi` VARCHAR(128) NOT NULL,
  `interest_ko` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_slug` (`slug`),
  KEY `idx_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Uygulama ilgi alanları (11 dil)';

INSERT INTO `interests` (`slug`, `emoji`, `sort_order`, `interest_tr`, `interest_en`, `interest_de`, `interest_fr`, `interest_pt`, `interest_it`, `interest_zh`, `interest_ja`, `interest_ru`, `interest_hi`, `interest_ko`) VALUES
('hiking', '🏔️', 1, 'Doğa yürüyüşü', 'Hiking', 'Wandern', 'Randonnée', 'Caminhadas', 'Escursionismo', '徒步', 'ハイキング', 'Походы', 'हाइकिंग', '하이킹'),
('photography', '📷', 2, 'Fotoğrafçılık', 'Photography', 'Fotografie', 'Photographie', 'Fotografia', 'Fotografia', '摄影', '写真', 'Фотография', 'फोटोग्राफी', '사진'),
('movies', '🍿', 3, 'Film', 'Movies', 'Filme', 'Cinéma', 'Filmes', 'Film', '电影', '映画', 'Кино', 'फ़िल्में', '영화'),
('travel', '✈️', 4, 'Seyahat', 'Travel', 'Reisen', 'Voyage', 'Viagens', 'Viaggi', '旅行', '旅行', 'Путешествия', 'यात्रा', '여행'),
('gaming', '🕹️', 5, 'Oyun', 'Gaming', 'Gaming', 'Jeux vidéo', 'Jogos', 'Giochi', '游戏', 'ゲーム', 'Игры', 'गेमिंग', '게임'),
('cooking', '🍳', 6, 'Yemek yapma', 'Cooking', 'Kochen', 'Cuisine', 'Culinária', 'Cucina', '烹饪', '料理', 'Кулинария', 'खाना बनाना', '요리'),
('yoga', '🧘', 7, 'Yoga', 'Yoga', 'Yoga', 'Yoga', 'Yoga', 'Yoga', '瑜伽', 'ヨガ', 'Йога', 'योग', '요가'),
('pets', '🐾', 8, 'Evcil hayvanlar', 'Pets', 'Haustiere', 'Animaux de compagnie', 'Animais de estimação', 'Animali domestici', '宠物', 'ペット', 'Питомцы', 'पालतू जानवर', '반려동물'),
('art', '🎭', 9, 'Sanat', 'Art', 'Kunst', 'Art', 'Arte', 'Arte', '艺术', 'アート', 'Искусство', 'कला', '예술'),
('music', '🎶', 10, 'Müzik', 'Music', 'Musik', 'Musique', 'Música', 'Musica', '音乐', '音楽', 'Музыка', 'संगीत', '음악'),
('painting', '🎨', 11, 'Resim', 'Painting', 'Malerei', 'Peinture', 'Pintura', 'Pittura', '绘画', '絵画', 'Живопись', 'चित्रकारी', '그림'),
('fitness', '💪', 12, 'Fitness', 'Fitness', 'Fitness', 'Fitness', 'Fitness', 'Fitness', '健身', 'フィットネス', 'Фитнес', 'फिटनेस', '피트니스'),
('reading', '📚', 13, 'Okuma', 'Reading', 'Lesen', 'Lecture', 'Leitura', 'Lettura', '阅读', '読書', 'Чтение', 'पढ़ना', '독서')
ON DUPLICATE KEY UPDATE
  `emoji` = VALUES(`emoji`),
  `sort_order` = VALUES(`sort_order`),
  `interest_tr` = VALUES(`interest_tr`),
  `interest_en` = VALUES(`interest_en`),
  `interest_de` = VALUES(`interest_de`),
  `interest_fr` = VALUES(`interest_fr`),
  `interest_pt` = VALUES(`interest_pt`),
  `interest_it` = VALUES(`interest_it`),
  `interest_zh` = VALUES(`interest_zh`),
  `interest_ja` = VALUES(`interest_ja`),
  `interest_ru` = VALUES(`interest_ru`),
  `interest_hi` = VALUES(`interest_hi`),
  `interest_ko` = VALUES(`interest_ko`);
