-- Mențiuni v2 (specul 2026-10-10-mentiuni-v2): sugestiile @mențiunilor caută membrii după prefixul numelui normalizat.
-- Un index cu colaționarea C servește atât `LIKE 'prefix%'` cât și ordonarea, oricare ar fi colaționarea bazei
-- (Prisma nu poate exprima colaționarea unei coloane de index). Setările de mențiune ale grupurilor stau în
-- `group_settings` (cheile `mentions.*`), fără tabele noi.
CREATE INDEX IF NOT EXISTS "users_nameNormalized_prefix_idx" ON "users" ("nameNormalized" COLLATE "C");
