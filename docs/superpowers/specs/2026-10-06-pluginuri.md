# Pluginuri și aplicații (etapa 6 §2) — designul concret

Data: 2026-10-06 · Stare: în implementare, pe ramura pluginurilor · Specul părinte: `2026-10-06-etapa-6-acp-pluginuri-sabloane.md` §2

Deciziile proprietarului: instalarea e **instantă, fără rebuild**; pluginurile primesc **hook-uri și setări avansate**.
Pluginurile sunt **cod scris de terți**: siguranța are prioritate față de comoditate. Tot ce nu se poate face sigur
acum e trecut la final, la „Lăsat deoparte”.

## 1. Pachetul `.zip`

| Fișier | Rol |
| --- | --- |
| `plugin.json` | manifestul (obligatoriu) |
| `server.mjs` | codul server, ESM precompilat (un singur fișier, fără `import` spre exterior), `export default definePlugin({...})` |
| `server/**/*.mjs` | module server suplimentare (opțional), importate relativ din `server.mjs` |
| `lang/<limbă>.json` | textele pluginului (`ro`, `en`, `de`, `es`, `fr`, `ru`); obiecte JSON cu șiruri |
| `migrations/NNN_nume.sql` | migrațiile SQL, aplicate în ordinea numelui, doar în schema proprie |
| `assets/**` | fișiere client: `.css`, `.js`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.woff`, `.woff2` |
| `gcs-signature.json` | semnătura Ed25519 (opțional) |
| `README.md`, `LICENSE`, `CHANGELOG.md` | documentație (opțional) |

Orice alt fișier respinge pachetul.

### 1.1 Verificările arhivei (`packages/core/src/plugins/zip.ts`, `package.ts`)
Cititorul ZIP e scris de noi (directorul central + `inflateRaw` din `node:zlib`), ca fiecare regulă să fie sub control:
- arhiva ≤ 8 MB; ≤ 400 de fișiere; un fișier ≤ 4 MB despachetat; total ≤ 32 MB; raport de compresie ≤ 200×
  (bombe ZIP); dimensiunea reală la dezarhivare e limitată (`maxOutputLength`), nu doar cea declarată;
- fără ZIP64, fără fișiere criptate, fără metode în afară de *store* / *deflate*; CRC32 verificat;
- căile: relative, cu `/`, fără `..`, `.`, `\`, litere de unitate, `:` sau caractere de control, ≤ 200 de caractere,
  doar `[A-Za-z0-9._-]` în segmente; fără duplicate (nici cu majuscule diferite);
- **fără link-uri simbolice** (atributele Unix `S_IFLNK`), fără intrări speciale; directoarele sunt ignorate.

### 1.2 Manifestul (`plugin.json`, schemă zod)
- `key`: `vendor.nume`, fiecare parte `[a-z][a-z0-9]*(_[a-z0-9]+)*`, max 24 de caractere (fără `__`, ca schema
  `plugin_<vendor>__<nume>` să fie unică); `name`, `version` (semver), `author`, `description`, `icon` (Font Awesome);
- `minGcs` (versiunea minimă a platformei), `dependencies` (`{ "vendor.altul": "^1.2.0" }`);
- `capabilities`: lista albă — `db`, `events`, `filters`, `widgets`, `pages`, `api`, `acp`, `menus`, `jobs`,
  `settings`, `permissions`, `hooks`, `http-out`, `client-css`, `client-js`, `templates`;
- declarațiile: `settings` (tab-uri cu câmpuri `text`, `textarea`, `number` cu „Nelimitat”, `toggle`, `select`,
  `secret`), `permissions` (pe grup sau pe container), `widgets`, `routes` (`pages`, `acp`, `api`), `events`,
  `filters`, `hooks` (puncte de extensie), `jobs`, `menus` (`site`, `user`), `client` (`styles`, `scripts`);
- fiecare declarație cere capabilitatea ei (ex. `widgets` fără `widgets` în `capabilities` = eroare);
- linkurile din meniuri sunt doar interne, sub `/p/<cheie>`.

### 1.3 Semnătura Ed25519 (`signature.ts`)
- `gcs-signature.json`: `{ "algorithm": "ed25519", "keyId": "...", "signature": "<base64>" }`;
- mesajul semnat: `GCS-PLUGIN-SIGNATURE-V1\n` + câte un rând `<sha256 hex>  <cale>\n` pentru fiecare fișier (fără
  fișierul semnăturii), sortat după cale. Un fișier adăugat, șters sau modificat schimbă mesajul;
- cheile de încredere vin doar din configurația serverului: variabila `GCS_PLUGIN_TRUSTED_KEYS`
  (`keyId=<cheie publică base64, 32 de octeți>,…`) plus lista de chei ale marketplace-ului din cod (goală până la
  etapa Redistribuire). **Nu se editează din ACP**: un admin cu drept pe pluginuri nu își poate „semna” singur pachetele;
- rezultate: *semnat* (cheie de încredere, semnătură validă), *nesemnat* (fără semnătură sau cheie necunoscută),
  *invalid* (cheie de încredere, dar semnătura nu se potrivește: pachet modificat) → respins.

### 1.4 Politica de instalare
- semnat: orice admin cu `system.applications` (edit), după ecranul de confirmare;
- nesemnat: **doar Root Admin**, cu codul 2FA introdus din nou pe ecranul de confirmare și cheia pluginului tastată;
  `GCS_PLUGINS_UNSIGNED=deny` interzice complet pachetele nesemnate;
- dezinstalarea cere `system.applications` (delete).

## 2. Stocare și ciclul de viață

### 2.1 Tabele (Prisma, migrația `20261014000000_plugins`)
- `plugins`: cheia, numele, versiunea, `enabled`, `status` (`installed` / `removed_kept_data`), `signed`, `signatureKeyId`,
  capabilitățile acordate, manifestul, setările (JSON), arhiva (`bytea`) + `sha256`, rolul DB și parola lui,
  migrațiile aplicate, `consecutiveFailures`, `disabledReason` (`admin` / `auto` / `safe_mode`), ultima eroare,
  instalat / actualizat (dată, de cine);
- `plugin_uploads`: încărcările în așteptarea confirmării (arhiva, raportul, cine a încărcat), șterse după 1 h;
- `plugin_logs`: jurnalul pluginului (erori, avertismente, mesajele lui), maximum 300 de rânduri per plugin;
- `plugin_hook_settings`: per (plugin, hook): pornit/oprit și prioritatea aleasă în ACP.

### 2.2 Fișierele
Arhiva din baza de date e sursa de adevăr. Fiecare proces (web, worker) o dezarhivează, verificată după `sha256`, în
`GCS_PLUGINS_DIR` (implicit `<GCS_CONFIG_DIR>/plugins`, pe volum, în afara codului aplicației), la
`<cheie>/<sha256 scurt>/`. Nu e nevoie de un volum comun între servere.

### 2.3 Baza de date a pluginului
- la instalare se creează un **rol PostgreSQL dedicat** (`gcsp_<hash>`, `LOGIN`, parolă aleatoare, fără SUPERUSER /
  CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS, limită de conexiuni) și schema `plugin_<vendor>__<nume>`, proprietatea
  lui; rolul are `search_path` pe schema lui și `statement_timeout`;
- migrațiile și interogările pluginului rulează **pe o conexiune autentificată ca acest rol** (nu `SET ROLE`, care se
  poate anula din SQL). Tabelele nucleului aparțin userului aplicației, fără drepturi pentru alte roluri: pluginul nu le
  poate citi sau modifica, oricum ar scrie SQL-ul;
- migrațiile rulează într-o singură tranzacție, iar evidența lor stă în `plugin_<…>._gcs_migrations`, în aceeași tranzacție;
- **verificarea statică a SQL-ului** (`sqlGuard.ts`, apărare în adâncime, nu granița principală): tokenizare cu
  comentarii, șiruri și `$$…$$`; respinge referințele la `public`, `pg_catalog`, `information_schema`, `pg_toast`,
  la alte scheme `plugin_*`, `SET`/`RESET`/`SET ROLE`/`SESSION AUTHORIZATION`, `set_config`, `COPY`, `DO`, `LOAD`,
  `LISTEN`/`NOTIFY`, `GRANT`/`REVOKE`, DDL pe roluri/baze/scheme/extensii/limbaje, `SECURITY DEFINER`, limbaje
  neprotejate (`c`, `internal`, `plpythonu`…), funcțiile de administrare (`pg_read_file`, `pg_terminate_backend`,
  `pg_advisory_*`, `lo_import`, `dblink`…), controlul tranzacțiilor și mai multe instrucțiuni într-o interogare;
- fără drept `CREATEROLE` (ex. o bază externă cu user limitat), un plugin cu `db` **nu se instalează** (eroare clară),
  în loc să ruleze cu o izolare mai slabă;
- limite cunoscute: fără cotă de spațiu pe schemă; un plugin poate ține ocupate cele câteva conexiuni ale lui.

### 2.4 Operațiile (`GcsPluginService`, `packages/core/src/plugins/service.ts`)
Încarcă → raport → confirmă → instalează; activează / dezactivează; setări; actualizează (versiune mai mare, migrațiile
noi); dezinstalează (cu sau fără păstrarea datelor: schema, rolul și setările rămân). Toate scriu în jurnalul ACP
(`plugin.install`, `plugin.update`, `plugin.enable`, `plugin.disable`, `plugin.auto_disable`, `plugin.settings`,
`plugin.hooks`, `plugin.uninstall`) și anunță celelalte procese.

## 3. Rularea (instant, fără rebuild)

### 3.1 Izolarea codului
Fiecare plugin rulează, în fiecare proces, într-un **`worker_thread` propriu** (același proces, alt izolat V8):
- `env: {}` (fără `DATABASE_URL`, `GCS_SECRET`…), `execArgv: []`, limite de memorie (`resourceLimits`);
- hook-uri de încărcare a modulelor (`module.registerHooks`, per fir): se pot importa doar fișierele pluginului
  (`.mjs`/`.js`/`.json`); **orice modul Node** (`fs`, `child_process`, `net`, `http`, `worker_threads`, `module`…),
  `data:` sau fișierele aplicației sunt refuzate, inclusiv prin `require`;
- `process` e înlocuit cu un obiect minim (fără `binding`, `dlopen`, `getBuiltinModule`, `kill`, `env` real); `fetch`,
  `WebSocket`, `EventSource`, `BroadcastChannel`, `require` dispar; `console` merge în jurnalul pluginului;
- un apel care depășește timpul primește eroare; dacă firul nu mai răspunde (ex. buclă infinită), e **oprit**
  (`terminate`) și repornit la următorul apel. O buclă infinită nu blochează serverul.

Contextul primit de plugin e singura lui ieșire, prin mesaje validate de gazdă:
- `ctx.db.query/execute/batch` — SQL parametrizat, în schema proprie, pe rolul dedicat (capabilitatea `db`);
- `ctx.api` — citiri publice prin serviciile existente, cu verificarea permisiunilor: utilizatori, topicuri, postări,
  forumuri, statistici. Identitatea vizitatorului e un **jeton opac** emis de gazdă pe durata apelului; fără jeton
  (evenimente, joburi) citirile se fac ca vizitator;
- `ctx.settings`, `ctx.permissions.can` (doar permisiunile lui), `ctx.t` (textele lui), `ctx.cache` (spațiu de nume
  propriu în Redis), `ctx.log`, `ctx.jobs.enqueue`, `ctx.http.fetch` (doar cu `http-out`; fără adrese private sau
  locale, verificate la conectare, nu doar la DNS).

### 3.2 Încărcarea și anunțarea
- `GcsPluginHost` (`packages/modules/src/plugins/host.ts`) pornește în web și în `gcs-worker`;
- la orice schimbare, serviciul publică pe canalul Redis `gcs:plugins`; fiecare proces citește starea din baza de date
  și încarcă / descarcă / reîncarcă pluginurile (reconciliere idempotentă, plus una periodică la 60 s);
- la încărcare: modulul dinamic din manifest (permisiuni, widget-uri, meniul ACP) intră în registry, apoi pornește firul;
- `GCS_PLUGINS_SAFE_MODE=1` (mediu) pornește procesul fără niciun plugin.

### 3.3 Hook-urile
| Tip | Cum |
| --- | --- |
| Evenimente | lista publică: `post.created`, `post.updated`, `post.deleted`, `post.approved`, `topic.created`, `topic.updated`, `topic.deleted`, `topic.moved`, `topic.moderated`, `user.registered`, `user.promoted`, `user.banned`, `user.unbanned`, `user.warned`, `user.followed`, `chat.message`, `chat.deleted`, `report.created`, `badge.awarded`, `vip.granted`, `vip.expired`. Livrare asincronă (nu întârzie cererea), doar câmpurile simple din payload. Mesajele private nu se expun. |
| Filtre | `post.before_save` (topic nou, răspuns, editare): primește titlul și documentul, poate întoarce o variantă modificată sau o respingere. Rulează în ordinea priorității, cu timeout de 2 s; o eroare sau un timeout sare pluginul (nu blochează postarea); timeout-ul se numără ca eșec, eroarea doar se jurnalizează (vezi mai jos). |
| Widget-uri | randate pe server ca HTML, trecut prin sanitizer (listă albă de taguri și atribute, fără `style`, `id`, `on*`, formulare, scripturi; clase doar `gcsp-*` și câteva clase GCS de prezentare; `<gcs-icon name="fa-solid fa-…">` devine iconița Font Awesome). Interfața `GcsPluginHtml` acceptă deja `{ template, data }`, pentru motorul de șabloane. |
| Puncte de extensie | `postbit.after_fields` (sub câmpurile din cardul autorului). HTML-ul se calculează o dată și ajunge atât în postbit-ul implicit (React), cât și în `{% hook "postbit.after_fields" %}` dintr-un șablon `postbit.author` modificat de temă. |
| Pagini site | `/p/<cheie>/…`, căi declarate (`/`, `/item/:id`), randate în layout-ul site-ului. |
| Pagini ACP | `/admin/plugins/<cheie>/…`, cu secțiunea ACP `plugin.<cheie>` (apare în rolurile ACP); doar HTML sanitizat. |
| API | `/api/plugins/<cheie>/…`: doar JSON, corp ≤ 64 KB, CSRF (Origin) la metodele care modifică, limită de rată. |
| Joburi | în `gcs-worker`, prin jobul generic `plugin.job`; periodice (`everyMinutes`) sau la cerere. |
| Meniuri | site (meniul principal), meniul userului, ACP (din paginile ACP declarate); opțional condiționate de o permisiune a pluginului. |

Fiecare apel: timeout (eveniment 5 s, filtru 2 s, widget / hook 3 s, pagină 5 s, API 10 s, job 60 s), `try/catch`,
durata măsurată (număr, eșecuri, timp total și maxim per hook, în Redis, comun proceselor). **5 eșecuri la rând**
(`GCS_PLUGINS_MAX_FAILURES`) → pluginul se dezactivează automat, apare în ACP cu motivul și intră în jurnalul ACP.

Ce se numără la dezactivarea automată: doar eșecurile care consumă resursele procesului — timeout-ul unui handler
care chiar rula (timpul se măsoară de când firul confirmă că a început apelul, nu din coada lui) și căderea firului
(pornire eșuată, memorie depășită, ieșire neașteptată; o cădere se numără o singură dată). O eroare aruncată de handler
se jurnalizează (cel mult 60 de intrări pe minut) și apare în metrici, dar **nu** se numără: ea vine adesea din datele
unei cereri (rute API și pagini accesibile vizitatorilor, filtrul `post.before_save`), iar altfel un singur vizitator ar
putea opri pluginul pe tot site-ul cu câteva cereri construite să-l facă să arunce o eroare. Nu se numără nici apelurile
care n-au ajuns să ruleze sau au fost întrerupte din afară: fir ocupat (apelul nu începe în intervalul lui de timeout),
prea multe apeluri în așteptare (256 pe fir), firul oprit după blocarea altui apel, pluginul descărcat sau reîncărcat
(actualizare, dezactivare) în timpul apelului. Un succes resetează numărătoarea.

### 3.4 CSS și JS client
- CSS (`client-css`): fără `@import`, fără `<`, `url()` doar spre fișierele pluginului, iar totul e **închis în
  clasa pluginului** (`.gcsp--<vendor>--<nume> { … }`, CSS imbricat; acoladele dezechilibrate resping fișierul). Tot ce
  randează pluginul stă într-un container cu `contain: paint`, deci nici `position: fixed` nu iese din el;
- JS (`client-js`): doar pentru **pluginuri semnate** cu o cheie de încredere și doar pe paginile pluginului
  (`/p/<cheie>/…`), niciodată în ACP. Un script pe aceeași origine poate acționa în numele vizitatorului, deci nu se
  acceptă de la pachete nesemnate.

### 3.5 Modul sigur
- `?safe=1`, doar pentru Root Admin: cookie de sesiune verificat la fiecare cerere (un cookie falsificat nu face nimic
  pentru alți useri). Pentru acel admin, site-ul se randează fără pluginuri (widget-uri, pagini, meniuri, puncte de
  extensie, CSS/JS); `?safe=0` iese. Evenimentele și filtrele de pe server continuă: pentru ele există „Dezactivează toate”;
- `gcs plugins:disable-all` (CLI) dezactivează toate pluginurile și anunță procesele; `gcs plugins:list` le listează.
  Dacă aplicația nu răspunde, CLI-ul indică `GCS_PLUGINS_SAFE_MODE=1` și repornirea.

## 4. ACP
- **Sistem → Aplicații și pluginuri** (`/admin/system/applications`): aplicațiile opționale (ca înainte), lista
  pluginurilor (iconiță, nume, cheie, versiune, autor, semnat / nesemnat, stare, comutator), încărcarea unui `.zip`;
- **confirmarea** (`…/applications/install/<id>`): raportul verificărilor, capabilitățile explicate pe înțeles (cu
  nivelul de risc), noutățile față de versiunea instalată, avertismentul pentru pachetele nesemnate (cod 2FA + cheia
  tastată, doar Root Admin);
- **pagina pluginului** (`…/applications/plugins/<cheie>`): setările generate din manifest (tab-uri, comutatoare,
  „Nelimitat”), jurnalul (erori, timpi pe hook), detaliile (capabilități, permisiuni, schema DB), actualizarea și
  dezinstalarea (cu „Păstrează datele”);
- **Sistem → Hook-uri** (`/admin/system/hooks`): evenimentele, filtrele, punctele de extensie, widget-urile, paginile,
  rutele API, joburile și meniurile, cine le folosește, prioritatea (editabilă) și comutatorul per plugin și hook.

## 5. SDK și pluginul de exemplu
- `@gcs/plugin-sdk` (`packages/plugin-sdk`): tipurile pentru `definePlugin` și context (fără acces la internele GCS),
  `packPlugin` (ZIP), `signPlugin` / `generateSigningKey` (Ed25519) și scriptul de build;
- `packages/plugin-sdk/examples/hello` (`gcs.hello`): un widget, o pagină pe site, o pagină în ACP, o rută API, o setare
  (cu tab-uri), o permisiune, un tabel propriu, un listener pe `post.created`, un job, o intrare în meniul userului,
  un punct de extensie în postbit și CSS propriu. `pnpm --filter @gcs/plugin-sdk build:example` produce zip-ul.

## 6. Teste
- unit: arhiva (zip-slip, link-uri simbolice, mărimi, bombe, duplicate), manifestul, semver, semnătura (validă, invalidă,
  modificată, cheie necunoscută), SQL guard, sanitizer HTML/CSS, izolarea firului (module Node, `process`, `fetch`),
  timeout + dezactivarea automată;
- integrare: zip-ul exemplului instalat → widget / pagină / setare / permisiune / tabel → dezactivare → actualizare →
  dezinstalare, fără repornire;
- E2E `apps/web/e2e/plugins.spec.ts`: instalarea din ACP, widget-ul și pagina pe site, dezactivarea, dezinstalarea.

## 7. Lăsat deoparte (cu motiv)
- **Izolarea nu e o graniță formală de securitate**: `worker_threads` + hook-urile de module + `process` restrâns închid
  căile cunoscute, dar o vulnerabilitate în V8/Node sau un API Node scăpat din vedere ar putea permite ieșirea. De aceea
  pachetele nesemnate rămân o decizie de încredere a Root Admin-ului, cu 2FA și confirmare scrisă.
- **CPU**: un plugin poate consuma CPU în firul lui până la timeout / oprire; nu există cote de CPU.
- **JS client din pachete nesemnate**: nu e posibil sigur pe aceeași origine (ar cere iframe-uri izolate, cu altă origine).
- **Formulare interactive în paginile ACP ale pluginului**: HTML-ul e sanitizat (fără formulare și scripturi); pentru
  configurare există formularul de setări generat din manifest.
- **Șabloanele pluginului** (`templates`): capabilitatea e rezervată. Gazda are deja `setTemplateRenderer` pentru
  `{ template, data }`; legarea de motorul de șabloane (sandbox-ul lui, cu datele pluginului) rămâne pentru pasul următor.
- **Cotă de spațiu** pentru schema pluginului și modificarea tabelelor nucleului: nu există (intenționat, pentru tabele).
- **Marketplace-ul** (cheia publică oficială, descărcarea din Data Center): etapa Redistribuire.
- **Realtime**: pluginurile nu rulează în `gcs-realtime`.
