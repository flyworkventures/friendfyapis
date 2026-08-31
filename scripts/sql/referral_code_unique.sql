-- Her referans kodu yalnızca bir kez redeem edilebilir.
-- Uygulama: node scripts/apply_referral_code_unique.js

ALTER TABLE `referral_code_redemptions`
  ADD UNIQUE KEY `uq_referral_code` (`code`);
