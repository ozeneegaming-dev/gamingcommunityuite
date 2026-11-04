-- Aplicația Pagini: arborele de pagini și foldere, bazele de date (categorii, înregistrări, comentarii) și biblioteca media (ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `pages_nodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `kind` LONGTEXT NOT NULL DEFAULT ('page'),
    `title` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `icon` LONGTEXT NULL,
    `contentType` LONGTEXT NOT NULL DEFAULT ('layout'),
    `layout` JSON NOT NULL DEFAULT ('{}'),
    `databaseId` INTEGER NULL,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `showTitle` BOOLEAN NOT NULL DEFAULT true,
    `viewGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `seoTitle` LONGTEXT NULL,
    `seoDescription` LONGTEXT NULL,
    `seoImageId` LONGTEXT NULL,
    `noindex` BOOLEAN NOT NULL DEFAULT false,
    `inMenu` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` LONGTEXT NULL,

    UNIQUE INDEX `pages_nodes_path_key`(`path`),
    UNIQUE INDEX `pages_nodes_databaseId_key`(`databaseId`),
    INDEX `pages_nodes_parentId_position_idx`(`parentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_databases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `icon` LONGTEXT NULL,
    `template` LONGTEXT NOT NULL DEFAULT ('blank'),
    `recordLabel` LONGTEXT NOT NULL DEFAULT (''),
    `fields` JSON NOT NULL DEFAULT ('[]'),
    `listLayout` LONGTEXT NOT NULL DEFAULT ('list'),
    `sort` LONGTEXT NOT NULL DEFAULT ('newest'),
    `perPage` INTEGER NOT NULL DEFAULT 20,
    `comments` BOOLEAN NOT NULL DEFAULT true,
    `ratings` BOOLEAN NOT NULL DEFAULT true,
    `submissions` BOOLEAN NOT NULL DEFAULT false,
    `approval` BOOLEAN NOT NULL DEFAULT true,
    `authorEdit` BOOLEAN NOT NULL DEFAULT true,
    `searchable` BOOLEAN NOT NULL DEFAULT true,
    `inStream` BOOLEAN NOT NULL DEFAULT true,
    `viewGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `submitGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `commentGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `rateGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `recordsCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pages_databases_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `databaseId` INTEGER NOT NULL,
    `name` LONGTEXT NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `icon` LONGTEXT NULL,
    `color` LONGTEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `recordsCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `pages_categories_databaseId_position_idx`(`databaseId`, `position`),
    UNIQUE INDEX `pages_categories_databaseId_slug_key`(`databaseId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `databaseId` INTEGER NOT NULL,
    `categoryId` INTEGER NULL,
    `authorId` VARCHAR(191) NULL,
    `title` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `contentJson` JSON NULL,
    `contentHtml` LONGTEXT NOT NULL DEFAULT (''),
    `imageId` LONGTEXT NULL,
    `fields` JSON NOT NULL DEFAULT ('{}'),
    `searchText` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('PUBLISHED', 'PENDING', 'REJECTED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
    `rejectReason` LONGTEXT NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `views` INTEGER NOT NULL DEFAULT 0,
    `commentsCount` INTEGER NOT NULL DEFAULT 0,
    `ratingAvg` DOUBLE NOT NULL DEFAULT 0,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `reviewedById` LONGTEXT NULL,
    `lastCommentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pages_records_databaseId_status_publishedAt_idx`(`databaseId`, `status`, `publishedAt`),
    INDEX `pages_records_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `pages_records_authorId_idx`(`authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `editedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `pages_comments_recordId_createdAt_idx`(`recordId`, `createdAt`),
    INDEX `pages_comments_authorId_idx`(`authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_media_folders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `name` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `pages_media_folders_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pages_media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `folderId` INTEGER NULL,
    `attachmentId` VARCHAR(191) NOT NULL,
    `title` LONGTEXT NOT NULL,
    `alt` LONGTEXT NOT NULL DEFAULT (''),
    `uploadedById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `pages_media_attachmentId_key`(`attachmentId`),
    INDEX `pages_media_folderId_createdAt_idx`(`folderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pages_nodes` ADD CONSTRAINT `pages_nodes_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `pages_nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_nodes` ADD CONSTRAINT `pages_nodes_databaseId_fkey` FOREIGN KEY (`databaseId`) REFERENCES `pages_databases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_categories` ADD CONSTRAINT `pages_categories_databaseId_fkey` FOREIGN KEY (`databaseId`) REFERENCES `pages_databases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_records` ADD CONSTRAINT `pages_records_databaseId_fkey` FOREIGN KEY (`databaseId`) REFERENCES `pages_databases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_records` ADD CONSTRAINT `pages_records_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `pages_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_comments` ADD CONSTRAINT `pages_comments_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `pages_records`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_media_folders` ADD CONSTRAINT `pages_media_folders_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `pages_media_folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pages_media` ADD CONSTRAINT `pages_media_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `pages_media_folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

