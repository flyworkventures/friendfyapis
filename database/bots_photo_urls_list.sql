-- Bots profile foto alanını liste formatına geçirir (JSON string)
-- photoURL kolonu korunur, içinde JSON dizi saklanır.

UPDATE `bots`
SET `photoURL` = JSON_ARRAY(`photoURL`)
WHERE `photoURL` IS NOT NULL
  AND TRIM(`photoURL`) <> ''
  AND LEFT(TRIM(`photoURL`), 1) <> '[';
