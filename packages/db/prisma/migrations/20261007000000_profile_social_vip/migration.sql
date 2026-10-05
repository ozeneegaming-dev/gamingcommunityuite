-- CreateEnum
CREATE TYPE "ProfileFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'URL', 'NUMBER', 'SELECT');

-- CreateEnum
CREATE TYPE "ProfileFieldSection" AS ENUM ('ABOUT', 'GAMES');

-- CreateEnum
CREATE TYPE "FieldVisibility" AS ENUM ('PUBLIC', 'MEMBERS', 'STAFF');

-- CreateEnum
CREATE TYPE "AchievementTrigger" AS ENUM ('POSTS_COUNT', 'REPUTATION', 'POINTS', 'MEMBER_DAYS', 'SOLUTIONS_COUNT', 'IS_VIP', 'EACH_POST', 'EACH_REACTION_RECEIVED', 'EACH_SOLUTION');

-- CreateEnum
CREATE TYPE "VipSource" AS ENUM ('MANUAL', 'STORE');

-- CreateEnum
CREATE TYPE "VipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VipAction" AS ENUM ('GRANT', 'EXTEND', 'REVOKE', 'EXPIRE');

-- CreateEnum
CREATE TYPE "FrameKind" AS ENUM ('CSS', 'IMAGE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "avatarFrameId" INTEGER,
ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "coverAttachmentId" TEXT,
ADD COLUMN     "coverPositionY" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "followersCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nameStyleId" INTEGER,
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "privacy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "rankId" INTEGER,
ADD COLUMN     "solutionsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "profile_fields" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ProfileFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "section" "ProfileFieldSection" NOT NULL DEFAULT 'ABOUT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxLength" INTEGER NOT NULL DEFAULT 200,
    "visibility" "FieldVisibility" NOT NULL DEFAULT 'PUBLIC',
    "showOnCard" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "profile_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_field_values" (
    "userId" TEXT NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "profile_field_values_pkey" PRIMARY KEY ("userId","fieldId")
);

-- CreateTable
CREATE TABLE "status_updates" (
    "id" SERIAL NOT NULL,
    "profileUserId" TEXT NOT NULL,
    "authorId" TEXT,
    "parentId" INTEGER,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'VISIBLE',
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ignores" (
    "userId" TEXT NOT NULL,
    "ignoredId" TEXT NOT NULL,
    "posts" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_ignores_pkey" PRIMARY KEY ("userId","ignoredId")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "starterId" TEXT,
    "lastMessageId" INTEGER,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastReadMessageId" INTEGER NOT NULL DEFAULT 0,
    "invitedById" TEXT,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "authorId" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "minPosts" INTEGER,
    "minPoints" INTEGER,
    "minReputation" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "symbol" TEXT,
    "imageAttachmentId" TEXT,
    "color" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" INTEGER NOT NULL,
    "awardedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_rules" (
    "id" SERIAL NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "trigger" "AchievementTrigger" NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "badgeId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "achievement_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_log" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "uniqueKey" TEXT,
    "contentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_promotions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "fromGroupIds" INTEGER[],
    "toGroupId" INTEGER NOT NULL,
    "asPrimary" BOOLEAN NOT NULL DEFAULT true,
    "minPosts" INTEGER,
    "minDays" INTEGER,
    "minReputation" INTEGER,
    "minPoints" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "group_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "source" "VipSource" NOT NULL DEFAULT 'MANUAL',
    "grantedById" TEXT,
    "status" "VipStatus" NOT NULL DEFAULT 'ACTIVE',
    "warnedAt" TIMESTAMP(3),
    "madePrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_log" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" INTEGER,
    "action" "VipAction" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "name_styles" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "style" JSONB NOT NULL,
    "allGroups" BOOLEAN NOT NULL DEFAULT false,
    "groupIds" INTEGER[],
    "badgeIds" INTEGER[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "name_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_frames" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FrameKind" NOT NULL DEFAULT 'CSS',
    "style" JSONB,
    "imageAttachmentId" TEXT,
    "allGroups" BOOLEAN NOT NULL DEFAULT false,
    "groupIds" INTEGER[],
    "badgeIds" INTEGER[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "avatar_frames_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_fields_key_key" ON "profile_fields"("key");

-- CreateIndex
CREATE INDEX "profile_field_values_fieldId_idx" ON "profile_field_values"("fieldId");

-- CreateIndex
CREATE INDEX "status_updates_profileUserId_parentId_createdAt_idx" ON "status_updates"("profileUserId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "user_ignores_ignoredId_idx" ON "user_ignores"("ignoredId");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_leftAt_idx" ON "conversation_participants"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_id_idx" ON "conversation_messages"("conversationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "badges_key_key" ON "badges"("key");

-- CreateIndex
CREATE INDEX "user_badges_badgeId_idx" ON "user_badges"("badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeId_key" ON "user_badges"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_rules_key_key" ON "achievement_rules"("key");

-- CreateIndex
CREATE INDEX "achievement_log_userId_createdAt_idx" ON "achievement_log"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_log_userId_uniqueKey_key" ON "achievement_log"("userId", "uniqueKey");

-- CreateIndex
CREATE INDEX "vip_subscriptions_status_expiresAt_idx" ON "vip_subscriptions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "vip_subscriptions_userId_status_idx" ON "vip_subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "vip_log_userId_createdAt_idx" ON "vip_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "vip_log_createdAt_idx" ON "vip_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "name_styles_key_key" ON "name_styles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_frames_key_key" ON "avatar_frames"("key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "ranks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_nameStyleId_fkey" FOREIGN KEY ("nameStyleId") REFERENCES "name_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarFrameId_fkey" FOREIGN KEY ("avatarFrameId") REFERENCES "avatar_frames"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_field_values" ADD CONSTRAINT "profile_field_values_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_field_values" ADD CONSTRAINT "profile_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "profile_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_profileUserId_fkey" FOREIGN KEY ("profileUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_updates" ADD CONSTRAINT "status_updates_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "status_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ignores" ADD CONSTRAINT "user_ignores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ignores" ADD CONSTRAINT "user_ignores_ignoredId_fkey" FOREIGN KEY ("ignoredId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_rules" ADD CONSTRAINT "achievement_rules_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_log" ADD CONSTRAINT "achievement_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_log" ADD CONSTRAINT "achievement_log_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "achievement_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_promotions" ADD CONSTRAINT "group_promotions_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_subscriptions" ADD CONSTRAINT "vip_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_subscriptions" ADD CONSTRAINT "vip_subscriptions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_log" ADD CONSTRAINT "vip_log_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Cel mult un abonament VIP activ pe user (Prisma nu poate exprima indexurile unice parțiale).
CREATE UNIQUE INDEX "vip_subscriptions_one_active_per_user" ON "vip_subscriptions"("userId") WHERE "status" = 'ACTIVE';
