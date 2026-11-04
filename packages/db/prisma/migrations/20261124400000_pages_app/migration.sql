-- Aplicația Pagini: arborele de pagini și foldere, bazele de date (categorii, înregistrări, comentarii) și biblioteca media.

-- CreateEnum
CREATE TYPE "PagesRecordStatus" AS ENUM ('PUBLISHED', 'PENDING', 'REJECTED', 'HIDDEN');

-- CreateTable
CREATE TABLE "pages_nodes" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'page',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'layout',
    "layout" JSONB NOT NULL DEFAULT '{}',
    "databaseId" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "showTitle" BOOLEAN NOT NULL DEFAULT true,
    "viewGroupIds" JSONB NOT NULL DEFAULT '[]',
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoImageId" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "inMenu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "pages_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_databases" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "template" TEXT NOT NULL DEFAULT 'blank',
    "recordLabel" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "listLayout" TEXT NOT NULL DEFAULT 'list',
    "sort" TEXT NOT NULL DEFAULT 'newest',
    "perPage" INTEGER NOT NULL DEFAULT 20,
    "comments" BOOLEAN NOT NULL DEFAULT true,
    "ratings" BOOLEAN NOT NULL DEFAULT true,
    "submissions" BOOLEAN NOT NULL DEFAULT false,
    "approval" BOOLEAN NOT NULL DEFAULT true,
    "authorEdit" BOOLEAN NOT NULL DEFAULT true,
    "searchable" BOOLEAN NOT NULL DEFAULT true,
    "inStream" BOOLEAN NOT NULL DEFAULT true,
    "viewGroupIds" JSONB NOT NULL DEFAULT '[]',
    "submitGroupIds" JSONB NOT NULL DEFAULT '[]',
    "commentGroupIds" JSONB NOT NULL DEFAULT '[]',
    "rateGroupIds" JSONB NOT NULL DEFAULT '[]',
    "recordsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_categories" (
    "id" SERIAL NOT NULL,
    "databaseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "recordsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pages_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_records" (
    "id" SERIAL NOT NULL,
    "databaseId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contentJson" JSONB,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "imageId" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "searchText" TEXT NOT NULL DEFAULT '',
    "status" "PagesRecordStatus" NOT NULL DEFAULT 'PUBLISHED',
    "rejectReason" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "lastCommentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_comments" (
    "id" SERIAL NOT NULL,
    "recordId" INTEGER NOT NULL,
    "authorId" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_media_folders" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages_media" (
    "id" SERIAL NOT NULL,
    "folderId" INTEGER,
    "attachmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pages_nodes_path_key" ON "pages_nodes"("path");

-- CreateIndex
CREATE UNIQUE INDEX "pages_nodes_databaseId_key" ON "pages_nodes"("databaseId");

-- CreateIndex
CREATE INDEX "pages_nodes_parentId_position_idx" ON "pages_nodes"("parentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pages_databases_key_key" ON "pages_databases"("key");

-- CreateIndex
CREATE INDEX "pages_categories_databaseId_position_idx" ON "pages_categories"("databaseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pages_categories_databaseId_slug_key" ON "pages_categories"("databaseId", "slug");

-- CreateIndex
CREATE INDEX "pages_records_databaseId_status_publishedAt_idx" ON "pages_records"("databaseId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "pages_records_status_createdAt_idx" ON "pages_records"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pages_records_authorId_idx" ON "pages_records"("authorId");

-- CreateIndex
CREATE INDEX "pages_comments_recordId_createdAt_idx" ON "pages_comments"("recordId", "createdAt");

-- CreateIndex
CREATE INDEX "pages_comments_authorId_idx" ON "pages_comments"("authorId");

-- CreateIndex
CREATE INDEX "pages_media_folders_parentId_idx" ON "pages_media_folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "pages_media_attachmentId_key" ON "pages_media"("attachmentId");

-- CreateIndex
CREATE INDEX "pages_media_folderId_createdAt_idx" ON "pages_media"("folderId", "createdAt");

-- AddForeignKey
ALTER TABLE "pages_nodes" ADD CONSTRAINT "pages_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pages_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_nodes" ADD CONSTRAINT "pages_nodes_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "pages_databases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_categories" ADD CONSTRAINT "pages_categories_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "pages_databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_records" ADD CONSTRAINT "pages_records_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "pages_databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_records" ADD CONSTRAINT "pages_records_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "pages_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_comments" ADD CONSTRAINT "pages_comments_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "pages_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_media_folders" ADD CONSTRAINT "pages_media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pages_media_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages_media" ADD CONSTRAINT "pages_media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "pages_media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

