-- Insignele grafice ale badge-urilor (specul 2026-10-07-insigne-grafice): forma, nivelul (metalul) și iconița.
-- Badge-urile implicite primesc grafica din seed (doar unde coloanele sunt goale). Culorile implicite ale badge-urilor
-- de postări și de vechime devin culorile categoriilor lor (doar dacă adminul nu le-a schimbat între timp).

-- AlterTable
ALTER TABLE "badges" ADD COLUMN "artShape" TEXT,
ADD COLUMN "artTier" TEXT,
ADD COLUMN "artIcon" TEXT;

-- Grafica badge-urilor implicite (aceeași ca în `DEFAULT_BADGES`).
UPDATE "badges" AS b
SET "artShape" = v.shape, "artTier" = v.tier, "artIcon" = v.icon
FROM (VALUES
    ('first_post', 'medal', 'bronze', 'fa-solid fa-pen-nib'),
    ('posts_100', 'medal', 'silver', 'fa-solid fa-comments'),
    ('posts_1000', 'medal', 'gold', 'fa-solid fa-fire'),
    ('member_1y', 'shield', 'silver', 'fa-solid fa-cake-candles'),
    ('member_3y', 'shield', 'gold', 'fa-solid fa-chess-rook'),
    ('reputation_100', 'hexagon', 'silver', 'fa-solid fa-thumbs-up'),
    ('top_helper', 'hexagon', 'gold', 'fa-solid fa-handshake-angle'),
    ('vip', 'diamond', 'platinum', 'fa-solid fa-gem'),
    ('tournament_champion', 'rosette', 'gold', 'fa-solid fa-trophy'),
    ('rp_veteran', 'star', 'custom', 'fa-solid fa-masks-theater')
) AS v(key, shape, tier, icon)
WHERE b."key" = v.key AND b."artShape" IS NULL AND b."artTier" IS NULL AND b."artIcon" IS NULL;

-- Culorile categoriilor: activitate (albastru) și vechime (turcoaz).
UPDATE "badges" SET "color" = '#5EA2FF' WHERE "key" IN ('posts_100', 'posts_1000') AND "color" = '#F4B740';
UPDATE "badges" SET "color" = '#26C6DA' WHERE "key" IN ('member_1y', 'member_3y') AND "color" = '#5EA2FF';
