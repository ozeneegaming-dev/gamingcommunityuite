-- CreateEnum
CREATE TYPE "ChatRoomType" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterEnum
ALTER TYPE "ProfileFieldType" ADD VALUE 'IMAGE_SELECT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "customTitle" TEXT,
ADD COLUMN     "prefs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "signatureHtml" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signatureJson" JSONB;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "banner" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "inLegend" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "forums" ADD COLUMN     "subforumColumns" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "profile_fields" ADD COLUMN     "icon" TEXT,
ADD COLUMN     "optionImages" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "showInPostbit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_channels" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "pinnedMessageId" INTEGER,
ADD COLUMN     "type" "ChatRoomType" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_permissions" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "apps" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "nav_items" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" JSONB NOT NULL,
    "icon" TEXT,
    "href" TEXT,
    "appKey" TEXT,
    "groups" INTEGER[],
    "newTab" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "nav_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "customCss" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "draft" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_placements" (
    "id" SERIAL NOT NULL,
    "page" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "groups" INTEGER[],

    CONSTRAINT "widget_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_members" (
    "channelId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "chat_message_reactions" (
    "messageId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "reactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_reactions_pkey" PRIMARY KEY ("messageId","userId","reactionId")
);

-- CreateTable
CREATE TABLE "chat_announcements" (
    "id" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "chat_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_cache" (
    "hash" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_cache_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "nav_items_parentId_position_idx" ON "nav_items"("parentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "themes_key_key" ON "themes"("key");

-- CreateIndex
CREATE INDEX "widget_placements_page_zone_position_idx" ON "widget_placements"("page", "zone", "position");

-- CreateIndex
CREATE INDEX "chat_room_members_userId_idx" ON "chat_room_members"("userId");

-- CreateIndex
CREATE INDEX "chat_announcements_expiresAt_idx" ON "chat_announcements"("expiresAt");

-- CreateIndex
CREATE INDEX "translation_cache_createdAt_idx" ON "translation_cache"("createdAt");

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nav_items" ADD CONSTRAINT "nav_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "nav_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed-urile făcute o singură dată (layout-ul implicit al paginilor).
ALTER TABLE "system_state" ADD COLUMN "seedMarks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Iconițele vechi ale forumurilor (setul propriu din etapele 1–4) devin iconițe Font Awesome.
UPDATE "forums" SET "icon" = CASE "icon"
  WHEN 'chat' THEN 'fa-solid fa-comments'
  WHEN 'megaphone' THEN 'fa-solid fa-bullhorn'
  WHEN 'book' THEN 'fa-solid fa-book'
  WHEN 'shield' THEN 'fa-solid fa-shield-halved'
  WHEN 'gamepad' THEN 'fa-solid fa-gamepad'
  WHEN 'users' THEN 'fa-solid fa-users'
  WHEN 'help' THEN 'fa-solid fa-circle-question'
  WHEN 'link' THEN 'fa-solid fa-link'
  ELSE "icon" END
WHERE "icon" IN ('chat', 'megaphone', 'book', 'shield', 'gamepad', 'users', 'help', 'link');
