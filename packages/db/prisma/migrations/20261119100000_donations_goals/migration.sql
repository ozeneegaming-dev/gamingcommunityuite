-- Donații + „Obiectivul lunii” (VIP clasic): starea donațiilor (confirmată / în așteptare / respinsă), metoda, referința
-- „Am donat”, anonimatul, data donației, donatorii fără cont, sursa (ACP, membru, procesator de plăți) și obiectivele.
-- Donațiile existente rămân confirmate, cu data lor de creare.
-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('CONFIRMED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "DonationGoalPeriod" AS ENUM ('MONTHLY', 'CUSTOM');

-- DropForeignKey
ALTER TABLE "member_donations" DROP CONSTRAINT "member_donations_userId_fkey";

-- AlterTable
ALTER TABLE "member_donations" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "donatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "donorName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rejectReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "status" "DonationStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "userId" DROP NOT NULL;

-- Data: donațiile de dinainte păstrează data lor.
UPDATE "member_donations" SET "donatedAt" = "createdAt", "updatedAt" = "createdAt";

-- CreateTable
CREATE TABLE "donation_goals" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "period" "DonationGoalPeriod" NOT NULL DEFAULT 'MONTHLY',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "groupIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_donations_status_donatedAt_idx" ON "member_donations"("status", "donatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_donations_source_externalId_key" ON "member_donations"("source", "externalId");

-- AddForeignKey
ALTER TABLE "member_donations" ADD CONSTRAINT "member_donations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
