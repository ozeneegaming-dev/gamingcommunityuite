-- Antetele titlurilor (specul 2026-10-07-antete-titluri): fiecare titlu are fundalul lui. Fundalul antetului casetelor
-- (`elements.dark/light.boxHeaderBg`) salvat „transparent” devine noua valoare implicită, `@surface2`, în setările
-- publicate și în draft-ul editorului vizual. Temele publicate schimbate primesc o versiune nouă (URL-ul CSS-ului temei
-- se schimbă, deci browserele nu mai folosesc CSS-ul vechi din cache). Culorile alese de admin rămân neatinse.

UPDATE "themes" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "settings" #>> '{elements,dark,boxHeaderBg}' = 'transparent' OR "settings" #>> '{elements,light,boxHeaderBg}' = 'transparent';

UPDATE "themes" SET "settings" = jsonb_set("settings", '{elements,dark,boxHeaderBg}', '"@surface2"')
WHERE "settings" #>> '{elements,dark,boxHeaderBg}' = 'transparent';

UPDATE "themes" SET "settings" = jsonb_set("settings", '{elements,light,boxHeaderBg}', '"@surface2"')
WHERE "settings" #>> '{elements,light,boxHeaderBg}' = 'transparent';

UPDATE "themes" SET "draft" = jsonb_set("draft", '{elements,dark,boxHeaderBg}', '"@surface2"')
WHERE "draft" #>> '{elements,dark,boxHeaderBg}' = 'transparent';

UPDATE "themes" SET "draft" = jsonb_set("draft", '{elements,light,boxHeaderBg}', '"@surface2"')
WHERE "draft" #>> '{elements,light,boxHeaderBg}' = 'transparent';
