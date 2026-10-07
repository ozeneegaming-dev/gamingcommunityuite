# Antetele titlurilor: fiecare titlu pe banda lui

- **Data:** 2026-10-07
- **Cererea (regula proprietarului):** „Titlurile trebuie să fie mereu diferențiate de fundal — fiecare titlu trebuie să
  aibă fundalul lui.”
- **Ce înseamnă concret:** orice bloc cu titlu își arată titlul într-o **bandă de antet** (sau, pentru titlul paginii,
  într-un **panou de antet**) cu un fundal diferit și de fundalul paginii, și de fundalul conținutului blocului.
- **Ce nu se schimbă:** aranjamentul paginilor, ordinea conținutului, tipografia titlurilor (mărimi, majuscule, fonturi)
  și ACP-ul (are designul lui). Se schimbă doar aspectul titlurilor: fundal, padding, separator, colțuri.

## 1. Problema de azi

- Elementul de temă `boxHeaderBg` („Fundalul antetului casetelor”) are implicit `transparent`, iar temele salvate îl
  au scris explicit (`settings.elements.dark/light.boxHeaderBg = "transparent"`, uneori și în `draft`). Deci și
  singurul antet care folosește variabila (`.gcs-category__header`) stă direct pe fundalul casetei.
- Fiecare componentă își desenează titlul altfel: unele doar cu o linie dedesubt (`.gcs-chat__head`,
  `.gcs-topicList__header`), unele cu fundalul lor (`.gcs-replyBox__title`, `.gcs-stream__dayTitle`, `--gcs-surface2`
  scris direct), panoul de statistici cu un gradient de accent în locul fundalului, iar titlurile paginilor (`<h1>`)
  stau direct pe fundalul paginii, unele cu stiluri inline.

## 2. Tratamentul comun

Toate regulile stau într-un singur fișier nou, **`packages/ui/src/titles.css`** (`@gcs/ui/titles.css`), importat
**ultimul** în `apps/web/app/globals.css`: „stratul titlurilor”. Componentele nu-și mai definesc fundalul titlului;
fișierele lor păstrează doar tipografia și aranjamentul.

### 2.1 Banda titlului unei casete (`.gcs-titleBand` și antetele existente)

| Proprietate | Valoare |
|---|---|
| Fundal | `var(--gcs-box-header-bg, var(--gcs-surface2))` — elementul de temă „Fundalul antetului casetelor” |
| Text | `var(--gcs-box-header-text, var(--gcs-text))`; linkurile din titlu au aceeași culoare |
| Separator | o linie de 1 px jos, `var(--gcs-box-border, var(--gcs-border))` (aceeași ca bordura casetei) |
| Padding | 12 px vertical; orizontal = padding-ul casetei (titlul se aliniază cu conținutul de dedesubt) |
| Colțuri | sus = raza casetei minus grosimea bordurii (`calc(var(--gcs-radius, 14px) - var(--gcs-box-border-w, 1px))`), jos 0 |
| Poziție | prima „felie” a casetei, pe toată lățimea ei |

Casetele cu padding (cardurile laterale, cardurile profilului, setările, planurile VIP, regulile, rezultatele
căutării…) își țin padding-ul în `--gcs-box-pad-y` / `--gcs-box-pad-x`; titlul de la început iese până la margini
(`margin: calc(-1 * pad-y) calc(-1 * pad-x) 0`), deci nu se schimbă nici markup-ul, nici conținutul. Clasa
`.gcs-titledBox` dă casetei padding-ul din variabile (implicit 18 × 20 px) și face banda primului titlu.

**Iconița și accentul.** Iconița titlului rămâne la începutul benzii, centrată vertical (pătratul de accent al
widget-urilor, iconița categoriei, `gcs-hIcon`). Accentele existente stau **peste** bandă, nu în locul ei:

- bara colorată a categoriei (`.gcs-category__bar`) rămâne în stânga titlului, pe bandă;
- panoul de statistici își păstrează bara de 3 px în stânga și gradientul de accent, dar gradientul se pictează
  peste fundalul benzii (`background: linear-gradient(…accent…), var(--gcs-box-header-bg, …)`), nu peste
  fundalul casetei;
- planurile VIP își păstrează linia de 3 px în culoarea planului deasupra benzii;
- blocurile „Cine e online” / „Cine a fost online” își păstrează bordura colorată din stânga, care continuă pe bandă.

Benzile casetelor **nu primesc un accent nou**: diferența vine din fundal și separator; accentul rămâne rezervat
iconițelor și panourilor de pagină (mai jos). Controalele din bandă care aveau fundalul `--gcs-surface2` (butoanele
pătrate ale chat-ului, butonul de restrângere al statisticilor, filtrul de prefixe, pătratul iconiței statisticilor)
primesc fundalul casetei, ca să nu se piardă în bandă.

### 2.2 Sub-banda (titlul unei secțiuni dintr-o casetă)

Aceeași bandă, mai discretă: același fundal și separator, padding 8–10 px, colțurile sub-blocului. Se folosește când
o casetă are secțiuni cu titlu propriu (secțiunile setărilor, „Cine e online” și legenda din panoul de statistici,
grupurile camerelor de chat, grupurile emoticoanelor). Un titlu de secțiune fără chenar propriu (ex. „Insigne
blocate”, subtitlurile setărilor) devine o fâșie de bandă cu colțuri de 8 px, pe toată lățimea secțiunii.

### 2.3 Panoul de antet al paginii (`.gcs-pageHeader`)

Titlul paginii (`<h1>`) nu mai stă direct pe fundalul paginii: e într-un panou propriu.

| Proprietate | Valoare |
|---|---|
| Fundal | același ca banda: `var(--gcs-box-header-bg, var(--gcs-surface2))` |
| Chenar | 1 px `var(--gcs-box-border, var(--gcs-border))`, raza casetelor (`--gcs-radius`) |
| Accent | o bară de 3 px în culoarea de accent pe marginea din stânga (`box-shadow: inset 3px 0 0 var(--gcs-accent)`) — același semn ca linkul activ din meniul setărilor; e singurul accent nou al regulii și marchează nivelul „pagină” |
| Padding | 18 × 22 px (16 × 16 px pe telefon) |
| Conținut | breadcrumb-ul (opțional, primul rând, pe toată lățimea), apoi titlul cu iconița, descrierea (opțională, `--gcs-muted`) și, în dreapta, acțiunile paginii (butoane) |

Paginile care aveau doar un `<h1>` (cu stil inline) primesc `<header className="gcs-pageHeader">` în jurul lui și al
acțiunilor existente (membri, mesaje, notificări, staff, etichete, căutare, topic nou, pagina unui plugin, chat-ul
fără camere, conversația cu linkul „înapoi”). Pe forum, topic și „Topic nou”, breadcrumb-ul intră în panou, ca prim rând.

Pagini cu antet special:

- **Profilul**: antetul cu copertă e deja un panou propriu; zona identității (avatarul, numele, insignele, acțiunile)
  primește fundalul benzii sub copertă (gradient care începe exact unde se termină suprapunerea avatarului), deci
  numele nu mai stă pe fundalul casetei.
- **Regulile**: documentul e o casetă; antetul lui (titlul + data actualizării) devine banda casetei.
- **Setările**: titlul „Setări” din coloana meniului devine un panou mic de antet; titlul fiecărei secțiuni de setări
  este banda casetei din dreapta.
- **Anunțul** (widget-ul erou de pe prima pagină) rămâne cum e: e deja un panou cu fundalul lui (gradient), iar titlul
  e chiar conținutul panoului.

### 2.4 Întunecat și luminos

Fundalul benzii e o referință la paletă (`@surface2`), deci urmează automat modul:

| | Pagina (`bg`) | Banda (`surface2`) | Conținutul casetei (`surface`) |
|---|---|---|---|
| Întunecat | `#0B0C10` | `#1B1E26` | `#14161C` |
| Luminos | `#F4F5F7` | `#EEF0F3` | `#FFFFFF` |

În modul întunecat banda e mai deschisă decât conținutul; în cel luminos e mai închisă decât conținutul alb. Față de
pagină, în modul luminos diferența de culoare e mică, de aceea banda casetei e închisă de bordura casetei, iar
panoul de pagină are și chenarul, și bara de accent. Textul benzii (`--gcs-text`) are contrast ≥ 12:1 în ambele moduri,
iar textul secundar (`--gcs-muted`) ≥ 4.5:1.

## 3. Tema: valoarea implicită și migrarea

- `DEFAULT_ELEMENTS.boxHeaderBg`: `"transparent"` → **`"@surface2"`** (ambele moduri). Referința la token e rezolvată
  de `themeColorCss` (`var(--gcs-surface2)`) și diferă de `boxBg` (`@surface`) în ambele palete implicite.
- **Normalizarea** (`normalizeThemeSettings`): elementele care trebuie să aibă mereu fundal (lista
  `THEME_OPAQUE_ELEMENTS = ["boxHeaderBg"]`) nu pot rămâne `transparent`: o valoare `transparent` sau goală devine
  valoarea implicită. Validarea patch-urilor acceptă în continuare `transparent` (temele importate sau clienții vechi nu
  primesc erori), dar valoarea salvată se normalizează la citire, deci CSS-ul compilat are mereu un fundal.
- **Editorul vizual**: selectorul de culoare nu mai oferă mostra „Transparent” pentru „Fundalul antetului casetelor”
  (rămâne la celelalte elemente). Culoarea se poate alege în continuare din mostre (tokenurile paletei) sau din selector.
- **Migrarea** `20261025000000_title_bands`: în `themes`, coloanele `settings` și `draft`, căile
  `elements.dark.boxHeaderBg` și `elements.light.boxHeaderBg` care sunt exact `"transparent"` devin `"@surface2"`.
  Temele cărora li se schimbă setările publicate primesc `version + 1` (URL-ul CSS-ului temei se schimbă, deci browserele
  nu păstrează CSS-ul vechi din cache). Culorile alese de admin rămân neatinse.

## 4. Inventarul titlurilor de pe site

„Înainte” = cum arăta titlul; „După” = tratamentul din §2.

### 4.1 Benzi de casetă

| Titlul | Clasa / locul | Înainte | După |
|---|---|---|---|
| Categoriile de pe prima pagină | `.gcs-category__header` | `--gcs-box-header-bg` (transparent) + linie | bandă (§2.1); bara categoriei pe bandă |
| Lista topicurilor (forum, etichete) | `.gcs-topicList__header` | doar linie | bandă; filtrul de prefixe cu fundalul casetei |
| Widget-urile din coloane (topicuri recente, postări recente, statistici, membri noi, top posteri, topicuri recomandate, „Cine e online”, „Cine a fost online”, legenda, widget-urile pluginurilor) | `.gcs-sideCard > .gcs-sideCard__title` (`GcsWidgetTitle`) | text pe caseta | bandă care iese până la marginile cardului |
| Panoul de statistici | `.gcs-statsPanel__head` | gradient de accent pe caseta | bandă + gradientul și bara de accent peste ea |
| Shoutbox-ul și chat-ul (pagina /chat) | `.gcs-chat__head` | doar linie | bandă; butoanele pătrate cu fundalul casetei |
| Cardurile laterale ale chat-ului (online, membrii camerei, anunțul) | `.gcs-sideCard > .gcs-sideCard__title` | text pe caseta | bandă |
| Răspunsul rapid | `.gcs-replyBox__title` | `--gcs-surface2` scris direct | bandă (aceeași variabilă) |
| Sondajul | `.gcs-poll__question` | text pe caseta | bandă |
| Zilele din „Activitate” | `.gcs-stream__dayTitle` | `--gcs-surface2` scris direct | bandă (aceeași variabilă, textul rămâne `--gcs-muted`) |
| Cardurile profilului (Despre, Conturi, Insigne, Activitate, Urmăritori, Avertismente…) | `.gcs-profileSection__title` (era stil inline) | text pe caseta | bandă |
| Secțiunea din dreapta a setărilor | `.gcs-settingsCard > … > .gcs-settingsTitle` (primul titlu) | text pe caseta | bandă |
| Planurile VIP | `.gcs-vipPlan__head` | text pe caseta | bandă sub linia planului |
| Regulile comunității | `.gcs-rules__head` | text + linie | bandă |
| Rezultatele căutării | `.gcs-searchResult__title` | text pe caseta | bandă |
| Mesaje: „Mesaj nou”, participanții conversației | `.gcs-titledBox > .gcs-titleBand` (era stil inline) | text pe caseta | bandă |
| Login / înregistrare (pagină) | `GcsAuthCard`, `.gcs-titleBand` | text pe caseta | bandă |
| Login / înregistrare (popup) | `.gcs-authModal .gcs-modal__header` | text pe dialog | bandă (doar popup-ul site-ului; dialogurile ACP rămân) |
| Dialogurile topicului (raportare, istoric) și regulile chat-ului | `.gcs-dialog__title`, `.gcs-chat__dialog > h2` | text pe dialog | bandă |
| Panoul notificărilor (clopoțel) | `.gcs-notifPanel__head` | doar linie | bandă |

### 4.2 Sub-benzi

| Titlul | Clasa | Înainte | După |
|---|---|---|---|
| „Cine e online” / „Cine a fost online” din panoul de statistici | `.gcs-onlineBlock__title` | text în prima coloană | sub-bandă pe toată lățimea blocului (coloanele rămân dedesubt) |
| Legenda grupurilor din panou | `.gcs-legendBlock__title` | text mic, gri | sub-bandă |
| Secțiunile setărilor (email, parolă, conturi legate, notificări…) | `.gcs-settingsFieldset > .gcs-settingsTitle`, `.gcs-settingsSubtitle` | text | sub-bandă |
| Grupurile camerelor de chat | `.gcs-chatRooms__title` | etichetă gri | sub-bandă |
| Grupurile emoticoanelor | `.gcs-chat__emojiHead` | `--gcs-surface2` scris direct | sub-bandă (aceeași variabilă) |
| „Insigne blocate” (profil) | `.gcs-badgeGrid__section` | text | sub-bandă |
| Grupurile din pagina Staff | `.gcs-staffGroup__title` | text pe pagină | fâșie de bandă cu chenar (nivel de secțiune) |
| Titlul meniului din dropdown-uri | `.gcs-dropdown__heading` (doar pe site) | etichetă gri | sub-bandă |

### 4.3 Panouri de pagină

| Pagina | Înainte | După |
|---|---|---|
| Forum, topic | breadcrumb + `.gcs-pageHeader` pe pagină | panou cu breadcrumb-ul înăuntru |
| Topic nou | breadcrumb + `<h1>` | panou cu breadcrumb |
| Activitate, Clasament, VIP | `.gcs-pageHeader` pe pagină | panou |
| Membri, Mesaje, Notificări, Staff, Etichete, Căutare, pagina unui plugin, Chat (fără camere), conversația | `<h1>` cu stil inline (unele cu acțiuni lângă) | panou (acțiunile în dreapta) |
| Chat (cu camere): „Chat” deasupra camerelor | `<h1>` cu stil inline | panou mic |
| Setări: „Setări” deasupra meniului | `<h1>` cu stil inline | panou mic |
| Profilul | numele pe caseta antetului | zona identității pe bandă, sub copertă |

### 4.4 Ce nu e „titlu de bloc” (rămâne cum e)

- Titlurile **rândurilor** din liste: forumurile, topicurile, ultimele postări, rândurile widget-urilor, conversațiile
  din inbox (`.gcs-forumRow__title`, `.gcs-topicRow__title`, `.gcs-widgetRow__title`, `.gcs-inbox__title`…): sunt
  elemente ale listei, iar lista are deja banda ei.
- Antetul postării (`.gcs-post__head`: data, numărul), antetul mesajelor (`.gcs-message__head`), titlul membrului din
  postbit (`.gcs-postbit__title`), coperta hover card-ului: meta, nu titluri.
- Anunțul erou (vezi §2.3) și etichetele plăcilor de statistici.
- **ACP-ul** și uneltele de administrare de pe site: editorul vizual al temei și lista „Widget-uri disponibile” a
  modului „Editează pagina” (`.gcs-pageSidebar`) au designul ACP.

## 5. Teste

- `@gcs/core` (vitest): valoarea implicită (`@surface2`, diferită de `boxBg` în ambele moduri și rezolvată la
  `var(--gcs-surface2)` în CSS-ul compilat); normalizarea (`transparent` → implicit pentru `boxHeaderBg`, alte elemente
  păstrează `transparent`); validarea acceptă `transparent`; migrarea folosește aceeași valoare ca implicitul.
- `@gcs/db` (`migrate.test.ts`): un site dinainte de migrare cu o temă `transparent` (în `settings` și `draft`) și una
  cu o culoare aleasă: după actualizare prima are `@surface2` și versiunea crescută, a doua rămâne neatinsă.
- `@gcs/ui` (`css.test.ts`): `titles.css` folosește `--gcs-box-header-bg` pentru toate tipurile de titlu din inventar.
- E2E: specurile existente (widgets, forum, topic, members, main-menu, profile, settings, theme-editor, stage5-smoke) și
  capturi întunecat / luminos ale paginilor din inventar.
