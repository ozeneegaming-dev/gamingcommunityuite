-- Email în masă: ciornele și trimiterile și dezabonarea membrilor de la emailurile adminilor (ca pe PostgreSQL).

-- AlterTable
ALTER TABLE `notification_members` ADD COLUMN `adminMailOff` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `bulk_mails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subject` LONGTEXT NOT NULL,
    `bodyJson` JSON NOT NULL,
    `bodyHtml` LONGTEXT NOT NULL,
    `audience` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `total` INTEGER NOT NULL DEFAULT 0,
    `sent` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `cursor` LONGTEXT NULL,
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `bulk_mails_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
