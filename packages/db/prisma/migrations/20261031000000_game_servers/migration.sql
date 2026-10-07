-- Aplicația Servere (specul 2026-10-07-servere): serverele de joc, adminii lor și istoricul interogărilor
-- (rânduri brute, agregate pe oră după 7 zile).
-- CreateTable
CREATE TABLE "game_servers" (
    "id" SERIAL NOT NULL,
    "game" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "queryPort" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "bannerId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "forumId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "groups" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_server_admins" (
    "serverId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "game_server_admins_pkey" PRIMARY KEY ("serverId","userId")
);

-- CreateTable
CREATE TABLE "server_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "serverId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hourly" BOOLEAN NOT NULL DEFAULT false,
    "online" BOOLEAN NOT NULL,
    "players" INTEGER NOT NULL DEFAULT 0,
    "peak" INTEGER NOT NULL DEFAULT 0,
    "maxPlayers" INTEGER NOT NULL DEFAULT 0,
    "map" TEXT,
    "ping" INTEGER,
    "samples" INTEGER NOT NULL DEFAULT 1,
    "onlineSamples" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "server_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_servers_enabled_position_idx" ON "game_servers"("enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "game_servers_game_host_port_key" ON "game_servers"("game", "host", "port");

-- CreateIndex
CREATE INDEX "game_server_admins_userId_idx" ON "game_server_admins"("userId");

-- CreateIndex
CREATE INDEX "server_snapshots_serverId_at_idx" ON "server_snapshots"("serverId", "at");

-- CreateIndex
CREATE INDEX "server_snapshots_hourly_at_idx" ON "server_snapshots"("hourly", "at");

-- AddForeignKey
ALTER TABLE "game_servers" ADD CONSTRAINT "game_servers_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_server_admins" ADD CONSTRAINT "game_server_admins_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_server_admins" ADD CONSTRAINT "game_server_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_snapshots" ADD CONSTRAINT "server_snapshots_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

