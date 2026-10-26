-- Botul comunității (aceeași migrație ca pe PostgreSQL; datele în UTC, ca în migrația de bază).

-- AlterTable
ALTER TABLE `users` ADD COLUMN `isBot` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `bot_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feature` LONGTEXT NOT NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `topicId` INTEGER NULL,
    `postId` INTEGER NULL,
    `conversationId` INTEGER NULL,
    `label` LONGTEXT NULL,
    `sourceName` LONGTEXT NULL,
    `sourceUrl` LONGTEXT NULL,
    `translatedFrom` LONGTEXT NULL,
    `importEveryMinutes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `bot_posts_dedupeKey_key`(`dedupeKey`),
    INDEX `bot_posts_topicId_idx`(`topicId`),
    INDEX `bot_posts_postId_idx`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bot_scheduled_posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `forumId` INTEGER NOT NULL,
    `title` LONGTEXT NOT NULL,
    `contentJson` JSON NOT NULL,
    `prefixId` INTEGER NULL,
    `lock` BOOLEAN NOT NULL DEFAULT false,
    `pin` BOOLEAN NOT NULL DEFAULT false,
    `publishAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `topicId` INTEGER NULL,
    `error` LONGTEXT NULL,
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `bot_scheduled_posts_status_publishAt_idx`(`status`, `publishAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

