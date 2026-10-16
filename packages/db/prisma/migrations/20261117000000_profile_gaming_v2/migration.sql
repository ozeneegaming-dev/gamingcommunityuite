-- Profil gaming v2: grupurile câmpurilor de profil (text de ajutor, handle-uri de contact, alegerea serverului), anul
-- opțional al zilei de naștere, dispozitivele, vizitatorii profilului, datele Steam / FACEIT cache-uite și donațiile.
-- AlterEnum
ALTER TYPE "ProfileFieldType" ADD VALUE 'SERVER_SELECT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birthdayShowYear" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "profile_fields" ADD COLUMN     "groupId" INTEGER,
ADD COLUMN     "helper" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "linkTemplate" TEXT;

-- CreateTable
CREATE TABLE "profile_field_groups" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helper" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "profile_field_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ip" TEXT,
    "location" TEXT,
    "autoLogin" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_visits" (
    "profileUserId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_visits_pkey" PRIMARY KEY ("profileUserId","visitorId")
);

-- CreateTable
CREATE TABLE "external_profiles" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "external_profiles_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateTable
CREATE TABLE "member_donations" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_field_groups_key_key" ON "profile_field_groups"("key");

-- CreateIndex
CREATE INDEX "user_devices_userId_lastSeenAt_idx" ON "user_devices"("userId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_userId_key_key" ON "user_devices"("userId", "key");

-- CreateIndex
CREATE INDEX "profile_visits_profileUserId_visitedAt_idx" ON "profile_visits"("profileUserId", "visitedAt");

-- CreateIndex
CREATE INDEX "profile_visits_visitorId_idx" ON "profile_visits"("visitorId");

-- CreateIndex
CREATE INDEX "external_profiles_provider_fetchedAt_idx" ON "external_profiles"("provider", "fetchedAt");

-- CreateIndex
CREATE INDEX "member_donations_userId_idx" ON "member_donations"("userId");

-- AddForeignKey
ALTER TABLE "profile_fields" ADD CONSTRAINT "profile_fields_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "profile_field_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_profileUserId_fkey" FOREIGN KEY ("profileUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_profiles" ADD CONSTRAINT "external_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_donations" ADD CONSTRAINT "member_donations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

