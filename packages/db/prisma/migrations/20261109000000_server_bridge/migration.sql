-- Puntea cu serverele de joc (specul 2026-10-08-servere-bridge, partea A): cheile serverelor, identitățile de joc,
-- codurile de legare, sesiunile, statisticile, adminii și presetările, sancțiunile (bannuri, mute, gag) cu revizia de
-- sincronizare, jurnalul din joc, VIP-ul pe servere, meciurile mix și ELO-ul, contestațiile / reclamațiile și hărțile.

-- Revizia sancțiunilor: crește la orice schimbare (sincronizarea incrementală a pluginurilor, GET /sanctions?since=N).
CREATE SEQUENCE "game_sync_revision";

-- CreateEnum
CREATE TYPE "GamePlayerKind" AS ENUM ('STEAM', 'NONSTEAM', 'NAME');

-- CreateEnum
CREATE TYPE "GameTrust" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "GameLinkSource" AS ENUM ('STEAM', 'CODE', 'STAFF');

-- CreateEnum
CREATE TYPE "GameAdminSubject" AS ENUM ('USER', 'PLAYER', 'NAME');

-- CreateEnum
CREATE TYPE "GameSanctionType" AS ENUM ('BAN', 'MUTE', 'GAG');

-- CreateEnum
CREATE TYPE "GameSanctionScope" AS ENUM ('SERVER', 'GLOBAL');

-- CreateEnum
CREATE TYPE "GameSanctionSource" AS ENUM ('SITE', 'GAME');

-- CreateEnum
CREATE TYPE "GameMatchStatus" AS ENUM ('WARMUP', 'LIVE', 'HALFTIME', 'ENDED', 'ABORTED');

-- CreateEnum
CREATE TYPE "GameTicketKind" AS ENUM ('APPEAL', 'CHEATER', 'ADMIN');

-- CreateEnum
CREATE TYPE "GameTicketStatus" AS ENUM ('OPEN', 'REVIEW', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GameTicketMessageKind" AS ENUM ('MESSAGE', 'STATUS', 'ASSIGN');

-- CreateEnum
CREATE TYPE "GameMapSource" AS ENUM ('UPLOAD', 'TEMPLATE');

-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "bridgePlugin" TEXT,
ADD COLUMN     "bridgeSeenAt" TIMESTAMP(3),
ADD COLUMN     "identityMode" TEXT NOT NULL DEFAULT 'mixed',
ADD COLUMN     "isMix" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameIds" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "game_server_keys" (
    "id" SERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "keyId" TEXT NOT NULL,
    "signingKey" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "game_server_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" SERIAL NOT NULL,
    "kind" "GamePlayerKind" NOT NULL,
    "value" TEXT NOT NULL,
    "trust" "GameTrust" NOT NULL,
    "userId" TEXT,
    "linkSource" "GameLinkSource",
    "linkedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastServerId" INTEGER,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_link_codes" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "playerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" BIGSERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "adminId" INTEGER,
    "name" TEXT NOT NULL DEFAULT '',
    "ip" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_player_stats" (
    "playerId" INTEGER NOT NULL,
    "serverId" INTEGER NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "teamkills" INTEGER NOT NULL DEFAULT 0,
    "suicides" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "playtime" INTEGER NOT NULL DEFAULT 0,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "roundsWon" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_player_stats_pkey" PRIMARY KEY ("playerId","serverId")
);

-- CreateTable
CREATE TABLE "game_weapon_stats" (
    "playerId" INTEGER NOT NULL,
    "serverId" INTEGER NOT NULL,
    "weapon" TEXT NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "game_weapon_stats_pkey" PRIMARY KEY ("playerId","serverId","weapon")
);

-- CreateTable
CREATE TABLE "game_map_stats" (
    "playerId" INTEGER NOT NULL,
    "serverId" INTEGER NOT NULL,
    "map" TEXT NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "playtime" INTEGER NOT NULL DEFAULT 0,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "roundsWon" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "game_map_stats_pkey" PRIMARY KEY ("playerId","serverId","map")
);

-- CreateTable
CREATE TABLE "game_bridge_events" (
    "serverId" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_bridge_events_pkey" PRIMARY KEY ("serverId","eventId")
);

-- CreateTable
CREATE TABLE "game_admin_presets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "flags" TEXT NOT NULL,
    "immunity" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "game_admin_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_admins" (
    "id" SERIAL NOT NULL,
    "subject" "GameAdminSubject" NOT NULL,
    "userId" TEXT,
    "playerId" INTEGER,
    "name" TEXT,
    "nameNormalized" TEXT,
    "passwordSalt" TEXT,
    "passwordVerifier" TEXT,
    "serverId" INTEGER,
    "presetId" INTEGER,
    "flags" TEXT,
    "immunity" INTEGER,
    "allowNonSteam" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "expiredLoggedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sanctions" (
    "id" SERIAL NOT NULL,
    "type" "GameSanctionType" NOT NULL,
    "scope" "GameSanctionScope" NOT NULL,
    "serverId" INTEGER,
    "playerId" INTEGER,
    "targetKind" "GamePlayerKind",
    "targetValue" TEXT,
    "ip" TEXT,
    "name" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "adminUserId" TEXT,
    "adminPlayerId" INTEGER,
    "adminName" TEXT NOT NULL DEFAULT '',
    "source" "GameSanctionSource" NOT NULL,
    "unbannedAt" TIMESTAMP(3),
    "unbannedById" TEXT,
    "unbannedByName" TEXT,
    "unbanReason" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "revision" BIGINT NOT NULL DEFAULT nextval('game_sync_revision'::regclass),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_admin_actions" (
    "id" SERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "adminPlayerId" INTEGER,
    "adminUserId" TEXT,
    "adminId" INTEGER,
    "adminName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "targetPlayerId" INTEGER,
    "targetName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "details" JSONB,
    "sanctionId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_vip_mappings" (
    "id" SERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "flags" TEXT NOT NULL DEFAULT 'b',

    CONSTRAINT "game_vip_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_matches" (
    "id" SERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "map" TEXT NOT NULL DEFAULT '',
    "status" "GameMatchStatus" NOT NULL DEFAULT 'WARMUP',
    "teamAName" TEXT NOT NULL DEFAULT '',
    "teamBName" TEXT NOT NULL DEFAULT '',
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_match_players" (
    "matchId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "team" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "mvps" INTEGER NOT NULL DEFAULT 0,
    "eloBefore" INTEGER,
    "eloAfter" INTEGER,

    CONSTRAINT "game_match_players_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateTable
CREATE TABLE "game_match_rounds" (
    "matchId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "winner" TEXT NOT NULL,
    "scoreA" INTEGER NOT NULL,
    "scoreB" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_match_rounds_pkey" PRIMARY KEY ("matchId","number")
);

-- CreateTable
CREATE TABLE "game_ratings" (
    "playerId" INTEGER NOT NULL,
    "elo" INTEGER NOT NULL,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "peak" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_ratings_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "game_tickets" (
    "id" SERIAL NOT NULL,
    "kind" "GameTicketKind" NOT NULL,
    "status" "GameTicketStatus" NOT NULL DEFAULT 'OPEN',
    "authorId" TEXT NOT NULL,
    "serverId" INTEGER,
    "sanctionId" INTEGER,
    "targetPlayerId" INTEGER,
    "targetUserId" TEXT,
    "targetAdminId" INTEGER,
    "targetName" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "game_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_ticket_messages" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" TEXT,
    "kind" "GameTicketMessageKind" NOT NULL DEFAULT 'MESSAGE',
    "contentJson" JSONB,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_maps" (
    "id" SERIAL NOT NULL,
    "game" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageId" TEXT,
    "source" "GameMapSource",
    "fetchedAt" TIMESTAMP(3),
    "fetchError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextFetchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_server_keys_keyId_key" ON "game_server_keys"("keyId");

-- CreateIndex
CREATE INDEX "game_server_keys_serverId_idx" ON "game_server_keys"("serverId");

-- CreateIndex
CREATE INDEX "game_players_userId_idx" ON "game_players"("userId");

-- CreateIndex
CREATE INDEX "game_players_lastSeenAt_idx" ON "game_players"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_kind_value_key" ON "game_players"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "game_link_codes_codeHash_key" ON "game_link_codes"("codeHash");

-- CreateIndex
CREATE INDEX "game_link_codes_userId_createdAt_idx" ON "game_link_codes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "game_sessions_serverId_disconnectedAt_idx" ON "game_sessions"("serverId", "disconnectedAt");

-- CreateIndex
CREATE INDEX "game_sessions_playerId_connectedAt_idx" ON "game_sessions"("playerId", "connectedAt");

-- CreateIndex
CREATE INDEX "game_sessions_adminId_connectedAt_idx" ON "game_sessions"("adminId", "connectedAt");

-- CreateIndex
CREATE INDEX "game_player_stats_serverId_rank_idx" ON "game_player_stats"("serverId", "rank");

-- CreateIndex
CREATE INDEX "game_bridge_events_createdAt_idx" ON "game_bridge_events"("createdAt");

-- CreateIndex
CREATE INDEX "game_admins_userId_idx" ON "game_admins"("userId");

-- CreateIndex
CREATE INDEX "game_admins_playerId_idx" ON "game_admins"("playerId");

-- CreateIndex
CREATE INDEX "game_admins_serverId_idx" ON "game_admins"("serverId");

-- CreateIndex
CREATE INDEX "game_admins_nameNormalized_idx" ON "game_admins"("nameNormalized");

-- CreateIndex
CREATE INDEX "game_sanctions_revision_idx" ON "game_sanctions"("revision");

-- CreateIndex
CREATE INDEX "game_sanctions_playerId_idx" ON "game_sanctions"("playerId");

-- CreateIndex
CREATE INDEX "game_sanctions_targetKind_targetValue_idx" ON "game_sanctions"("targetKind", "targetValue");

-- CreateIndex
CREATE INDEX "game_sanctions_ip_idx" ON "game_sanctions"("ip");

-- CreateIndex
CREATE INDEX "game_sanctions_type_expiresAt_idx" ON "game_sanctions"("type", "expiresAt");

-- CreateIndex
CREATE INDEX "game_admin_actions_serverId_at_idx" ON "game_admin_actions"("serverId", "at");

-- CreateIndex
CREATE INDEX "game_admin_actions_adminId_at_idx" ON "game_admin_actions"("adminId", "at");

-- CreateIndex
CREATE INDEX "game_admin_actions_adminUserId_at_idx" ON "game_admin_actions"("adminUserId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "game_vip_mappings_serverId_groupId_key" ON "game_vip_mappings"("serverId", "groupId");

-- CreateIndex
CREATE INDEX "game_matches_serverId_startedAt_idx" ON "game_matches"("serverId", "startedAt");

-- CreateIndex
CREATE INDEX "game_matches_status_endedAt_idx" ON "game_matches"("status", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_matches_serverId_externalId_key" ON "game_matches"("serverId", "externalId");

-- CreateIndex
CREATE INDEX "game_match_players_playerId_idx" ON "game_match_players"("playerId");

-- CreateIndex
CREATE INDEX "game_ratings_elo_idx" ON "game_ratings"("elo");

-- CreateIndex
CREATE INDEX "game_tickets_status_lastActivityAt_idx" ON "game_tickets"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "game_tickets_authorId_kind_status_idx" ON "game_tickets"("authorId", "kind", "status");

-- CreateIndex
CREATE INDEX "game_tickets_sanctionId_idx" ON "game_tickets"("sanctionId");

-- CreateIndex
CREATE INDEX "game_tickets_serverId_status_idx" ON "game_tickets"("serverId", "status");

-- CreateIndex
CREATE INDEX "game_ticket_messages_ticketId_createdAt_idx" ON "game_ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "game_maps_imageId_nextFetchAt_idx" ON "game_maps"("imageId", "nextFetchAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_maps_game_name_key" ON "game_maps"("game", "name");

-- AddForeignKey
ALTER TABLE "game_server_keys" ADD CONSTRAINT "game_server_keys_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_lastServerId_fkey" FOREIGN KEY ("lastServerId") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_link_codes" ADD CONSTRAINT "game_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_link_codes" ADD CONSTRAINT "game_link_codes_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "game_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_player_stats" ADD CONSTRAINT "game_player_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_player_stats" ADD CONSTRAINT "game_player_stats_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_weapon_stats" ADD CONSTRAINT "game_weapon_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_map_stats" ADD CONSTRAINT "game_map_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_admins" ADD CONSTRAINT "game_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_admins" ADD CONSTRAINT "game_admins_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_admins" ADD CONSTRAINT "game_admins_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_admins" ADD CONSTRAINT "game_admins_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "game_admin_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sanctions" ADD CONSTRAINT "game_sanctions_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sanctions" ADD CONSTRAINT "game_sanctions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_admin_actions" ADD CONSTRAINT "game_admin_actions_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_vip_mappings" ADD CONSTRAINT "game_vip_mappings_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_vip_mappings" ADD CONSTRAINT "game_vip_mappings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_matches" ADD CONSTRAINT "game_matches_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_players" ADD CONSTRAINT "game_match_players_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_players" ADD CONSTRAINT "game_match_players_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_rounds" ADD CONSTRAINT "game_match_rounds_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ratings" ADD CONSTRAINT "game_ratings_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_tickets" ADD CONSTRAINT "game_tickets_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_tickets" ADD CONSTRAINT "game_tickets_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_tickets" ADD CONSTRAINT "game_tickets_sanctionId_fkey" FOREIGN KEY ("sanctionId") REFERENCES "game_sanctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_ticket_messages" ADD CONSTRAINT "game_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "game_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O singură sesiune deschisă pe (server, jucător): heartbeat-ul și evenimentul connect pot sosi în același timp.
CREATE UNIQUE INDEX "game_sessions_one_open" ON "game_sessions"("serverId", "playerId") WHERE "disconnectedAt" IS NULL;
