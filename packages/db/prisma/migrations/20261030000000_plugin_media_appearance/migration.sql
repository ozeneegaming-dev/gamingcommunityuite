-- Studio VIP (specul 2026-10-07): fișierele media ale pluginurilor (capabilitatea `media`) și aspectul membrilor
-- publicat de pluginuri (capabilitatea `appearance`).
-- CreateTable
CREATE TABLE "plugin_media" (
    "id" TEXT NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_appearances" (
    "pluginKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_appearances_pkey" PRIMARY KEY ("pluginKey","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_media_storageKey_key" ON "plugin_media"("storageKey");

-- CreateIndex
CREATE INDEX "plugin_media_pluginKey_status_createdAt_idx" ON "plugin_media"("pluginKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "member_appearances_userId_idx" ON "member_appearances"("userId");

-- AddForeignKey
ALTER TABLE "plugin_media" ADD CONSTRAINT "plugin_media_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "plugins"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_appearances" ADD CONSTRAINT "member_appearances_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "plugins"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_appearances" ADD CONSTRAINT "member_appearances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
