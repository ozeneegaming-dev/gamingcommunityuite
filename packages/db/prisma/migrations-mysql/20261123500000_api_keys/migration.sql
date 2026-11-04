-- API: cheile de acces (doar prefixul și hash-ul; ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `api_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `hash` LONGTEXT NOT NULL,
    `scopes` JSON NOT NULL DEFAULT ('[]'),
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `api_keys_prefix_key`(`prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
