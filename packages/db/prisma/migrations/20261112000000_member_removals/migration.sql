-- Ștergerea și unirea conturilor (specul 2026-10-09-stergere-unire-membri): operațiile, cu progresul lor.
-- CreateEnum
CREATE TYPE "MemberRemovalKind" AS ENUM ('DELETE', 'MERGE');

-- CreateEnum
CREATE TYPE "MemberRemovalMode" AS ENUM ('KEEP_CONTENT', 'DELETE_CONTENT');

-- CreateEnum
CREATE TYPE "MemberRemovalSource" AS ENUM ('ACP', 'SELF');

-- CreateEnum
CREATE TYPE "MemberRemovalStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "member_removals" (
    "id" TEXT NOT NULL,
    "kind" "MemberRemovalKind" NOT NULL,
    "status" "MemberRemovalStatus" NOT NULL,
    "source" "MemberRemovalSource" NOT NULL DEFAULT 'ACP',
    "mode" "MemberRemovalMode" NOT NULL DEFAULT 'KEEP_CONTENT',
    "keepMessages" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "targetId" TEXT,
    "targetName" TEXT,
    "requestedById" TEXT,
    "runAfter" TIMESTAMP(3),
    "steps" JSONB NOT NULL DEFAULT '{}',
    "currentStep" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_removals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_removals_status_runAfter_idx" ON "member_removals"("status", "runAfter");

-- CreateIndex
CREATE INDEX "member_removals_userId_idx" ON "member_removals"("userId");

-- CreateIndex
CREATE INDEX "member_removals_createdAt_idx" ON "member_removals"("createdAt");

-- Un singur rând activ (în așteptare, în coadă, în lucru sau eșuat) pe cont: două operații pe același cont s-ar călca.
CREATE UNIQUE INDEX "member_removals_one_active" ON "member_removals"("userId") WHERE "status" IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'FAILED');
