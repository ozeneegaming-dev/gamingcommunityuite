-- Importul din altă platformă (ACP → Sistem → Conversii): joburile, harta id vechi → id nou, jurnalul,
-- plus IP-ul de înregistrare al membrilor importați.

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('DRAFT', 'READY', 'QUEUED', 'RUNNING', 'PAUSED', 'CANCELLED', 'FAILED', 'DONE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "registrationIp" TEXT;

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "mapKey" TEXT NOT NULL DEFAULT '',
    "status" "ImportStatus" NOT NULL DEFAULT 'DRAFT',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT,
    "detected" JSONB,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "currentStep" TEXT,
    "control" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_map" (
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,

    CONSTRAINT "import_map_pkey" PRIMARY KEY ("source","type","sourceId")
);

-- CreateTable
CREATE TABLE "import_logs" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_map_type_targetId_idx" ON "import_map"("type", "targetId");

-- CreateIndex
CREATE INDEX "import_logs_jobId_id_idx" ON "import_logs"("jobId", "id");

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
