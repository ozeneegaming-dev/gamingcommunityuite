-- Recomandări: cine a adus pe cine (linkul de invitație) și recompensa la calificare (ca pe PostgreSQL).

-- CreateTable
CREATE TABLE `referrals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `referrerId` VARCHAR(191) NOT NULL,
    `referredId` VARCHAR(191) NOT NULL,
    `ip` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `qualifiedAt` DATETIME(3) NULL,
    `rewardedPoints` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `referrals_referredId_key`(`referredId`),
    INDEX `referrals_referrerId_idx`(`referrerId`),
    INDEX `referrals_qualifiedAt_idx`(`qualifiedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
