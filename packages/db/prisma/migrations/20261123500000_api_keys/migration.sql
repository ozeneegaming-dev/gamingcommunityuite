-- API: cheile de acces (doar prefixul și hash-ul).

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");
