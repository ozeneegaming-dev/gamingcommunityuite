-- Cuvintele cu litere și cifre („Ștefan99”, „Mașina2”, „Șoim-2”) erau indexate fără unaccent:
-- PostgreSQL le dă tipurile numword / numhword / hword_numpart, pe care gcs_ro nu le mapa.
ALTER TEXT SEARCH CONFIGURATION gcs_ro
  ALTER MAPPING FOR numword, numhword, hword_numpart WITH unaccent, simple;

-- Reindexarea conținutului existent (titluri și postări), cu noua mapare.
UPDATE topics SET "searchVector" = setweight(to_tsvector('gcs_ro', title), 'A');
UPDATE posts SET "searchVector" = setweight(to_tsvector('gcs_ro', regexp_replace("contentHtml", '<[^>]*>', ' ', 'g')), 'B');
