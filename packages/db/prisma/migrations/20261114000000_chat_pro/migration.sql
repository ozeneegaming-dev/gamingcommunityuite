-- Chat Pro (specul 2026-10-10-chat-pro): profilul de chat al membrilor, statisticile zilnice și câștigătorii clasamentului,
-- bara de anunțuri, pachetele de emoticoane; răspunsurile citate și datele extensiilor pe mesaje; ziua de naștere pe profil.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birthday" DATE,
ADD COLUMN     "birthdayVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "replyToId" INTEGER;

-- CreateTable
CREATE TABLE "chat_pro_profiles" (
    "userId" TEXT NOT NULL,
    "prefs" JSONB NOT NULL DEFAULT '{}',
    "nickname" TEXT,
    "nicknameNormalized" TEXT,
    "badgeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "emoteFavorites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gifFavorites" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_pro_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "chat_pro_daily_stats" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "chat_pro_daily_stats_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "chat_pro_winners" (
    "id" SERIAL NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "userId" TEXT,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_pro_winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_pro_bar_items" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "ctaLabel" TEXT NOT NULL DEFAULT '',
    "ctaUrl" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "groupIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_pro_bar_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_emote_packs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_emote_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_emotes" (
    "id" SERIAL NOT NULL,
    "packId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_emotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_pro_profiles_nicknameNormalized_key" ON "chat_pro_profiles"("nicknameNormalized");

-- CreateIndex
CREATE INDEX "chat_pro_daily_stats_day_idx" ON "chat_pro_daily_stats"("day");

-- CreateIndex
CREATE UNIQUE INDEX "chat_pro_winners_periodStart_key" ON "chat_pro_winners"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "chat_emotes_code_key" ON "chat_emotes"("code");

-- CreateIndex
CREATE INDEX "chat_emotes_packId_position_idx" ON "chat_emotes"("packId", "position");

-- CreateIndex
CREATE INDEX "chat_messages_authorId_id_idx" ON "chat_messages"("authorId", "id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_pro_profiles" ADD CONSTRAINT "chat_pro_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_pro_daily_stats" ADD CONSTRAINT "chat_pro_daily_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_pro_winners" ADD CONSTRAINT "chat_pro_winners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_emotes" ADD CONSTRAINT "chat_emotes_packId_fkey" FOREIGN KEY ("packId") REFERENCES "chat_emote_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

