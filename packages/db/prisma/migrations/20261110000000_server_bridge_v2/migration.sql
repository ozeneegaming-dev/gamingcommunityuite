-- Pluginurile serverelor v2 (specul 2026-10-08-servere-plugin-v2): modulele opționale pe fiecare server (implicit oprite:
-- pluginul doar colectează date), flag-urile de admin raportate de servere în sesiuni (prezența adminilor) și înrolările
-- automate ale serverelor necunoscute (aprobate în ACP).

-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN     "manageAdmins" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enforceSanctions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manageVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mixReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "adminCommands" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "game_sessions" ADD COLUMN     "adminFlags" TEXT;

-- CreateEnum
CREATE TYPE "GameEnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "game_server_enrollments" (
    "id" SERIAL NOT NULL,
    "ref" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "hostname" TEXT NOT NULL DEFAULT '',
    "map" TEXT,
    "players" INTEGER NOT NULL DEFAULT 0,
    "maxPlayers" INTEGER NOT NULL DEFAULT 0,
    "plugin" TEXT NOT NULL DEFAULT '',
    "status" "GameEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "check" JSONB,
    "checkedAt" TIMESTAMP(3),
    "serverId" INTEGER,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "keyId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_server_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_server_enrollments_ref_key" ON "game_server_enrollments"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "game_server_enrollments_secretHash_key" ON "game_server_enrollments"("secretHash");

-- CreateIndex
CREATE INDEX "game_server_enrollments_status_expiresAt_idx" ON "game_server_enrollments"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "game_server_enrollments_ip_idx" ON "game_server_enrollments"("ip");

-- AddForeignKey
ALTER TABLE "game_server_enrollments" ADD CONSTRAINT "game_server_enrollments_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "game_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
