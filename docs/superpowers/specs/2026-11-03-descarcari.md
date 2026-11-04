# Descărcări (aplicația standard `downloads`, etapa 8)

- **Data:** 2026-11-03
- **Cererea proprietarului:** aplicația standard Descărcări, completă: categorii cu permisiuni, trimiteri de la membri cu
  aprobarea staff-ului, descărcare doar pentru membri, categorii VIP, 200 MB implicit, antivirus ClamAV, cote de stocare.
- **Deciziile proprietarului (2026-10-09):** orice membru trimite fișiere, care apar după aprobare (cine încarcă se
  setează pe categorie); doar membrii logați descarcă, vizitatorii văd fișierele; categoriile / fișierele VIP se văd de
  toți, iar ceilalți primesc invitația VIP; 200 MB implicit; ClamAV ca serviciu compose opțional, pornit odată cu
  aplicația; fișier curat → coada de aprobare, infectat → carantină, autorul anunțat, staff-ul alertat; arhivele scanate
  pe dinăuntru; tipul verificat după conținut; rescanare periodică; fără ClamAV (Lite) doar aprobare manuală.
- **Rutele:** `/downloads`, `/downloads/all`, `/downloads/category/{id}-{slug}`, `/downloads/file/{id}-{slug}` (+ `/edit`,
  `/version`, `/log`), `/downloads/submit`, `/downloads/mine`, `/downloads/get/{asset}?t=`, `/downloads/rss.xml`.
- **ACP:** Comunitate → Descărcări: Prezentare, Coada de aprobare, Fișiere, Categorii, Câmpuri suplimentare, Antivirus,
  Setări; Statistici → Descărcări; permisiunile pe categorie (`/admin/permissions/downloads/{id}`); tabul aplicației în
  editarea grupului (setările de grup `downloads.*`).

## 1. Modelul

`download_categories` (arbore, opțiunile în `options`, câmpurile activate în `fieldIds`, `vipOnly`, `clanId`),
`download_files` (intrarea: titlu, rezumat, descriere, starea, versiunea curentă, contoare), `download_versions`
(eticheta, schimbările, starea), `download_assets` (fișierele: încărcare pe bucăți, link, import; tipul real, sha256,
rezultatul antivirusului), `download_reviews`, `download_comments`, `download_logs`, `download_fields`. Fără chei străine
spre `users` (aplicația își tratează datele la ștergerea / unirea conturilor: `downloadMemberData`). Migrația există pe
PostgreSQL și MySQL (`20261124000000_downloads`).

## 2. Fluxul unui fișier

1. Formularul alege categoria (regulile ei), apoi încarcă fișierele **pe bucăți de 8 MB** (`/api/downloads/uploads`):
   extensia permisă, mărimea (cea mai mică dintre categorie / site și grup), cota membrului și a site-ului.
2. După ultima bucată, jobul `downloads.process` lipește fișierul, îi află **tipul real după conținut** (un executabil
   deghizat e respins), îl trece prin **ClamAV** (INSTREAM, arhivele pe dinăuntru) și îl mută în stocare (sau în
   `downloads/quarantine/`).
3. La trimitere, versiunea rămâne „în verificare” până se termină toate fișierele; apoi: infectat → carantină (autorul
   și staff-ul anunțați), eșuat → respins, curat → coada de aprobare (sau publicat, pentru staff / categoriile fără
   aprobare). O eroare a antivirusului → coada, marcat „neverificat” (sau respins, după setare).
4. Publicarea face versiunea curentă, păstrează / șterge versiunile vechi după categorie, creează topicul de suport
   (opțional) și anunță urmăritorii.
5. Descărcarea: tokenul paginii (fără linkuri directe), drepturile categoriei, VIP-ul, limita pe membru, logul.
6. Jobul `downloads.rescan` reverifică fișierele publicate cu semnăturile noi; `downloads.maintain` curăță încărcările
   neterminate, carantina veche și logul.

## 3. Paritatea cu aplicația de referință (idei și structură, design GCS)

| Funcția din referință | Stare în GCS |
|---|---|
| Categorii cu nume, descriere, părinte; subcategorii | făcut |
| Matricea pe categorie cu 6 drepturi (vede categoria, vede fișierele, încarcă, descarcă, comentează, recenzii) | făcut (pagina comună de permisiuni, cu moștenirea părintelui) |
| Ecranul de permisiuni deschis automat după salvare | parțial: butonul „Permisiuni” pe fiecare categorie |
| Copierea unei categorii (setări + permisiuni) | făcut |
| Ordinea categoriilor | făcut (↑ / ↓ între categoriile surori, din tastatură) |
| Conținut anonim | lipsește: GCS nu are postare anonimă |
| Comentarii (cu aprobare), recenzii (cu aprobare, „doar după descărcare”) | făcut |
| Sortarea implicită a categoriei | făcut |
| Termenii descărcării / trimiterii și când se acceptă | făcut („înainte de cumpărare” vine cu Magazinul) |
| Iconița (niciuna / aleasă / încărcată), imaginea de copertă | făcut |
| Iconița estompată fără conținut necitit | lipsește: fișierele nu au „necitit” în GCS |
| Logul descărcărilor, păstrarea lui, vizibil autorului | făcut |
| Extensiile permise, mărimea maximă (sau nelimitat), mai multe fișiere într-o intrare | făcut |
| Versiuni: oprite / opționale / obligatorii, păstrarea celor vechi, câte, schimbări obligatorii | făcut |
| Fișierele trebuie aprobate | făcut (implicit pornit, decizia proprietarului) |
| Capturi: permise / obligatorii, mărimea maximă | făcut |
| Capturi: dimensiunile maxime | lipsește: imaginile sunt micșorate oricum la latura din ACP › Încărcări |
| Etichete pe fișiere | făcut |
| Prefixe pe fișiere | lipsește: prefixele GCS sunt ale forumurilor |
| Mesajele pentru cine nu poate vedea / descărca | făcut (text simplu) |
| Topicul de suport la fiecare fișier nou (forum, prefix, sufix, ștergere odată cu fișierul) | făcut |
| Prima captură în topicul de suport | lipsește: editorul acceptă doar imagini https externe |
| Câmpuri suplimentare: tipuri (inclusiv membri / co-autori), mai multe valori, obligatoriu, locul pe pagină | făcut |
| Câmpurile în topicul de suport, cu format | făcut |
| Câmpurile activate pe categorie, permisiunile pe câmp (văd / completează) | făcut |
| Indexul pe casete: Recomandate (câte), Noutăți, Cele mai bine notate, Cele mai descărcate (pe categorii) | făcut (și ca widget-uri) |
| Widget-ul categoriilor cu numărul de fișiere | făcut |
| Watermark pe capturi | făcut (imaginea, locul, opacitatea) |
| Domenii blocate la trimiterea prin URL | făcut |
| Fără linkuri directe | făcut (token legat de membru, o oră) |
| RSS al fișierelor noi | făcut (general și pe categorie) |
| Fișiere cu plată (comision, taxă, cost minim, metode, credit) | lipsește, intenționat: vine cu aplicația Magazin |
| Trimitere prin link extern (drept de grup) | făcut |
| Import din calea de pe server (doar staff) | făcut (folderul `config/imports` sau `GCS_DOWNLOADS_IMPORT_DIR`) |
| Trimiterea în bloc (drept de grup) | făcut |
| Mărimea maximă pe grup (se aplică cea mai mică) | făcut |

**În plus față de referință (cerințele proprietarului):** antivirusul ClamAV (scanare, carantină, rescanare, test, alertă
staff, și pentru atașamentele din forum / mesaje / chat), tipul real după conținut, categoriile și fișierele VIP cu
invitația VIP, cotele de stocare (pe grup și pe site), încărcarea reluabilă pe bucăți (fișiere de 200 MB și peste),
categoria unui clan (drepturile din apartenență), mențiunile și numele stilizate în descrieri, recenzii și comentarii,
urmărirea fișierelor și a categoriilor, notificările, statisticile, ștergerea / unirea conturilor, ediția Lite (MySQL,
fără antivirus).
