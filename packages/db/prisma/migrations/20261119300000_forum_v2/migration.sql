-- AlterEnum
ALTER TYPE "ForumType" ADD VALUE 'PAGE';

-- AlterTable
ALTER TABLE "forums" ADD COLUMN     "autoCloseDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "countPosts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "defaultSort" TEXT NOT NULL DEFAULT 'last',
ADD COLUMN     "minPosts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ownTopicsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "pollsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ratingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rulesHtml" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rulesJson" JSONB,
ADD COLUMN     "rulesMode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "tagsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recommendedPostId" INTEGER,
ADD COLUMN     "requireApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "hiddenParts" JSONB;

-- CreateTable
CREATE TABLE "forum_extension_data" (
    "forumId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "forum_extension_data_pkey" PRIMARY KEY ("forumId","key")
);

-- CreateTable
CREATE TABLE "forum_pages" (
    "forumId" INTEGER NOT NULL,
    "contentJson" JSONB,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "ctaIcon" TEXT,
    "allowTopics" BOOLEAN NOT NULL DEFAULT false,
    "audienceGroupIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "forum_pages_pkey" PRIMARY KEY ("forumId")
);

-- CreateTable
CREATE TABLE "forum_rules_acceptances" (
    "forumId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_rules_acceptances_pkey" PRIMARY KEY ("forumId","userId")
);

-- CreateTable
CREATE TABLE "topic_notices" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "authorId" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'info',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_ratings" (
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_ratings_pkey" PRIMARY KEY ("contentType","contentId","userId")
);

-- CreateTable
CREATE TABLE "content_rating_summaries" (
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "sum" INTEGER NOT NULL DEFAULT 0,
    "avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_rating_summaries_pkey" PRIMARY KEY ("contentType","contentId")
);

-- CreateIndex
CREATE INDEX "topic_notices_topicId_idx" ON "topic_notices"("topicId");

-- CreateIndex
CREATE INDEX "content_ratings_userId_idx" ON "content_ratings"("userId");

-- CreateIndex
CREATE INDEX "content_rating_summaries_contentType_avg_idx" ON "content_rating_summaries"("contentType", "avg" DESC);

-- CreateIndex
CREATE INDEX "topics_forumId_ratingAvg_idx" ON "topics"("forumId", "ratingAvg" DESC);

-- AddForeignKey
ALTER TABLE "forum_extension_data" ADD CONSTRAINT "forum_extension_data_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_pages" ADD CONSTRAINT "forum_pages_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_rules_acceptances" ADD CONSTRAINT "forum_rules_acceptances_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_notices" ADD CONSTRAINT "topic_notices_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_ratings" ADD CONSTRAINT "content_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

