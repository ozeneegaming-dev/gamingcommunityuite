-- Aplicația Servere: contul de interogare al serverelor de voce (TeamSpeak ServerQuery / WebQuery).

-- AlterTable
ALTER TABLE "game_servers" ADD COLUMN "queryMode" TEXT NOT NULL DEFAULT 'raw',
ADD COLUMN "queryUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN "querySecret" TEXT;
