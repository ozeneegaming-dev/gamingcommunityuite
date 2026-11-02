-- Setări → Termeni și confidențialitate: momentul acceptării termenilor la înregistrare.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);
