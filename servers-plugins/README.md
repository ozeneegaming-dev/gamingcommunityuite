# GCS Server Bridge — pluginurile serverelor de joc

Puntea dintre serverele de joc ale comunității și GamingCommunitySuite (specul
`docs/superpowers/specs/2026-10-08-servere-bridge.md`). Pluginul de pe server trimite heartbeat-uri și evenimente
(conectări, ucideri, runde, focuri, acțiuni de admin, sancțiuni, meciuri mix) și trage de la site listele de admini,
sancțiuni (bannuri, mute, gag) și VIP. Listele se păstrează local: site-ul căzut nu oprește adminii și nici bannurile.

| Joc | Framework | Sursa | HTTP | Licența |
|---|---|---|---|---|
| Counter-Strike 1.6 | AMX Mod X 1.9 / 1.10 (+ ReAPI / Reunion opționale) | `amxx/gcs_bridge.sma` | modulul AmxxEasyHttp | GPL-3.0-or-later |
| Counter-Strike 2 | CounterStrikeSharp (.NET 8, peste Metamod:Source 2) | `cs2/GcsBridge/` | `HttpClient` din .NET | MIT |

Licența GCS nu e afectată: pluginurile sunt programe separate care vorbesc HTTP cu site-ul.

## Protocolul pe scurt

- Baza: `{site}/api/servers/bridge/v1`, JSON UTF-8, HTTPS (HTTP doar în LAN, la alegerea operatorului).
- Cheia serverului se creează în ACP → Gaming → Servere → serverul → **Plugin și chei API** și se arată o singură
  dată: `gcs1.<keyId>.<secret>`. Secretul nu pleacă niciodată pe rețea.
- Fiecare cerere are anteturile `X-GCS-Key` (keyId), `X-GCS-Timestamp` (Unix, secunde), `X-GCS-Nonce` (16–64 de
  caractere `[A-Za-z0-9_-]`, unic) și `X-GCS-Signature`:
  - șirul canonic: `METODĂ \n CALE \n TIMESTAMP \n NONCE \n hex(SHA-256(corp))`, unde CALE = partea de după bază, cu
    query-ul exact cum se trimite (ex. `/sanctions?since=120&limit=100`);
  - `K = hex(SHA-256(secret))` (64 de caractere hex);
  - `hmac-sha256=<hex>` = HMAC-SHA256 cu cheia K (ca octeți ASCII) peste șirul canonic (pluginul CS2);
  - `sha256-env=<hex>` = SHA-256(K + "\n" + canonic + "\n" + K) (pluginul AMX Mod X, care are doar `hash_string`).
- Ceasul: diferența maximă e 300 s; la `401 clock_skew` răspunsul are `serverTime`, pluginul își corectează decalajul
  și retrimite. Toate răspunsurile au `serverTime` și antetul `X-GCS-Time`.
- Rutele: `POST /heartbeat`, `POST /events` (max 500 / lot, fiecare cu id unic: retrimiterea e sigură),
  `GET /admins` și `GET /vip` (cu `If-None-Match`), `GET /sanctions?since=<cursor>[&limit=1..1000]`, `POST /check`
  (verificarea la conectare, 3 s), `POST /link` (`/gcs COD`).
- Reîncercările: rețea / 5xx → același lot, cu backoff 5 s, 10 s, 20 s … max 5 minute; 4xx (în afară de 401
  `clock_skew`, 409 `replay`, 429) → lotul e invalid și se aruncă. Evenimentele netrimise se salvează pe disc la
  schimbarea hărții / oprire și se retrimit cu aceleași id-uri.

Un server de joc fals care vorbește protocolul (fără dependențe, Node ≥ 18) e în `mock/gcs-mock-server.mjs`:

```sh
node servers-plugins/mock/gcs-mock-server.mjs --url https://comunitate.exemplu.ro --key gcs1.<keyId>.<secret> --scenario full
```

## Counter-Strike 1.6 (AMX Mod X)

### Cerințe pe server

- AMX Mod X **1.9 sau 1.10** (nativele `json_*` și `hash_string` cu SHA-256): <https://www.amxmodx.org/downloads.php>
- Modulul **AmxxEasyHttp** 1.4 sau mai nou (HTTPS asincron, prin libcurl), de pe pagina oficială a proiectului
  (GitHub, „AmxxEasyHttp”, secțiunea Releases): din arhiva versiunii, modulul (`easy_http_amxx_i386.so` /
  `easy_http_amxx.dll`) în `addons/amxmodx/modules/` și certificatele (`addons/amxmodx/data/amxx_easy_http_cacert.pem`,
  necesare pentru HTTPS); `easy_http.inc` și `easy_http_json.inc` la include-urile compilatorului.
- Opțional, **ReAPI** cu **Reunion** (pentru a deosebi clienții Steam de cei non-Steam): fără ele, în modul `mixed`
  toți jucătorii sunt non-Steam (Steam-ul nu se poate dovedi). Pluginul compilat cu `reapi.inc` se încarcă și fără
  ReAPI (biblioteca e opțională).

### Compilarea

Compilatorul (`amxxpc`) vine în pachetul oficial AMX Mod X (folderul `addons/amxmodx/scripting/`). Depozitul GCS nu
conține și nu descarcă compilatorul.

```powershell
# Windows
.\servers-plugins\amxx\build.ps1 -Compiler "C:\amxmodx\addons\amxmodx\scripting\amxxpc.exe" -Includes "C:\easy_http","C:\reapi"
```

```sh
# Linux
AMXXPC=/opt/amxmodx/addons/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/easy_http:/opt/reapi ./servers-plugins/amxx/build.sh
```

`-Includes` / `AMXX_INCLUDES` = folderele cu `easy_http.inc` + `easy_http_json.inc` și, opțional, `reapi*.inc` (pe
Windows o listă sau separate prin `;`, pe Linux prin `:`). Rezultatul: `servers-plugins/amxx/build/gcs_bridge.amxx`.
Compilat cu `amxxpc` 1.10, pluginul folosește doar native care există și în AMX Mod X 1.9.

**Limitele Pawn** (de ținut minte la modificări): nativele care citesc un șir din plugin (`hash_string`,
`ezhttp_option_set_body`, `json_parse` dintr-un șir) se opresc la 16383 de caractere. De aceea corpul unei cereri rămâne
sub 16000 de caractere (lotul de evenimente se oprește înainte), un eveniment are cel mult 4095 (jucătorii unui
`round_end` pleacă în loturi de câte 8), iar răspunsurile se citesc din fișier (`json_parse(…, true)`), fără limită.

### Instalarea

1. `gcs_bridge.amxx` → `addons/amxmodx/plugins/`; în `addons/amxmodx/configs/plugins.ini` adaugă `gcs_bridge.amxx`
   **înaintea** `admincmd.amxx` (ca acțiunile adminilor să intre în jurnal înainte să le trateze AMX Mod X).
2. `gcs_bridge.cfg` → `addons/amxmodx/configs/` și completează `gcs_url` și `gcs_key`.
3. În `modules.ini`: `easy_http`. Repornește harta.
4. Adminii vin de la GCS: pluginul setează flag-urile la intrare (`users.ini` nu mai e necesar pentru ei; flag-urile
   date de `users.ini` sunt înlocuite, deci adminii se adaugă în ACP înainte). Adminii pe nume + parolă pun parola în
   setinfo: `setinfo _pw parola` (câmpul se schimbă cu `gcs_password_field`).

### Comenzi

| Comandă | Drept | Ce face |
|---|---|---|
| `gcs_ban <țintă> <minute> [motiv]` / `amx_ban` | `d` (sau `v` doar temporar) | ban pe acest server |
| `gcs_gban <țintă> <minute> [motiv]` | `d` | ban pe toate serverele (doar dacă GCS te cunoaște ca admin pe toate) |
| `gcs_unban <authid \| ip> [motiv]` / `amx_unban` | `d` | ridică banul |
| `gcs_mute` / `gcs_gag <țintă> <minute> [motiv]` | `i` | mute vocal / gag |
| `gcs_unmute` / `gcs_ungag <țintă>` | `i` | ridică mute-ul / gag-ul |
| `gcs_match <start\|live\|halftime\|end\|abort>` | `h` | meciul mix urmărit de GCS |
| `gcs_sync` | `l` | trage acum listele de la site |
| `say /gcs COD` | oricine | leagă identitatea non-Steam de contul de pe site (codul din Setări → Cont) |
| `say /ready`, `say /unready` | oricine, cu `gcs_mix_ready 1` | ready-up-ul meciului mix |

Alte pluginuri de mix pot conduce meciul prin `gcs_bridge.inc` (`gcs_mix_command`, `gcs_mix_state`,
`gcs_queue_event`, forward-urile `gcs_on_match_state` și `gcs_on_player_linked`).

## Counter-Strike 2 (CounterStrikeSharp)

### Cerințe pe server

- **Metamod:Source 2** și **CounterStrikeSharp** (cu runtime-ul .NET inclus), din pagina oficială a proiectului
  CounterStrikeSharp (GitHub, Releases).

### Compilarea

Necesită **.NET SDK 8**: <https://dotnet.microsoft.com/download/dotnet/8.0> (sau scriptul oficial `dotnet-install`
cu `-Channel 8.0 -InstallDir <folder>`, fără instalare în sistem). Pachetul `CounterStrikeSharp.API` vine din NuGet la
prima compilare, în versiunea fixă din `GcsBridge.csproj`: **1.0.368**, ultima pentru net8.0 (de la 1.0.369 pachetul
cere net10.0, deci .NET SDK 10). Pluginul net8.0 rulează și pe CounterStrikeSharp-ul nou, cu runtime-ul .NET 10.

```powershell
.\servers-plugins\cs2\build.ps1 [-Dotnet "C:\tools\dotnet8\dotnet.exe"]
```

```sh
[DOTNET_EXE=/opt/dotnet8/dotnet] ./servers-plugins/cs2/build.sh
```

Rezultatul: `servers-plugins/cs2/GcsBridge/bin/Release/net8.0/GcsBridge.dll` (pe server ajung doar `GcsBridge.dll` și,
opțional, `GcsBridge.pdb`; CounterStrikeSharp își aduce singur API-ul).

### Instalarea

1. `GcsBridge.dll` → `addons/counterstrikesharp/plugins/GcsBridge/`.
2. La prima pornire se creează `addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json`; completează
   `Url` și `Key`, apoi `css_plugins reload GcsBridge` (sau schimbă harta).
3. Adminii și VIP-ul vin de la GCS ca permisiuni CounterStrikeSharp (`@css/*`, plus `@gcs/custom_a`…`@gcs/custom_h`
   și `@gcs/tempban`), cu imunitatea lor. Permisiunile din `configs/admins.json` ale unui jucător sunt înlocuite la
   conectare, deci adminii se adaugă în ACP înainte.

### Comenzi

| Comandă (chat: `!…` sau `/…`) | Permisiune | Ce face |
|---|---|---|
| `css_gcsban` / `css_gcsgban <țintă> <minute> [motiv]` | `@css/ban` (sau `@gcs/tempban` doar temporar) | ban pe acest server / pe toate |
| `css_gcsunban <SteamID64 \| IP> [motiv]` | `@css/unban` | ridică banul |
| `css_gcsmute` / `css_gcsgag <țintă> <minute> [motiv]` | `@css/chat` | mute vocal / gag |
| `css_gcsunmute` / `css_gcsungag <țintă>` | `@css/chat` | ridică mute-ul / gag-ul |
| `css_gcskick <țintă> [motiv]` | `@css/kick` | kick, cu intrare în jurnalul GCS |
| `css_gcsmatch <start\|live\|halftime\|end\|abort>` | `@css/config` | meciul mix urmărit de GCS |
| `!gcs COD` | oricine | legarea identității (pe CS2 contul Steam se leagă de pe site) |
| `!ready`, `!unready` | oricine, cu `MixReady: true` | ready-up-ul meciului mix |

## Securitate

- Cheia e pe server: se rotește (cea veche mai merge 10 minute) și se revocă din ACP. O cheie furată poate scrie
  statistici false și poate raporta bannuri în numele serverului; bannurile globale venite din joc cer un admin cunoscut
  de GCS pe toate serverele.
- Adminii membri primesc drepturile doar pe identitățile Steam (dovedite). ID-urile non-Steam pot fi falsificate: se
  permit doar explicit, cu avertisment; pentru jucătorii non-Steam folosiți nume + parolă.
- Parolele adminilor pe nume nu circulă niciodată spre server: lista conține doar sarea și verificatorul
  (`SHA-256(salt:parolă)`). Dacă fișierul local al serverului e furat, o parolă slabă se poate ghici offline: folosiți
  parole lungi (butonul „Generează” din ACP) și rotiți-le.
- Textele venite din joc (nume, motive, hărți) sunt curățate de GCS și afișate doar ca text.

## Starea compilării

Ambele pluginuri se compilează fără erori și fără avertismente (2026-10-08):

| Plugin | Unelte | Rezultat |
|---|---|---|
| `amxx/gcs_bridge.sma` | `amxxpc` din AMX Mod X 1.10.0.5486; include-urile AmxxEasyHttp 1.5.0 și ReAPI 5.29.0.358 | `gcs_bridge.amxx`; nativele folosite există toate și în AMX Mod X 1.9 |
| `cs2/GcsBridge` | .NET SDK 8.0.425; `CounterStrikeSharp.API` 1.0.368 | `GcsBridge.dll` (net8.0) |

Semnarea e verificată cap la cap cu codul GCS (`signing.ts`) și cu serverul fals: clientul CS2 (`BridgeClient.cs`,
`EventQueue.cs`) și algoritmul `sha256-env` al pluginului AMX Mod X, inclusiv corectarea ceasului la `clock_skew`,
corpurile cu UTF-8, query-ul din cale, `If-None-Match` / 304 și o cheie greșită (refuzată). Pluginurile nu au rulat încă
pe un server de joc real.
