# GCS Server Bridge — pluginurile serverelor de joc

Puntea dintre serverele de joc ale comunității și GamingCommunitySuite (specurile
`docs/superpowers/specs/2026-10-08-servere-bridge.md`, `2026-10-08-servere-plugin-v2.md` și
`2026-10-08-servere-hltv.md`).

**Implicit pluginul doar colectează date** pentru site: heartbeat (harta, jucătorii și flag-urile lor de admin, citite
din sistemul de admini al serverului), evenimente (conectări, ucideri, runde, focuri, scorul echipelor), meciurile mix
urmărite pasiv pe serverele marcate „mix” și legarea contului cu `/gcs COD`. Nu atinge adminii (`users.ini`,
`configs/admins.json`), bannurile, comenzile sau alte pluginuri ale serverului.

Același binar merge pe orice server; doar configul diferă, iar ACP-ul îl completează singur (vezi „Pachetele”).

| Joc | Framework | Sursa | HTTP | Licența |
|---|---|---|---|---|
| Counter-Strike 1.6 | AMX Mod X 1.9 / 1.10 (+ ReAPI / Reunion opționale) | `amxx/gcs_bridge.sma` | modulul AmxxEasyHttp | GPL-3.0-or-later |
| Counter-Strike 2 | CounterStrikeSharp (.NET 8, peste Metamod:Source 2) | `cs2/GcsBridge/` | `HttpClient` din .NET | MIT |

Licența GCS nu e afectată: pluginurile sunt programe separate care vorbesc HTTP cu site-ul.

## Pachetele (configurare zero)

- **Pe server:** ACP → Gaming → Servere → serverul → Plugin și chei API → „Descarcă pluginul pentru acest server”. Arhiva
  are pluginul compilat, configul cu adresa site-ului și o cheie API nouă (creată atunci, pusă doar în arhivă, în
  jurnal), nota de instalare și licența. Pe server: încarci fișierele, repornești, gata.
- **General:** ACP → Gaming → Servere → „Descarcă pluginul general” (CS 1.6 / CS2): doar adresa site-ului, fără cheie.
  Pus pe orice server încă neadăugat, pluginul se înrolează singur; adminul îl aprobă la „Servere noi detectate”, iar
  pluginul primește cheia o singură dată și o salvează local (CS 1.6: `configs/gcs_bridge_key.cfg`; CS2:
  `plugins/GcsBridge/data/gcs_bridge_key.txt`).
- Pe CS 1.6 arhiva are și `configs/plugins-gcs.ini` (AMX Mod X încarcă singur fișierele `plugins-*.ini`), deci
  `plugins.ini` nu se editează.

## Modulele opționale (oprite implicit)

Se pornesc din ACP pe fiecare server („Module opționale — doar dacă vrei ca GCS să administreze serverul”); pluginul
le primește în heartbeat (`config.features`). Un modul oprit nu își înregistrează comenzile și nu își trage listele.
`gcs_allow_manage 0` (CS 1.6) / `"AllowManage": false` (CS2) ține pluginul colector oricum ar fi setările din ACP.

| Modul | Cheia | Ce face |
|---|---|---|
| Admini din GCS | `admins` | adminii din ACP înlocuiesc drepturile jucătorilor (nume + parolă, protecția numelui); la oprire, adminii serverului se reîncarcă (`amx_reloadadmins` / `css_reloadadmins`) |
| Bannuri, mute, gag din GCS | `sanctions` | sincronizarea sancțiunilor, `/check` la conectare, kick-ul celor banați, mute / gag |
| VIP din GCS | `vip` | flag-urile / permisiunile VIP adăugate peste cele ale serverului (doar cele adăugate de GCS se scot) |
| Ready-up mix | `mixReady` | `say /ready` / `!ready`: GCS pornește meciul (restartul) |
| Comenzile de admin GCS | `commands` | comenzile din tabelele de mai jos și jurnalul acțiunilor adminilor |
| Demo-urile meciurilor mix (doar CS2) | `demos` | `tv_record gcs-<id meci>` la trecerea meciului în live, `tv_stoprecord` după `tv_delay` + 5 s; cu sursa „încărcate de plugin”, demo-ul urcă pe site după meci (§ „HLTV / GOTV”) |

## Protocolul pe scurt

- Baza: `{site}/api/servers/bridge/v1`, JSON UTF-8, HTTPS (HTTP doar în LAN, la alegerea operatorului; pluginul scrie
  un avertisment în log, iar la înrolare cheia ar trece în clar).
- Cheia serverului: `gcs1.<keyId>.<secret>`. Secretul nu pleacă niciodată pe rețea.
- Fiecare cerere semnată are `X-GCS-Key`, `X-GCS-Timestamp` (Unix), `X-GCS-Nonce` (16–64 de caractere
  `[A-Za-z0-9_-]`, unic) și `X-GCS-Signature`:
  - șirul canonic: `METODĂ \n CALE \n TIMESTAMP \n NONCE \n hex(SHA-256(corp))`, CALE = partea de după bază, cu query-ul
    exact cum se trimite;
  - `K = hex(SHA-256(secret))`; `hmac-sha256=<hex>` (CS2) sau `sha256-env=<hex>` = SHA-256(K + "\n" + canonic + "\n" +
    K) (AMX Mod X, care are doar `hash_string`).
- Ceasul: max 300 s diferență; la `401 clock_skew` pluginul își corectează decalajul (`serverTime`) și retrimite.
- Rutele semnate: `POST /heartbeat` (răspunsul are `config.features`, `config.isMix`), `POST /events`, `GET /admins`,
  `GET /vip`, `GET /sanctions?since=…` (doar cu modulele lor), `POST /check`, `POST /link`.
- **Înrolarea** (fără semnătură, max 4 KB): `POST /enroll` `{ game, port, hostname, map, maxPlayers, players, plugin,
  secret }` → `{ status, enrollment }`; `POST /enroll/status` `{ enrollment, secret }` → `pending` / `approved` + `key`
  (o singură dată) / `approved` + `delivered` / `rejected`; referința necunoscută sau secretul greșit → `404
  unknown_enrollment`. Site-ul păstrează doar `SHA-256(secret)`, verifică prin interogarea A2S că la IP-ul sursei
  răspunde un server al jocului și aplică limite pe IP, plafoane și expirarea (7 zile).
- Heartbeat-ul raportează pe fiecare jucător flag-urile de admin existente (CS 1.6: `flags`, literele din
  `get_user_flags`; CS2: `permissions` și `groups` din CounterStrikeSharp, doar citite), `modules` / `scores` și
  transmisia `tv` (CS2: `enabled`, `delay`, `port`, `recording` din `tv_enable` / `tv_delay` / `tv_port`; CS 1.6:
  `hltv`, câte proxy-uri HLTV sunt conectate). Răspunsul are `config.features.demos` și `config.tv` (`upload`,
  `chunkSize`, `rate`).
- **Demo-urile încărcate de plugin** (semnate, doar cu sursa „plugin” și modulul `demos`): `POST /demos/upload`
  `{ match, file, size, sha256 }` → `{ upload, chunkSize, received }` / `{ done: true }` / `{ processing: true }`, apoi
  `POST /demos/chunk?upload=<id>&offset=<n>` cu corpul binar (exact `chunkSize` octeți, ultima bucată restul; max 1 MiB;
  semnătura acoperă hex(SHA-256(octeți))) → `{ received }` / `{ received, complete: true }` / `409 offset_mismatch`.
  Aceeași mărime și același sha256 reiau încărcarea de la `received`.

Un server de joc fals care vorbește protocolul (fără dependențe, Node ≥ 18) e în `mock/gcs-mock-server.mjs`:

```sh
node servers-plugins/mock/gcs-mock-server.mjs --url https://comunitate.exemplu.ro --key gcs1.<keyId>.<secret> --scenario full
node servers-plugins/mock/gcs-mock-server.mjs --url https://comunitate.exemplu.ro --scenario enroll --game cs2
node servers-plugins/mock/gcs-mock-server.mjs --url https://comunitate.exemplu.ro --key gcs1.<keyId>.<secret> --scenario demo --demo meci.dem
```

## Release-ul (binarele de pe site)

ACP-ul pune în pachete binarele din `release/` (în depozit), verificate cu `release/manifest.json` (versiunile, sha256
pentru fiecare fișier, sha256 al surselor folosite, versiunile uneltelor). După orice schimbare în surse:

```powershell
.\servers-plugins\release.ps1 -Compiler "C:\amxmodx\scripting\amxxpc.exe" -Includes "C:\easy_http","C:\reapi" -Dotnet "C:\dotnet8\dotnet.exe"
```

```sh
AMXXPC=/opt/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/easy_http:/opt/reapi DOTNET_EXE=/opt/dotnet8/dotnet ./servers-plugins/release.sh
```

Scriptul oprește release-ul la orice avertisment, compilează DLL-ul fără `.pdb` și fără căile locale ale mașinii
(build reproductibil) și rescrie `release/`. Testul `packages/modules/src/servers/bridge/release.test.ts` pică dacă
sursele s-au schimbat fără un release nou. Next.js include folderul în build-ul standalone; altă cale:
`GCS_PLUGIN_RELEASE_DIR`.

## Counter-Strike 1.6 (AMX Mod X)

### Cerințe pe server

- AMX Mod X **1.9 sau 1.10**: <https://www.amxmodx.org/downloads.php>
- Modulul **AmxxEasyHttp** 1.4 sau mai nou (HTTPS asincron, prin libcurl), de pe pagina oficială a proiectului
  (GitHub, „AmxxEasyHttp”, Releases): modulul în `addons/amxmodx/modules/` și certificatele
  `addons/amxmodx/data/amxx_easy_http_cacert.pem` (necesare pentru HTTPS).
- Opțional, **ReAPI** cu **Reunion** (deosebesc clienții Steam de cei non-Steam).

### Compilarea

`amxxpc` vine în pachetul oficial AMX Mod X. Depozitul nu conține și nu descarcă compilatorul.

```powershell
.\servers-plugins\amxx\build.ps1 -Compiler "C:\amxmodx\addons\amxmodx\scripting\amxxpc.exe" -Includes "C:\easy_http","C:\reapi"
```

```sh
AMXXPC=/opt/amxmodx/addons/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/easy_http:/opt/reapi ./servers-plugins/amxx/build.sh
```

**Limitele Pawn:** nativele care citesc un șir din plugin (`hash_string`, `ezhttp_option_set_body`, `json_parse` dintr-un
șir) se opresc la 16383 de caractere: corpul unei cereri rămâne sub 16000, un eveniment sub 4095 (jucătorii unui
`round_end` pleacă în loturi de câte 8), răspunsurile se citesc din fișier.

### Configul (`configs/gcs_bridge.cfg`)

| Cvar | Implicit | Ce face |
|---|---|---|
| `gcs_url` | — | adresa site-ului |
| `gcs_key` | gol | cheia; goală = înrolarea automată |
| `gcs_allow_manage` | 1 | 0 = doar colector, orice module s-ar porni în ACP |
| `gcs_password_field`, `gcs_name_protect` | `_pw`, 1 | modulul „admins”: parola adminilor pe nume și protecția numelui |
| `gcs_amx_aliases` | 1 | modulul „commands”: `amx_ban` / `amx_unban` prin GCS |
| `gcs_mix_players`, `gcs_mix_maxrounds` | 10, 30 | ready-up-ul și rundele meciului când `mp_maxrounds` e 0 |
| `gcs_debug` | 0 | jurnalul cererilor (fără chei sau semnături) |

### Comenzile modulului „commands”

| Comandă | Drept | Ce face |
|---|---|---|
| `gcs_ban <țintă> <minute> [motiv]` / `amx_ban` | `d` (sau `v` doar temporar) | ban pe acest server |
| `gcs_gban <țintă> <minute> [motiv]` | `d` | ban pe toate serverele (doar dacă GCS te cunoaște ca admin pe toate) |
| `gcs_unban <authid \| ip> [motiv]` / `amx_unban` | `d` | ridică banul |
| `gcs_mute` / `gcs_gag <țintă> <minute> [motiv]` | `i` | mute vocal / gag |
| `gcs_unmute` / `gcs_ungag <țintă>` | `i` | ridică mute-ul / gag-ul |
| `gcs_match <start\|live\|halftime\|end\|abort>` | `h` | meciul mix condus din comandă |
| `gcs_sync` | `l` | trage acum listele de la site |

Mereu: `say /gcs COD` (legarea identității non-Steam). Cu `mixReady`: `say /ready`, `say /unready`. Alte pluginuri de
mix pot conduce meciul prin `gcs_bridge.inc` (`gcs_mix_command`, `gcs_mix_state`, `gcs_queue_event`, forward-urile
`gcs_on_match_state` și `gcs_on_player_linked`); atunci GCS doar urmărește meciul (restartul și mutările le face
pluginul lor).

## Counter-Strike 2 (CounterStrikeSharp)

### Cerințe pe server

- **Metamod:Source 2** și **CounterStrikeSharp** (cu runtime-ul .NET), din pagina oficială a proiectului
  CounterStrikeSharp (GitHub, Releases).

### Compilarea

Necesită **.NET SDK 8**: <https://dotnet.microsoft.com/download/dotnet/8.0>. `CounterStrikeSharp.API` vine din NuGet în
versiunea fixă din `GcsBridge.csproj`: **1.0.368**, ultima pentru net8.0. Pluginul net8.0 rulează și pe
CounterStrikeSharp-ul nou, cu runtime-ul .NET 10.

```powershell
.\servers-plugins\cs2\build.ps1 [-Dotnet "C:\tools\dotnet8\dotnet.exe"]
```

### Configul (`configs/plugins/GcsBridge/GcsBridge.json`)

`Url`, `Key` (gol = înrolarea automată), `AllowManage` (false = doar colector), `MixPlayers`, `MixMaxRounds`,
`KeepDemos` (modulul `demos`: true păstrează demo-ul pe server după ce a ajuns pe site), `Debug`.

### Comenzile modulului „commands” (chat: `!…` sau `/…`)

| Comandă | Permisiune | Ce face |
|---|---|---|
| `css_gcsban` / `css_gcsgban <țintă> <minute> [motiv]` | `@css/ban` (sau `@gcs/tempban` doar temporar) | ban pe acest server / pe toate |
| `css_gcsunban <SteamID64 \| IP> [motiv]` | `@css/unban` | ridică banul |
| `css_gcsmute` / `css_gcsgag <țintă> <minute> [motiv]` | `@css/chat` | mute vocal / gag |
| `css_gcsunmute` / `css_gcsungag <țintă>` | `@css/chat` | ridică mute-ul / gag-ul |
| `css_gcskick <țintă> [motiv]` | `@css/kick` | kick, cu intrare în jurnalul GCS |
| `css_gcsmatch <start\|live\|halftime\|end\|abort>` | `@css/config` | meciul mix condus din comandă |

Mereu: `!gcs COD` (pe CS2 contul Steam se leagă de pe site). Cu `mixReady`: `!ready`, `!unready`.

## Meciurile mix urmărite pasiv

Pe un server marcat „mix” în ACP, fără ready-up și fără ca meciul să fie condus din comandă / native, pluginul doar
observă: un restart al jocului urmat de o rundă cu cel puțin 2 jucători în fiecare echipă pornește meciul (A = CT);
schimbarea părților (majoritatea lui A pe partea cealaltă) e pauza; finalul vine la majoritatea lui `mp_maxrounds`
(30 pe CS 1.6 / 24 pe CS2 dacă e 0) sau, pe CS2, la panoul de final; harta schimbată anulează meciul deschis.

## HLTV / GOTV și demo-urile meciurilor mix

Totul se setează pe site, pe fiecare server (ACP → Gaming → Servere → serverul → Plugin și chei API → „HLTV / GOTV și
demo-uri”), și e oprit implicit:

- **„Urmărește live”:** adresa HLTV / GOTV (`host:port`) și întârzierea; pe CS2 pluginul raportează `tv_delay`.
- **Sursa demo-urilor:** FTP / FTPS / SFTP (secretele sigilate pe site, niciodată arătate înapoi), un folder HTTP cu lista
  fișierelor sau, pe CS2, încărcarea directă de către plugin. Site-ul potrivește fișierele cu meciul după nume (numele
  GCS, `<prefix>-<AALLZZhhmm>-<hartă>.dem` ale HLTV-ului, numele cu dată), fereastra meciului și hartă, inclusiv
  demo-urile împărțite.
- **CS 1.6:** HLTV-ul e un proxy separat; pluginul nu înregistrează nimic. Opțional, gcs-worker pornește / oprește
  înregistrarea HLTV prin rcon (`record gcs-m<id>` / `stoprecording`, cu `adminpassword`-ul HLTV), doar la adresa
  configurată.
- **CS2:** modulul `demos` rulează `tv_record` / `tv_stoprecord` (cere `tv_enable 1`) și, cu sursa „plugin”, încarcă
  demo-ul după meci, în bucăți, cu ritmul cerut de site, reluabil după repornire (`data/gcs_demo_uploads.json`) și
  **niciodată cât timp pe server e un meci**.

## Securitate

- Cheia e pe server: se rotește (cea veche mai merge 10 minute) și se revocă din ACP. O cheie furată poate scrie
  statistici false; de aceea înrolarea cere aprobarea unui admin, iar cheia se livrează o singură dată, doar celui cu
  referința și secretul înrolării.
- Secretul înrolării pe CS 1.6 vine dintr-un rezervor de entropie trecut prin SHA-256 (AMX Mod X nu are un generator
  criptografic); referința dată de site (aleatorie, doar prin răspunsul către plugin) o completează.
- Adminii membri primesc drepturile doar pe identitățile Steam (dovedite). Parolele adminilor pe nume nu circulă
  niciodată spre server (doar sarea și verificatorul).
- Textele venite din joc (nume, motive, hărți, numele raportat la înrolare) sunt curățate de GCS și afișate doar ca text.

## Starea compilării

Ambele pluginuri (1.2.0) se compilează fără erori și fără avertismente (2026-10-09):

| Plugin | Unelte | Rezultat |
|---|---|---|
| `amxx/gcs_bridge.sma` | `amxxpc` din AMX Mod X 1.10.0.5486; include-urile AmxxEasyHttp 1.5.0 și ReAPI 5.29.0.358 | `gcs_bridge.amxx`; nativele folosite există și în AMX Mod X 1.9 |
| `cs2/GcsBridge` | .NET SDK 8.0.425; `CounterStrikeSharp.API` 1.0.368 | `GcsBridge.dll` (net8.0), fără `.pdb` |

Protocolul e verificat cap la cap cu codul site-ului: clientul CS2 real (`BridgeClient.cs`, `EventQueue.cs`) prin HTTP
(înrolarea, secretul greșit, cheia livrată, heartbeat-ul semnat cu permisiunile raportate, evenimentele) și pașii
pluginului AMX Mod X refăcuți în Node (corpurile ca `json_serial_to_string`, `sha256-env`, cheia din
`gcs_bridge_key.cfg`). Încărcarea demo-urilor are un test repetabil: `cs2/crosscheck` compilează `BridgeClient.cs` și
`DemoUploader.cs` fără CounterStrikeSharp și încarcă un demo pe codul real al site-ului prin HTTP (heartbeat-ul cu
modulul `demos`, întreruperea și reluarea, lipirea, `done`):

```sh
GCS_DOTNET=/cale/spre/dotnet NUGET_PACKAGES=/cale/spre/nuget npx vitest run src/servers/bridge/demos/crosscheck.test.ts
```

(din `packages/modules`). Pluginurile nu au rulat încă pe un server de joc real.
