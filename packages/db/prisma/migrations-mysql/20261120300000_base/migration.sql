-- Ediția Lite: schema completă pentru MySQL 8 / MariaDB 10.6+ (generată de scripts/mysql-base.mjs).
SET FOREIGN_KEY_CHECKS = 0;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `nameNormalized` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `image` LONGTEXT NULL,
    `primaryGroupId` INTEGER NOT NULL,
    `previousPrimaryGroupId` INTEGER NULL,
    `nameGroupId` INTEGER NULL,
    `displayGroupChoiceId` INTEGER NULL,
    `locale` LONGTEXT NOT NULL DEFAULT ('ro'),
    `timezone` LONGTEXT NOT NULL DEFAULT ('Europe/Bucharest'),
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorSecret` LONGTEXT NULL,
    `lastActiveAt` DATETIME(3) NULL,
    `lastAcpAuthAt` DATETIME(3) NULL,
    `lastAcpAuthIp` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `postsCount` INTEGER NOT NULL DEFAULT 0,
    `approvedPostsCount` INTEGER NOT NULL DEFAULT 0,
    `reputation` INTEGER NOT NULL DEFAULT 0,
    `bio` LONGTEXT NOT NULL DEFAULT (''),
    `accentColor` LONGTEXT NULL,
    `coverAttachmentId` LONGTEXT NULL,
    `coverPositionY` INTEGER NOT NULL DEFAULT 50,
    `privacy` JSON NOT NULL DEFAULT ('{}'),
    `points` INTEGER NOT NULL DEFAULT 0,
    `followersCount` INTEGER NOT NULL DEFAULT 0,
    `solutionsCount` INTEGER NOT NULL DEFAULT 0,
    `rankId` INTEGER NULL,
    `nameStyleId` INTEGER NULL,
    `avatarFrameId` INTEGER NULL,
    `birthday` DATE NULL,
    `birthdayVisible` BOOLEAN NOT NULL DEFAULT false,
    `signatureJson` JSON NULL,
    `signatureHtml` LONGTEXT NOT NULL DEFAULT (''),
    `customTitle` LONGTEXT NULL,
    `prefs` JSON NOT NULL DEFAULT ('{}'),
    `registrationIp` LONGTEXT NULL,
    `birthdayShowYear` BOOLEAN NOT NULL DEFAULT false,
    `isSpammer` BOOLEAN NOT NULL DEFAULT false,
    `passwordResetRequestedAt` DATETIME(3) NULL,
    `lastIp` LONGTEXT NULL,

    UNIQUE INDEX `users_nameNormalized_key`(`nameNormalized`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_primaryGroupId_idx`(`primaryGroupId`),
    INDEX `users_createdAt_idx`(`createdAt`),
    INDEX `users_lastActiveAt_idx`(`lastActiveAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `ipAddress` LONGTEXT NULL,
    `userAgent` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sessions_token_key`(`token`),
    INDEX `sessions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `accessToken` LONGTEXT NULL,
    `refreshToken` LONGTEXT NULL,
    `idToken` LONGTEXT NULL,
    `accessTokenExpiresAt` DATETIME(3) NULL,
    `refreshTokenExpiresAt` DATETIME(3) NULL,
    `scope` LONGTEXT NULL,
    `password` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `accounts_userId_idx`(`userId`),
    UNIQUE INDEX `accounts_providerId_accountId_key`(`providerId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verifications` (
    `id` VARCHAR(191) NOT NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `verifications_identifier_idx`(`identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `two_factors` (
    `id` VARCHAR(191) NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `backupCodes` LONGTEXT NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT true,
    `failedVerificationCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,

    INDEX `two_factors_secret_idx`(`secret`),
    INDEX `two_factors_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `isProtected` BOOLEAN NOT NULL DEFAULT false,
    `isVip` BOOLEAN NOT NULL DEFAULT false,
    `color` LONGTEXT NULL,
    `nameStyle` JSON NULL,
    `title` LONGTEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `icon` LONGTEXT NULL,
    `banner` LONGTEXT NULL,
    `inLegend` BOOLEAN NOT NULL DEFAULT true,
    `optIn` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `groups_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_groups` (
    `userId` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `source` LONGTEXT NOT NULL DEFAULT ('manual'),
    `expiresAt` DATETIME(3) NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `addedById` LONGTEXT NULL,

    INDEX `user_groups_groupId_idx`(`groupId`),
    INDEX `user_groups_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`userId`, `groupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `title` LONGTEXT NULL,
    `layout` LONGTEXT NOT NULL DEFAULT ('detailed'),
    `position` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `staff_sections_groupId_key`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_profiles` (
    `userId` VARCHAR(191) NOT NULL,
    `descriptionJson` JSON NULL,
    `descriptionHtml` LONGTEXT NOT NULL DEFAULT (''),
    `duties` JSON NOT NULL DEFAULT ('[]'),
    `position` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,

    UNIQUE INDEX `group_settings_groupId_key_key`(`groupId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `container_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `containerType` VARCHAR(191) NOT NULL,
    `containerId` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,

    INDEX `container_permissions_containerType_containerId_idx`(`containerType`, `containerId`),
    UNIQUE INDEX `container_permissions_containerType_containerId_groupId_acti_key`(`containerType`, `containerId`, `groupId`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `container_inherit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `containerType` VARCHAR(191) NOT NULL,
    `containerId` VARCHAR(191) NOT NULL,
    `parentId` LONGTEXT NULL,
    `inherits` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `container_inherit_containerType_containerId_key`(`containerType`, `containerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderators` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `containerType` VARCHAR(191) NOT NULL,
    `containerId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `groupId` INTEGER NULL,
    `powers` JSON NOT NULL DEFAULT ('[]'),

    INDEX `moderators_containerType_containerId_idx`(`containerType`, `containerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bans` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('ACCOUNT', 'IP', 'EMAIL') NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `reason` LONGTEXT NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `liftedAt` DATETIME(3) NULL,

    INDEX `bans_type_value_idx`(`type`, `value`),
    INDEX `bans_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warnings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `reason` LONGTEXT NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `issuedById` VARCHAR(191) NULL,
    `evidence` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `warnings_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warning_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `threshold` INTEGER NOT NULL,
    `action` ENUM('MODERATE_POSTS', 'RESTRICT', 'BAN') NOT NULL,
    `durationHours` INTEGER NULL,

    UNIQUE INDEX `warning_actions_threshold_key`(`threshold`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acp_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `acp_roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acp_role_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roleId` INTEGER NOT NULL,
    `section` VARCHAR(191) NOT NULL,
    `canView` BOOLEAN NOT NULL DEFAULT false,
    `canEdit` BOOLEAN NOT NULL DEFAULT false,
    `canDelete` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `acp_role_permissions_roleId_section_key`(`roleId`, `section`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acp_role_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roleId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NULL,
    `groupId` INTEGER NULL,

    INDEX `acp_role_assignments_userId_idx`(`userId`),
    INDEX `acp_role_assignments_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acp_dashboard_layouts` (
    `userId` VARCHAR(191) NOT NULL,
    `layout` JSON NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_notes` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `body` LONGTEXT NOT NULL DEFAULT (''),
    `updatedById` LONGTEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_state` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `installedAt` DATETIME(3) NULL,
    `permVersion` INTEGER NOT NULL DEFAULT 0,
    `appVersion` LONGTEXT NOT NULL DEFAULT ('1.0.0'),
    `seedMarks` JSON NOT NULL DEFAULT ('[]'),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` LONGTEXT NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_actorId_idx`(`actorId`),
    INDEX `audit_logs_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forums` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `type` ENUM('CATEGORY', 'FORUM', 'LINK', 'QA', 'PAGE') NOT NULL DEFAULT 'FORUM',
    `name` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `icon` LONGTEXT NULL,
    `color` LONGTEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `linkUrl` LONGTEXT NULL,
    `requireApproval` BOOLEAN NOT NULL DEFAULT false,
    `subforumColumns` INTEGER NOT NULL DEFAULT 2,
    `topicsCount` INTEGER NOT NULL DEFAULT 0,
    `postsCount` INTEGER NOT NULL DEFAULT 0,
    `lastPostId` INTEGER NULL,
    `lastPostAt` DATETIME(3) NULL,
    `lastTopicId` INTEGER NULL,
    `lastPosterId` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `ownTopicsOnly` BOOLEAN NOT NULL DEFAULT false,
    `passwordHash` LONGTEXT NULL,
    `rulesMode` LONGTEXT NOT NULL DEFAULT ('off'),
    `rulesJson` JSON NULL,
    `rulesHtml` LONGTEXT NOT NULL DEFAULT (''),
    `defaultSort` LONGTEXT NOT NULL DEFAULT ('last'),
    `pollsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `tagsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `minPosts` INTEGER NOT NULL DEFAULT 0,
    `countPosts` BOOLEAN NOT NULL DEFAULT true,
    `autoCloseDays` INTEGER NOT NULL DEFAULT 0,
    `ratingEnabled` BOOLEAN NOT NULL DEFAULT false,

    INDEX `forums_parentId_position_idx`(`parentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_extension_data` (
    `forumId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL DEFAULT ('{}'),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` LONGTEXT NULL,

    PRIMARY KEY (`forumId`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_pages` (
    `forumId` INTEGER NOT NULL,
    `contentJson` JSON NULL,
    `contentHtml` LONGTEXT NOT NULL DEFAULT (''),
    `ctaLabel` LONGTEXT NULL,
    `ctaUrl` LONGTEXT NULL,
    `ctaIcon` LONGTEXT NULL,
    `allowTopics` BOOLEAN NOT NULL DEFAULT false,
    `audienceGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` LONGTEXT NULL,

    PRIMARY KEY (`forumId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_rules_acceptances` (
    `forumId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`forumId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `forumId` INTEGER NOT NULL,
    `title` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `prefixId` INTEGER NULL,
    `visibility` ENUM('VISIBLE', 'PENDING', 'HIDDEN') NOT NULL DEFAULT 'VISIBLE',
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `solvedPostId` INTEGER NULL,
    `firstPostId` INTEGER NULL,
    `lastPostId` INTEGER NULL,
    `lastPostAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastPosterId` LONGTEXT NULL,
    `repliesCount` INTEGER NOT NULL DEFAULT 0,
    `viewsCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `ratingAvg` DOUBLE NOT NULL DEFAULT 0,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `recommendedPostId` INTEGER NULL,
    `requireApproval` BOOLEAN NOT NULL DEFAULT false,
    `archivedAt` DATETIME(3) NULL,
    `archivedById` LONGTEXT NULL,

    INDEX `topics_forumId_visibility_pinned_lastPostAt_idx`(`forumId`, `visibility`, `pinned` DESC, `lastPostAt` DESC),
    INDEX `topics_forumId_ratingAvg_idx`(`forumId`, `ratingAvg` DESC),
    INDEX `topics_authorId_idx`(`authorId`),
    INDEX `topics_createdAt_id_idx`(`createdAt` DESC, `id` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `posts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topicId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `visibility` ENUM('VISIBLE', 'PENDING', 'HIDDEN') NOT NULL DEFAULT 'VISIBLE',
    `hiddenById` LONGTEXT NULL,
    `hiddenReason` LONGTEXT NULL,
    `editedAt` DATETIME(3) NULL,
    `editedById` LONGTEXT NULL,
    `ip` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `hiddenParts` JSON NULL,

    INDEX `posts_topicId_visibility_id_idx`(`topicId`, `visibility`, `id`),
    INDEX `posts_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `posts_createdAt_id_idx`(`createdAt` DESC, `id` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topic_notices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topicId` INTEGER NOT NULL,
    `authorId` LONGTEXT NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `tone` LONGTEXT NOT NULL DEFAULT ('info'),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `topic_notices_topicId_idx`(`topicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `archive_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `conditions` JSON NOT NULL,
    `exclusions` JSON NOT NULL DEFAULT ('{}'),
    `position` INTEGER NOT NULL DEFAULT 0,
    `lastRunAt` DATETIME(3) NULL,
    `lastCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_revisions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `postId` INTEGER NOT NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `editorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `post_revisions_postId_idx`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topic_prefixes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `color` LONGTEXT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_prefixes` (
    `forumId` INTEGER NOT NULL,
    `prefixId` INTEGER NOT NULL,

    PRIMARY KEY (`forumId`, `prefixId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `slug` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `tags_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topic_tags` (
    `topicId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,

    INDEX `topic_tags_tagId_idx`(`tagId`),
    PRIMARY KEY (`topicId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `polls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topicId` INTEGER NOT NULL,
    `question` LONGTEXT NOT NULL,
    `multiple` BOOLEAN NOT NULL DEFAULT false,
    `closesAt` DATETIME(3) NULL,

    UNIQUE INDEX `polls_topicId_key`(`topicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poll_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pollId` INTEGER NOT NULL,
    `text` LONGTEXT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `votesCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `poll_options_pollId_idx`(`pollId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poll_votes` (
    `pollId` INTEGER NOT NULL,
    `optionId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `poll_votes_pollId_userId_idx`(`pollId`, `userId`),
    PRIMARY KEY (`pollId`, `optionId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `label` LONGTEXT NOT NULL,
    `symbol` LONGTEXT NOT NULL,
    `color` LONGTEXT NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `reactions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_ratings` (
    `contentType` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `content_ratings_userId_idx`(`userId`),
    PRIMARY KEY (`contentType`, `contentId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `post_votes` (
    `postId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `post_votes_userId_idx`(`userId`),
    PRIMARY KEY (`postId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_rating_summaries` (
    `contentType` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `sum` INTEGER NOT NULL DEFAULT 0,
    `avg` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `content_rating_summaries_contentType_avg_idx`(`contentType`, `avg` DESC),
    PRIMARY KEY (`contentType`, `contentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_reactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contentType` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reactionId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `content_reactions_contentType_contentId_idx`(`contentType`, `contentId`),
    INDEX `content_reactions_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `content_reactions_contentType_contentId_userId_key`(`contentType`, `contentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `read_markers` (
    `userId` VARCHAR(191) NOT NULL,
    `topicId` INTEGER NOT NULL,
    `lastReadPostId` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `read_markers_topicId_idx`(`topicId`),
    PRIMARY KEY (`userId`, `topicId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forum_read_marks` (
    `userId` VARCHAR(191) NOT NULL,
    `forumId` INTEGER NOT NULL,
    `markedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`, `forumId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `follows_contentType_contentId_idx`(`contentType`, `contentId`),
    UNIQUE INDEX `follows_userId_contentType_contentId_key`(`userId`, `contentType`, `contentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `contentId` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NULL,
    `reason` LONGTEXT NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `handledById` LONGTEXT NULL,
    `handledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `reports_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `reports_contentType_contentId_idx`(`contentType`, `contentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachments` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `filename` LONGTEXT NOT NULL,
    `mime` LONGTEXT NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `contentType` VARCHAR(191) NULL,
    `contentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `attachments_storageKey_key`(`storageKey`),
    INDEX `attachments_contentType_contentId_idx`(`contentType`, `contentId`),
    INDEX `attachments_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mod_saved_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `forumIds` JSON NOT NULL DEFAULT ('[]'),
    `actions` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profile_field_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `label` LONGTEXT NOT NULL,
    `helper` LONGTEXT NOT NULL DEFAULT (''),
    `icon` LONGTEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `profile_field_groups_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profile_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `label` LONGTEXT NOT NULL,
    `type` ENUM('TEXT', 'TEXTAREA', 'URL', 'NUMBER', 'SELECT', 'IMAGE_SELECT', 'SERVER_SELECT') NOT NULL DEFAULT 'TEXT',
    `options` JSON NOT NULL DEFAULT ('[]'),
    `section` ENUM('ABOUT', 'GAMES') NOT NULL DEFAULT 'ABOUT',
    `required` BOOLEAN NOT NULL DEFAULT false,
    `maxLength` INTEGER NOT NULL DEFAULT 200,
    `visibility` ENUM('PUBLIC', 'MEMBERS', 'STAFF') NOT NULL DEFAULT 'PUBLIC',
    `showOnCard` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,
    `icon` LONGTEXT NULL,
    `showInPostbit` BOOLEAN NOT NULL DEFAULT false,
    `optionImages` JSON NOT NULL DEFAULT ('{}'),
    `groupId` INTEGER NULL,
    `helper` LONGTEXT NOT NULL DEFAULT (''),
    `linkTemplate` LONGTEXT NULL,

    UNIQUE INDEX `profile_fields_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profile_field_values` (
    `userId` VARCHAR(191) NOT NULL,
    `fieldId` INTEGER NOT NULL,
    `value` LONGTEXT NOT NULL,
    `json` JSON NULL,
    `html` LONGTEXT NOT NULL DEFAULT (''),

    INDEX `profile_field_values_fieldId_idx`(`fieldId`),
    PRIMARY KEY (`userId`, `fieldId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `status_updates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profileUserId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `parentId` INTEGER NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `visibility` ENUM('VISIBLE', 'PENDING', 'HIDDEN') NOT NULL DEFAULT 'VISIBLE',
    `repliesCount` INTEGER NOT NULL DEFAULT 0,
    `ip` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `status_updates_profileUserId_parentId_createdAt_idx`(`profileUserId`, `parentId`, `createdAt`),
    INDEX `status_updates_createdAt_id_idx`(`createdAt` DESC, `id` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_ignores` (
    `userId` VARCHAR(191) NOT NULL,
    `ignoredId` VARCHAR(191) NOT NULL,
    `posts` BOOLEAN NOT NULL DEFAULT true,
    `messages` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `user_ignores_ignoredId_idx`(`ignoredId`),
    PRIMARY KEY (`userId`, `ignoredId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` LONGTEXT NOT NULL,
    `starterId` LONGTEXT NULL,
    `lastMessageId` INTEGER NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `messagesCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_participants` (
    `conversationId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `leftAt` DATETIME(3) NULL,
    `lastReadMessageId` INTEGER NOT NULL DEFAULT 0,
    `invitedById` LONGTEXT NULL,

    INDEX `conversation_participants_userId_leftAt_idx`(`userId`, `leftAt`),
    PRIMARY KEY (`conversationId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `editedAt` DATETIME(3) NULL,
    `ip` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `conversation_messages_conversationId_id_idx`(`conversationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ranks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `icon` LONGTEXT NULL,
    `minPosts` INTEGER NULL,
    `minPoints` INTEGER NULL,
    `minReputation` INTEGER NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `emblemTier` LONGTEXT NULL,
    `emblemShape` LONGTEXT NULL,
    `emblemIcon` LONGTEXT NULL,
    `color` LONGTEXT NULL,
    `imageAttachmentId` LONGTEXT NULL,
    `animated` BOOLEAN NOT NULL DEFAULT false,
    `match` LONGTEXT NOT NULL DEFAULT ('all'),
    `criteria` JSON NOT NULL DEFAULT ('[]'),
    `perkGroupId` INTEGER NULL,
    `perkBadgeId` INTEGER NULL,
    `perkNameStyleId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `badges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `symbol` LONGTEXT NULL,
    `imageAttachmentId` LONGTEXT NULL,
    `color` LONGTEXT NOT NULL,
    `artShape` LONGTEXT NULL,
    `artTier` LONGTEXT NULL,
    `artIcon` LONGTEXT NULL,
    `manual` BOOLEAN NOT NULL DEFAULT false,
    `points` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `badges_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_badges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` INTEGER NOT NULL,
    `awardedById` LONGTEXT NULL,
    `reason` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastAwardedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `timesAwarded` INTEGER NOT NULL DEFAULT 1,

    INDEX `user_badges_badgeId_idx`(`badgeId`),
    INDEX `user_badges_lastAwardedAt_idx`(`lastAwardedAt`),
    UNIQUE INDEX `user_badges_userId_badgeId_key`(`userId`, `badgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievement_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NULL,
    `name` LONGTEXT NOT NULL,
    `trigger` ENUM('POSTS_COUNT', 'REPUTATION', 'POINTS', 'MEMBER_DAYS', 'SOLUTIONS_COUNT', 'IS_VIP', 'EACH_POST', 'EACH_REACTION_RECEIVED', 'EACH_SOLUTION', 'EVENT') NOT NULL,
    `threshold` INTEGER NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `badgeId` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `event` VARCHAR(191) NULL,
    `conditions` JSON NOT NULL DEFAULT ('{}'),
    `rewards` JSON NOT NULL DEFAULT ('{}'),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `achievement_rules_key_key`(`key`),
    INDEX `achievement_rules_event_idx`(`event`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievement_occurrences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `ref` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `achievement_occurrences_ruleId_userId_createdAt_idx`(`ruleId`, `userId`, `createdAt`),
    UNIQUE INDEX `achievement_occurrences_ruleId_userId_ref_key`(`ruleId`, `userId`, `ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievement_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `ruleId` INTEGER NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `uniqueKey` VARCHAR(191) NULL,
    `contentRef` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `achievement_log_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `achievement_log_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `achievement_log_userId_uniqueKey_key`(`userId`, `uniqueKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_promotions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `fromGroupIds` JSON NOT NULL DEFAULT ('[]'),
    `toGroupId` INTEGER NOT NULL,
    `asPrimary` BOOLEAN NOT NULL DEFAULT true,
    `minPosts` INTEGER NULL,
    `minDays` INTEGER NULL,
    `minReputation` INTEGER NULL,
    `minPoints` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vip_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NULL,
    `source` ENUM('MANUAL', 'STORE') NOT NULL DEFAULT 'MANUAL',
    `grantedById` LONGTEXT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `warnedAt` DATETIME(3) NULL,
    `madePrimary` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `vip_subscriptions_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `vip_subscriptions_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vip_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NULL,
    `action` ENUM('GRANT', 'EXTEND', 'REVOKE', 'EXPIRE') NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `actorId` LONGTEXT NULL,
    `note` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `vip_log_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `vip_log_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `name_styles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `style` JSON NOT NULL,
    `allGroups` BOOLEAN NOT NULL DEFAULT false,
    `groupIds` JSON NOT NULL DEFAULT ('[]'),
    `badgeIds` JSON NOT NULL DEFAULT ('[]'),
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `name_styles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `avatar_frames` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `kind` ENUM('CSS', 'IMAGE') NOT NULL DEFAULT 'CSS',
    `style` JSON NULL,
    `imageAttachmentId` LONGTEXT NULL,
    `allGroups` BOOLEAN NOT NULL DEFAULT false,
    `groupIds` JSON NOT NULL DEFAULT ('[]'),
    `badgeIds` JSON NOT NULL DEFAULT ('[]'),
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `avatar_frames_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `type` LONGTEXT NOT NULL,
    `targetType` LONGTEXT NOT NULL,
    `targetId` LONGTEXT NOT NULL,
    `groupKey` LONGTEXT NOT NULL,
    `actorIds` JSON NOT NULL DEFAULT ('[]'),
    `count` INTEGER NOT NULL DEFAULT 1,
    `data` JSON NOT NULL,
    `readAt` DATETIME(3) NULL,
    `emailedAt` DATETIME(3) NULL,
    `site` BOOLEAN NOT NULL DEFAULT true,
    `important` BOOLEAN NOT NULL DEFAULT false,
    `channels` JSON NOT NULL DEFAULT ('{}'),
    `clickedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notifications_userId_readAt_updatedAt_idx`(`userId`, `readAt`, `updatedAt`),
    INDEX `notifications_readAt_emailedAt_idx`(`readAt`, `emailedAt`),
    INDEX `notifications_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `channels` JSON NOT NULL DEFAULT ('{}'),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`userId`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_defaults` (
    `type` VARCHAR(191) NOT NULL,
    `channels` JSON NOT NULL DEFAULT ('{}'),
    `locks` JSON NOT NULL DEFAULT ('{}'),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_members` (
    `userId` VARCHAR(191) NOT NULL,
    `emailsOff` BOOLEAN NOT NULL DEFAULT false,
    `emailsOffAt` DATETIME(3) NULL,
    `emailsOffById` LONGTEXT NULL,
    `weeklySentAt` DATETIME(3) NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `p256dh` LONGTEXT NOT NULL,
    `auth` LONGTEXT NOT NULL,
    `userAgent` LONGTEXT NOT NULL DEFAULT (''),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastUsedAt` DATETIME(3) NULL,
    `failures` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_stats` (
    `day` DATE NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `sent` INTEGER NOT NULL DEFAULT 0,
    `clicked` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`, `type`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `position` INTEGER NOT NULL DEFAULT 0,
    `slowModeSeconds` INTEGER NOT NULL DEFAULT 0,
    `retentionDays` INTEGER NOT NULL DEFAULT 7,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `showOnHome` BOOLEAN NOT NULL DEFAULT false,
    `type` ENUM('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PUBLIC',
    `ownerId` VARCHAR(191) NULL,
    `pinnedMessageId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `chat_channels_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channelId` INTEGER NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `body` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `deletedAt` DATETIME(3) NULL,
    `deletedById` LONGTEXT NULL,
    `editedAt` DATETIME(3) NULL,
    `files` JSON NOT NULL DEFAULT ('[]'),
    `replyToId` INTEGER NULL,
    `meta` JSON NULL,
    `hiddenAt` DATETIME(3) NULL,
    `hiddenById` LONGTEXT NULL,

    INDEX `chat_messages_channelId_id_idx`(`channelId`, `id`),
    INDEX `chat_messages_createdAt_idx`(`createdAt`),
    INDEX `chat_messages_authorId_id_idx`(`authorId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_mutes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `channelId` INTEGER NULL,
    `until` DATETIME(3) NULL,
    `reason` LONGTEXT NOT NULL DEFAULT (''),
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `chat_mutes_userId_until_idx`(`userId`, `until`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_sanctions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('KICK', 'BAN', 'SLOW') NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `channelId` INTEGER NULL,
    `until` DATETIME(3) NULL,
    `seconds` INTEGER NOT NULL DEFAULT 0,
    `reason` LONGTEXT NOT NULL DEFAULT (''),
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `liftedAt` DATETIME(3) NULL,
    `liftedById` LONGTEXT NULL,

    INDEX `chat_sanctions_userId_kind_idx`(`userId`, `kind`),
    INDEX `chat_sanctions_until_idx`(`until`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_mod_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` VARCHAR(191) NULL,
    `action` LONGTEXT NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `channelKey` LONGTEXT NULL,
    `messageId` INTEGER NULL,
    `reason` LONGTEXT NOT NULL DEFAULT (''),
    `data` JSON NULL,
    `ref` LONGTEXT NULL,
    `undoneAt` DATETIME(3) NULL,
    `undoneById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `chat_mod_log_createdAt_idx`(`createdAt`),
    INDEX `chat_mod_log_targetId_idx`(`targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_moderator_grants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `rights` JSON NOT NULL DEFAULT ('[]'),
    `rooms` JSON NOT NULL DEFAULT ('[]'),
    `expiresAt` DATETIME(3) NULL,
    `grantedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_moderator_grants_userId_key`(`userId`),
    INDEX `chat_moderator_grants_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`userId`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apps` (
    `key` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nav_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `label` JSON NOT NULL,
    `description` JSON NULL,
    `badge` LONGTEXT NULL,
    `icon` LONGTEXT NULL,
    `href` LONGTEXT NULL,
    `appKey` LONGTEXT NULL,
    `groups` JSON NOT NULL DEFAULT ('[]'),
    `newTab` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `kind` LONGTEXT NOT NULL DEFAULT ('link'),
    `audience` LONGTEXT NOT NULL DEFAULT ('all'),
    `counter` LONGTEXT NULL,
    `highlight` LONGTEXT NULL,

    INDEX `nav_items_parentId_position_idx`(`parentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nav_drafts` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `items` JSON NOT NULL,
    `updatedById` LONGTEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `themes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `settings` JSON NOT NULL DEFAULT ('{}'),
    `logoUrl` LONGTEXT NULL,
    `faviconUrl` LONGTEXT NULL,
    `draft` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `themes_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `theme_css_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `themeId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `content` LONGTEXT NOT NULL DEFAULT (''),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `theme_css_files_themeId_position_idx`(`themeId`, `position`),
    UNIQUE INDEX `theme_css_files_themeId_name_key`(`themeId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `theme_css_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileId` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `action` LONGTEXT NOT NULL,
    `authorId` LONGTEXT NULL,
    `authorName` LONGTEXT NOT NULL DEFAULT (''),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `theme_css_versions_fileId_id_idx`(`fileId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `theme_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `themeId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `source` LONGTEXT NOT NULL,
    `baseVersion` INTEGER NOT NULL,
    `baseSource` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `theme_templates_themeId_key_key`(`themeId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `theme_template_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `themeId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `source` LONGTEXT NOT NULL,
    `action` LONGTEXT NOT NULL,
    `authorId` LONGTEXT NULL,
    `authorName` LONGTEXT NOT NULL DEFAULT (''),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `theme_template_versions_themeId_key_id_idx`(`themeId`, `key`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `widget_placements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `page` VARCHAR(191) NOT NULL,
    `zone` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `type` LONGTEXT NOT NULL,
    `config` JSON NOT NULL DEFAULT ('{}'),
    `groups` JSON NOT NULL DEFAULT ('[]'),

    INDEX `widget_placements_page_zone_position_idx`(`page`, `zone`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_room_members` (
    `channelId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `invitedById` LONGTEXT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `chat_room_members_userId_idx`(`userId`),
    PRIMARY KEY (`channelId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_message_reactions` (
    `messageId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reactionId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`messageId`, `userId`, `reactionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_announcements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `body` LONGTEXT NOT NULL,
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NULL,

    INDEX `chat_announcements_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_pro_profiles` (
    `userId` VARCHAR(191) NOT NULL,
    `prefs` JSON NOT NULL DEFAULT ('{}'),
    `nickname` LONGTEXT NULL,
    `nicknameNormalized` VARCHAR(191) NULL,
    `badgeIds` JSON NOT NULL DEFAULT ('[]'),
    `emoteFavorites` JSON NOT NULL DEFAULT ('[]'),
    `gifFavorites` JSON NOT NULL DEFAULT ('[]'),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_pro_profiles_nicknameNormalized_key`(`nicknameNormalized`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_pro_daily_stats` (
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `messages` INTEGER NOT NULL DEFAULT 0,

    INDEX `chat_pro_daily_stats_day_idx`(`day`),
    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_online_days` (
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `seconds` INTEGER NOT NULL DEFAULT 0,

    INDEX `member_online_days_day_idx`(`day`),
    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_pro_winners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `periodStart` VARCHAR(191) NOT NULL,
    `periodEnd` LONGTEXT NOT NULL,
    `userId` VARCHAR(191) NULL,
    `messages` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `chat_pro_winners_periodStart_key`(`periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_pro_bar_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` LONGTEXT NOT NULL,
    `ctaLabel` LONGTEXT NOT NULL DEFAULT (''),
    `ctaUrl` LONGTEXT NOT NULL DEFAULT (''),
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `groupIds` JSON NOT NULL DEFAULT ('[]'),
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_emote_packs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_emotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `packId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `attachmentId` LONGTEXT NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `animated` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `chat_emotes_code_key`(`code`),
    INDEX `chat_emotes_packId_position_idx`(`packId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `translation_cache` (
    `hash` VARCHAR(191) NOT NULL,
    `target` LONGTEXT NOT NULL,
    `text` LONGTEXT NOT NULL,
    `provider` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `translation_cache_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugins` (
    `key` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `version` LONGTEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `status` LONGTEXT NOT NULL DEFAULT ('installed'),
    `signed` BOOLEAN NOT NULL DEFAULT false,
    `signatureKeyId` LONGTEXT NULL,
    `capabilities` JSON NOT NULL DEFAULT ('[]'),
    `manifest` JSON NOT NULL,
    `settings` JSON NOT NULL DEFAULT ('{}'),
    `package` LONGBLOB NULL,
    `packageSha256` LONGTEXT NULL,
    `dbRole` LONGTEXT NULL,
    `dbPassword` LONGTEXT NULL,
    `migrations` JSON NOT NULL DEFAULT ('[]'),
    `disabledReason` LONGTEXT NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `lastError` LONGTEXT NULL,
    `lastErrorAt` DATETIME(3) NULL,
    `installedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `installedById` LONGTEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_uploads` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` LONGTEXT NULL,
    `fileName` LONGTEXT NOT NULL,
    `data` LONGBLOB NOT NULL,
    `sha256` LONGTEXT NOT NULL,
    `report` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `plugin_uploads_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pluginKey` VARCHAR(191) NOT NULL,
    `level` LONGTEXT NOT NULL,
    `hook` LONGTEXT NULL,
    `message` LONGTEXT NOT NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `plugin_logs_pluginKey_id_idx`(`pluginKey`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_hook_settings` (
    `pluginKey` VARCHAR(191) NOT NULL,
    `hook` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NULL,

    PRIMARY KEY (`pluginKey`, `hook`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_media` (
    `id` VARCHAR(191) NOT NULL,
    `pluginKey` VARCHAR(191) NOT NULL,
    `kind` LONGTEXT NOT NULL,
    `mime` LONGTEXT NOT NULL,
    `ext` LONGTEXT NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `uploadedBy` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `plugin_media_storageKey_key`(`storageKey`),
    INDEX `plugin_media_pluginKey_status_createdAt_idx`(`pluginKey`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_appearance_styles` (
    `pluginKey` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `css` LONGTEXT NOT NULL,
    `updatedBy` LONGTEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`pluginKey`, `kind`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_appearances` (
    `pluginKey` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `member_appearances_userId_idx`(`userId`),
    PRIMARY KEY (`pluginKey`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `source` LONGTEXT NOT NULL DEFAULT (''),
    `mapKey` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('DRAFT', 'READY', 'QUEUED', 'RUNNING', 'PAUSED', 'CANCELLED', 'FAILED', 'DONE') NOT NULL DEFAULT 'DRAFT',
    `dryRun` BOOLEAN NOT NULL DEFAULT false,
    `config` JSON NOT NULL DEFAULT ('{}'),
    `secret` LONGTEXT NULL,
    `detected` JSON NULL,
    `steps` JSON NOT NULL DEFAULT ('[]'),
    `currentStep` LONGTEXT NULL,
    `control` LONGTEXT NULL,
    `error` LONGTEXT NULL,
    `createdById` LONGTEXT NULL,
    `heartbeatAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `import_jobs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_map` (
    `source` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,

    INDEX `import_map_type_targetId_idx`(`type`, `targetId`),
    PRIMARY KEY (`source`, `type`, `sourceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobId` VARCHAR(191) NOT NULL,
    `step` LONGTEXT NOT NULL,
    `level` LONGTEXT NOT NULL,
    `message` LONGTEXT NOT NULL,
    `sourceId` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `import_logs_jobId_id_idx`(`jobId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plugin_ports` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` LONGTEXT NULL,
    `fileName` LONGTEXT NOT NULL,
    `format` LONGTEXT NOT NULL,
    `sourceName` LONGTEXT NOT NULL,
    `sha256` LONGTEXT NOT NULL,
    `analysis` JSON NOT NULL,
    `source` LONGBLOB NULL,
    `rightsBasis` LONGTEXT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `pluginKey` LONGTEXT NULL,
    `report` JSON NULL,
    `result` LONGBLOB NULL,
    `package` LONGBLOB NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `plugin_ports_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_servers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `game` VARCHAR(191) NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `queryPort` INTEGER NULL,
    `name` LONGTEXT NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `bannerId` LONGTEXT NULL,
    `description` LONGTEXT NOT NULL DEFAULT (''),
    `forumId` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `groups` JSON NOT NULL DEFAULT ('[]'),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `identityMode` LONGTEXT NOT NULL DEFAULT ('mixed'),
    `nameIds` BOOLEAN NOT NULL DEFAULT false,
    `isMix` BOOLEAN NOT NULL DEFAULT false,
    `bridgeSeenAt` DATETIME(3) NULL,
    `bridgePlugin` LONGTEXT NULL,
    `manageAdmins` BOOLEAN NOT NULL DEFAULT false,
    `enforceSanctions` BOOLEAN NOT NULL DEFAULT false,
    `manageVip` BOOLEAN NOT NULL DEFAULT false,
    `mixReady` BOOLEAN NOT NULL DEFAULT false,
    `adminCommands` BOOLEAN NOT NULL DEFAULT false,

    INDEX `game_servers_enabled_position_idx`(`enabled`, `position`),
    UNIQUE INDEX `game_servers_game_host_port_key`(`game`, `host`, `port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_server_admins` (
    `serverId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `game_server_admins_userId_idx`(`userId`),
    PRIMARY KEY (`serverId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `server_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `hourly` BOOLEAN NOT NULL DEFAULT false,
    `online` BOOLEAN NOT NULL,
    `players` INTEGER NOT NULL DEFAULT 0,
    `peak` INTEGER NOT NULL DEFAULT 0,
    `maxPlayers` INTEGER NOT NULL DEFAULT 0,
    `map` LONGTEXT NULL,
    `ping` INTEGER NULL,
    `samples` INTEGER NOT NULL DEFAULT 1,
    `onlineSamples` INTEGER NOT NULL DEFAULT 0,

    INDEX `server_snapshots_serverId_at_idx`(`serverId`, `at`),
    INDEX `server_snapshots_hourly_at_idx`(`hourly`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tag` LONGTEXT NOT NULL,
    `tagNormalized` VARCHAR(191) NOT NULL,
    `name` LONGTEXT NOT NULL,
    `nameNormalized` VARCHAR(191) NOT NULL,
    `slug` LONGTEXT NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'PENDING',
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `lockReason` LONGTEXT NULL,
    `joinMode` ENUM('OPEN', 'REQUEST', 'INVITE') NOT NULL DEFAULT 'REQUEST',
    `descriptionJson` JSON NULL,
    `descriptionHtml` LONGTEXT NOT NULL DEFAULT (''),
    `logoId` LONGTEXT NULL,
    `bannerId` LONGTEXT NULL,
    `color` LONGTEXT NOT NULL DEFAULT ('#D62839'),
    `color2` LONGTEXT NOT NULL DEFAULT ('#1B1E26'),
    `links` JSON NOT NULL DEFAULT ('{}'),
    `officerRights` JSON NOT NULL DEFAULT ('[]'),
    `memberLimit` INTEGER NULL,
    `membersCount` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER NULL,
    `scoreParts` JSON NOT NULL DEFAULT ('{}'),
    `scoredAt` DATETIME(3) NULL,
    `forumId` INTEGER NULL,
    `forumRequested` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `approvedById` LONGTEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clans_tagNormalized_key`(`tagNormalized`),
    UNIQUE INDEX `clans_nameNormalized_key`(`nameNormalized`),
    UNIQUE INDEX `clans_forumId_key`(`forumId`),
    INDEX `clans_status_rank_idx`(`status`, `rank`),
    INDEX `clans_status_membersCount_idx`(`status`, `membersCount`),
    INDEX `clans_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clan_members` (
    `clanId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('LEADER', 'OFFICER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `clan_members_userId_idx`(`userId`),
    PRIMARY KEY (`clanId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clan_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clanId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('REQUEST', 'INVITE') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `message` LONGTEXT NOT NULL DEFAULT (''),
    `invitedById` VARCHAR(191) NULL,
    `decidedById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,

    INDEX `clan_requests_clanId_status_idx`(`clanId`, `status`),
    INDEX `clan_requests_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_server_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `keyId` VARCHAR(191) NOT NULL,
    `signingKey` LONGTEXT NOT NULL,
    `label` LONGTEXT NOT NULL DEFAULT (''),
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastUsedAt` DATETIME(3) NULL,
    `lastIp` LONGTEXT NULL,
    `revokedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `game_server_keys_keyId_key`(`keyId`),
    INDEX `game_server_keys_serverId_idx`(`serverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_server_enrollments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ref` VARCHAR(191) NOT NULL,
    `secretHash` VARCHAR(191) NOT NULL,
    `game` LONGTEXT NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `hostname` LONGTEXT NOT NULL DEFAULT (''),
    `map` LONGTEXT NULL,
    `players` INTEGER NOT NULL DEFAULT 0,
    `maxPlayers` INTEGER NOT NULL DEFAULT 0,
    `plugin` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `check` JSON NULL,
    `checkedAt` DATETIME(3) NULL,
    `serverId` INTEGER NULL,
    `decidedById` LONGTEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `keyId` LONGTEXT NULL,
    `deliveredAt` DATETIME(3) NULL,
    `deliveries` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `game_server_enrollments_ref_key`(`ref`),
    UNIQUE INDEX `game_server_enrollments_secretHash_key`(`secretHash`),
    INDEX `game_server_enrollments_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `game_server_enrollments_ip_idx`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_players` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('STEAM', 'NONSTEAM', 'NAME') NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `trust` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL,
    `userId` VARCHAR(191) NULL,
    `linkSource` ENUM('STEAM', 'CODE', 'STAFF') NULL,
    `linkedAt` DATETIME(3) NULL,
    `name` LONGTEXT NOT NULL DEFAULT (''),
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastServerId` INTEGER NULL,

    INDEX `game_players_userId_idx`(`userId`),
    INDEX `game_players_lastSeenAt_idx`(`lastSeenAt`),
    UNIQUE INDEX `game_players_kind_value_key`(`kind`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_link_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `playerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `game_link_codes_codeHash_key`(`codeHash`),
    INDEX `game_link_codes_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `playerId` INTEGER NOT NULL,
    `adminId` INTEGER NULL,
    `name` LONGTEXT NOT NULL DEFAULT (''),
    `ip` LONGTEXT NULL,
    `connectedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `disconnectedAt` DATETIME(3) NULL,
    `seconds` INTEGER NOT NULL DEFAULT 0,
    `adminFlags` LONGTEXT NULL,

    INDEX `game_sessions_serverId_disconnectedAt_idx`(`serverId`, `disconnectedAt`),
    INDEX `game_sessions_playerId_connectedAt_idx`(`playerId`, `connectedAt`),
    INDEX `game_sessions_adminId_connectedAt_idx`(`adminId`, `connectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_player_stats` (
    `playerId` INTEGER NOT NULL,
    `serverId` INTEGER NOT NULL,
    `kills` INTEGER NOT NULL DEFAULT 0,
    `deaths` INTEGER NOT NULL DEFAULT 0,
    `headshots` INTEGER NOT NULL DEFAULT 0,
    `assists` INTEGER NOT NULL DEFAULT 0,
    `teamkills` INTEGER NOT NULL DEFAULT 0,
    `suicides` INTEGER NOT NULL DEFAULT 0,
    `shots` INTEGER NOT NULL DEFAULT 0,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `damage` INTEGER NOT NULL DEFAULT 0,
    `playtime` INTEGER NOT NULL DEFAULT 0,
    `rounds` INTEGER NOT NULL DEFAULT 0,
    `roundsWon` INTEGER NOT NULL DEFAULT 0,
    `score` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `game_player_stats_serverId_rank_idx`(`serverId`, `rank`),
    PRIMARY KEY (`playerId`, `serverId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_weapon_stats` (
    `playerId` INTEGER NOT NULL,
    `serverId` INTEGER NOT NULL,
    `weapon` VARCHAR(191) NOT NULL,
    `kills` INTEGER NOT NULL DEFAULT 0,
    `deaths` INTEGER NOT NULL DEFAULT 0,
    `headshots` INTEGER NOT NULL DEFAULT 0,
    `shots` INTEGER NOT NULL DEFAULT 0,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `damage` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`playerId`, `serverId`, `weapon`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_map_stats` (
    `playerId` INTEGER NOT NULL,
    `serverId` INTEGER NOT NULL,
    `map` VARCHAR(191) NOT NULL,
    `kills` INTEGER NOT NULL DEFAULT 0,
    `deaths` INTEGER NOT NULL DEFAULT 0,
    `headshots` INTEGER NOT NULL DEFAULT 0,
    `playtime` INTEGER NOT NULL DEFAULT 0,
    `rounds` INTEGER NOT NULL DEFAULT 0,
    `roundsWon` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`playerId`, `serverId`, `map`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_bridge_events` (
    `serverId` INTEGER NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `game_bridge_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`serverId`, `eventId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_admin_presets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` LONGTEXT NOT NULL,
    `flags` LONGTEXT NOT NULL,
    `immunity` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_admins` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subject` ENUM('USER', 'PLAYER', 'NAME') NOT NULL,
    `userId` VARCHAR(191) NULL,
    `playerId` INTEGER NULL,
    `name` LONGTEXT NULL,
    `nameNormalized` VARCHAR(191) NULL,
    `passwordSalt` LONGTEXT NULL,
    `passwordVerifier` LONGTEXT NULL,
    `serverId` INTEGER NULL,
    `presetId` INTEGER NULL,
    `flags` LONGTEXT NULL,
    `immunity` INTEGER NULL,
    `allowNonSteam` BOOLEAN NOT NULL DEFAULT false,
    `note` LONGTEXT NOT NULL DEFAULT (''),
    `expiresAt` DATETIME(3) NULL,
    `expiredLoggedAt` DATETIME(3) NULL,
    `createdById` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `game_admins_userId_idx`(`userId`),
    INDEX `game_admins_playerId_idx`(`playerId`),
    INDEX `game_admins_serverId_idx`(`serverId`),
    INDEX `game_admins_nameNormalized_idx`(`nameNormalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_sanctions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('BAN', 'MUTE', 'GAG') NOT NULL,
    `scope` ENUM('SERVER', 'GLOBAL') NOT NULL,
    `serverId` INTEGER NULL,
    `playerId` INTEGER NULL,
    `targetKind` ENUM('STEAM', 'NONSTEAM', 'NAME') NULL,
    `targetValue` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `name` LONGTEXT NULL,
    `reason` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NULL,
    `adminUserId` LONGTEXT NULL,
    `adminPlayerId` INTEGER NULL,
    `adminName` LONGTEXT NOT NULL DEFAULT (''),
    `source` ENUM('SITE', 'GAME') NOT NULL,
    `unbannedAt` DATETIME(3) NULL,
    `unbannedById` LONGTEXT NULL,
    `unbannedByName` LONGTEXT NULL,
    `unbanReason` LONGTEXT NULL,
    `evidence` JSON NOT NULL DEFAULT ('[]'),
    `revision` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `game_sanctions_revision_idx`(`revision`),
    INDEX `game_sanctions_playerId_idx`(`playerId`),
    INDEX `game_sanctions_targetKind_targetValue_idx`(`targetKind`, `targetValue`),
    INDEX `game_sanctions_ip_idx`(`ip`),
    INDEX `game_sanctions_type_expiresAt_idx`(`type`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_admin_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `adminPlayerId` INTEGER NULL,
    `adminUserId` VARCHAR(191) NULL,
    `adminId` INTEGER NULL,
    `adminName` LONGTEXT NOT NULL DEFAULT (''),
    `action` LONGTEXT NOT NULL,
    `targetPlayerId` INTEGER NULL,
    `targetName` LONGTEXT NOT NULL DEFAULT (''),
    `reason` LONGTEXT NOT NULL DEFAULT (''),
    `details` JSON NULL,
    `sanctionId` INTEGER NULL,
    `at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `game_admin_actions_serverId_at_idx`(`serverId`, `at`),
    INDEX `game_admin_actions_adminId_at_idx`(`adminId`, `at`),
    INDEX `game_admin_actions_adminUserId_at_idx`(`adminUserId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_vip_mappings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `groupId` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `flags` LONGTEXT NOT NULL DEFAULT ('b'),

    UNIQUE INDEX `game_vip_mappings_serverId_groupId_key`(`serverId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_matches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serverId` INTEGER NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `map` LONGTEXT NOT NULL DEFAULT (''),
    `status` ENUM('WARMUP', 'LIVE', 'HALFTIME', 'ENDED', 'ABORTED') NOT NULL DEFAULT 'WARMUP',
    `teamAName` LONGTEXT NOT NULL DEFAULT (''),
    `teamBName` LONGTEXT NOT NULL DEFAULT (''),
    `scoreA` INTEGER NOT NULL DEFAULT 0,
    `scoreB` INTEGER NOT NULL DEFAULT 0,
    `round` INTEGER NOT NULL DEFAULT 0,
    `winner` LONGTEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `liveAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `rated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `game_matches_serverId_startedAt_idx`(`serverId`, `startedAt`),
    INDEX `game_matches_status_endedAt_idx`(`status`, `endedAt`),
    UNIQUE INDEX `game_matches_serverId_externalId_key`(`serverId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_match_players` (
    `matchId` INTEGER NOT NULL,
    `playerId` INTEGER NOT NULL,
    `team` LONGTEXT NOT NULL,
    `name` LONGTEXT NOT NULL DEFAULT (''),
    `kills` INTEGER NOT NULL DEFAULT 0,
    `deaths` INTEGER NOT NULL DEFAULT 0,
    `assists` INTEGER NOT NULL DEFAULT 0,
    `headshots` INTEGER NOT NULL DEFAULT 0,
    `damage` INTEGER NOT NULL DEFAULT 0,
    `mvps` INTEGER NOT NULL DEFAULT 0,
    `eloBefore` INTEGER NULL,
    `eloAfter` INTEGER NULL,

    INDEX `game_match_players_playerId_idx`(`playerId`),
    PRIMARY KEY (`matchId`, `playerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_match_rounds` (
    `matchId` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `winner` LONGTEXT NOT NULL,
    `scoreA` INTEGER NOT NULL,
    `scoreB` INTEGER NOT NULL,
    `reason` LONGTEXT NOT NULL DEFAULT (''),
    `endedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`matchId`, `number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_server_tv` (
    `serverId` INTEGER NOT NULL,
    `address` LONGTEXT NULL,
    `delay` INTEGER NULL,
    `source` LONGTEXT NOT NULL DEFAULT ('none'),
    `host` LONGTEXT NULL,
    `port` INTEGER NULL,
    `username` LONGTEXT NULL,
    `secret` LONGTEXT NULL,
    `privateKey` LONGTEXT NULL,
    `remoteDir` LONGTEXT NOT NULL DEFAULT ('/'),
    `tlsInsecure` BOOLEAN NOT NULL DEFAULT false,
    `hostKey` LONGTEXT NULL,
    `httpTemplate` LONGTEXT NULL,
    `namePrefix` LONGTEXT NOT NULL DEFAULT (''),
    `timeZone` LONGTEXT NOT NULL DEFAULT ('UTC'),
    `record` BOOLEAN NOT NULL DEFAULT false,
    `rconPassword` LONGTEXT NULL,
    `lastFetchAt` DATETIME(3) NULL,
    `lastFetchOk` BOOLEAN NULL,
    `lastFetchCode` LONGTEXT NULL,
    `lastFetchInfo` JSON NULL,
    `lastRcon` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`serverId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_match_demos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NULL,
    `serverId` INTEGER NULL,
    `part` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('WAITING', 'FETCHING', 'AVAILABLE', 'NOT_FOUND', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'WAITING',
    `source` LONGTEXT NOT NULL,
    `remoteName` LONGTEXT NULL,
    `fileName` LONGTEXT NOT NULL,
    `storageKey` LONGTEXT NULL,
    `encoding` LONGTEXT NOT NULL DEFAULT ('identity'),
    `size` INTEGER NULL,
    `storedSize` INTEGER NULL,
    `sha256` LONGTEXT NULL,
    `downloads` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `error` LONGTEXT NULL,
    `chunkSize` INTEGER NULL,
    `received` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `availableAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    INDEX `game_match_demos_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `game_match_demos_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `game_match_demos_serverId_createdAt_idx`(`serverId`, `createdAt`),
    UNIQUE INDEX `game_match_demos_matchId_part_key`(`matchId`, `part`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_ratings` (
    `playerId` INTEGER NOT NULL,
    `elo` INTEGER NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `draws` INTEGER NOT NULL DEFAULT 0,
    `peak` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `game_ratings_elo_idx`(`elo`),
    PRIMARY KEY (`playerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_tickets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('APPEAL', 'CHEATER', 'ADMIN') NOT NULL,
    `status` ENUM('OPEN', 'REVIEW', 'ACCEPTED', 'REJECTED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `authorId` VARCHAR(191) NOT NULL,
    `serverId` INTEGER NULL,
    `sanctionId` INTEGER NULL,
    `targetPlayerId` INTEGER NULL,
    `targetUserId` LONGTEXT NULL,
    `targetAdminId` INTEGER NULL,
    `targetName` LONGTEXT NOT NULL DEFAULT (''),
    `title` LONGTEXT NOT NULL,
    `contentJson` JSON NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `evidence` JSON NOT NULL DEFAULT ('[]'),
    `assigneeId` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `closedAt` DATETIME(3) NULL,

    INDEX `game_tickets_status_lastActivityAt_idx`(`status`, `lastActivityAt`),
    INDEX `game_tickets_authorId_kind_status_idx`(`authorId`, `kind`, `status`),
    INDEX `game_tickets_sanctionId_idx`(`sanctionId`),
    INDEX `game_tickets_serverId_status_idx`(`serverId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_ticket_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `authorId` LONGTEXT NULL,
    `kind` ENUM('MESSAGE', 'STATUS', 'ASSIGN') NOT NULL DEFAULT 'MESSAGE',
    `contentJson` JSON NULL,
    `contentHtml` LONGTEXT NOT NULL DEFAULT (''),
    `internal` BOOLEAN NOT NULL DEFAULT false,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `game_ticket_messages_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_maps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `game` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageId` VARCHAR(191) NULL,
    `source` ENUM('UPLOAD', 'TEMPLATE') NULL,
    `fetchedAt` DATETIME(3) NULL,
    `fetchError` LONGTEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextFetchAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `game_maps_imageId_nextFetchAt_idx`(`imageId`, `nextFetchAt`),
    UNIQUE INDEX `game_maps_game_name_key`(`game`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_removals` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('DELETE', 'MERGE') NOT NULL,
    `status` ENUM('SCHEDULED', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL,
    `source` ENUM('ACP', 'SELF') NOT NULL DEFAULT 'ACP',
    `mode` ENUM('KEEP_CONTENT', 'DELETE_CONTENT') NOT NULL DEFAULT 'KEEP_CONTENT',
    `keepMessages` BOOLEAN NOT NULL DEFAULT false,
    `userId` VARCHAR(191) NOT NULL,
    `userName` LONGTEXT NOT NULL,
    `targetId` LONGTEXT NULL,
    `targetName` LONGTEXT NULL,
    `requestedById` LONGTEXT NULL,
    `runAfter` DATETIME(3) NULL,
    `steps` JSON NOT NULL DEFAULT ('{}'),
    `currentStep` LONGTEXT NULL,
    `error` LONGTEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `heartbeatAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `member_removals_status_runAfter_idx`(`status`, `runAfter`),
    INDEX `member_removals_userId_idx`(`userId`),
    INDEX `member_removals_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_devices` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `browser` LONGTEXT NOT NULL,
    `os` LONGTEXT NOT NULL,
    `method` LONGTEXT NOT NULL,
    `ip` LONGTEXT NULL,
    `location` LONGTEXT NULL,
    `autoLogin` BOOLEAN NOT NULL DEFAULT true,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `user_devices_userId_lastSeenAt_idx`(`userId`, `lastSeenAt`),
    UNIQUE INDEX `user_devices_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profile_visits` (
    `profileUserId` VARCHAR(191) NOT NULL,
    `visitorId` VARCHAR(191) NOT NULL,
    `visitedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `profile_visits_profileUserId_visitedAt_idx`(`profileUserId`, `visitedAt`),
    INDEX `profile_visits_visitorId_idx`(`visitorId`),
    PRIMARY KEY (`profileUserId`, `visitorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_profiles` (
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `data` JSON NOT NULL DEFAULT ('{}'),
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `error` LONGTEXT NULL,

    INDEX `external_profiles_provider_fetchedAt_idx`(`provider`, `fetchedAt`),
    PRIMARY KEY (`userId`, `provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_donations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NULL,
    `donorName` LONGTEXT NOT NULL DEFAULT (''),
    `amount` INTEGER NOT NULL,
    `currency` LONGTEXT NOT NULL DEFAULT ('EUR'),
    `note` LONGTEXT NOT NULL DEFAULT (''),
    `method` LONGTEXT NOT NULL DEFAULT (''),
    `reference` LONGTEXT NOT NULL DEFAULT (''),
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('CONFIRMED', 'PENDING', 'REJECTED') NOT NULL DEFAULT 'CONFIRMED',
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `externalId` VARCHAR(191) NULL,
    `donatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `createdById` LONGTEXT NULL,
    `reviewedById` LONGTEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `rejectReason` LONGTEXT NOT NULL DEFAULT (''),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `member_donations_userId_idx`(`userId`),
    INDEX `member_donations_status_donatedAt_idx`(`status`, `donatedAt`),
    UNIQUE INDEX `member_donations_source_externalId_key`(`source`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `donation_goals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` LONGTEXT NOT NULL,
    `target` INTEGER NOT NULL,
    `currency` LONGTEXT NOT NULL DEFAULT ('EUR'),
    `period` ENUM('MONTHLY', 'CUSTOM') NOT NULL DEFAULT 'MONTHLY',
    `startsOn` DATE NOT NULL,
    `endsOn` DATE NULL,
    `autoRenew` BOOLEAN NOT NULL DEFAULT true,
    `groupIds` JSON NOT NULL DEFAULT ('[]'),
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_kv` (
    `key` VARCHAR(255) NOT NULL,
    `type` VARCHAR(8) NOT NULL,
    `value` LONGTEXT NULL,
    `expiresAt` BIGINT NULL,

    INDEX `gcs_kv_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_kv_items` (
    `key` VARCHAR(255) NOT NULL,
    `field` VARCHAR(255) NOT NULL,
    `value` LONGTEXT NULL,
    `score` DOUBLE NULL,

    INDEX `gcs_kv_items_key_score_idx`(`key`, `score`),
    PRIMARY KEY (`key`, `field`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_kv_locks` (
    `stripe` INTEGER NOT NULL,

    PRIMARY KEY (`stripe`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `jobKey` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'waiting',
    `runAt` BIGINT NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lockedUntil` BIGINT NULL,
    `lastError` LONGTEXT NULL,
    `createdAt` BIGINT NOT NULL,

    UNIQUE INDEX `gcs_jobs_jobKey_key`(`jobKey`),
    INDEX `gcs_jobs_status_runAt_idx`(`status`, `runAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_job_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `everyMs` INTEGER NULL,
    `pattern` VARCHAR(100) NULL,
    `nextRunAt` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gcs_realtime_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `room` VARCHAR(191) NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `origin` VARCHAR(64) NULL,
    `createdAt` BIGINT NOT NULL,

    INDEX `gcs_realtime_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_primaryGroupId_fkey` FOREIGN KEY (`primaryGroupId`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_nameGroupId_fkey` FOREIGN KEY (`nameGroupId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_displayGroupChoiceId_fkey` FOREIGN KEY (`displayGroupChoiceId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_rankId_fkey` FOREIGN KEY (`rankId`) REFERENCES `ranks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_nameStyleId_fkey` FOREIGN KEY (`nameStyleId`) REFERENCES `name_styles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_avatarFrameId_fkey` FOREIGN KEY (`avatarFrameId`) REFERENCES `avatar_frames`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `two_factors` ADD CONSTRAINT `two_factors_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_sections` ADD CONSTRAINT `staff_sections_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_profiles` ADD CONSTRAINT `staff_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_settings` ADD CONSTRAINT `group_settings_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `container_permissions` ADD CONSTRAINT `container_permissions_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderators` ADD CONSTRAINT `moderators_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderators` ADD CONSTRAINT `moderators_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bans` ADD CONSTRAINT `bans_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bans` ADD CONSTRAINT `bans_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warnings` ADD CONSTRAINT `warnings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warnings` ADD CONSTRAINT `warnings_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acp_role_permissions` ADD CONSTRAINT `acp_role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `acp_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acp_role_assignments` ADD CONSTRAINT `acp_role_assignments_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `acp_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acp_role_assignments` ADD CONSTRAINT `acp_role_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acp_role_assignments` ADD CONSTRAINT `acp_role_assignments_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acp_dashboard_layouts` ADD CONSTRAINT `acp_dashboard_layouts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forums` ADD CONSTRAINT `forums_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `forums`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_extension_data` ADD CONSTRAINT `forum_extension_data_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_pages` ADD CONSTRAINT `forum_pages_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_rules_acceptances` ADD CONSTRAINT `forum_rules_acceptances_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topics` ADD CONSTRAINT `topics_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topics` ADD CONSTRAINT `topics_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topics` ADD CONSTRAINT `topics_prefixId_fkey` FOREIGN KEY (`prefixId`) REFERENCES `topic_prefixes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topic_notices` ADD CONSTRAINT `topic_notices_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_revisions` ADD CONSTRAINT `post_revisions_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_revisions` ADD CONSTRAINT `post_revisions_editorId_fkey` FOREIGN KEY (`editorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_prefixes` ADD CONSTRAINT `forum_prefixes_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_prefixes` ADD CONSTRAINT `forum_prefixes_prefixId_fkey` FOREIGN KEY (`prefixId`) REFERENCES `topic_prefixes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topic_tags` ADD CONSTRAINT `topic_tags_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `topic_tags` ADD CONSTRAINT `topic_tags_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `polls` ADD CONSTRAINT `polls_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poll_options` ADD CONSTRAINT `poll_options_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `polls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poll_votes` ADD CONSTRAINT `poll_votes_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `polls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poll_votes` ADD CONSTRAINT `poll_votes_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `poll_options`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poll_votes` ADD CONSTRAINT `poll_votes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_ratings` ADD CONSTRAINT `content_ratings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_votes` ADD CONSTRAINT `post_votes_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `post_votes` ADD CONSTRAINT `post_votes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_reactions` ADD CONSTRAINT `content_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_reactions` ADD CONSTRAINT `content_reactions_reactionId_fkey` FOREIGN KEY (`reactionId`) REFERENCES `reactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `read_markers` ADD CONSTRAINT `read_markers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `read_markers` ADD CONSTRAINT `read_markers_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `forum_read_marks` ADD CONSTRAINT `forum_read_marks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_fields` ADD CONSTRAINT `profile_fields_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `profile_field_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_field_values` ADD CONSTRAINT `profile_field_values_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_field_values` ADD CONSTRAINT `profile_field_values_fieldId_fkey` FOREIGN KEY (`fieldId`) REFERENCES `profile_fields`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `status_updates` ADD CONSTRAINT `status_updates_profileUserId_fkey` FOREIGN KEY (`profileUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `status_updates` ADD CONSTRAINT `status_updates_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `status_updates` ADD CONSTRAINT `status_updates_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `status_updates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_ignores` ADD CONSTRAINT `user_ignores_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_ignores` ADD CONSTRAINT `user_ignores_ignoredId_fkey` FOREIGN KEY (`ignoredId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_participants` ADD CONSTRAINT `conversation_participants_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_participants` ADD CONSTRAINT `conversation_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_messages` ADD CONSTRAINT `conversation_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_messages` ADD CONSTRAINT `conversation_messages_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ranks` ADD CONSTRAINT `ranks_perkGroupId_fkey` FOREIGN KEY (`perkGroupId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ranks` ADD CONSTRAINT `ranks_perkBadgeId_fkey` FOREIGN KEY (`perkBadgeId`) REFERENCES `badges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ranks` ADD CONSTRAINT `ranks_perkNameStyleId_fkey` FOREIGN KEY (`perkNameStyleId`) REFERENCES `name_styles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_badges` ADD CONSTRAINT `user_badges_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `badges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_rules` ADD CONSTRAINT `achievement_rules_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `badges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_occurrences` ADD CONSTRAINT `achievement_occurrences_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `achievement_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_occurrences` ADD CONSTRAINT `achievement_occurrences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_log` ADD CONSTRAINT `achievement_log_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_log` ADD CONSTRAINT `achievement_log_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `achievement_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_promotions` ADD CONSTRAINT `group_promotions_toGroupId_fkey` FOREIGN KEY (`toGroupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vip_subscriptions` ADD CONSTRAINT `vip_subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vip_subscriptions` ADD CONSTRAINT `vip_subscriptions_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vip_log` ADD CONSTRAINT `vip_log_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_members` ADD CONSTRAINT `notification_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_channels` ADD CONSTRAINT `chat_channels_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `chat_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `chat_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_mutes` ADD CONSTRAINT `chat_mutes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_mutes` ADD CONSTRAINT `chat_mutes_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `chat_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_sanctions` ADD CONSTRAINT `chat_sanctions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_sanctions` ADD CONSTRAINT `chat_sanctions_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `chat_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_mod_log` ADD CONSTRAINT `chat_mod_log_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_mod_log` ADD CONSTRAINT `chat_mod_log_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_moderator_grants` ADD CONSTRAINT `chat_moderator_grants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_moderator_grants` ADD CONSTRAINT `chat_moderator_grants_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nav_items` ADD CONSTRAINT `nav_items_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `nav_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `theme_css_files` ADD CONSTRAINT `theme_css_files_themeId_fkey` FOREIGN KEY (`themeId`) REFERENCES `themes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `theme_css_versions` ADD CONSTRAINT `theme_css_versions_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `theme_css_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `theme_templates` ADD CONSTRAINT `theme_templates_themeId_fkey` FOREIGN KEY (`themeId`) REFERENCES `themes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `theme_template_versions` ADD CONSTRAINT `theme_template_versions_themeId_fkey` FOREIGN KEY (`themeId`) REFERENCES `themes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_room_members` ADD CONSTRAINT `chat_room_members_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `chat_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_room_members` ADD CONSTRAINT `chat_room_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_message_reactions` ADD CONSTRAINT `chat_message_reactions_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_message_reactions` ADD CONSTRAINT `chat_message_reactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_pro_profiles` ADD CONSTRAINT `chat_pro_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_pro_daily_stats` ADD CONSTRAINT `chat_pro_daily_stats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_online_days` ADD CONSTRAINT `member_online_days_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_pro_winners` ADD CONSTRAINT `chat_pro_winners_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_emotes` ADD CONSTRAINT `chat_emotes_packId_fkey` FOREIGN KEY (`packId`) REFERENCES `chat_emote_packs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plugin_logs` ADD CONSTRAINT `plugin_logs_pluginKey_fkey` FOREIGN KEY (`pluginKey`) REFERENCES `plugins`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plugin_hook_settings` ADD CONSTRAINT `plugin_hook_settings_pluginKey_fkey` FOREIGN KEY (`pluginKey`) REFERENCES `plugins`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plugin_media` ADD CONSTRAINT `plugin_media_pluginKey_fkey` FOREIGN KEY (`pluginKey`) REFERENCES `plugins`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plugin_appearance_styles` ADD CONSTRAINT `plugin_appearance_styles_pluginKey_fkey` FOREIGN KEY (`pluginKey`) REFERENCES `plugins`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_appearances` ADD CONSTRAINT `member_appearances_pluginKey_fkey` FOREIGN KEY (`pluginKey`) REFERENCES `plugins`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_appearances` ADD CONSTRAINT `member_appearances_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_logs` ADD CONSTRAINT `import_logs_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_servers` ADD CONSTRAINT `game_servers_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_server_admins` ADD CONSTRAINT `game_server_admins_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_server_admins` ADD CONSTRAINT `game_server_admins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `server_snapshots` ADD CONSTRAINT `server_snapshots_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clans` ADD CONSTRAINT `clans_forumId_fkey` FOREIGN KEY (`forumId`) REFERENCES `forums`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clans` ADD CONSTRAINT `clans_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clan_members` ADD CONSTRAINT `clan_members_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `clans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clan_members` ADD CONSTRAINT `clan_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clan_requests` ADD CONSTRAINT `clan_requests_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `clans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clan_requests` ADD CONSTRAINT `clan_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clan_requests` ADD CONSTRAINT `clan_requests_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_server_keys` ADD CONSTRAINT `game_server_keys_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_server_enrollments` ADD CONSTRAINT `game_server_enrollments_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_players` ADD CONSTRAINT `game_players_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_players` ADD CONSTRAINT `game_players_lastServerId_fkey` FOREIGN KEY (`lastServerId`) REFERENCES `game_servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_link_codes` ADD CONSTRAINT `game_link_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_link_codes` ADD CONSTRAINT `game_link_codes_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_sessions` ADD CONSTRAINT `game_sessions_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_sessions` ADD CONSTRAINT `game_sessions_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_sessions` ADD CONSTRAINT `game_sessions_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `game_admins`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_player_stats` ADD CONSTRAINT `game_player_stats_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_player_stats` ADD CONSTRAINT `game_player_stats_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_weapon_stats` ADD CONSTRAINT `game_weapon_stats_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_map_stats` ADD CONSTRAINT `game_map_stats_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_admins` ADD CONSTRAINT `game_admins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_admins` ADD CONSTRAINT `game_admins_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_admins` ADD CONSTRAINT `game_admins_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_admins` ADD CONSTRAINT `game_admins_presetId_fkey` FOREIGN KEY (`presetId`) REFERENCES `game_admin_presets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_sanctions` ADD CONSTRAINT `game_sanctions_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_sanctions` ADD CONSTRAINT `game_sanctions_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_admin_actions` ADD CONSTRAINT `game_admin_actions_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_vip_mappings` ADD CONSTRAINT `game_vip_mappings_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_vip_mappings` ADD CONSTRAINT `game_vip_mappings_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_matches` ADD CONSTRAINT `game_matches_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_match_players` ADD CONSTRAINT `game_match_players_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `game_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_match_players` ADD CONSTRAINT `game_match_players_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_match_rounds` ADD CONSTRAINT `game_match_rounds_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `game_matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_server_tv` ADD CONSTRAINT `game_server_tv_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_match_demos` ADD CONSTRAINT `game_match_demos_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `game_matches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_match_demos` ADD CONSTRAINT `game_match_demos_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_ratings` ADD CONSTRAINT `game_ratings_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `game_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_tickets` ADD CONSTRAINT `game_tickets_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_tickets` ADD CONSTRAINT `game_tickets_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `game_servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_tickets` ADD CONSTRAINT `game_tickets_sanctionId_fkey` FOREIGN KEY (`sanctionId`) REFERENCES `game_sanctions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_ticket_messages` ADD CONSTRAINT `game_ticket_messages_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `game_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_devices` ADD CONSTRAINT `user_devices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_visits` ADD CONSTRAINT `profile_visits_profileUserId_fkey` FOREIGN KEY (`profileUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_visits` ADD CONSTRAINT `profile_visits_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_profiles` ADD CONSTRAINT `external_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_donations` ADD CONSTRAINT `member_donations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gcs_kv_items` ADD CONSTRAINT `gcs_kv_items_key_fkey` FOREIGN KEY (`key`) REFERENCES `gcs_kv`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;



-- ─── Ce nu se exprimă în schema Prisma ───────────────────────────────────────────

-- Unic doar când …: coloane generate (NULL în afara condiției) + index unic.
ALTER TABLE `notifications` ADD COLUMN `unreadKey` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN `readAt` IS NULL THEN `groupKey` END) STORED;
CREATE UNIQUE INDEX `notifications_unread_group` ON `notifications`(`userId`, `unreadKey`);
ALTER TABLE `vip_subscriptions` ADD COLUMN `activeFlag` TINYINT GENERATED ALWAYS AS (CASE WHEN `status` = 'ACTIVE' THEN 1 END) STORED;
CREATE UNIQUE INDEX `vip_subscriptions_one_active_per_user` ON `vip_subscriptions`(`userId`, `activeFlag`);
ALTER TABLE `clan_members` ADD COLUMN `leaderFlag` TINYINT GENERATED ALWAYS AS (CASE WHEN `role` = 'LEADER' THEN 1 END) STORED;
CREATE UNIQUE INDEX `clan_members_one_leader` ON `clan_members`(`clanId`, `leaderFlag`);
ALTER TABLE `clan_requests` ADD COLUMN `pendingFlag` TINYINT GENERATED ALWAYS AS (CASE WHEN `status` = 'PENDING' THEN 1 END) STORED;
CREATE UNIQUE INDEX `clan_requests_one_pending` ON `clan_requests`(`clanId`, `userId`, `kind`, `pendingFlag`);
ALTER TABLE `game_sessions` ADD COLUMN `openFlag` TINYINT GENERATED ALWAYS AS (CASE WHEN `disconnectedAt` IS NULL THEN 1 END) STORED;
CREATE UNIQUE INDEX `game_sessions_one_open` ON `game_sessions`(`serverId`, `playerId`, `openFlag`);
ALTER TABLE `member_removals` ADD COLUMN `activeFlag` TINYINT GENERATED ALWAYS AS (CASE WHEN `status` IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'FAILED') THEN 1 END) STORED;
CREATE UNIQUE INDEX `member_removals_one_active` ON `member_removals`(`userId`, `activeFlag`);

-- Căutarea: textul simplu al titlului / postării, cu index FULLTEXT (colația ignoră diacriticele și majusculele).
ALTER TABLE `topics` ADD COLUMN `searchText` LONGTEXT NULL;
ALTER TABLE `posts` ADD COLUMN `searchText` LONGTEXT NULL;
CREATE FULLTEXT INDEX `topics_searchText_idx` ON `topics`(`searchText`);
CREATE FULLTEXT INDEX `posts_searchText_idx` ON `posts`(`searchText`);

-- Cheile GcsSqlKv sunt sensibile la majuscule (ca în Redis).
ALTER TABLE `gcs_kv` MODIFY `key` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin;
ALTER TABLE `gcs_kv_items` MODIFY `key` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin, MODIFY `field` VARCHAR(255) NOT NULL COLLATE utf8mb4_bin;

-- Revizia sancțiunilor (PostgreSQL: secvența `game_sync_revision`): în MySQL o dă aplicația, sub lacăt.
ALTER TABLE `game_sanctions` MODIFY `revision` BIGINT NOT NULL DEFAULT 0;

SET FOREIGN_KEY_CHECKS = 1;
