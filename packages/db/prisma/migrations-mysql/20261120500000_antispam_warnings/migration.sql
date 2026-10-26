-- Anti-spam (etapa 2), ca pe PostgreSQL; datele în UTC, ca în migrația de bază.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `postingRestrictedUntil` DATETIME(3) NULL,
    ADD COLUMN `postsModeratedUntil` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `warnings` ADD COLUMN `acknowledgedAt` DATETIME(3) NULL,
    ADD COLUMN `reasonId` INTEGER NULL,
    ADD COLUMN `revokedAt` DATETIME(3) NULL,
    ADD COLUMN `revokedById` LONGTEXT NULL;

-- CreateTable
CREATE TABLE `warning_reasons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `points` INTEGER NOT NULL,
    `expiresDays` INTEGER NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warning_appeals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `warningId` VARCHAR(191) NOT NULL,
    `userId` LONGTEXT NOT NULL,
    `text` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `decidedById` LONGTEXT NULL,
    `decisionReason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `decidedAt` DATETIME(3) NULL,

    UNIQUE INDEX `warning_appeals_warningId_key`(`warningId`),
    INDEX `warning_appeals_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `warning_appeals` ADD CONSTRAINT `warning_appeals_warningId_fkey` FOREIGN KEY (`warningId`) REFERENCES `warnings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

