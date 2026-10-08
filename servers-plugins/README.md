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
- Modulul **AmxxEasyHttp** (HTTPS asincron, prin libcurl), de pe pagina oficială a proiectului (GitHub,
  „AmxxEasyHttp”, secțiunea Releases): `easy_http_amxx_i386.so` / `easy_http_amxx.dll` în `addons/amxmodx/modules/`
  și `easy_http.inc` la include-urile compilatorului.
- Opțional, **ReAPI** cu **Reunion** (pentru a deosebi clienții Steam de cei non-Steam): fără ele, în modul `mixed`
  toți jucătorii sunt non-Steam (Steam-ul nu se poate dovedi).

### Compilarea

Compilatorul (`amxxpc`) vine în pachetul oficial AMX Mod X (folderul `addons/amxmodx/scripting/`). Depozitul GCS nu
conține și nu descarcă compilatorul.

```powershell
# Windows
.\servers-plugins\amxx\build.ps1 -Compiler "C:\amxmodx\addons\amxmodx\scripting\amxxpc.exe" -Includes "C:\includes"
```

```sh
# Linux
AMXXPC=/opt/amxmodx/addons/amxmodx/scripting/amxxpc AMXX_INCLUDES=/opt/includes ./servers-plugins/amxx/build.sh
```

`-Includes` / `AMXX_INCLUDES` = folderul cu `easy_http.inc` (și `reapi.inc`, dacă folosești ReAPI). Rezultatul:
`servers-plugins/amxx/build/gcs_bridge.amxx`. Se poate compila și cu compilatorul online al AMX Mod X, încărcând
`gcs_bridge.sma` împreună cu include-urile.

### Instalarea

1. `gcs_bridge.amxx` → `addons/amxmodx/plugins/`; în `addons/amxmodx/configs/plugins.ini` adaugă `gcs_bridge.amxx`
   **înaintea** `admincmd.amxx` (ca acțiunile adminilor să intre în jurnal înainte să le trateze AMX Mod X).
2. `gcs_bridge.cfg` → `addons/amxmodx/configs/` și completează `gcs_url` și `gcs_key`.
3. În `modules.ini`: `easy_http`. Repornește harta.
4. Adminii vin de la GCS: pluginul setează flag-urile la intrare (`users.ini` nu mai e necesar pentru ei). Adminii pe
   nume + parolă pun parola în setinfo: `setinfo _pw parola` (câmpul se schimbă cu `gcs_password_field`).

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

Necesită **.NET SDK 8**: <https://dotnet.microsoft.com/download/dotnet/8.0>. Pachetul `CounterStrikeSharp.API` vine
din NuGet la prima compilare.

```powershell
.\servers-plugins\cs2\build.ps1
```

```sh
./servers-plugins/cs2/build.sh
```

Rezultatul: `servers-plugins/cs2/GcsBridge/bin/Release/net8.0/GcsBridge.dll`.

### Instalarea

1. `GcsBridge.dll` → `addons/counterstrikesharp/plugins/GcsBridge/`.
2. La prima pornire se creează `addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json`; completează
   `Url` și `Key`, apoi `css_plugins reload GcsBridge` (sau schimbă harta).
3. Adminii și VIP-ul vin de la GCS ca permisiuni CounterStrikeSharp (`@css/*`, plus `@gcs/custom_a`…`@gcs/custom_h`
   și `@gcs/tempban`), cu imunitatea lor.

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

Sursele sunt scrise după API-urile documentate ale AMX Mod X 1.9 / 1.10, AmxxEasyHttp și CounterStrikeSharp, dar nu au
fost compilate încă: compilatorul AMX Mod X și .NET SDK nu sunt instalate pe mașina de dezvoltare și se descarcă doar
cu acordul proprietarului. Protocolul e verificat complet de testele GCS cu serverul fals (`mock/`).
