-- Membri v2: lista ACP (spammeri, resetarea parolei, indexuri pentru sortare), grupurile secundare temporare (sursa,
-- expirarea, cine le-a dat), grupurile publice (opt-in), pagina Staff v2 (secțiuni și profiluri) și managerul de meniu
-- v2 (tipul itemului, publicul, contorul, evidențierea și ciorna).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isSpammer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastIp" TEXT,
ADD COLUMN     "passwordResetRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "optIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_groups" ADD COLUMN     "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "nav_items" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "counter" TEXT,
ADD COLUMN     "highlight" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'link';

-- Itemii existenți: cei legați de o aplicație sunt pagini de aplicație, cei cu subitemi și fără link sunt grupuri.
UPDATE "nav_items" SET "kind" = 'app' WHERE "appKey" IS NOT NULL;
UPDATE "nav_items" n SET "kind" = 'dropdown' WHERE n."href" IS NULL AND EXISTS (SELECT 1 FROM "nav_items" c WHERE c."parentId" = n."id");

-- CreateTable
CREATE TABLE "staff_sections" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "title" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'detailed',
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "staff_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "userId" TEXT NOT NULL,
    "descriptionJson" JSONB,
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "duties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "nav_drafts" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "users_lastActiveAt_idx" ON "users"("lastActiveAt");

-- CreateIndex
CREATE INDEX "user_groups_expiresAt_idx" ON "user_groups"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sections_groupId_key" ON "staff_sections"("groupId");

-- AddForeignKey
ALTER TABLE "staff_sections" ADD CONSTRAINT "staff_sections_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
