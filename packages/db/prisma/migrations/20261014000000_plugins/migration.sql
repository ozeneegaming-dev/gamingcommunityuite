-- Pluginurile (etapa 6 §2): pluginurile instalate, încărcările în așteptare, jurnalul și setările hook-urilor.
-- CreateTable
CREATE TABLE "plugins" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signatureKeyId" TEXT,
    "capabilities" TEXT[],
    "manifest" JSONB NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "package" BYTEA,
    "packageSha256" TEXT,
    "dbRole" TEXT,
    "dbPassword" TEXT,
    "migrations" TEXT[],
    "disabledReason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "plugin_uploads" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "fileName" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_logs" (
    "id" SERIAL NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "hook" TEXT,
    "message" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_hook_settings" (
    "pluginKey" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER,

    CONSTRAINT "plugin_hook_settings_pkey" PRIMARY KEY ("pluginKey","hook")
);

-- CreateIndex
CREATE INDEX "plugin_uploads_createdAt_idx" ON "plugin_uploads"("createdAt");

-- CreateIndex
CREATE INDEX "plugin_logs_pluginKey_id_idx" ON "plugin_logs"("pluginKey", "id");

-- AddForeignKey
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "plugins"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_hook_settings" ADD CONSTRAINT "plugin_hook_settings_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "plugins"("key") ON DELETE CASCADE ON UPDATE CASCADE;
