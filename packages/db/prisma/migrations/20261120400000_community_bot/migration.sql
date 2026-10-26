-- Botul comunității: contul-bot (users.isBot), ce a publicat (deduplicare + rândul de sursă) și postările programate.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bot_posts" (
    "id" SERIAL NOT NULL,
    "feature" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "topicId" INTEGER,
    "postId" INTEGER,
    "conversationId" INTEGER,
    "label" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "translatedFrom" TEXT,
    "importEveryMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_scheduled_posts" (
    "id" SERIAL NOT NULL,
    "forumId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "prefixId" INTEGER,
    "lock" BOOLEAN NOT NULL DEFAULT false,
    "pin" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "topicId" INTEGER,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_scheduled_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_posts_dedupeKey_key" ON "bot_posts"("dedupeKey");

-- CreateIndex
CREATE INDEX "bot_posts_topicId_idx" ON "bot_posts"("topicId");

-- CreateIndex
CREATE INDEX "bot_posts_postId_idx" ON "bot_posts"("postId");

-- CreateIndex
CREATE INDEX "bot_scheduled_posts_status_publishAt_idx" ON "bot_scheduled_posts"("status", "publishAt");

