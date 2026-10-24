-- Ediția Lite (etapa 2): indexurile unice parțiale (`... WHERE ...`, doar PostgreSQL) devin indexuri unice pe o coloană
-- generată care e NULL în afara condiției (NULL nu se ciocnește, deci regula rămâne aceeași; merge și pe MySQL).
-- Coloanele nu apar în schema Prisma: le scrie doar baza.

-- O singură notificare necitită pe grup (gruparea notificărilor).
DROP INDEX "notifications_unread_group";
ALTER TABLE "notifications" ADD COLUMN "unreadKey" TEXT GENERATED ALWAYS AS (CASE WHEN "readAt" IS NULL THEN "groupKey" END) STORED;
CREATE UNIQUE INDEX "notifications_unread_group" ON "notifications"("userId", "unreadKey");

-- Un singur abonament VIP activ pe membru.
DROP INDEX "vip_subscriptions_one_active_per_user";
ALTER TABLE "vip_subscriptions" ADD COLUMN "activeFlag" SMALLINT GENERATED ALWAYS AS (CASE WHEN "status" = 'ACTIVE' THEN 1 END) STORED;
CREATE UNIQUE INDEX "vip_subscriptions_one_active_per_user" ON "vip_subscriptions"("userId", "activeFlag");

-- Un singur lider pe clan.
DROP INDEX "clan_members_one_leader";
ALTER TABLE "clan_members" ADD COLUMN "leaderFlag" SMALLINT GENERATED ALWAYS AS (CASE WHEN "role" = 'LEADER' THEN 1 END) STORED;
CREATE UNIQUE INDEX "clan_members_one_leader" ON "clan_members"("clanId", "leaderFlag");

-- O singură cerere în așteptare pe clan, membru și tip.
DROP INDEX "clan_requests_one_pending";
ALTER TABLE "clan_requests" ADD COLUMN "pendingFlag" SMALLINT GENERATED ALWAYS AS (CASE WHEN "status" = 'PENDING' THEN 1 END) STORED;
CREATE UNIQUE INDEX "clan_requests_one_pending" ON "clan_requests"("clanId", "userId", "kind", "pendingFlag");

-- O singură sesiune deschisă pe server și jucător.
DROP INDEX "game_sessions_one_open";
ALTER TABLE "game_sessions" ADD COLUMN "openFlag" SMALLINT GENERATED ALWAYS AS (CASE WHEN "disconnectedAt" IS NULL THEN 1 END) STORED;
CREATE UNIQUE INDEX "game_sessions_one_open" ON "game_sessions"("serverId", "playerId", "openFlag");

-- O singură ștergere / unire activă pe membru.
DROP INDEX "member_removals_one_active";
ALTER TABLE "member_removals" ADD COLUMN "activeFlag" SMALLINT GENERATED ALWAYS AS (CASE WHEN "status" IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'FAILED') THEN 1 END) STORED;
CREATE UNIQUE INDEX "member_removals_one_active" ON "member_removals"("userId", "activeFlag");
