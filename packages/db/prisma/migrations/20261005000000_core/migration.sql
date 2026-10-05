-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BanType" AS ENUM ('ACCOUNT', 'IP', 'EMAIL');

-- CreateEnum
CREATE TYPE "WarningActionType" AS ENUM ('MODERATE_POSTS', 'RESTRICT', 'BAN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "primaryGroupId" INTEGER NOT NULL,
    "previousPrimaryGroupId" INTEGER,
    "locale" TEXT NOT NULL DEFAULT 'ro',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "lastAcpAuthAt" TIMESTAMP(3),
    "lastAcpAuthIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "nameStyle" JSONB,
    "title" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "userId" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "group_settings" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "group_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_permissions" (
    "id" SERIAL NOT NULL,
    "containerType" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "container_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_inherit" (
    "id" SERIAL NOT NULL,
    "containerType" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "parentId" TEXT,
    "inherits" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "container_inherit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderators" (
    "id" SERIAL NOT NULL,
    "containerType" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" INTEGER,
    "powers" TEXT[],

    CONSTRAINT "moderators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bans" (
    "id" TEXT NOT NULL,
    "type" "BanType" NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warnings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warning_actions" (
    "id" SERIAL NOT NULL,
    "threshold" INTEGER NOT NULL,
    "action" "WarningActionType" NOT NULL,
    "durationHours" INTEGER,

    CONSTRAINT "warning_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acp_roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "acp_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acp_role_permissions" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "acp_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acp_role_assignments" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "userId" TEXT,
    "groupId" INTEGER,

    CONSTRAINT "acp_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acp_dashboard_layouts" (
    "userId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,

    CONSTRAINT "acp_dashboard_layouts_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "installedAt" TIMESTAMP(3),
    "permVersion" INTEGER NOT NULL DEFAULT 0,
    "appVersion" TEXT NOT NULL DEFAULT '1.0.0',

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_nameNormalized_key" ON "users"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_primaryGroupId_idx" ON "users"("primaryGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "groups_key_key" ON "groups"("key");

-- CreateIndex
CREATE INDEX "user_groups_groupId_idx" ON "user_groups"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "group_settings_groupId_key_key" ON "group_settings"("groupId", "key");

-- CreateIndex
CREATE INDEX "container_permissions_containerType_containerId_idx" ON "container_permissions"("containerType", "containerId");

-- CreateIndex
CREATE UNIQUE INDEX "container_permissions_containerType_containerId_groupId_act_key" ON "container_permissions"("containerType", "containerId", "groupId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "container_inherit_containerType_containerId_key" ON "container_inherit"("containerType", "containerId");

-- CreateIndex
CREATE INDEX "moderators_containerType_containerId_idx" ON "moderators"("containerType", "containerId");

-- CreateIndex
CREATE INDEX "bans_type_value_idx" ON "bans"("type", "value");

-- CreateIndex
CREATE INDEX "bans_userId_idx" ON "bans"("userId");

-- CreateIndex
CREATE INDEX "warnings_userId_idx" ON "warnings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "warning_actions_threshold_key" ON "warning_actions"("threshold");

-- CreateIndex
CREATE UNIQUE INDEX "acp_roles_name_key" ON "acp_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "acp_role_permissions_roleId_section_key" ON "acp_role_permissions"("roleId", "section");

-- CreateIndex
CREATE INDEX "acp_role_assignments_userId_idx" ON "acp_role_assignments"("userId");

-- CreateIndex
CREATE INDEX "acp_role_assignments_groupId_idx" ON "acp_role_assignments"("groupId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_primaryGroupId_fkey" FOREIGN KEY ("primaryGroupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settings" ADD CONSTRAINT "group_settings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_permissions" ADD CONSTRAINT "container_permissions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderators" ADD CONSTRAINT "moderators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderators" ADD CONSTRAINT "moderators_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acp_role_permissions" ADD CONSTRAINT "acp_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "acp_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acp_role_assignments" ADD CONSTRAINT "acp_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "acp_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acp_role_assignments" ADD CONSTRAINT "acp_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acp_role_assignments" ADD CONSTRAINT "acp_role_assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acp_dashboard_layouts" ADD CONSTRAINT "acp_dashboard_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

