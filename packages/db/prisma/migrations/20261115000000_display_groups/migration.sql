-- Nume și grupuri peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): grupul afișat al unui membru (stilul
-- numelui), calculat dintre grupul principal și cele secundare după „Prioritate afișare” (setarea grupului
-- `display.priority`), și grupul ales de membru în Setări (doar dintre grupurile care permit, `display.selectable`).
ALTER TABLE "users" ADD COLUMN "nameGroupId" INTEGER;
ALTER TABLE "users" ADD COLUMN "displayGroupChoiceId" INTEGER;
ALTER TABLE "users" ADD CONSTRAINT "users_nameGroupId_fkey" FOREIGN KEY ("nameGroupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_displayGroupChoiceId_fkey" FOREIGN KEY ("displayGroupChoiceId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;