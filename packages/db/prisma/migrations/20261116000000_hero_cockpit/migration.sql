-- Hero Cockpit (specul 2026-10-10-hero-cockpit): timpul online al membrilor pe zile (clasamentul „Timp online”) și
-- descrierea + insigna itemilor de meniu (mega meniurile).
-- AlterTable
ALTER TABLE "nav_items" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "description" JSONB;

-- CreateTable
CREATE TABLE "member_online_days" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "member_online_days_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "member_online_days_day_idx" ON "member_online_days"("day");

-- AddForeignKey
ALTER TABLE "member_online_days" ADD CONSTRAINT "member_online_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
