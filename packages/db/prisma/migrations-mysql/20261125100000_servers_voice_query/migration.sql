-- Aplicația Servere: contul de interogare al serverelor de voce (TeamSpeak ServerQuery / WebQuery; ca pe PostgreSQL).

-- AlterTable
ALTER TABLE `game_servers` ADD COLUMN `queryMode` LONGTEXT NOT NULL DEFAULT ('raw'),
    ADD COLUMN `queryUser` LONGTEXT NOT NULL DEFAULT (''),
    ADD COLUMN `querySecret` LONGTEXT NULL;
