-- CreateTable
CREATE TABLE `registration_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locale` LONGTEXT NULL,
    `question` LONGTEXT NOT NULL,
    `answers` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spam_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(191) NOT NULL,
    `userId` LONGTEXT NULL,
    `ip` LONGTEXT NULL,
    `email` LONGTEXT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `spam_logs_kind_createdAt_idx`(`kind`, `createdAt`),
    INDEX `spam_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

