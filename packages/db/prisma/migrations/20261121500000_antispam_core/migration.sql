-- CreateTable
CREATE TABLE "registration_questions" (
    "id" SERIAL NOT NULL,
    "locale" TEXT,
    "question" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_logs" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "email" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spam_logs_kind_createdAt_idx" ON "spam_logs"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "spam_logs_createdAt_idx" ON "spam_logs"("createdAt");

