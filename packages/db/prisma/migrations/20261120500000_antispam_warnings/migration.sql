-- Anti-spam (etapa 2): avertismentele confirmate / anulate, motivele predefinite, contestațiile și restricțiile din praguri.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "postingRestrictedUntil" TIMESTAMP(3),
ADD COLUMN     "postsModeratedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "warnings" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "reasonId" INTEGER,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" TEXT;

-- CreateTable
CREATE TABLE "warning_reasons" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "expiresDays" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warning_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warning_appeals" (
    "id" SERIAL NOT NULL,
    "warningId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "warning_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warning_appeals_warningId_key" ON "warning_appeals"("warningId");

-- CreateIndex
CREATE INDEX "warning_appeals_status_createdAt_idx" ON "warning_appeals"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "warning_appeals" ADD CONSTRAINT "warning_appeals_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "warnings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

