-- Webhook-urile: endpointurile și evenimentele lor (ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `url` LONGTEXT NOT NULL,
    `format` LONGTEXT NOT NULL DEFAULT ('json'),
    `secret` LONGTEXT NOT NULL,
    `events` JSON NOT NULL DEFAULT ('[]'),
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
