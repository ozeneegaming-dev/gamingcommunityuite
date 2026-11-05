-- Descărcări: categoriile, fișierele, versiunile, fișierele încărcate, recenziile, comentariile, logul și câmpurile suplimentare (ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `download_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `name` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `descriptionJson` JSON NULL,
    `descriptionHtml` LONGTEXT NOT NULL DEFAULT (''),
    `icon` LONGTEXT NOT NULL DEFAULT (''),
    `iconId` LONGTEXT NULL,
    `coverId` LONGTEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `vipOnly` BOOLEAN NOT NULL DEFAULT false,
    `clanId` INTEGER NULL,
    `options` JSON NOT NULL DEFAULT ('{}'),
    `fieldIds` JSON NOT NULL DEFAULT ('[]'),
    `filesCount` INTEGER NOT NULL DEFAULT 0,
    `lastFileAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `download_categories_clanId_key`(`clanId`),
    INDEX `download_categories_parentId_position_idx`(`parentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `categoryId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `title` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `summary` LONGTEXT NOT NULL DEFAULT (''),
    `descriptionJson` JSON NULL,
    `descriptionHtml` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('SCANNING', 'PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'HIDDEN') NOT NULL DEFAULT 'SCANNING',
    `vipOnly` BOOLEAN NOT NULL DEFAULT false,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `commentsLocked` BOOLEAN NOT NULL DEFAULT false,
    `versionId` INTEGER NULL,
    `version` LONGTEXT NOT NULL DEFAULT (''),
    `fields` JSON NOT NULL DEFAULT ('{}'),
    `tags` JSON NOT NULL DEFAULT ('[]'),
    `screenshotIds` JSON NOT NULL DEFAULT ('[]'),
    `size` BIGINT NOT NULL DEFAULT 0,
    `filesCount` INTEGER NOT NULL DEFAULT 0,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `views` INTEGER NOT NULL DEFAULT 0,
    `ratingAvg` DOUBLE NOT NULL DEFAULT 0,
    `reviewsCount` INTEGER NOT NULL DEFAULT 0,
    `commentsCount` INTEGER NOT NULL DEFAULT 0,
    `topicId` INTEGER NULL,
    `rejectReason` LONGTEXT NULL,
    `approvedById` LONGTEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `download_files_categoryId_status_publishedAt_idx`(`categoryId`, `status`, `publishedAt`),
    INDEX `download_files_status_publishedAt_idx`(`status`, `publishedAt`),
    INDEX `download_files_status_downloads_idx`(`status`, `downloads`),
    INDEX `download_files_status_ratingAvg_idx`(`status`, `ratingAvg`),
    INDEX `download_files_status_featured_idx`(`status`, `featured`),
    INDEX `download_files_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileId` INTEGER NOT NULL,
    `label` LONGTEXT NOT NULL DEFAULT (''),
    `changelogJson` JSON NULL,
    `changelogHtml` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('SCANNING', 'PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'HIDDEN') NOT NULL DEFAULT 'SCANNING',
    `size` BIGINT NOT NULL DEFAULT 0,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `createdById` LONGTEXT NULL,
    `rejectReason` LONGTEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `download_versions_fileId_createdAt_idx`(`fileId`, `createdAt`),
    INDEX `download_versions_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_assets` (
    `id` VARCHAR(191) NOT NULL,
    `fileId` INTEGER NULL,
    `versionId` INTEGER NULL,
    `categoryId` INTEGER NULL,
    `uploaderId` VARCHAR(191) NULL,
    `source` ENUM('UPLOAD', 'LINK', 'PATH') NOT NULL DEFAULT 'UPLOAD',
    `state` ENUM('UPLOADING', 'RECEIVED', 'READY', 'FAILED') NOT NULL DEFAULT 'UPLOADING',
    `name` LONGTEXT NOT NULL,
    `url` LONGTEXT NULL,
    `storageKey` VARCHAR(191) NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `mime` LONGTEXT NOT NULL DEFAULT ('application/octet-stream'),
    `kind` LONGTEXT NOT NULL DEFAULT (''),
    `sha256` LONGTEXT NULL,
    `chunkSize` INTEGER NOT NULL DEFAULT 0,
    `received` BIGINT NOT NULL DEFAULT 0,
    `scanStatus` ENUM('PENDING', 'CLEAN', 'INFECTED', 'ERROR', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `scanResult` LONGTEXT NULL,
    `scanEngine` LONGTEXT NULL,
    `scannedAt` DATETIME(3) NULL,
    `error` LONGTEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `download_assets_storageKey_key`(`storageKey`),
    INDEX `download_assets_fileId_idx`(`fileId`),
    INDEX `download_assets_versionId_idx`(`versionId`),
    INDEX `download_assets_uploaderId_createdAt_idx`(`uploaderId`, `createdAt`),
    INDEX `download_assets_state_createdAt_idx`(`state`, `createdAt`),
    INDEX `download_assets_scanStatus_scannedAt_idx`(`scanStatus`, `scannedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `bodyJson` JSON NULL,
    `bodyHtml` LONGTEXT NOT NULL DEFAULT (''),
    `version` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('VISIBLE', 'PENDING', 'HIDDEN') NOT NULL DEFAULT 'VISIBLE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `download_reviews_fileId_status_createdAt_idx`(`fileId`, `status`, `createdAt`),
    UNIQUE INDEX `download_reviews_fileId_userId_key`(`fileId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `bodyJson` JSON NULL,
    `bodyHtml` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('VISIBLE', 'PENDING', 'HIDDEN') NOT NULL DEFAULT 'VISIBLE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `download_comments_fileId_status_createdAt_idx`(`fileId`, `status`, `createdAt`),
    INDEX `download_comments_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileId` INTEGER NOT NULL,
    `versionId` INTEGER NULL,
    `assetId` LONGTEXT NULL,
    `userId` VARCHAR(191) NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `download_logs_fileId_createdAt_idx`(`fileId`, `createdAt`),
    INDEX `download_logs_userId_fileId_idx`(`userId`, `fileId`),
    INDEX `download_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `download_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `type` LONGTEXT NOT NULL DEFAULT ('text'),
    `options` JSON NOT NULL DEFAULT ('[]'),
    `multiple` BOOLEAN NOT NULL DEFAULT false,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `location` LONGTEXT NOT NULL DEFAULT ('sidebar'),
    `inTopic` BOOLEAN NOT NULL DEFAULT false,
    `topicFormat` LONGTEXT NOT NULL DEFAULT (''),
    `viewGroups` JSON NOT NULL DEFAULT ('[]'),
    `editGroups` JSON NOT NULL DEFAULT ('[]'),
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `download_fields_position_idx`(`position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `download_categories` ADD CONSTRAINT `download_categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `download_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_files` ADD CONSTRAINT `download_files_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `download_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_versions` ADD CONSTRAINT `download_versions_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `download_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_assets` ADD CONSTRAINT `download_assets_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `download_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_assets` ADD CONSTRAINT `download_assets_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `download_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_reviews` ADD CONSTRAINT `download_reviews_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `download_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_comments` ADD CONSTRAINT `download_comments_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `download_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `download_logs` ADD CONSTRAINT `download_logs_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `download_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
