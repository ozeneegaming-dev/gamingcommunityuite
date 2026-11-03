-- Formularul de contact: mesajele primite (ACP › Setări › Contact; ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `contact_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` LONGTEXT NULL,
    `name` LONGTEXT NOT NULL,
    `email` LONGTEXT NOT NULL,
    `subject` LONGTEXT NOT NULL,
    `body` LONGTEXT NOT NULL,
    `ip` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'new',
    `handledById` LONGTEXT NULL,
    `handledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `contact_messages_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `contact_messages_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
