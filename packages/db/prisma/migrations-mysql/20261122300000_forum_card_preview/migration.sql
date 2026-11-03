-- Cardurile de forum (vederea în grilă): imaginea de previzualizare a forumului, ca pe PostgreSQL.

-- AlterTable
ALTER TABLE `forums` ADD COLUMN `previewFocusX` INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN `previewFocusY` INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN `previewImageId` LONGTEXT NULL,
    ADD COLUMN `previewMode` LONGTEXT NOT NULL DEFAULT ('auto');
