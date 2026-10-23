-- Notificări v2: canalele pe tip (site, toast, email, push; pornit / „doar important” / oprit; emailul imediat, zilnic
-- sau săptămânal), blocările din ACP, abonamentele web push, statisticile pe canal și setările de livrare pe membru.
-- Datele vechi (site da/nu, email OFF / INSTANT / DIGEST) trec în forma nouă; alegerile egale cu valorile implicite dispar.

-- AlterTable: notificările știu dacă apar în clopoțel, dacă au fost importante, pe ce canale au plecat și când au fost deschise.
ALTER TABLE "notifications" ADD COLUMN "site" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "important" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "channels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "clickedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_defaults" ADD COLUMN "channels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "locks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "channels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Valorile implicite vechi → canalele noi (site și email; toast și push rămân cele din cod).
UPDATE "notification_defaults" SET "channels" = jsonb_build_object(
  'site', CASE WHEN "site" THEN 'on' ELSE 'off' END,
  'email', CASE WHEN "email" = 'OFF' THEN 'off' ELSE 'on' END,
  'emailMode', CASE WHEN "email" = 'INSTANT' THEN 'instant' ELSE 'daily' END
);

-- Alegerile membrilor → doar ce diferă de valoarea implicită a tipului (un tip fără rând implicit: site pornit, email zilnic).
UPDATE "notification_preferences" p SET "channels" = jsonb_strip_nulls(jsonb_build_object(
  'site', CASE WHEN p."site" IS DISTINCT FROM COALESCE(d."site", true) THEN CASE WHEN p."site" THEN 'on' ELSE 'off' END END,
  'email', CASE WHEN (p."email" = 'OFF') IS DISTINCT FROM (COALESCE(d."email", 'DIGEST') = 'OFF') THEN CASE WHEN p."email" = 'OFF' THEN 'off' ELSE 'on' END END,
  'emailMode', CASE WHEN p."email" <> 'OFF' AND p."email" IS DISTINCT FROM COALESCE(d."email", 'DIGEST') THEN CASE WHEN p."email" = 'INSTANT' THEN 'instant' ELSE 'daily' END END
))
FROM (SELECT pp."userId", pp."type", dd."site", dd."email" FROM "notification_preferences" pp LEFT JOIN "notification_defaults" dd ON dd."type" = pp."type") d
WHERE d."userId" = p."userId" AND d."type" = p."type";

DELETE FROM "notification_preferences" WHERE "channels" = '{}'::jsonb;

-- Notificările necitite și netrimise pe email ale cuiva cu emailul oprit pentru tipul lor nu mai așteaptă un digest.
UPDATE "notifications" n SET "emailedAt" = n."updatedAt"
WHERE n."emailedAt" IS NULL AND n."readAt" IS NULL AND COALESCE(
  (SELECT p."email" FROM "notification_preferences" p WHERE p."userId" = n."userId" AND p."type" = n."type"),
  (SELECT d."email" FROM "notification_defaults" d WHERE d."type" = n."type"),
  'DIGEST'
) = 'OFF';

-- AlterTable: coloanele vechi și enum-ul lor.
ALTER TABLE "notification_defaults" DROP COLUMN "email",
DROP COLUMN "site";

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "email",
DROP COLUMN "site";

-- DropEnum
DROP TYPE "NotificationEmail";

-- CreateTable
CREATE TABLE "notification_members" (
    "userId" TEXT NOT NULL,
    "emailsOff" BOOLEAN NOT NULL DEFAULT false,
    "emailsOffAt" TIMESTAMP(3),
    "emailsOffById" TEXT,
    "weeklySentAt" TIMESTAMP(3),

    CONSTRAINT "notification_members_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_stats" (
    "day" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "clicked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_stats_pkey" PRIMARY KEY ("day","type","channel")
);

-- CreateIndex
CREATE INDEX "notifications_updatedAt_idx" ON "notifications"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "notification_members" ADD CONSTRAINT "notification_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
