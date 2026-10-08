-- Aplicația Clanuri (specul 2026-10-08-clanuri): clanurile, membrii lor (cu rolul) și cererile / invitațiile.
-- Forumul privat e un rând din `forums` legat prin `clans.forumId`; drepturile pe el vin din apartenență.
-- CreateEnum
CREATE TYPE "ClanStatus" AS ENUM ('PENDING', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClanRole" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ClanJoinMode" AS ENUM ('OPEN', 'REQUEST', 'INVITE');

-- CreateEnum
CREATE TYPE "ClanRequestKind" AS ENUM ('REQUEST', 'INVITE');

-- CreateEnum
CREATE TYPE "ClanRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "clans" (
    "id" SERIAL NOT NULL,
    "tag" TEXT NOT NULL,
    "tagNormalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ClanStatus" NOT NULL DEFAULT 'PENDING',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT,
    "joinMode" "ClanJoinMode" NOT NULL DEFAULT 'REQUEST',
    "descriptionJson" JSONB,
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "logoId" TEXT,
    "bannerId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#D62839',
    "color2" TEXT NOT NULL DEFAULT '#1B1E26',
    "links" JSONB NOT NULL DEFAULT '{}',
    "officerRights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memberLimit" INTEGER,
    "membersCount" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "scoreParts" JSONB NOT NULL DEFAULT '{}',
    "scoredAt" TIMESTAMP(3),
    "forumId" INTEGER,
    "forumRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clan_members" (
    "clanId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClanRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clan_members_pkey" PRIMARY KEY ("clanId","userId")
);

-- CreateTable
CREATE TABLE "clan_requests" (
    "id" SERIAL NOT NULL,
    "clanId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ClanRequestKind" NOT NULL,
    "status" "ClanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL DEFAULT '',
    "invitedById" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "clan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clans_tagNormalized_key" ON "clans"("tagNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "clans_nameNormalized_key" ON "clans"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "clans_forumId_key" ON "clans"("forumId");

-- CreateIndex
CREATE INDEX "clans_status_rank_idx" ON "clans"("status", "rank");

-- CreateIndex
CREATE INDEX "clans_status_membersCount_idx" ON "clans"("status", "membersCount");

-- CreateIndex
CREATE INDEX "clans_status_createdAt_idx" ON "clans"("status", "createdAt");

-- CreateIndex
CREATE INDEX "clan_members_userId_idx" ON "clan_members"("userId");

-- CreateIndex
CREATE INDEX "clan_requests_clanId_status_idx" ON "clan_requests"("clanId", "status");

-- CreateIndex
CREATE INDEX "clan_requests_userId_status_idx" ON "clan_requests"("userId", "status");

-- AddForeignKey
ALTER TABLE "clans" ADD CONSTRAINT "clans_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clans" ADD CONSTRAINT "clans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "clans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_requests" ADD CONSTRAINT "clan_requests_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "clans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_requests" ADD CONSTRAINT "clan_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_requests" ADD CONSTRAINT "clan_requests_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un singur lider pe clan.
CREATE UNIQUE INDEX "clan_members_one_leader" ON "clan_members"("clanId") WHERE "role" = 'LEADER';

-- O singură cerere sau invitație în așteptare pe (clan, membru, fel).
CREATE UNIQUE INDEX "clan_requests_one_pending" ON "clan_requests"("clanId", "userId", "kind") WHERE "status" = 'PENDING';
