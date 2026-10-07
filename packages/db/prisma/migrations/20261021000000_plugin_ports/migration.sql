-- Asistentul de portare a pluginurilor (ACP → Sistem → Conversii → Portare plugin): portările, cu arhiva sursă până
-- la conversie, raportul, rezultatul și pachetul generat.

-- CreateTable
CREATE TABLE "plugin_ports" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "source" BYTEA,
    "rightsBasis" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "pluginKey" TEXT,
    "report" JSONB,
    "result" BYTEA,
    "package" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_ports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plugin_ports_createdAt_idx" ON "plugin_ports"("createdAt");
