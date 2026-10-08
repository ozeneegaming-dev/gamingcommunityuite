-- HLTV / GOTV la meciurile mix (specul 2026-10-08-servere-hltv): setările pe server (adresa de vizionare, sursa
-- demo-urilor cu secretele sigilate, înregistrarea opțională) și demo-urile meciurilor (stocate privat, cu retenție).

-- CreateEnum
CREATE TYPE "GameDemoStatus" AS ENUM ('WAITING', 'FETCHING', 'AVAILABLE', 'NOT_FOUND', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "game_server_tv" (
    "serverId" INTEGER NOT NULL,
    "address" TEXT,
    "delay" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'none',
    "host" TEXT,
    "port" INTEGER,
    "username" TEXT,
    "secret" TEXT,
    "privateKey" TEXT,
    "remoteDir" TEXT NOT NULL DEFAULT '/',
    "tlsInsecure" BOOLEAN NOT NULL DEFAULT false,
    "hostKey" TEXT,
    "httpTemplate" TEXT,
    "namePrefix" TEXT NOT NULL DEFAULT '',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "record" BOOLEAN NOT NULL DEFAULT false,
    "rconPassword" TEXT,
    "lastFetchAt" TIMESTAMP(3),
    "lastFetchOk" BOOLEAN,
    "lastFetchCode" TEXT,
    "lastFetchInfo" JSONB,
    "lastRcon" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_server_tv_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "game_match_demos" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER,
    "serverId" INTEGER,
    "part" INTEGER NOT NULL DEFAULT 1,
    "status" "GameDemoStatus" NOT NULL DEFAULT 'WAITING',
    "source" TEXT NOT NULL,
    "remoteName" TEXT,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "encoding" TEXT NOT NULL DEFAULT 'identity',
    "size" INTEGER,
    "storedSize" INTEGER,
    "sha256" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "chunkSize" INTEGER,
    "received" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "game_match_demos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_match_demos_status_nextAttemptAt_idx" ON "game_match_demos"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "game_match_demos_status_availableAt_idx" ON "game_match_demos"("status", "availableAt");

-- CreateIndex
CREATE INDEX "game_match_demos_serverId_createdAt_idx" ON "game_match_demos"("serverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_match_demos_matchId_part_key" ON "game_match_demos"("matchId", "part");

-- AddForeignKey
ALTER TABLE "game_server_tv" ADD CONSTRAINT "game_server_tv_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_demos" ADD CONSTRAINT "game_match_demos_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "game_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_match_demos" ADD CONSTRAINT "game_match_demos_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
