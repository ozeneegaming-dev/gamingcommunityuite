# Asistentul de portare a pluginurilor — designul concret

- **Data:** 2026-10-07
- **Specul modulului:** `2026-10-06-etapa-6-migrare.md`, §4 (asistentul de portare). Ținta: sistemul de pluginuri din
  `2026-10-06-pluginuri.md` (pachetul `.zip`, manifestul, capabilitățile, instalarea din ACP).
- **Regula de denumire:** sursele se numesc după structura lor, nu după produs (ca la importator):
  - `app-json`: aplicație exportată ca arhivă `.tar` (sau `.tar.gz`), cu `data/application.json`, `data/settings.json`,
    `data/schema.json`, `data/lang.xml`, `data/theme.xml`… și codul PHP în `modules/`, `sources/`, `extensions/`, `hooks/`;
  - `plugin-xml`: plugin într-un singur fișier `.xml` (rădăcina `<plugin>`), cu hook-uri, setări, fraze, șabloane și
    fișiere încorporate (base64);
  - `addon-json`: add-on `.zip` cu `addon.json` și folderul `_data/` (`options.xml`, `phrases.xml`, `permissions.xml`,
    `routes.xml`, `templates.xml`…), plus clasele PHP.
  - În interfață: „Format detectat: aplicație cu `data/application.json`” / „plugin într-un fișier XML” / „add-on cu
    `addon.json` și `_data/`”.

## 1. Schimbarea față de spec (§4.4)

Specul cerea un folder `packages/modules/src/ported/<cheie>/` compilat împreună cu platforma. Între timp există
sistemul de pluginuri (instalare instant, fără rebuild, cod izolat), deci **ieșirea e un plugin GCS**: același pachet
`.zip` pe care îl validează și îl instalează ACP → Aplicații și pluginuri. Avantaje: nu cere rebuild, codul portat
rulează izolat, iar validarea pachetului (manifest, SQL guard, CSS, texte) se aplică exact ca la orice plugin.

## 2. Ce se livrează acum

### 2.1 Intrarea și siguranța
- Arhiva încărcată (≤ 8 MB, ca pachetele de plugin) e **ostilă până la proba contrarie**:
  - `.zip`: cititorul întărit al pluginurilor (`readPluginZip`), cu limite proprii (≤ 2000 de fișiere, ≤ 4 MB pe
    fișier, ≤ 48 MB despachetat, raport de compresie ≤ 200×): fără `..`, căi absolute, link-uri simbolice, intrări
    speciale, duplicate sau coliziuni fișier/folder, CRC verificat;
  - `.tar` / `.tar.gz`: un cititor TAR propriu, cu aceleași reguli (aceleași căi sigure, aceleași limite, sumă de
    control a antetului, link-uri și dispozitive refuzate, `gunzip` cu mărimea de ieșire limitată);
  - `.xml`: un singur fișier, parsat cu `htmlparser2` în mod XML (fără DTD, fără entități externe); fișierele
    încorporate (base64) au aceleași limite.
- Nimic nu se scrie pe disc și **nimic nu se execută**: PHP, JavaScript, șabloanele și SQL-ul sursei se citesc doar ca
  text (expresii regulate și tokenizare), niciodată prin `eval`, `require` sau un interpretor.
- Codul generat (`server.mjs`) primește textele sursei doar ca șiruri JSON (`JSON.stringify`) sau comentarii pe un
  singur rând curățate (fără `*/`, rânduri noi sau caractere de control): sursa nu poate injecta cod în plugin.
- Tot ce ajunge în ACP (nume, autor, căi, mesaje) e text simplu, randat de React (escapat); raportul nu conține HTML.

### 2.2 Fluxul din ACP (Sistem → Conversii → Portare plugin, secțiunea `system.porting`)
1. **Încărcarea** (`/api/acp/porting/upload`, CSRF + poarta ACP): formatul detectat, numele, versiunea, autorul,
   licența detectată, numerele pe tipuri (setări, fraze, tabele, șabloane, fișiere PHP/JS). Nu se convertește nimic.
2. **Confirmarea dreptului** (obligatorie, înaintea conversiei): temeiul — sunt autorul / am acordul scris al
   autorului / licența permite — și bifa „Confirm că am dreptul să modific și să folosesc acest plugin”. Textul
   amintește că pluginurile cumpărate sunt licențiate de autorii lor. **Avertisment GPL** când licența sau antetele
   fișierelor sunt GPL/AGPL/LGPL: codul GPL nu poate intra într-un GCS redistribuit închis.
   Cheia pluginului (`vendor.nume`) e propusă din sursă și se poate schimba.
3. **Conversia**: jurnalul ACP primește `porting.convert` cu numele pluginului, formatul, temeiul confirmării, cheia și
   semnalul GPL. Arhiva sursă se șterge după conversie (rezultatul păstrează sursele în `ORIGINAL/`).
4. **Rezultatul**: procentul estimat de muncă automată, tabelul pe tipuri (automat / manual), verificările pachetului
   (aceleași ca la instalare), lista fișierelor de portat manual cu echivalentul GCS recomandat, avertismentele.
   - **Descarcă rezultatul (.zip)**;
   - **Trimite la instalare**: pachetul intră în pasul de validare al instalatorului de pluginuri
     (`/admin/system/applications/install/<id>`), unde adminul decide. **Nimic nu se instalează sau activează automat**
     (`porting.handoff` în jurnal);
   - **Șterge** (`porting.delete`). Portările mai vechi de o zi se șterg singure.

### 2.3 Ce se convertește automat

| Sursa | Pluginul GCS |
|---|---|
| Manifestul (`application.json` / `addon.json` / atributele `<plugin>`) | `plugin.json`: cheie, nume, versiune (semver), autor, descriere, iconiță, licență, `minGcs` |
| Setările (`settings.json` + formularele PHP citite ca text / `options.xml` + `option_groups.xml` / `<settings>`) | `settings.tabs` (toggle, number cu „Nelimitat”, text, textarea, select), etichete în `lang/` |
| Permisiunile de grup (`permissions.xml`) | `permissions` (boolean / number, pe grup) |
| Meniul ACP și navigarea (`acpmenu.json`, `modules.json` / `admin_navigation.xml`, `navigation.xml`) | `routes.acp`, `menus.site` |
| Rutele (`furl.json`, controllerele din `modules/` / `routes.xml`) | `routes.pages`, `routes.acp`, `routes.api` + handlere schelet |
| Frazele (`lang.xml` / `phrases.xml` / `<lang>`) | `lang/en.json` + `lang/ro.json` (de tradus), cu `%s` → `{p1}`, fără marcaj HTML |
| Schema (`schema.json` / `createTable` din `Setup.php`) | `migrations/001_init.sql` (PostgreSQL, în schema pluginului, trecut prin SQL guard) |
| Șabloanele (`theme.xml`, `dev/html/**/*.phtml` / `templates.xml` / `<htmlFiles>`) | funcții de randare în `server.mjs`: HTML-ul păstrat (clasele prefixate `gcsp-`, `id`/`style`/`on*` scoase), frazele → `ctx.t(...)`, variabilele → valori escapate, `if`/`foreach` simple → cod, restul → comentarii `TODO(portare)` lângă locul lor |
| CSS-ul (`theme.xml`, `dev/css` / șabloanele `.css`/`.less` / `<cssFiles>`) | `assets/<nume>.css`: clasele prefixate, regulile nesigure sau LESS scoase (numărate în raport), validat cu `scopePluginCss` |
| Task-urile programate (`tasks.json` / `cron.xml` / `<tasks>`) | `jobs` cu `everyMinutes` + handlere schelet |
| Widget-urile (`widgets.json` / `widget_definitions.xml` / `<widgets>`) | `widgets` + handlere schelet |

Paginile scheletului randează șablonul folosit de controllerul sursei (găsit în PHP, ca text) cu date goale și un
`TODO(portare)` pentru datele lui; rutele API răspund `501` până la portare; joburile doar scriu în jurnalul pluginului.

### 2.4 Ce rămâne manual (cu ajutor)
- Codul PHP (controllere, modele/entități, servicii, extensii, hook-uri, listeneri, instalare): copiat în `ORIGINAL/`,
  fiecare fișier în `PORTING.md` cu echivalentul GCS: pagină / pagină ACP / rută API, `ctx.db`, evenimente (`events`),
  filtrul `post.before_save`, punctul de extensie din postbit, joburi, migrații.
- JavaScript-ul: în `ORIGINAL/` (scripturile client cer un plugin semnat, `client-js`).
- Raportul estimează procentul automat pe unități de lucru (setare, permisiune, rută, tabel, șablon, frază vs. rânduri
  de PHP/JS și locurile `TODO` din șabloane).

### 2.5 Ieșirea (`.zip`)
```
<vendor.nume>/            pachetul pluginului, ca folder (plugin.json, server.mjs, lang/, migrations/, assets/, README.md)
<vendor.nume>-<ver>.zip   pachetul instalabil, validat cu aceleași reguli ca la instalare
ORIGINAL/                 sursele (doar ca text, pentru portarea manuală)
PORTING.md                raportul: ce s-a convertit, ce rămâne și echivalentul GCS al fiecărui fișier
report.json               același raport, pentru unelte
```

### 2.6 CLI
`pnpm gcs:port <arhivă> --rights=author|consent|license [--key=vendor.nume] [--out=folder]` — aceeași conversie,
fără bază de date: scrie folderul de mai sus. Fără `--rights` refuză (confirmarea e obligatorie și apare în raport).
Se rulează din rădăcina monorepo-ului; căile relative sunt față de ea. Opțiuni: `--locale=en` (raportul în engleză),
`--force` (scrie peste un folder existent).

### 2.6.1 Unde e codul
| Unde | Ce |
|---|---|
| `packages/modules/src/porting/archive.ts` | intrarea: ZIP (cititorul pluginurilor, limitele portării), TAR/gzip propriu, XML |
| `packages/modules/src/porting/xml.ts`, `text.ts` | XML-ul (fără DTD, adâncime plafonată), textul (chei, versiuni, licență, comentarii sigure) |
| `packages/modules/src/porting/formats/*` | cititoarele celor trei formate și PHP-ul citit ca text (`php.ts`) |
| `packages/modules/src/porting/convert/*` | șabloanele (lexere → arbore → JavaScript), frazele, schema, CSS-ul |
| `packages/modules/src/porting/generate.ts`, `report.ts` | pluginul, pachetul validat, raportul, `PORTING.md`, arhiva rezultatului |
| `packages/modules/src/porting/service.ts` | `GcsPortingService` (`services().porting`) |
| `packages/modules/src/porting/cli.ts` | CLI-ul (`pnpm gcs:port`) |
| `apps/web/…/system/porting`, `/api/acp/porting/*` | pagina ACP, încărcarea și descărcarea (construite separat, peste serviciu) |

### 2.6.2 API-ul serviciului (contractul interfeței)
- `analyze(actor, { fileName, data })` → `GcsPortView` (`status: "analyzed"`, `analysis`: format, metadate, licență cu
  `gpl`, cheia propusă, numerele pe tipuri, notele);
- `convert(actor, id, { basis, confirmed, key?, locale? })` → `GcsPortView` (`status: "converted"`, `report`,
  `canHandoff`);
- `get(actor, id)`, `list(actor, limit?)`, `download(actor, id)` → `{ fileName, data }`,
  `handoff(actor, id)` → `{ uploadId }` (ecranul instalatorului: `/admin/system/applications/install/<uploadId>`),
  `delete(actor, id)`;
- drepturile: `view` (citiri, descărcare), `edit` (încărcare, conversie, predare; predarea cere și
  `system.applications` edit, verificat de instalator), `delete`;
- erorile: `GcsValidationError({ file: <cod cititor> | "required" | "unknown_archive" | "unknown_format" |
  "convert_failed" })`, `({ rights: "required" })`, `({ key: "invalid" })`, `({ package: "invalid" })`,
  `GcsConflict({ reason: "already_converted" | "not_converted" })`, `GcsNotFound({ entity: "plugin_port" })`;
- notele (`porting.notes.<cod>`): `invalid_file`, `files_outside_root`, `column_type_unknown`, `fulltext_index`,
  `table_rejected`, `phrases_dropped`, `settings_unknown`, `templates_skipped`, `css_dropped`, `css_file_rejected`,
  `html_dropped`, `forms`, `limit`, `gpl`.

### 2.6.3 Limitele (surse ostile)
Pe lângă limitele arhivei: XML cu cel mult 200 000 de elemente și 64 de niveluri; un șablon ≤ 256 KB, cel mult 300 de
șabloane și 3 MB de cod generat; blocurile de șablon imbricate peste 32 de niveluri devin `TODO`; CSS ≤ 256 KB pe
fișier și 8 niveluri; în PHP, cel mult 1000 de potriviri pe fișier și argumentele căutate pe cel mult 4 KB; frazele
≤ 1800. Nicio căutare nu se repetă până la capătul fișierului pentru construcții neînchise (fără timp pătratic).

### 2.7 Stocare (migrația `20261021000000_plugin_ports`)
`plugin_ports`: cine, numele fișierului, formatul, numele sursei, `sha256`, analiza (fără cod), temeiul confirmării și
ora, cheia, raportul, arhiva sursă (până la conversie), rezultatul și pachetul (`bytea`). Rândurile mai vechi de o zi
se șterg la următoarea încărcare.

## 3. Testare
- **Unit:** cititorul TAR (căi, link-uri, mărimi, sume de control, gzip), XML-ul (CDATA, entități, fără DTD), fiecare
  format (manifest, setări, permisiuni, fraze, schemă, rute, șabloane, CSS, task-uri), conversia șabloanelor (ambele
  sintaxe, cazuri ostile: `</script>`, `*/`, ghilimele, `__proto__`), SQL-ul (trece prin SQL guard), generatorul
  (pachetul trece de `validatePluginPackage`, `server.mjs` trece de `node --check`), raportul și licența GPL.
- **Integrare (PostgreSQL de test):** serviciul — fără confirmare nu convertește; confirmarea intră în jurnal; predarea
  la instalator creează o încărcare de plugin; pluginul generat se instalează și pagina lui randează șablonul convertit.
- **E2E** (`apps/web/e2e/porting.spec.ts`): portarea unui add-on de test din ACP, confirmarea, raportul, descărcarea și
  predarea la instalator.

## 4. Lăsat pe mai târziu (cu motiv)
- **Șabloanele GCS (Liquid) pentru pluginuri:** capabilitatea `templates` e încă rezervată; când se leagă motorul de
  șabloane, aceeași reprezentare intermediară poate emite și șabloane Liquid.
- **Instalarea „ca modul inactiv”:** instalatorul de pluginuri pornește pluginul nou activ; predarea duce doar la
  ecranul de confirmare (adminul decide). O opțiune „instalează dezactivat” ține de instalator.
- **Upgrade-urile de schemă** (`alterTable`, query-urile din `setup/upg_*`), **class extensions**, **listenerii** și
  **hook-urile de șablon**: depind de cod PHP; apar în `PORTING.md` cu echivalentul GCS, nu se convertesc.
- **Expresiile complexe din șabloane** (apeluri de funcții, operatori, PHP inline): rămân `TODO(portare)`; condițiile
  nerecunoscute sunt false până la portare.
- **Fișierele cu nume în afara setului sigur** (`[A-Za-z0-9._-]`, ex. spații): arhiva e refuzată cu calea în cauză,
  ca la pachetele de plugin; se redenumesc înainte de încărcare.
- **Traducerea frazelor:** `lang/ro.json` pornește cu textul sursei; traducerea rămâne pentru dezvoltator.
