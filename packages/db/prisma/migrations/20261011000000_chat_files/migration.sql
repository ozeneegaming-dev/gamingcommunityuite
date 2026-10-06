-- Chat v3: fișierele (imagini, mesaje vocale) unui mesaj de chat.
ALTER TABLE "chat_messages" ADD COLUMN "files" JSONB NOT NULL DEFAULT '[]';
