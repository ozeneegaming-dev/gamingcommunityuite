-- Setări → Termeni și confidențialitate: momentul acceptării termenilor la înregistrare (ca pe PostgreSQL).

-- AlterTable
ALTER TABLE `users` ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL;
