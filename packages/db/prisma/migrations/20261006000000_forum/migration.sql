-- Etapa 2: forum. Căutarea ignoră diacriticele (unaccent) și flexiunile (dicționarul romanian).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Configurația de căutare „gcs_ro”: romanian + unaccent înaintea stemmer-ului.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'gcs_ro') THEN
    CREATE TEXT SEARCH CONFIGURATION gcs_ro (COPY = romanian);
    ALTER TEXT SEARCH CONFIGURATION gcs_ro
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, romanian_stem;
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "ForumType" AS ENUM ('CATEGORY', 'FORUM', 'LINK', 'QA');

-- CreateEnum
CREATE TYPE "ContentVisibility" AS ENUM ('VISIBLE', 'PENDING', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approvedPostsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reputation" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "forums" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "type" "ForumType" NOT NULL DEFAULT 'FORUM',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "linkUrl" TEXT,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "topicsCount" INTEGER NOT NULL DEFAULT 0,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "lastPostId" INTEGER,
    "lastPostAt" TIMESTAMP(3),
    "lastTopicId" INTEGER,
    "lastPosterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" SERIAL NOT NULL,
    "forumId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "authorId" TEXT,
    "prefixId" INTEGER,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'VISIBLE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "solvedPostId" INTEGER,
    "firstPostId" INTEGER,
    "lastPostId" INTEGER,
    "lastPostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPosterId" TEXT,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchVector" tsvector,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "authorId" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'VISIBLE',
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchVector" tsvector,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_revisions" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "editorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_prefixes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "topic_prefixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_prefixes" (
    "forumId" INTEGER NOT NULL,
    "prefixId" INTEGER NOT NULL,

    CONSTRAINT "forum_prefixes_pkey" PRIMARY KEY ("forumId","prefixId")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_tags" (
    "topicId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "topic_tags_pkey" PRIMARY KEY ("topicId","tagId")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" TIMESTAMP(3),

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_options" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "votesCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "pollId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("pollId","optionId","userId")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reactions" (
    "id" SERIAL NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "read_markers" (
    "userId" TEXT NOT NULL,
    "topicId" INTEGER NOT NULL,
    "lastReadPostId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "read_markers_pkey" PRIMARY KEY ("userId","topicId")
);

-- CreateTable
CREATE TABLE "forum_read_marks" (
    "userId" TEXT NOT NULL,
    "forumId" INTEGER NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_read_marks_pkey" PRIMARY KEY ("userId","forumId")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "contentType" TEXT,
    "contentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mod_saved_actions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "forumIds" INTEGER[],
    "actions" JSONB NOT NULL,

    CONSTRAINT "mod_saved_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forums_parentId_position_idx" ON "forums"("parentId", "position");

-- CreateIndex
CREATE INDEX "topics_forumId_visibility_pinned_lastPostAt_idx" ON "topics"("forumId", "visibility", "pinned" DESC, "lastPostAt" DESC);

-- CreateIndex
CREATE INDEX "topics_authorId_idx" ON "topics"("authorId");

-- CreateIndex
CREATE INDEX "posts_topicId_visibility_id_idx" ON "posts"("topicId", "visibility", "id");

-- CreateIndex
CREATE INDEX "posts_authorId_createdAt_idx" ON "posts"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "post_revisions_postId_idx" ON "post_revisions"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "topic_tags_tagId_idx" ON "topic_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "polls_topicId_key" ON "polls"("topicId");

-- CreateIndex
CREATE INDEX "poll_options_pollId_idx" ON "poll_options"("pollId");

-- CreateIndex
CREATE INDEX "poll_votes_pollId_userId_idx" ON "poll_votes"("pollId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_key_key" ON "reactions"("key");

-- CreateIndex
CREATE INDEX "content_reactions_contentType_contentId_idx" ON "content_reactions"("contentType", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "content_reactions_contentType_contentId_userId_key" ON "content_reactions"("contentType", "contentId", "userId");

-- CreateIndex
CREATE INDEX "read_markers_topicId_idx" ON "read_markers"("topicId");

-- CreateIndex
CREATE INDEX "follows_contentType_contentId_idx" ON "follows"("contentType", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "follows_userId_contentType_contentId_key" ON "follows"("userId", "contentType", "contentId");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_contentType_contentId_idx" ON "reports"("contentType", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_contentType_contentId_idx" ON "attachments"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "attachments_ownerId_createdAt_idx" ON "attachments"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "forums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_prefixId_fkey" FOREIGN KEY ("prefixId") REFERENCES "topic_prefixes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_prefixes" ADD CONSTRAINT "forum_prefixes_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_prefixes" ADD CONSTRAINT "forum_prefixes_prefixId_fkey" FOREIGN KEY ("prefixId") REFERENCES "topic_prefixes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_tags" ADD CONSTRAINT "topic_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reactions" ADD CONSTRAINT "content_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reactions" ADD CONSTRAINT "content_reactions_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "reactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "read_markers" ADD CONSTRAINT "read_markers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "read_markers" ADD CONSTRAINT "read_markers_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_read_marks" ADD CONSTRAINT "forum_read_marks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Indexuri de căutare (Prisma nu le poate exprima).
CREATE INDEX "topics_searchVector_idx" ON "topics" USING GIN ("searchVector");
CREATE INDEX "posts_searchVector_idx" ON "posts" USING GIN ("searchVector");
CREATE INDEX "users_nameNormalized_trgm_idx" ON "users" USING GIN ("nameNormalized" gin_trgm_ops);
