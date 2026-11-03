-- Cardurile de forum (vederea în grilă): imaginea de previzualizare a forumului (modul, imaginea din ACP, focalizarea).

-- AlterTable
ALTER TABLE "forums" ADD COLUMN     "previewFocusX" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "previewFocusY" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "previewImageId" TEXT,
ADD COLUMN     "previewMode" TEXT NOT NULL DEFAULT 'auto';
