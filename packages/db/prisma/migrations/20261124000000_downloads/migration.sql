-- Descărcări: categoriile, fișierele, versiunile, fișierele încărcate, recenziile, comentariile, logul și câmpurile suplimentare.

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('SCANNING', 'PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "DownloadScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DownloadAssetSource" AS ENUM ('UPLOAD', 'LINK', 'PATH');

-- CreateEnum
CREATE TYPE "DownloadAssetState" AS ENUM ('UPLOADING', 'RECEIVED', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DownloadPostStatus" AS ENUM ('VISIBLE', 'PENDING', 'HIDDEN');

-- CreateTable
CREATE TABLE "download_categories" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descriptionJson" JSONB,
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "iconId" TEXT,
    "coverId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "vipOnly" BOOLEAN NOT NULL DEFAULT false,
    "clanId" INTEGER,
    "options" JSONB NOT NULL DEFAULT '{}',
    "fieldIds" JSONB NOT NULL DEFAULT '[]',
    "filesCount" INTEGER NOT NULL DEFAULT 0,
    "lastFileAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_files" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "descriptionJson" JSONB,
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "status" "DownloadStatus" NOT NULL DEFAULT 'SCANNING',
    "vipOnly" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "commentsLocked" BOOLEAN NOT NULL DEFAULT false,
    "versionId" INTEGER,
    "version" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "screenshotIds" JSONB NOT NULL DEFAULT '[]',
    "size" BIGINT NOT NULL DEFAULT 0,
    "filesCount" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "topicId" INTEGER,
    "rejectReason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_versions" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "changelogJson" JSONB,
    "changelogHtml" TEXT NOT NULL DEFAULT '',
    "status" "DownloadStatus" NOT NULL DEFAULT 'SCANNING',
    "size" BIGINT NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "rejectReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_assets" (
    "id" TEXT NOT NULL,
    "fileId" INTEGER,
    "versionId" INTEGER,
    "categoryId" INTEGER,
    "uploaderId" TEXT,
    "source" "DownloadAssetSource" NOT NULL DEFAULT 'UPLOAD',
    "state" "DownloadAssetState" NOT NULL DEFAULT 'UPLOADING',
    "name" TEXT NOT NULL,
    "url" TEXT,
    "storageKey" TEXT,
    "size" BIGINT NOT NULL DEFAULT 0,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "kind" TEXT NOT NULL DEFAULT '',
    "sha256" TEXT,
    "chunkSize" INTEGER NOT NULL DEFAULT 0,
    "received" BIGINT NOT NULL DEFAULT 0,
    "scanStatus" "DownloadScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanResult" TEXT,
    "scanEngine" TEXT,
    "scannedAt" TIMESTAMP(3),
    "error" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_reviews" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "bodyJson" JSONB,
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "status" "DownloadPostStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_comments" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "authorId" TEXT,
    "bodyJson" JSONB,
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "status" "DownloadPostStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_logs" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "versionId" INTEGER,
    "assetId" TEXT,
    "userId" TEXT,
    "size" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_fields" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB NOT NULL DEFAULT '[]',
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT NOT NULL DEFAULT 'sidebar',
    "inTopic" BOOLEAN NOT NULL DEFAULT false,
    "topicFormat" TEXT NOT NULL DEFAULT '',
    "viewGroups" JSONB NOT NULL DEFAULT '[]',
    "editGroups" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "download_categories_clanId_key" ON "download_categories"("clanId");

-- CreateIndex
CREATE INDEX "download_categories_parentId_position_idx" ON "download_categories"("parentId", "position");

-- CreateIndex
CREATE INDEX "download_files_categoryId_status_publishedAt_idx" ON "download_files"("categoryId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "download_files_status_publishedAt_idx" ON "download_files"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "download_files_status_downloads_idx" ON "download_files"("status", "downloads");

-- CreateIndex
CREATE INDEX "download_files_status_ratingAvg_idx" ON "download_files"("status", "ratingAvg");

-- CreateIndex
CREATE INDEX "download_files_status_featured_idx" ON "download_files"("status", "featured");

-- CreateIndex
CREATE INDEX "download_files_authorId_createdAt_idx" ON "download_files"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "download_versions_fileId_createdAt_idx" ON "download_versions"("fileId", "createdAt");

-- CreateIndex
CREATE INDEX "download_versions_status_createdAt_idx" ON "download_versions"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "download_assets_storageKey_key" ON "download_assets"("storageKey");

-- CreateIndex
CREATE INDEX "download_assets_fileId_idx" ON "download_assets"("fileId");

-- CreateIndex
CREATE INDEX "download_assets_versionId_idx" ON "download_assets"("versionId");

-- CreateIndex
CREATE INDEX "download_assets_uploaderId_createdAt_idx" ON "download_assets"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "download_assets_state_createdAt_idx" ON "download_assets"("state", "createdAt");

-- CreateIndex
CREATE INDEX "download_assets_scanStatus_scannedAt_idx" ON "download_assets"("scanStatus", "scannedAt");

-- CreateIndex
CREATE INDEX "download_reviews_fileId_status_createdAt_idx" ON "download_reviews"("fileId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "download_reviews_fileId_userId_key" ON "download_reviews"("fileId", "userId");

-- CreateIndex
CREATE INDEX "download_comments_fileId_status_createdAt_idx" ON "download_comments"("fileId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "download_comments_authorId_createdAt_idx" ON "download_comments"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "download_logs_fileId_createdAt_idx" ON "download_logs"("fileId", "createdAt");

-- CreateIndex
CREATE INDEX "download_logs_userId_fileId_idx" ON "download_logs"("userId", "fileId");

-- CreateIndex
CREATE INDEX "download_logs_createdAt_idx" ON "download_logs"("createdAt");

-- CreateIndex
CREATE INDEX "download_fields_position_idx" ON "download_fields"("position");

-- AddForeignKey
ALTER TABLE "download_categories" ADD CONSTRAINT "download_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "download_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_files" ADD CONSTRAINT "download_files_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "download_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_versions" ADD CONSTRAINT "download_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "download_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_assets" ADD CONSTRAINT "download_assets_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "download_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_assets" ADD CONSTRAINT "download_assets_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "download_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_reviews" ADD CONSTRAINT "download_reviews_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "download_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_comments" ADD CONSTRAINT "download_comments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "download_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "download_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

