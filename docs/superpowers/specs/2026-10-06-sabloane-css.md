# Șabloane HTML și fișiere CSS (ACP → Aspect → Șabloane / CSS)

Data: 2026-10-06 · Stare: implementat · Sursa: specul etapei 6, §3 („Șabloane editabile, sigure”)

## Scop

Proprietarul vrea, ca într-o suită de forum clasică, să poată schimba din ACP **markup-ul** zonelor importante și
**CSS-ul** temei, cu previzualizare, istoric și revenire la original — dar fără ca un admin (sau un cont de admin
compromis) să poată rula cod pe server sau JavaScript în browserul vizitatorilor.

## A. ACP → Aspect → CSS

### Model

- `theme_css_files` (`ThemeCssFile`): `themeId`, `name` (unic pe temă, `^[a-z0-9][a-z0-9._-]{0,40}\.css$`),
  `position`, `content` (deja sanitizat), `updatedAt`. Cel mult 30 de fișiere pe temă, 50.000 de caractere pe fișier.
- `theme_css_versions` (`ThemeCssVersion`): `fileId`, `content`, `action` (`create`, `save`, `restore`, `publish`,
  `migrate`, `import`), `authorId`, `authorName` (denormalizat: istoricul rămâne lizibil și după ștergerea userului),
  `createdAt`. Prima versiune a fișierului e „originalul” (diferențele „față de original”).
- **O singură sursă de adevăr:** coloana `themes.customCss` dispare. Migrația o mută în fișierul `custom.css` al
  fiecărei teme (cu o versiune `migrate`). Dialogul „CSS personalizat” din editorul vizual editează tot `custom.css`:
  modificarea stă în draft-ul temei (`draft.customCss`, ca până acum) și, la „Salvează și publică”, devine o versiune
  nouă a fișierului (`publish`). Salvarea lui `custom.css` din ACP → CSS șterge `draft.customCss` (altfel publicarea
  draft-ului ar suprascrie fișierul cu o copie veche).
- `custom.css` nu se poate redenumi sau șterge (e fișierul editorului vizual); celelalte da. Ordinea se schimbă cu
  săgeți sus/jos.

### Compilare

`GcsThemeService.css()`: CSS-ul generat din setări, apoi fișierele în ordinea `position`, fiecare cu un comentariu
`/* nume.css */`, totul trecut încă o dată prin `sanitizeThemeCss` (idempotent). Orice salvare crește
`themes.version`, deci URL-ul `/gcs-theme.css?v=` se schimbă și browserele iau imediat CSS-ul nou.

### Validare

`sanitizeThemeCssReport(raw)` întoarce CSS-ul curățat **și lista a ce s-a eliminat** (rândul, fragmentul, motivul:
HTML, `expression(`, `javascript:`, `@import` străin, `@charset`, `url()` nepermis, `-moz-binding`, `behavior:`).
`sanitizeThemeCss` rămâne aceeași funcție (folosește raportul). Editorul arată lista după salvare.

### Interfața

- Intrare nouă în meniu: Aspect → **CSS** (`fa-brands fa-css3-alt`), secțiune ACP proprie `appearance.css`
  (apare automat în matricea rolurilor ACP; `edit` = salvare/creare/reordonare/restaurare, `delete` = ștergere).
- Selectorul de temă sus; lista fișierelor (creare, redenumire, ștergere, reordonare); editorul de cod
  (CodeMirror 6, încărcat leneș — doar pe paginile editorului): evidențiere, numere de rând, căutare (Ctrl+F),
  salvare cu Ctrl+S, avertisment la plecare cu modificări nesalvate.
- **Previzualizarea live**: același `iframe` ca editorul vizual (`/?gcs-theme-preview=<cheie>` + cookie-ul lui +
  puntea `postMessage`). Editorul compilează în browser exact ca serverul (`compileThemeCss` din `@gcs/core/themes`)
  cu fișierul nesalvat și trimite rezultatul previzualizării; vizitatorii nu văd nimic până la salvare.
- **Istoricul** fiecărui fișier: cine și când, diferențele față de versiunea anterioară sau față de original
  (diff pe rânduri, `@gcs/core/diff`), „Restaurează” (o versiune nouă `restore`). Fiecare operație intră în jurnalul
  ACP (`theme.css.*`).

## B. ACP → Aspect → Șabloane

### Motorul (`packages/core/src/templates`)

Limbaj de tip Liquid, randat doar pe server, într-un sandbox:

- `{{ expr | filtru: arg, cheie: valoare }}` — **escapat implicit**. HTML brut iese doar din valori marcate de cod ca
  sigure (`GcsSafeHtml`: conținutul postărilor și semnăturile, deja sanitizate; corpul emailurilor). Șablonul nu are
  niciun mijloc de a produce o valoare „sigură” (fără filtru `raw`).
- Taguri: `if / elsif / else`, `unless`, `case / when`, `for … in … limit: offset: reversed` (cu `forloop.index`,
  `index0`, `rindex`, `first`, `last`, `length`) și `else` pentru liste goale, `break`, `continue`, `assign`,
  `capture`, `comment`, `raw`, `include "grup.nume" param: valoare`, `hook "punct.nume"` (puncte de extensie pentru
  pluginuri; deocamdată goale), `slot "nume"` (locul unei părți interactive randate de React).
- Componente ale platformei: `{% icon "fa-solid fa-star" %}`, `{% avatar user, size: "s" %}`,
  `{% username user %}`, `{% time date %}` (dată relativă, ca pe site).
- Filtre: `escape`, `date` (`short`/`medium`/`long`/`full`/`date`/`time`/`relative`/`iso`), `number`, `truncate`,
  `truncatewords`, `upcase`, `downcase`, `capitalize`, `default`, `t` (texte traduse, cu parametri), `size`, `first`,
  `last`, `join`, `split`, `append`, `prepend`, `replace`, `remove`, `strip`, `plus`, `minus`, `times`, `divided_by`,
  `modulo`, `round`, `abs`, `url_encode`, `tint` (culoare `#RRGGBB` → `rgba` translucid, ca în componente).
- Adevărat/fals: `false`, `nil`, `""`, `0` și listele goale sunt false (mai intuitiv pentru admini decât Liquid).
- **Sandbox:** doar valori de date (primitive, liste, obiecte simple, `Date`); funcțiile nu se apelează niciodată;
  `__proto__`, `constructor`, `prototype` sunt blocate; fără acces la sistem, fișiere sau rețea.
- **Limite:** sursa ≤ 64 KB, timp de randare (50 ms pe site, 250 ms în previzualizare), 20.000 de iterații, ieșire
  ≤ 256 KB, includeri pe cel mult 5 niveluri.
- **Erori cu rând și coloană**, atât la parsare (la salvare: șablonul nu se salvează) cât și la randare (pe site
  componenta revine la ieșirea implicită React și eroarea ajunge în log; pagina nu se strică).
- Parsarea se face o dată: AST-ul compilat e păstrat într-un cache (după sursă, 500 de intrări).
- **HTML-ul final trece prin sanitizer** (`sanitize-html`, listă de taguri și atribute permise): fără `script`,
  `style`, `iframe`, `object`, `form`, `input`; fără atribute `on*`; `href`/`src` doar `http(s)`, `mailto` sau căi
  relative (fără `javascript:`, `data:`); `style` permis doar cu declarații verificate (fără `url()` străin,
  `expression`, `@import`, `\`); `target="_blank"` primește `rel="noopener"`.

### Stocarea (Prisma)

- `theme_templates` (`ThemeTemplate`): suprascrierea unui șablon pe o temă (`themeId`, `key`, `source`,
  `baseVersion` = versiunea șablonului implicit de la care a pornit, `baseSource` = sursa lui de atunci).
- `theme_template_versions` (`ThemeTemplateVersion`): istoricul pe (temă, cheie), păstrat și după „Revino la
  original” (`action`: `save`, `restore`, `revert`, `import`; autor; dată).
- Șabloanele implicite stau în cod (`packages/core/src/templates/defaults.ts`), fiecare cu o **versiune**. Când o
  actualizare GCS schimbă un șablon implicit (versiunea crește), suprascrierile pornite de la o versiune mai veche
  apar „necesită revizuire”, cu diferențele dintre originalul vechi și cel nou. „Marchează ca revizuit” sau o salvare
  le aliniază.
- Fără rând = șablonul implicit = **ieșirea React de acum** (nicio schimbare vizuală până nu se modifică ceva).
- Cache: suprascrierile unei teme stau în cache-ul Redis (eticheta `templates`), invalidat la orice modificare.

### Ce șabloane sunt legate (prima serie)

Componenta React păstrează comportamentul (formulare, butoane, meniuri); când tema are o suprascriere, markup-ul
vine din șablon, cu datele pe care componenta le are deja. Părțile interactive intră prin `{% slot %}`; dacă
șablonul nu pune un slot obligatoriu, React îl adaugă la final.

| Cheie | Zona | Sloturi |
| --- | --- | --- |
| `forum.row` | rândul unui forum (index, subforumuri) | — |
| `forum.topic_row` | rândul unui topic (listele de topicuri) | `select` (bifa moderatorului) |
| `postbit.author` | coloana autorului din postare | — |
| `postbit.fields` | câmpurile de profil din postbit (inclus de `postbit.author`) | — |
| `members.card` | cardul unui membru (`/members`, `/staff`) | — |
| `members.hover_card` | hover card-ul (randat pe server, în API) | `actions` (Urmărește / Mesaj) |
| `layout.footer` | subsolul site-ului | `language`, `scheme`, `powered` |
| `widgets.card` | cardul comun al widget-urilor | `content`, `extra` |
| `email.layout` | învelișul HTML al emailurilor | — (`content` = corpul generat) |

Variabilele fiecărui șablon sunt documentate în cod (`variables`) și apar lângă editor (click = inserare; tot ele
alimentează autocompletarea). Lăsate deliberat pe mai târziu (nu se pot încă șablona curat): antetul și meniul
(meniuri client, căutare, notificări în timp real), acțiunile postării (componentă client), rândul de chat
(randat în browser, în timp real), paginile de eroare și profilul (multe părți interactive).

### HTML → React

Pe site, HTML-ul sanitizat e parsat (htmlparser2) și transformat în elemente React (fără `innerHTML`): linkurile
interne devin `next/link`, `style` devine obiect, `gcs-slot` devine nodul React al slotului. Hover card-ul (client)
primește HTML-ul sanitizat din API și pune acțiunile în slot printr-un portal.

### Interfața

- Intrare nouă: Aspect → **Șabloane** (`fa-solid fa-file-code`), secțiunea ACP `appearance.templates`.
- Selectorul de temă; **arborele** pe zone (iconiță pe grup și pe șablon), cu căutare și marcajele „modificat” /
  „necesită revizuire”.
- **Editorul** (același CodeMirror leneș, modul Liquid/HTML) cu autocompletare pentru variabile, filtre și taguri;
  panoul variabilelor (click = inserare); validare la salvare, cu rândul erorii evidențiat; Ctrl+S.
- **Previzualizarea live** pe date reale (primul forum vizibil, un topic, ultima postare, membri reali…), randată pe
  server cu sursa nesalvată și afișată într-un `iframe` al site-ului (stilurile temei editate).
- **Istoricul**: versiunile cu autor și dată, diferențele față de original sau de versiunea anterioară, „Restaurează”,
  „Revino la original”.

### Export / import

Exportul unei teme: un `.zip` cu `theme.json` (cheie, nume, setări, logo/favicon ca URL-uri), `css/<nume>.css` și
`templates/<cheie>.liquid`. Importul creează o temă nouă (cheie nouă) din arhivă, cu aceleași validări (setări,
CSS sanitizat, șabloane parsate, limite de mărime și de căi).

### Teme copil

Nu în această etapă: fiecare temă are propriile fișiere CSS și suprascrieri; o temă nouă copiază fișierele și
suprascrierile temei din care pornește, iar șabloanele nemodificate cad pe cele implicite din cod.

## Testare

- Unit (motor): escapare, XSS (atribute, `javascript:`, `on*`, `<script>`, `style`), limite (timp, iterații, ieșire,
  includeri), filtre, includeri, sloturi, erori cu rând și coloană, sandbox (`__proto__`, funcții).
- Unit/integrare (servicii): versiunile, restaurarea, „necesită revizuire”, revenirea la original, sanitizarea CSS
  cu raport, migrarea lui `custom.css`, publicarea din editorul vizual, drepturile ACP.
- E2E: `templates.spec.ts` (editare cu previzualizare, vizibil pe site, revenire la original) și `css.spec.ts`
  (editare cu previzualizare, salvare, vizibil pe site, restaurarea unei versiuni). Ambele curăță după ele.
