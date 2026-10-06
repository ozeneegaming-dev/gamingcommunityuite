-- Fișierele CSS ale temelor (ACP → Aspect → CSS), cu istoric, și șabloanele modificate (ACP → Aspect → Șabloane).

-- CreateTable
CREATE TABLE "theme_css_files" (
    "id" SERIAL NOT NULL,
    "themeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theme_css_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_css_versions" (
    "id" SERIAL NOT NULL,
    "fileId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theme_css_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_templates" (
    "id" SERIAL NOT NULL,
    "themeId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "baseSource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theme_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_template_versions" (
    "id" SERIAL NOT NULL,
    "themeId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theme_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "theme_css_files_themeId_position_idx" ON "theme_css_files"("themeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "theme_css_files_themeId_name_key" ON "theme_css_files"("themeId", "name");

-- CreateIndex
CREATE INDEX "theme_css_versions_fileId_id_idx" ON "theme_css_versions"("fileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "theme_templates_themeId_key_key" ON "theme_templates"("themeId", "key");

-- CreateIndex
CREATE INDEX "theme_template_versions_themeId_key_id_idx" ON "theme_template_versions"("themeId", "key", "id");

-- AddForeignKey
ALTER TABLE "theme_css_files" ADD CONSTRAINT "theme_css_files_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_css_versions" ADD CONSTRAINT "theme_css_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "theme_css_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_templates" ADD CONSTRAINT "theme_templates_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_template_versions" ADD CONSTRAINT "theme_template_versions_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O singură sursă pentru CSS-ul extra: coloana `customCss` devine fișierul `custom.css` al fiecărei teme (cu o
-- primă versiune, originalul din istoric), apoi coloana dispare.
INSERT INTO "theme_css_files" ("themeId", "name", "position", "content", "updatedAt")
SELECT "id", 'custom.css', 0, "customCss", CURRENT_TIMESTAMP FROM "themes";

INSERT INTO "theme_css_versions" ("fileId", "content", "action")
SELECT "id", "content", 'migrate' FROM "theme_css_files";

-- AlterTable
ALTER TABLE "themes" DROP COLUMN "customCss";
