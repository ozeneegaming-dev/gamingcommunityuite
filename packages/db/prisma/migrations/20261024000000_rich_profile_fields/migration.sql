-- Câmpurile de profil „Text lung” formatate cu editorul (specul 2026-10-07-editor-campuri): documentul și HTML-ul
-- randat de server. Valorile vechi rămân în `value` și se afișează ca paragrafe (conversie la citire, fără migrare
-- de date).

-- AlterTable
ALTER TABLE "profile_field_values" ADD COLUMN "json" JSONB,
ADD COLUMN "html" TEXT NOT NULL DEFAULT '';
