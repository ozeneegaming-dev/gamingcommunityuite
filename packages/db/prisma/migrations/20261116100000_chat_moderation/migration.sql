-- Moderarea chat-ului (staff și accesul de moderator în chat): mesajele ascunse, sancțiunile (kick, ban din chat, slow mode
-- personal), jurnalul moderării, accesul de moderator dat membrilor și dovada atașată avertismentelor.
-- CreateEnum
CREATE TYPE "ChatSanctionKind" AS ENUM ('KICK', 'BAN', 'SLOW');

-- AlterTable
ALTER TABLE "warnings" ADD COLUMN     "evidence" JSONB;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenById" TEXT;

-- CreateTable
CREATE TABLE "chat_sanctions" (
    "id" SERIAL NOT NULL,
    "kind" "ChatSanctionKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" INTEGER,
    "until" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,

    CONSTRAINT "chat_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_mod_log" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "channelKey" TEXT,
    "messageId" INTEGER,
    "reason" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "ref" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_mod_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_moderator_grants" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "rights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rooms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_moderator_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sanctions_userId_kind_idx" ON "chat_sanctions"("userId", "kind");

-- CreateIndex
CREATE INDEX "chat_sanctions_until_idx" ON "chat_sanctions"("until");

-- CreateIndex
CREATE INDEX "chat_mod_log_createdAt_idx" ON "chat_mod_log"("createdAt");

-- CreateIndex
CREATE INDEX "chat_mod_log_targetId_idx" ON "chat_mod_log"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_moderator_grants_userId_key" ON "chat_moderator_grants"("userId");

-- CreateIndex
CREATE INDEX "chat_moderator_grants_expiresAt_idx" ON "chat_moderator_grants"("expiresAt");

-- AddForeignKey
ALTER TABLE "chat_sanctions" ADD CONSTRAINT "chat_sanctions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sanctions" ADD CONSTRAINT "chat_sanctions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_mod_log" ADD CONSTRAINT "chat_mod_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_mod_log" ADD CONSTRAINT "chat_mod_log_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_moderator_grants" ADD CONSTRAINT "chat_moderator_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_moderator_grants" ADD CONSTRAINT "chat_moderator_grants_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

