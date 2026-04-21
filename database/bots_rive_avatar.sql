-- Bots table: rive avatar link alanı
-- Bu alanda .riv veya asset linki tutulur

ALTER TABLE `bots`
  ADD COLUMN IF NOT EXISTS `rive_avatar` VARCHAR(512) DEFAULT NULL AFTER `photoURL`;
