-- Bots table: çok dilli meslek alanları
-- Desteklenen diller:
-- tr, en, it, de, ja, fr, es, ko, hi, pt
-- Not: Japonca/Korece'nin ???? görünmemesi için utf8mb4 zorunludur.

SET NAMES utf8mb4;

-- Tabloyu utf8mb4'e çevir (mevcut latin1 kaynaklı bozulmaları önler)
ALTER TABLE `bots`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Kolonları güvenli ekle (dosya tekrar çalıştırılırsa hata vermez)
ALTER TABLE `bots`
  ADD COLUMN IF NOT EXISTS `job_tr` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `interestsType`,
  ADD COLUMN IF NOT EXISTS `job_en` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_tr`,
  ADD COLUMN IF NOT EXISTS `job_it` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_en`,
  ADD COLUMN IF NOT EXISTS `job_de` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_it`,
  ADD COLUMN IF NOT EXISTS `job_ja` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_de`,
  ADD COLUMN IF NOT EXISTS `job_fr` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_ja`,
  ADD COLUMN IF NOT EXISTS `job_es` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_fr`,
  ADD COLUMN IF NOT EXISTS `job_ko` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_es`,
  ADD COLUMN IF NOT EXISTS `job_hi` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_ko`,
  ADD COLUMN IF NOT EXISTS `job_pt` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `job_hi`;

-- Her bota farklı meslek ata (id mod 10 ile dağıtım)
UPDATE `bots`
SET
  `job_tr` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Yazılım Mühendisi'
    WHEN 1 THEN 'Grafik Tasarımcı'
    WHEN 2 THEN 'Müzik Prodüktörü'
    WHEN 3 THEN 'Seyahat Danışmanı'
    WHEN 4 THEN 'Fitness Koçu'
    WHEN 5 THEN 'Fotoğrafçı'
    WHEN 6 THEN 'Aşçı'
    WHEN 7 THEN 'Oyun Geliştirici'
    WHEN 8 THEN 'Psikolojik Danışman'
    ELSE 'İçerik Üreticisi'
  END,
  `job_en` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Software Engineer'
    WHEN 1 THEN 'Graphic Designer'
    WHEN 2 THEN 'Music Producer'
    WHEN 3 THEN 'Travel Consultant'
    WHEN 4 THEN 'Fitness Coach'
    WHEN 5 THEN 'Photographer'
    WHEN 6 THEN 'Chef'
    WHEN 7 THEN 'Game Developer'
    WHEN 8 THEN 'Counselor'
    ELSE 'Content Creator'
  END,
  `job_it` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Ingegnere Software'
    WHEN 1 THEN 'Grafico'
    WHEN 2 THEN 'Produttore Musicale'
    WHEN 3 THEN 'Consulente di Viaggio'
    WHEN 4 THEN 'Coach Fitness'
    WHEN 5 THEN 'Fotografo'
    WHEN 6 THEN 'Chef'
    WHEN 7 THEN 'Sviluppatore di Giochi'
    WHEN 8 THEN 'Consulente Psicologico'
    ELSE 'Creatore di Contenuti'
  END,
  `job_de` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Softwareentwickler'
    WHEN 1 THEN 'Grafikdesigner'
    WHEN 2 THEN 'Musikproduzent'
    WHEN 3 THEN 'Reiseberater'
    WHEN 4 THEN 'Fitnesscoach'
    WHEN 5 THEN 'Fotograf'
    WHEN 6 THEN 'Koch'
    WHEN 7 THEN 'Spieleentwickler'
    WHEN 8 THEN 'Psychologischer Berater'
    ELSE 'Content Creator'
  END,
  `job_ja` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'ソフトウェアエンジニア'
    WHEN 1 THEN 'グラフィックデザイナー'
    WHEN 2 THEN '音楽プロデューサー'
    WHEN 3 THEN '旅行コンサルタント'
    WHEN 4 THEN 'フィットネスコーチ'
    WHEN 5 THEN '写真家'
    WHEN 6 THEN 'シェフ'
    WHEN 7 THEN 'ゲーム開発者'
    WHEN 8 THEN '心理カウンセラー'
    ELSE 'コンテンツクリエイター'
  END,
  `job_fr` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Ingénieur Logiciel'
    WHEN 1 THEN 'Designer Graphique'
    WHEN 2 THEN 'Producteur de Musique'
    WHEN 3 THEN 'Conseiller en Voyage'
    WHEN 4 THEN 'Coach Fitness'
    WHEN 5 THEN 'Photographe'
    WHEN 6 THEN 'Chef Cuisinier'
    WHEN 7 THEN 'Développeur de Jeux'
    WHEN 8 THEN 'Conseiller Psychologique'
    ELSE 'Créateur de Contenu'
  END,
  `job_es` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Ingeniero de Software'
    WHEN 1 THEN 'Diseñador Gráfico'
    WHEN 2 THEN 'Productor Musical'
    WHEN 3 THEN 'Consultor de Viajes'
    WHEN 4 THEN 'Entrenador de Fitness'
    WHEN 5 THEN 'Fotógrafo'
    WHEN 6 THEN 'Chef'
    WHEN 7 THEN 'Desarrollador de Juegos'
    WHEN 8 THEN 'Consejero Psicológico'
    ELSE 'Creador de Contenido'
  END,
  `job_ko` = CASE MOD(`id`, 10)
    WHEN 0 THEN '소프트웨어 엔지니어'
    WHEN 1 THEN '그래픽 디자이너'
    WHEN 2 THEN '음악 프로듀서'
    WHEN 3 THEN '여행 컨설턴트'
    WHEN 4 THEN '피트니스 코치'
    WHEN 5 THEN '사진작가'
    WHEN 6 THEN '셰프'
    WHEN 7 THEN '게임 개발자'
    WHEN 8 THEN '심리 상담사'
    ELSE '콘텐츠 크리에이터'
  END,
  `job_hi` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'सॉफ्टवेयर इंजीनियर'
    WHEN 1 THEN 'ग्राफिक डिज़ाइनर'
    WHEN 2 THEN 'म्यूजिक प्रोड्यूसर'
    WHEN 3 THEN 'ट्रैवल कंसल्टेंट'
    WHEN 4 THEN 'फिटनेस कोच'
    WHEN 5 THEN 'फोटोग्राफर'
    WHEN 6 THEN 'शेफ'
    WHEN 7 THEN 'गेम डेवलपर'
    WHEN 8 THEN 'मनोवैज्ञानिक सलाहकार'
    ELSE 'कॉन्टेंट क्रिएटर'
  END,
  `job_pt` = CASE MOD(`id`, 10)
    WHEN 0 THEN 'Engenheiro de Software'
    WHEN 1 THEN 'Designer Gráfico'
    WHEN 2 THEN 'Produtor Musical'
    WHEN 3 THEN 'Consultor de Viagens'
    WHEN 4 THEN 'Treinador de Fitness'
    WHEN 5 THEN 'Fotógrafo'
    WHEN 6 THEN 'Chef'
    WHEN 7 THEN 'Desenvolvedor de Jogos'
    WHEN 8 THEN 'Conselheiro Psicológico'
    ELSE 'Criador de Conteúdo'
  END
WHERE 1;
