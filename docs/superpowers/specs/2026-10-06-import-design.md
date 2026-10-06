# GamingCommunitySuite — Importul din altă platformă: designul concret

- **Data:** 2026-10-06
- **Specul modulului:** `2026-10-06-etapa-6-migrare.md`, §3 (importatorul de date). Asistentul de portare (§4) vine separat.
- **Regula de denumire:** sursele se numesc după schema bazei lor de date, nu după produs:
  - `core-schema`: tabele `core_members`, `core_groups`, `forums_forums`, `forums_topics`, `forums_posts` (prefix opțional, ex. `ibf_`), conținut HTML cu marcaje proprii;
  - `prefixed-schema`: tabele `xf_user`, `xf_user_group`, `xf_node`, `xf_thread`, `xf_post`, conținut BBCode.
  - În interfață: „Sursă detectată: schemă core_* (versiunea 4.7.18)” / „schemă xf_* (versiunea 2.2.13)”.

## 1. Pachetele și fișierele

| Unde | Ce |
|---|---|
| `packages/core/src/auth/legacyPasswords.ts` | verificarea hash-urilor vechi și rehash-ul (folosit de login) |
| `packages/core/src/net/safeFetch.ts` | descărcare anti-SSRF (IP-uri private blocate la conectare, redirecturi re-verificate, limită de mărime și timp) |
| `packages/core/src/secrets.ts` | criptarea parolei bazei vechi (AES-256-GCM, cheie derivată din `GCS_SECRET`) |
| `packages/core/src/content/files/attachments.ts` | `importFile`: același `prepare` ca la upload (magic bytes, recodare), fără permisiuni de grup |
| `packages/modules/src/importer/source/*` | interfața de citire, MySQL (`mysql2`), sursa în memorie (teste, E2E), detecția, adaptoarele |
| `packages/modules/src/importer/convert/*` | HTML (`core-schema`) și BBCode (`prefixed-schema`) → documentul GCS |
| `packages/modules/src/importer/engine/*` | pașii, harta de id-uri, checkpoint-urile, raportul |
| `packages/modules/src/importer/service.ts` | `GcsImportService`: testul conexiunii, pornire/pauză/reluare/anulare, starea, redirecturile |
| `packages/modules/src/importer/redirects.ts` | recunoașterea adreselor vechi (pur) și rezolvarea lor |
| `apps/web/app/admin/(panel)/system/import/*` | pagina ACP „Import din altă platformă” |
| `apps/web/proxy.ts` | redirecturile 301 (doar când sunt pornite) |

## 2. Modelul de date (migrația `20261020000000_importer`)

- `ImportJob` (`import_jobs`): un import configurat.
  - `config` (JSON fără secrete): host, port, bază, user, prefix, fișiere (folder sau URL), adresa veche, opțiuni.
  - `secret`: parola bazei vechi, criptată; se poate șterge după import.
  - `detected`: schema, prefixul, versiunea, numărul de înregistrări pe tip, postările pe pagină ale sursei.
  - `status`: `DRAFT`, `READY`, `QUEUED`, `RUNNING`, `PAUSED`, `CANCELLED`, `FAILED`, `DONE`.
  - `steps` (JSON): pe fiecare pas `status`, `total`, `done`, `imported`, `skipped`, `errors`, `unrecognized`, `cursor`, orele.
  - `control`: cererea de pauză sau anulare, citită între loturi; `heartbeatAt`: un worker căzut nu blochează reluarea.
- `ImportMap` (`import_map`): `(source, type, sourceId) → targetId`.
  - `source` = cheia hărții: schema + host-ul adresei vechi (ex. `core-schema@forum.exemplu.ro`). Un import nou de pe aceeași comunitate (ex. din dump-ul final) refolosește harta: aduce doar ce lipsește.
- `ImportLog` (`import_logs`): jurnalul pe pași (`info`, `warn`, `error`), cu id-ul sursei; plafonat la 5 000 de rânduri pe import.
- `users.registrationIp`: IP-ul de înregistrare (apare în uneltele IP din ACP).

## 3. Sursa

- **Interfața de citire** (`GcsSourceReader`) e structurată, nu SQL liber: `tables()`, `select(tabel, { columns, where, orderBy, limit })`, `count`, `max`.
  - `where` acceptă egalitate, `in`, `gt`/`gte`/`lt`/`lte`, `ne`, `isNull`.
  - Implementarea MySQL construiește SQL parametrizat (identificatorii validați `[A-Za-z0-9_]`), deschide sesiunea cu `SET SESSION TRANSACTION READ ONLY` și rulează doar `SELECT`/`SHOW`.
  - Implementarea în memorie (`createMemoryReader`) aplică aceleași filtre pe rânduri înregistrate. Adaptoarele se testează pe ea, fără MySQL.
- **Detecția:** după tabele (`core_members` + `forums_topics` → `core-schema`; `xf_user` + `xf_thread` → `prefixed-schema`), cu prefixul dedus. Versiunea: `core_applications` (aplicația `core`), respectiv rândul principal din `xf_addon`.
  - **Suportate (implicit):** `core-schema` 4.4–4.7 și 5.x; `prefixed-schema` 2.1–2.3.
  - Altă versiune → eroare clară: „actualizează întâi platforma veche la o versiune suportată”.
- **Loturi pe intervale de id:** `id > cursor ORDER BY id LIMIT n`. Tabelele cu cheie compusă (urmăriri) se citesc pe intervale ale primei coloane.
- **Fișierele:**
  - din folderul montat: căi relative, fără `..`, fără căi absolute, cu `realpath` verificat (un symlink nu iese din folder);
  - sau de la o adresă web, prin `safeFetch`. Folderul `internal_data` al surselor `prefixed-schema` nu e public, deci atașamentele lor cer folderul montat.
- **Sursa de test** (`host = fixture`, baza `core-schema` sau `prefixed-schema`): date înregistrate în cod, cu fișiere în memorie. Există doar cu `GCS_TEST_ROUTES=1` (E2E).

## 4. Pașii (ordinea din spec §3.2)

1. **Grupurile:** după rol. Administratori → `admin`, moderatori globali → `super_moderator`, membri → `member`, vizitatori → `guest`, banați → `banned`; restul devin grupuri noi (`custom_<id>`, cu numele și culoarea lor și drepturile grupului `member`).
2. **Membrii:**
   - emailul existent în GCS → contul se **leagă**, nu se modifică;
   - numele ocupat → sufix `_2`, `_3`…;
   - grupul principal și cele secundare, data înscrierii, ultima vizită, IP-ul, reputația, titlul, semnătura (convertită);
   - avatarul și cover-ul trec prin recodarea imaginilor de profil;
   - ziua de naștere, dacă sursa o arată public → câmpul de profil „Zi de naștere”;
   - banul → ban pe cont (cu motivul și expirarea);
   - parola → contul `credential` cu hash-ul marcat (§6).
3. **Câmpurile de profil** și valorile (cele existente nu se suprascriu).
4. **Forumurile:** categorii, forumuri, subforumuri, linkuri; ordinea, descrierile (text simplu, max 500).
   - Un forum fără categorie intră sub categoria „Importate”.
   - **Permisiunile:** matricea sursei (`view`, `read`, `create`, `reply`, `upload`, `download`) pe grupurile potrivite. Grupurile GCS fără corespondent preiau drepturile rolului lor: Membru nou și VIP ca Membru, Root Admin are tot.
5. **Prefixele** (tag-urile se creează odată cu topicurile).
6. **Topicurile:**
   - fixat, închis, ascuns/în așteptare, vizualizări, prefix, tag-uri;
   - sondajul, cu opțiunile și voturile;
   - topicurile „mutate” (stub-uri de redirect) se sar.
7. **Atașamentele:** fișierul trece prin `importFile` (tipul real, recodarea), apoi se leagă de postare sau de mesaj. Pasul rulează înaintea postărilor, ca acestea să găsească id-urile noi.
8. **Postările:** conținutul convertit (§5), autorul, IP-ul, data, editarea, vizibilitatea. Atașamentele nefolosite în text se adaugă la final.
9. **Reacțiile:** după nume (`like`, `thanks`, `haha`, `gg`, `disagree`, cu sinonime); fără corespondent → Like.
10. **Mesajele private:** conversațiile, participanții (plecat = `leftAt`), mesajele, starea de citire.
11. **Urmăririle** (forum, topic, membru) și **ignorările**.
12. **Avertismentele** (punctele, motivul, expirarea).
13. **Status-urile / postările de profil** (comentariile devin răspunsuri).
14. **Finalizarea:**
    - contoarele recalculate: topicuri, forumuri, membri, urmăritori, conversații, răspunsurile status-urilor;
    - indexul de căutare al topicurilor;
    - versiunea permisiunilor și cache-ul golit;
    - redirecturile pornite (dacă s-a cerut).

## 5. Comportamentul importului

- **Idempotent:** fiecare entitate creată intră în `import_map` în aceeași tranzacție. O rulare nouă sare peste ce e deja în hartă.
- **Reluabil:**
  - checkpoint-ul (cursorul) se salvează după fiecare lot; o rulare întreruptă continuă de la ultimul lot;
  - pauza și anularea se citesc între loturi; reluarea pune din nou jobul în coadă.
- **Loturi scurte:** 200–500 de înregistrări într-o tranzacție. Dacă tranzacția lotului pică, lotul se reia rând cu rând: rândul stricat ajunge în lista de erori, restul merge mai departe.
- **Rulare de probă:**
  - detecția, numerele pe tip și o probă de conversie pe primele 200 de postări (elemente nerecunoscute);
  - conturile care se vor lega după email;
  - nu scrie nimic în tabelele site-ului.
- **Jobul `import.run`** rulează în `gcs-worker`. Un singur import rulează odată: starea trece `QUEUED → RUNNING` atomic, cu `heartbeatAt`.
- **Raportul:** pe fiecare tip, importate / sărite / erori / elemente nerecunoscute. Se descarcă și ca CSV.
- **Jurnalul de audit:** `import.test`, `import.start`, `import.pause`, `import.resume`, `import.cancel`, `import.delete`, `import.redirects`, `import.credentials_deleted`.

## 6. Parolele

Hash-urile se marchează, nu se ghicesc:

| Prefix în `accounts.password` | Formula |
|---|---|
| `legacy-bcrypt$<hash>` | bcrypt (`$2y$` / `$2a$` / `$2b$`) |
| `legacy-md5s$<sare base64url>$<hash>` | `md5(md5(sare) . md5(parolă))`, cu și fără escaparea veche a caracterelor speciale |
| `legacy-sha256s$<sare>$<hash>` | `sha256(sha256(parolă) . sare)` |
| `legacy-sha1s$<sare>$<hash>` | `sha1(sha1(parolă) . sare)` |

- `verifyPassword` recunoaște prefixele. La prima autentificare reușită, hook-ul `verify` din Better Auth rescrie parola în Argon2id (`updateMany` pe hash-ul vechi).
- Membrii fără parolă validă nu primesc cont `credential`. Emailul de resetare cere fluxul „Am uitat parola”, care încă nu există în GCS (rămâne pe lista de după import).
- Hash-urile nu apar în loguri, rapoarte sau audit.

## 7. Conversia conținutului

- **Un singur scriitor de document** (`DocWriter`): blocuri, paragrafe, mărci și reguli de curățare. Rezultatul trece apoi prin `GcsContentRenderer`, deci validarea și sanitizarea sunt cele de la o postare nouă.
  - Containerele goale dispar, textele adiacente cu aceleași mărci se unesc.
  - Adâncimea citatelor e plafonată la 6, documentele foarte mari se aplatizează în paragrafe.
  - Ce nu trece validarea devine text simplu.
- **HTML (`core-schema`)**, parsat cu `htmlparser2`, recunoscut după clase și atribute (nu după nume de produs):
  - citatul (`data-*quote-username`, `-userid`, `-contentcommentid`) → nod `quote` cu postarea și autorul noi; nerezolvat → `blockquote` cu autorul;
  - mențiunea (`data-mentionid`) → `mention`;
  - spoilerul, codul (`lang-*`), embed-urile (iframe YouTube/Twitch sau URL-ul din parametrul `url`);
  - atașamentele (`data-fileid`) → imagine sau link spre `/files/{id}`;
  - emoticoanele: emoji după codul lor (`:)` → 🙂), altfel textul;
  - formatarea: aldin, cursiv, subliniat, tăiat, `sub`/`sup`, culoare hex, mărime rotunjită la `GCS_FONT_SIZES`, aliniere, titluri, liste;
  - marcajele de adresă (`<___base_url___>`, `<fileStore.*>`) se înlocuiesc cu adresa veche.
- **BBCode (`prefixed-schema`)**, cu un parser propriu (etichete neînchise = text):
  - `B I U S`, `COLOR`, `SIZE` (1–7 sau px, rotunjit), `FONT` (ignorat), `LEFT/CENTER/RIGHT/JUSTIFY`, `HEADING`;
  - `URL`, `EMAIL`, `IMG` (doar https; altfel link);
  - `MEDIA=youtube|twitch`;
  - `QUOTE="Nume, post: 1, member: 2"`, `ATTACH`, `USER=id`;
  - `CODE=limbaj`, `ICODE`, `PHP`/`HTML`, `SPOILER="titlu"`, `ISPOILER`;
  - `LIST`/`LIST=1` cu `[*]`, `SUB`, `SUP`, `HR`, `PLAIN`, `INDENT`;
  - `TABLE` → rânduri de text.
- **Linkurile interne** spre adresa veche (topic, forum, membru, postare) se rescriu spre adresele GCS când entitatea e deja importată; altfel devin calea veche relativă, rezolvată de redirecturi.
- **Nerecunoscut** → textul sursei, păstrat; raportul numără cazurile. Testele XSS: `<script>`, `javascript:`, `onerror`, stiluri `url()`, BBCode cu ghilimele și paranteze.

## 8. Redirecturile 301

- **Recunoaștere pură** (`matchLegacyPath`):
  - `core-schema`:
    - `/topic/123-titlu/` (și `/page/4/`, `?page=4`), `?do=findComment&comment=456`;
    - `/forum/5-nume/`, `/profile/7-nume/`;
    - `index.php?/topic/…`, `?showtopic=`, `?showforum=`, `?showuser=`;
  - `prefixed-schema`:
    - `/threads/titlu.123/` (și `page-4`, `post-456`), `/forums/nume.5/`, `/members/nume.7/`, `/posts/456/`;
    - cu sau fără `index.php?`.
- **Prefixul căii vechi** se poate configura (ex. `/forum`, dacă forumul vechi era într-un subfolder).
- **Rezolvarea** după `import_map`:
  - pagina topicului se recalculează pentru numărul de postări pe pagină din GCS (din numărul sursei, detectat);
  - postarea → `/topic/{id}/post/{postId}`.
- **Coliziunile:** fără prefix, `/topic/123-x` și `/forum/5-x` din `core-schema` arată ca adresele GCS. Redirectul se face doar dacă id-ul GCS nu există sau slug-ul cerut nu e al lui.
- **În `proxy.ts`:**
  - setarea `import.redirects` (cache Redis) e verificată la fiecare request; e oprită implicit;
  - regex-urile rulează doar când e pornită, iar baza de date se întreabă doar la o potrivire.
- **Se opresc din ACP.** Unealta „Verifică redirecturile” arată ținta pentru o adresă veche și un eșantion de topicuri.

## 9. ACP → Sistem → Conversii → „Import din altă platformă”

Secțiunea ACP `system.import` (intrarea de meniu existentă; implicit doar Root Admin, cu 2FA ca tot ACP-ul).

1. **Conexiunea:**
   - host, port, baza, user, parolă, prefix;
   - folderul fișierelor sau adresa lor, adresa veche a site-ului, prefixul căii vechi;
   - „Testează conexiunea” → schema și versiunea detectate, numărul de înregistrări pe tip.
2. **Opțiunile:** bife pe tipuri, „Rulare de probă (doar numără)”, „Pornește redirecturile 301 la final”.
3. **Progresul live** (polling la 2 s):
   - pasul curent, câte din câte, viteza;
   - jurnalul, erorile;
   - butoanele Pauză / Reia / Anulează.
4. **Raportul final:**
   - tabelul pe tipuri, „Descarcă CSV”;
   - „Verifică redirecturile”, „Sincronizare” (rulează din nou, aduce doar ce e nou), „Șterge datele de conectare”.

## 10. Securitate

- Conexiunea la baza veche e doar pentru citire: sesiune `READ ONLY`, doar `SELECT`/`SHOW` construite de cod.
- Parola bazei vechi e criptată în `import_jobs.secret`. Nu se loghează, nu ajunge la client (formularul arată doar „setată”).
- Descărcarea fișierelor de la o adresă web e anti-SSRF:
  - doar `http`/`https`, porturile 80/443/8080/8443, fără user și parolă în URL;
  - fiecare IP rezolvat e verificat la conectare (fără rebinding DNS): blocate loopback, rețelele private, link-local, CGNAT, multicast, rezervatele, IPv6 ULA/link-local/mapat;
  - cel mult 3 redirecturi, re-verificate; max 50 MB și 30 s.
- Folderul montat: fără `..`, fără căi absolute, `realpath` în interiorul folderului.
- Conținutul importat trece prin `GcsContentRenderer` (validare strictă + `sanitize-html`); HTML-ul sursei nu se randează niciodată direct.
- Fișierele trec prin aceeași verificare ca un upload nou.

## 11. Ce rămâne pe mai târziu

- Asistentul de portare a pluginurilor (§4 din spec).
- Emailul de resetare pentru membrii fără parolă (cere fluxul „Am uitat parola”).
- Importul din fișier `.sql` încărcat (se folosește un dump restaurat într-o bază temporară, conexiunea e aceeași).
- Reacțiile pe status-uri și pe mesajele private, istoricul complet al editărilor, restricțiile prefixelor pe forum.
- Aplicațiile Galerie, Descărcări, Bloguri, Pagini, Magazin (cu modulele lor, etapele 8–10).
