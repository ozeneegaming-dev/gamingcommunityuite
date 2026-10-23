-- Ediția Lite: cheile, coada de joburi și jurnalul live fără Redis (goale în ediția VPS).

-- CreateTable
CREATE TABLE "gcs_kv" (
    "key" VARCHAR(255) NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    "value" TEXT,
    "expiresAt" BIGINT,

    CONSTRAINT "gcs_kv_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "gcs_kv_items" (
    "key" VARCHAR(255) NOT NULL,
    "field" VARCHAR(255) NOT NULL,
    "value" TEXT,
    "score" DOUBLE PRECISION,

    CONSTRAINT "gcs_kv_items_pkey" PRIMARY KEY ("key","field")
);

-- CreateTable
CREATE TABLE "gcs_kv_locks" (
    "stripe" INTEGER NOT NULL,

    CONSTRAINT "gcs_kv_locks_pkey" PRIMARY KEY ("stripe")
);

-- CreateTable
CREATE TABLE "gcs_jobs" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "data" TEXT NOT NULL,
    "jobKey" VARCHAR(191),
    "status" VARCHAR(16) NOT NULL DEFAULT 'waiting',
    "runAt" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedUntil" BIGINT,
    "lastError" TEXT,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "gcs_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gcs_job_schedules" (
    "id" VARCHAR(191) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "data" TEXT NOT NULL,
    "everyMs" INTEGER,
    "pattern" VARCHAR(100),
    "nextRunAt" BIGINT NOT NULL,

    CONSTRAINT "gcs_job_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gcs_realtime_events" (
    "id" BIGSERIAL NOT NULL,
    "room" VARCHAR(191) NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "data" TEXT NOT NULL,
    "origin" VARCHAR(64),
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "gcs_realtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gcs_kv_expiresAt_idx" ON "gcs_kv"("expiresAt");

-- CreateIndex
CREATE INDEX "gcs_kv_items_key_score_idx" ON "gcs_kv_items"("key", "score");

-- CreateIndex
CREATE UNIQUE INDEX "gcs_jobs_jobKey_key" ON "gcs_jobs"("jobKey");

-- CreateIndex
CREATE INDEX "gcs_jobs_status_runAt_idx" ON "gcs_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "gcs_realtime_events_createdAt_idx" ON "gcs_realtime_events"("createdAt");

-- AddForeignKey
ALTER TABLE "gcs_kv_items" ADD CONSTRAINT "gcs_kv_items_key_fkey" FOREIGN KEY ("key") REFERENCES "gcs_kv"("key") ON DELETE CASCADE ON UPDATE CASCADE;
