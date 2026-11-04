-- Reclamele: unitățile plasate prin widget-ul „Reclamă” (ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `ad_units` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `kind` LONGTEXT NOT NULL DEFAULT ('image'),
    `imageUrl` LONGTEXT NOT NULL DEFAULT (''),
    `linkUrl` LONGTEXT NOT NULL DEFAULT (''),
    `alt` LONGTEXT NOT NULL DEFAULT (''),
    `html` LONGTEXT NOT NULL DEFAULT (''),
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `hideGroups` JSON NOT NULL DEFAULT ('[]'),
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
