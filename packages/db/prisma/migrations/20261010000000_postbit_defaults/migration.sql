-- Etapa 5, actualizare: câmpurile implicite de profil primesc iconițele și afișarea în postbit și pe site-urile
-- instalate înainte de etapa 5 (doar acolo unde adminul nu a ales deja o iconiță).
UPDATE "profile_fields" SET "icon" = 'fa-solid fa-flag', "showInPostbit" = true WHERE "key" = 'country' AND "icon" IS NULL;
UPDATE "profile_fields" SET "icon" = 'fa-solid fa-gamepad', "showInPostbit" = true WHERE "key" = 'platform' AND "icon" IS NULL;
UPDATE "profile_fields" SET "icon" = 'fa-brands fa-twitch' WHERE "key" = 'twitch' AND "icon" IS NULL;
UPDATE "profile_fields" SET "icon" = 'fa-solid fa-ranking-star', "showInPostbit" = true WHERE "key" = 'rank_cs2' AND "icon" IS NULL;
UPDATE "profile_fields" SET "icon" = 'fa-solid fa-server' WHERE "key" = 'server' AND "icon" IS NULL;
