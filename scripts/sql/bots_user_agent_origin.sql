-- "Oluşturduklarım": yalnızca create-custom-agent (Arkadaş oluştur) kayıtları.
-- Eski akışta katalogdan kopyalanan system=0 hayaletler catalog_fork ile listeden çıkarılabilir.

ALTER TABLE `bots`
  ADD COLUMN `user_agent_origin` ENUM('friend_create', 'catalog_fork') NOT NULL DEFAULT 'friend_create'
  COMMENT 'friend_create=create-custom-agent; catalog_fork=eski katalog kopyası vb.'
  AFTER `system`;
