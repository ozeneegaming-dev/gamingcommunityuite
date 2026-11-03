-- Mega meniurile: „Link scurt” pe subitemii meniului (coloana din dreapta a submeniului).

-- AlterTable
ALTER TABLE "nav_items" ADD COLUMN     "shortLink" BOOLEAN NOT NULL DEFAULT false;
