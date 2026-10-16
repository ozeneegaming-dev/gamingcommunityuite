-- Realizări v2: constructorul de reguli („Când → Și → Atunci”) pe evenimentele aplicațiilor, rangurile moderne
-- (emblemă pe trepte, criterii ale aplicațiilor, toate/oricare, avantaje) și widget-ul „Ultimele realizări”.

-- AlterEnum
ALTER TYPE "AchievementTrigger" ADD VALUE 'EVENT';

-- AlterTable
ALTER TABLE "achievement_rules" ADD COLUMN     "conditions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "event" TEXT,
ADD COLUMN     "rewards" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ranks" ADD COLUMN     "animated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "criteria" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "emblemIcon" TEXT,
ADD COLUMN     "emblemShape" TEXT,
ADD COLUMN     "emblemTier" TEXT,
ADD COLUMN     "imageAttachmentId" TEXT,
ADD COLUMN     "match" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "perkBadgeId" INTEGER,
ADD COLUMN     "perkGroupId" INTEGER,
ADD COLUMN     "perkNameStyleId" INTEGER;

-- AlterTable
ALTER TABLE "user_badges" ADD COLUMN     "lastAwardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "timesAwarded" INTEGER NOT NULL DEFAULT 1;

-- Badge-urile existente: ultima acordare = data acordării.
UPDATE "user_badges" SET "lastAwardedAt" = "createdAt";

-- CreateTable
CREATE TABLE "achievement_occurrences" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "achievement_occurrences_ruleId_userId_createdAt_idx" ON "achievement_occurrences"("ruleId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_occurrences_ruleId_userId_ref_key" ON "achievement_occurrences"("ruleId", "userId", "ref");

-- CreateIndex
CREATE INDEX "achievement_rules_event_idx" ON "achievement_rules"("event");

-- CreateIndex
CREATE INDEX "user_badges_lastAwardedAt_idx" ON "user_badges"("lastAwardedAt");

-- AddForeignKey
ALTER TABLE "ranks" ADD CONSTRAINT "ranks_perkGroupId_fkey" FOREIGN KEY ("perkGroupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranks" ADD CONSTRAINT "ranks_perkBadgeId_fkey" FOREIGN KEY ("perkBadgeId") REFERENCES "badges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranks" ADD CONSTRAINT "ranks_perkNameStyleId_fkey" FOREIGN KEY ("perkNameStyleId") REFERENCES "name_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_occurrences" ADD CONSTRAINT "achievement_occurrences_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "achievement_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_occurrences" ADD CONSTRAINT "achievement_occurrences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
