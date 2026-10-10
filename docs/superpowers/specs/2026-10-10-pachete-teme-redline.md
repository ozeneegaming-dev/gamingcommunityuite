# Pachetele de temă și tema „RED-LINE OFFICIAL”

- **Data:** 2026-10-10
- **Cererea proprietarului:** o temă nouă de gaming, modernă, „cu tot ce trebuie” (stil cyber neon, mov + cyan), numită
  **RED-LINE OFFICIAL**, livrată ca **fișier care se încarcă direct în ACP**; temele să se poată schimba **direct din forum**.

## 1. Pachetul de temă (`.gcs-theme.json`)

- Un singur fișier JSON: `format: "gcs-theme"`, `version: 1`, `key`, `name`, opțional `description` / `author`,
  `settings` (un patch peste setările temei, ca draft-ul editorului vizual) și `cssFiles` (`[{ name, content }]`, în
  ordinea compilării).
- Validarea (`parseThemePackage`, strictă, erori pe câmpuri): numele 1–40, cheia ca la temele create din ACP, setările
  cu aceleași reguli ca editorul (`themeSettingsErrors`), cel mult 30 de fișiere CSS, nume valide și unice, cel mult
  50 000 de caractere fiecare; fișierul încărcat are cel mult 900 KB (sub limita Server Actions).
- Imaginile (logo-urile, favicon-ul, imaginea antetului) sunt fișiere ale site-ului sursă (`/files/<id>`): nu intră în
  pachet și se ignoră la import; tema le primește din editorul vizual.
- **Exportă** (ACP → Aspect → Teme, butonul de pe fiecare temă): `GET /api/themes/export?key=` (dreptul „vede” pe
  secțiunea temelor) descarcă `<cheia>.gcs-theme.json` cu setările și fișierele CSS publicate (fără cele goale).
- **Importă o temă** (aceeași pagină): tema nouă e **inactivă și neimplicită** (adminul o verifică în editorul vizual,
  apoi o pornește); cheia ocupată primește un sufix (`-2`, `-3`…); setările lipsă vin din designul pachetului
  (`preset`); CSS-ul trece prin aceeași sanitizare ca ACP → Aspect → CSS (versiunea fișierului: `import`); jurnal
  `theme.import`.

## 2. Schimbarea temei din forum

- Subsolul are meniul **„Tema forumului”** (lângă limbă și comutatorul de mod) când există cel puțin două teme active:
  oricine (și vizitatorii) alege tema dintre cele active, fără Setări → Aspect. Formularul merge și fără JavaScript
  (`setSkinChoice`: cookie-ul `gcs-skin`, plus preferința membrului, ca alegerea din Setări → Aspect).
- În șabloanele modificate ale subsolului, meniul vine în slotul `scheme`, împreună cu comutatorul de mod.

## 3. Tema RED-LINE OFFICIAL (`themes/redline-official/`)

- Sursele: `theme.json` (numele, cheia, setările) și `css/` (patru fișiere); `node themes/build.mjs redline-official`
  scrie pachetul `redline-official.gcs-theme.json` (cel încărcat în ACP). Testul pachetelor verifică faptul că pachetul
  e valid, la zi cu sursele, că sanitizarea nu scoate nimic și că toate regulile stau sub `html.gcs-nova`.
- Construită peste designul Nova (`preset: nova`: antetul înalt, rândul breadcrumb + căutare, benzile, subsolul bogat,
  hover-ul), cu designul ei în CSS-ul temei, sub `html.gcs-nova` (nu atinge ACP-ul):
  - paleta: întunecat `#07060D` / casete `#110F1C`, accent mov electric `#8B3DFF`, cyan `#22E4FF` pentru text, link-uri
    la hover și iconițe; luminos: suprafețe lavandă deschise, același mov, cyan închis `#0A7FA3` (contrast pe alb);
  - Rajdhani (titluri, meniul, butoanele, cu majuscule și spațiere) + Inter (text, 14 px), din Google Fonts (OFL);
  - fundalul cu grilă tehnică și două lumini fixe; antetul violet cu grilă și linia neon animată jos (oprită la
    „mișcare redusă”); logo-ul hexagonal mov → cyan; meniul activ cu linia cyan care strălucește;
  - benzile cu gradient mov și bara cyan, iconițele în pătrate rotunjite; butoanele principale în gradient cu
    strălucire; câmpurile cu focus cyan; rândurile forumului / topicurilor se aprind cu bara cyan la hover;
  - postările cu autorul pe fundal mov adânc, prima postare evidențiată; subsolul cu linia neon și pastilele cyan;
  - antetul rămâne închis și în modul luminos (cu un cyan propriu); pe telefon, titlurile și grila se micșorează;
  - stratul „HUD” (`redline-fx.css`, ultimul): casetele din sticlă cu chenar în gradient mov → cyan și colțuri de
    țintă, benzile cu dungi tehnice și linia care se aprinde la hover, forumurile ca plăci separate cu iconița în
    hexagon, butoanele principale cu colțuri tăiate și reflex de lumină, aurora din antet, titlurile paginilor și
    statisticile în gradient, inelul neon al avatarelor, liniile de scanare (doar în modul întunecat).
- Meniul principal se remăsoară și când fonturile Google ale temei termină de încărcat (`loadingdone`), nu doar la
  `document.fonts.ready` (care se poate rezolva înainte ca ele să fie cerute): butoanele nu se mai suprapun.
- Setările temei rămân editabile din editorul vizual (culorile, fonturile, logo-ul, imaginea antetului…). Excepție:
  stilul benzilor e dat de CSS-ul temei (setarea „Stilul benzilor” nu-l schimbă).
