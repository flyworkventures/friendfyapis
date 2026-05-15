-- Mevcut bot_catalog_overrides tablosuna Rive URL (görüntülü konuşma).
ALTER TABLE `bot_catalog_overrides`
  ADD COLUMN `rive_avatar` VARCHAR(2048) NULL DEFAULT NULL COMMENT '.riv CDN URL' AFTER `country`;
