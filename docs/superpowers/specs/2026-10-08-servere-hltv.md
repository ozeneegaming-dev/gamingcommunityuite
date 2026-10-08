# Servere: HLTV / GOTV la meciurile mix — demo-urile pe site și „Urmărește live”

- **Data:** 2026-10-08
- **Cererea proprietarului** (aprobată 2026-10-08, „hai să implementăm și hltv”): demo-ul fiecărui meci mix pe pagina
  meciului („Descarcă demo”) și butonul **„Urmărește live”** la meciurile în desfășurare (adresa HLTV / GOTV a
  serverului, cu întârzierea transmisiei).
- **Regula de bază:** tot stă în aplicația Servere (`packages/modules/src/servers/bridge`). **Totul e oprit implicit**:
  pe serverul de joc nu se schimbă nimic până când adminul nu pornește explicit o opțiune în ACP.
- **Referințe:** puntea, partea A (`2026-10-08-servere-bridge.md`: protocolul §5–6, meciurile mix §6.9 / §10, joburile
  §16), paginile, partea B (`2026-10-08-servere-pagini.md` §7), pluginurile v2 (`2026-10-08-servere-plugin-v2.md`:
  modul colector, modulele opționale, pasul de release), specul Serverelor (`2026-10-07-servere.md` §10: garda SSRF).

## 1. Ce intră

1. **Demo-ul fiecărui meci mix încheiat** pe pagina meciului: „Descarcă demo” (mărimea, data, numărul descărcărilor);
   dreptul de grup `servers.demos_download` (implicit: toți cei care văd meciul). Păstrarea: zile setate în ACP (implicit
   14), o limită de mărime pe demo și o cotă totală; jobul de curățenie șterge demo-urile vechi.
2. **„Urmărește live”** la meciurile mix deschise (pagina meciului, cardul live din `/servers/matches`, pagina
   serverului): `steam://connect/<adresa HLTV sau GOTV>`, cu întârzierea transmisiei (CS 1.6: setată în ACP; CS2:
   `tv_delay` raportat de plugin, altfel cea din ACP). Doar dacă adresa e completată.
3. **ACP → serverul → Plugin și chei API → „HLTV / GOTV și demo-uri”** (setări pe server, toate oprite implicit):
   adresa de vizionare, întârzierea, sursa demo-urilor (FTP / FTPS / SFTP, folder HTTP, încărcarea directă de pluginul
   CS2), înregistrarea opțională (modulul CS2 / rcon HLTV pe CS 1.6), „Testează conexiunea”, ultimul rezultat și
   ultimele demo-uri (cu „Caută din nou” și „Șterge”).
4. **Joburile** (gcs-worker): aducerea demo-ului după final (reîncercări, limite, garda SSRF), potrivirea cu meciul,
   stocarea privată, comprimarea, curățenia; comenzile rcon către HLTV.
5. **Pluginurile 1.2.0:** CS2 primește modulul opțional „Înregistrează demo la meciurile mix” (`tv_record` /
   `tv_stoprecord`, încărcarea în bucăți); CS 1.6 raportează câte proxy-uri HLTV sunt conectate. Ambele raportează în
   heartbeat starea transmisiei (`tv`).

## 2. Modelul de date

Migrarea **`20261111000000_server_tv_demos`**.

### 2.1 `game_server_tv` (un rând pe server, lipsă = totul oprit)

| Câmp | Tip | Note |
|---|---|---|
| `serverId` | int, cheie, FK cascadă | |
| `address` | text, opțional | adresa HLTV / GOTV `host:port` pentru „Urmărește live” |
| `delay` | int, opțional | întârzierea transmisiei (s, 0–3600); CS2: rezerva când pluginul nu o raportează |
| `source` | text, implicit `none` | `none` / `ftp` / `ftps` / `sftp` / `http` / `plugin` (doar CS2) |
| `host`, `port`, `username` | opționale | FTP / FTPS / SFTP |
| `secret` | text, opțional | parola (sau fraza cheii SFTP), **sigilată** (`sealSecret`, ca parola bazei vechi la import) |
| `privateKey` | text, opțional | cheia privată SFTP, **sigilată** |
| `remoteDir` | text, implicit `/` | folderul demo-urilor |
| `tlsInsecure` | bool, implicit `false` | FTPS: acceptă un certificat nevalidat (nesigur, cu avertisment) |
| `hostKey` | text, opțional | SFTP: amprenta cheii serverului (`SHA256:…`); goală = se reține la prima conectare |
| `httpTemplate` | text, opțional | `http(s)://…/{file}` |
| `namePrefix` | text, implicit gol | doar fișierele care încep cu acest prefix (`[A-Za-z0-9_.-]`, max 32) |
| `timeZone` | text, implicit `UTC` | fusul orar al datelor din numele demo-urilor (HLTV scrie ora locală a mașinii) |
| `record` | bool, implicit `false` | CS2: modulul pluginului `tv_record`; CS 1.6: GCS pornește / oprește înregistrarea prin rcon HLTV |
| `rconPassword` | text, opțional | CS 1.6: `adminpassword` al HLTV-ului, **sigilat** |
| `lastFetchAt`, `lastFetchOk`, `lastFetchCode`, `lastFetchInfo` (JSON) | | ultimul rezultat al aducerii (ACP) |
| `lastRcon` (JSON) | | ultima comandă rcon: `{ at, action, ok, code }` |
| `updatedAt` | | |

Secretele nu se arată niciodată înapoi: formularul are „lasă gol ca să păstrezi” și „șterge”; jurnalul scrie doar
`set` / `unset`.

### 2.2 `game_match_demos` (un rând pe fișier)

`id`, `matchId` (FK `SET NULL`: rândurile rămase fără meci se curăță cu fișierele lor), `serverId` (FK `SET NULL`),
`part` (1…10: demo-urile împărțite), `status`, `source`, `remoteName` (numele de pe server), `fileName` (numele
descărcării: `<hartă>-<AAAA-LL-ZZ>-m<id>[-p<parte>].dem`), `storageKey` (store-ul platformei, privat), `encoding`
(`identity` / `gzip`), `size` (octeții demo-ului), `storedSize`, `sha256`, `downloads`, `attempts`, `nextAttemptAt`,
`error` (codul ultimei erori), `chunkSize` și `received` (încărcarea pluginului), `createdAt`, `updatedAt`, `availableAt`,
`expiresAt`. Unic `(matchId, part)`; indexuri `(status, nextAttemptAt)`, `(status, availableAt)`.

**Stările** (`GameDemoStatus`): `WAITING` (în așteptare), `FETCHING` (în transfer: descărcare sau încărcare),
`AVAILABLE` (disponibil), `NOT_FOUND` (negăsit după toate încercările), `FAILED` (eroare definitivă: prea mare,
fișier invalid, cotă), `EXPIRED` (șters la retenție, cotă sau de admin; rândul rămâne pentru istoric).

### 2.3 Setări și permisiuni

| Cheie | Implicit | Interval |
|---|---|---|
| `servers.demo_retention_days` | 14 | 1–365 |
| `servers.demo_max_mb` (pe demo) | 300 | 10–2000 |
| `servers.demo_quota_gb` (total) | 20 | 1–2000 |

Pe pagina „Bridge și ELO”. Permisiunea de grup **`servers.demos_download`**: implicit toate grupurile, mai puțin
Banat (ca `servers.stats_view`); descărcarea cere și vizibilitatea meciului (statisticile + serverul).

## 3. „Urmărește live”

- Adresa: `host:port` (IPv4 sau nume de domeniu public, port 1–65535); legătura e `steam://connect/<host>:<port>`.
- Întârzierea: CS2 — `tv.delay` din ultimul heartbeat (dacă pluginul o raportează), altfel `delay` din ACP; CS 1.6 —
  `delay` din ACP. Fără valoare: butonul fără întârziere.
- Apare doar la meciurile deschise (încălzire / live / pauză) ale unui server cu adresa completată: pe pagina meciului
  (dispare când meciul se încheie live), pe cardul din `/servers/matches` (deasupra legăturii întinse a cardului) și pe
  tabela live din pagina serverului. Serviciile întorc `tv: { address, delay } | null` (citire ușoară: rândul `tv` și
  lista din Redis).

## 4. Sursele demo-urilor

### 4.1 FTP / FTPS / SFTP

- **FTP / FTPS** (`basic-ftp`, MIT): FTPS explicit (`AUTH TLS`), certificatul verificat (servername = numele scris în
  ACP), cu excepția opțiunii „acceptă certificat nevalidat”. Modul pasiv: adresa din `PASV` se ignoră, transferul merge
  **doar la IP-ul conexiunii de control** (fără atacul „FTP bounce”).
- **SFTP** (`ssh2`, MIT): parolă sau cheie privată (cu fraza ei); cheia serverului verificată cu amprenta reținută
  (prima conectare o salvează; o cheie schimbată = `host_key_mismatch`).
- Listarea folderului (numele, mărimea, data), apoi descărcarea fișierelor alese într-un fișier temporar.

### 4.2 HTTP

- Șablonul `http(s)://host[:port]/cale/{file}` (`{file}` o singură dată, în cale; fără nume / parolă). Folderul
  (șablonul fără `{file}`) trebuie să aibă o listă a fișierelor (pagina de index a serverului web): GCS citește
  legăturile `*.dem` (max 2 MB), apoi descarcă `{file}` = numele ales (codat).
- Redirecturile doar pe aceeași origine (max 3).

### 4.3 Încărcarea directă de pluginul CS2 (`source = plugin`)

Rutele semnate (§5 partea A), doar cu `source = plugin` și modulul de înregistrare pornit (altfel `403 demos_disabled`):

- `POST /demos/upload` `{ match, file, size, sha256 }` → `{ upload, chunkSize, received }`, `{ done: true }` (demo-ul e
  deja pe site) sau `{ processing: true }` (se verifică). Erori: `404 unknown_match`, `409 match_open` (meciul nu s-a
  încheiat încă: reîncearcă), `410 not_wanted` (meci anulat), `413 too_large`, `507 over_quota`, `400 invalid_*`.
  Aceeași cerere cu aceeași mărime și același sha256 **reia** încărcarea (`received`); alte valori o încep din nou.
- `POST /demos/chunk?upload=<id>&offset=<n>` (corp binar, `application/octet-stream`, cel mult 1 MiB; semnătura
  acoperă hash-ul corpului) → `{ received }` / `{ received, complete: true }`; `409 offset_mismatch` (+ `received`).
  Fiecare bucată are exact `chunkSize` octeți (ultima, restul). Bucățile stau în store-ul platformei
  (`servers/demo-uploads/<id>/<offset>`), deci site-ul rămâne fără stare locală.
- La ultima bucată, jobul `servers.demos.ingest` le lipește, verifică mărimea, sha256-ul și antetul demo-ului, apoi le
  stochează (§6). Pluginul întreabă din nou `POST /demos/upload` până primește `done: true`.
- **Pluginul:** încarcă doar după finalul meciului, **niciodată în timpul unui meci live pe acel server** (se oprește și
  continuă după), cu ritmul primit de la site (`config.tv.rate`, implicit 1 MiB/s), reluabil după repornire
  (`data/gcs_demo_uploads.json`); la `done: true` șterge fișierul local (`"KeepDemos": true` îl păstrează).

### 4.4 Potrivirea fișierelor cu meciul

Pe numele fișierului (doar `*.dem`, nume simple `[A-Za-z0-9_.()+-]`, max 200):

1. **Numele GCS** (exacte, au prioritate): `gcs-<externalId>.dem` (modulul CS2; caracterele din afara `[A-Za-z0-9_-]`
   devin `_`) și `gcs-m<id>-<AAZZ…>-<hartă>.dem` (rcon-ul HLTV, §5).
2. **Numele HLTV:** `<prefix>-<AALLZZhhmm>-<hartă>.dem`; **numele cu dată** (ex. înregistrarea automată GOTV):
   `…<AAAALLZZ>[-_]<hhmm[ss]>…` cu numele hărții în nume.
3. Data din nume e ora locală a mașinii care înregistrează → UTC după `timeZone` (cu trecerile la ora de vară).
4. **Fereastra:** harta trebuie să fie a meciului; începutul jocului `T0 = liveAt` (sau `startedAt`), finalul `T1`,
   amândouă plus întârzierea transmisiei. Prima parte = ultimul fișier început la cel mult `T0 + 60 s` (minutul din nume)
   și cel mult 12 ore înainte; părțile următoare = fișierele aceleiași hărți începute după ea, până la `T1 + 60 s`
   (**demo-urile împărțite** la schimbarea hărții / restart). Fără fișier înainte de `T0`: cele începute în fereastră.
   Un fișier cu data modificării (FTP / SFTP) mai veche decât `T0` nu are meciul și se ignoră. Max 10 părți.
5. `namePrefix` (dacă e completat) filtrează numele înainte de toate.

## 5. CS 1.6: HLTV

- **Varianta A (implicit):** pluginul de mix existent / HLTV-ul serverului înregistrează deja; GCS doar aduce
  demo-urile (FTP / HTTP) și le potrivește după fereastră și hartă (§4.4).
- **Varianta B (opțională, `record`):** gcs-worker trimite comenzi rcon **doar la adresa HLTV configurată** (UDP,
  garda adreselor ca la interogări): la trecerea meciului în `live` — `record gcs-m<id>`, la final / anulare —
  `stoprecording` (după întârzierea transmisiei + 5 s). Protocolul GoldSrc: `ÿÿÿÿchallenge rcon\n` → `challenge rcon
  <n>`, apoi `ÿÿÿÿrcon <n> "<adminpassword>" <comandă>\n`. Parola sigilată; comenzile sunt doar cele două (nume
  `[A-Za-z0-9_-]`), parola fără ghilimele / caractere de control. Rezultatul (fără parolă) în `lastRcon`.

## 6. Joburile și stocarea

| Job | Ritm | Ce face |
|---|---|---|
| `servers.demos.fetch` | la 2 minute + programat la finalul meciului | rândurile `WAITING` scadente (max 5 pe rundă): listarea, potrivirea, descărcarea, stocarea |
| `servers.demos.ingest` | la ultima bucată a pluginului | lipirea bucăților, verificarea, stocarea |
| `servers.demos.cleanup` | la oră | retenția, cota, rândurile fără meci, încărcările abandonate (24 h), transferurile blocate (30 min) |
| `servers.tv.rcon` | la tranzițiile meciului | `record` / `stoprecording` la HLTV (varianta B) |

- **La finalul meciului** (`ended`, server cu sursă): rândul `WAITING` (partea 1), scadent după întârzierea transmisiei
  + 30 s; jobul e programat atunci. Meciurile anulate nu au demo.
- **Reîncercările:** 8 încercări, cu pauzele de 2, 5, 10, 20, 40, 60 și 120 de minute (~4 ore); după ultima:
  `NOT_FOUND` (niciun fișier potrivit) sau `FAILED` (eroarea). Erorile definitive (prea mare, alt joc, cota, sursa
  neconfigurată) nu se reîncearcă. Timpul: conectarea 15 s, listarea 30 s, descărcarea max 15 minute.
- **Limitele:** `servers.demo_max_mb` pe fișier (oprit din flux, nu după), antetul verificat (`HLDEMO` pe CS 1.6,
  `PBDEMS2` / `HL2DEMO` pe CS2), numele sigure.
- **Garda SSRF** (aducerea, testul, rcon-ul): doar host-ul și portul configurate; adresa rezolvată o singură dată și
  verificată (public; privat doar în excepția operatorului `GCS_SERVERS_ALLOW_NETS`; loopback doar în afara producției;
  link-local / multicast / metadatele niciodată); conexiunea merge la IP-ul verificat.
- **Comprimarea:** gzip în flux; se păstrează comprimat doar dacă economisește cel puțin 10 %. Descărcarea îl
  decomprimă în flux: fișierul primit e `.dem`, gata de deschis în joc.
- **Stocarea:** store-ul platformei (MinIO / folder local), cheia `servers/demos/<AAAA>/<LL>/<uuid>.dem[.gz]`, **fără
  atașament public**: doar prin ruta `/api/servers/demos/<id>` (verificarea drepturilor la fiecare cerere, contorul de
  descărcări, limită pe IP, `Cache-Control: private, no-store`, `Content-Disposition: attachment`).
- **Retenția / cota:** `AVAILABLE` mai vechi de `servers.demo_retention_days` → fișierul șters, `EXPIRED`; peste
  `servers.demo_quota_gb` → cele mai vechi expiră până sub cotă (niciodată cel tocmai adus; unul singur peste cotă =
  `FAILED over_quota`).

## 7. ACP și vizibilitatea pentru staff

- **Secțiunea „HLTV / GOTV și demo-uri”** pe pagina punții: formularul (§2.1, câmpurile după sursă), „Testează
  conexiunea” (folosește setările salvate: listează folderul, arată câte demo-uri vede și câteva nume, amprenta SFTP;
  10 / oră), ultimul rezultat al aducerii (data, codul, fișierele văzute / potrivite), ultima comandă rcon, ultimele 10
  demo-uri (meciul, starea, mărimea, descărcările, eroarea) cu „Caută din nou” (`edit`) și „Șterge” (`delete`).
- Jurnal: `servers.tv.update` (secretele doar `set` / `unset`), `servers.tv.test`, `servers.demo.refetch`,
  `servers.demo.delete`.
- **Pagina meciului:** pentru cine are ACP → Gaming → Servere (`view`), starea demo-ului (în așteptare / în transfer /
  disponibil / negăsit / expirat / eroare + codul), cu legătura spre pagina punții.

## 8. Pluginurile 1.2.0

- **CS2:** modulul `demos` (în `config.features`, pornit doar cu `record` și cu acordul local `AllowManage`): la
  trecerea meciului în `live` rulează `tv_record gcs-<externalId>` (doar dacă `tv_enable` e 1; altfel raportează),
  la final / anulare `tv_stoprecord` după `tv_delay + 5 s`; cu `config.tv.upload` pune demo-ul meciului încheiat în
  coada de încărcare (§4.3). Heartbeat: `tv: { enabled, delay, port, recording }`.
- **CS 1.6:** heartbeat `tv: { hltv }` (câte proxy-uri HLTV sunt conectate). Nimic altceva nu se schimbă.
- Pasul de release (0 erori / 0 avertismente), manifestul, livrabilele.

## 9. Testele

- **Unitare:** potrivirea numelor (HLTV, GCS, cu dată; fusul orar și ora de vară; prefixul; demo-urile împărțite;
  fișierele vechi / alte hărți), validarea setărilor, sigilarea secretelor (nimic în clar în baza de date sau în
  jurnal), garda adreselor, retenția și cota, drepturile descărcării, pachetele rcon (fără rețea) și schimbul rcon cu un
  HLTV fals pe UDP, sursele HTTP / FTP / SFTP pe servere locale, protocolul de încărcare (start, bucăți, reluare,
  `offset_mismatch`, sha256 greșit, limitele), joburile (aducerea, reîncercările, cleanup-ul), serverul fals.
- **Verificarea încrucișată:** clientul CS2 real (`BridgeClient.cs`, `DemoUploader.cs`) contra codului real al
  site-ului prin HTTP (test opțional, cu `GCS_DOTNET`).
- **E2E:** sursa HTTP (server static local cu un demo) → meciul mix al serverului fals se încheie → demo-ul apare pe
  pagina meciului și se descarcă identic; „Urmărește live” pe un meci live, cu adresa și întârzierea.
