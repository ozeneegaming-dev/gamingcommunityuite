-- Email în masă: ciornele și trimiterile (ACP › Membri › Comunicare) și dezabonarea membrilor de la emailurile adminilor.

-- AlterTable
ALTER TABLE "notification_members" ADD COLUMN     "adminMailOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bulk_mails" (
    "id" SERIAL NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyJson" JSONB NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "bulk_mails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_mails_status_idx" ON "bulk_mails"("status");
