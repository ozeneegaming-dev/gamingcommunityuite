# Servere: puntea cu serverele de joc („GCS Server Bridge”), partea A

- **Data:** 2026-10-08
- **Cererea proprietarului:** extensia aplicației **Servere**: pluginuri pe serverele de joc (CS 1.6 cu AMX Mod X, CS2
  cu cel mai folosit framework) care vorbesc cu GCS printr-un protocol HTTPS JSON: heartbeat, evenimente (ucideri,
  runde, conectări, acțiuni de admin, meciuri mix), liste trase de server (admini, bannuri, mute / gag, VIP). Pe site:
  adminii serverelor cu flag-uri, bannuri și comunicații (mute vocal / gag chat) cu scop „acest server” sau „toate
  serverele”, contestații și reclamații, VIP pe servere, statistici pe jucător și pe server, meciuri mix 5v5 cu ELO,
  prezența adminilor, catalogul hărților.
- **Ce intră în partea A (acesta):** modelul de date, serviciile, protocolul (rutele API), joburile, paginile ACP,
  pluginurile (surse + instrucțiuni de compilare), serverul fals (mock) și testele. **Partea B** (imediat după) face
  paginile publice ale site-ului (profilul jucătorului, clasamente, meciuri, lista bannurilor, contestații) pe
  serviciile de aici (§17).
- **Regula de bază:** tot ce ține de servere stă **doar în aplicația Servere** (`packages/modules/src/servers`). Alte
  aplicații (Clanuri) doar citesc prin interfețele publice (`GcsPlayerStatsProvider`).
- **Referințe:** specul Serverelor (`2026-10-07-servere.md`), specul Clanurilor §15 (statisticile citite de clanuri),
  specul antetelor (`2026-10-07-antete-titluri.md`), specul principal §6 (permisiuni) și §12 (ACP, jurnalul).

## 1. Principii

1. **Serverul de joc e un client autentificat, nu un utilizator.** Fiecare server are chei API proprii; o cheie poate
   scrie doar date ale serverului ei.
2. **Totul e idempotent.** Pluginul retrimite până primește confirmarea; fiecare eveniment are un id, iar GCS îl
   aplică o singură dată.
3. **Pluginul funcționează și fără site.** Listele (admini, bannuri, comunicații, VIP) se păstrează local pe server;
   site-ul căzut nu oprește adminii și nici aplicarea bannurilor.
4. **Datele de la serverele de joc sunt neîncredere** (nume, hărți, motive): se curăță ca la statusul serverelor
   (`cleanGameText`) și se afișează doar ca text.
5. **Identitatea jucătorului e generică** (§3): Steam, non-Steam sau nume, fiecare cu un nivel de încredere. Nimic
   important (admin, VIP, ban) nu se leagă de o identitate mai slabă decât e nevoie.

## 2. Jocurile și pluginurile

| Joc | Framework | Pluginul | HTTP | Licența pluginului |
|---|---|---|---|---|
| Counter-Strike 1.6 | AMX Mod X 1.9 / 1.10 (+ ReHLDS / ReAPI / Reunion opționale) | `servers-plugins/amxx/gcs_bridge.sma` (Pawn) | modulul **AmxxEasyHttp** (HTTPS prin libcurl, asincron) | GPL-3.0-or-later |
| Counter-Strike 2 | **CounterStrikeSharp** (C#, .NET 8, peste Metamod:Source 2) | `servers-plugins/cs2/GcsBridge` | `HttpClient` din .NET | MIT |

- **AMX Mod X:** pluginurile Pawn sunt lucrări derivate din include-urile AMXX (GPLv3 sau ulterioară, cu excepția de
  dublă licențiere pentru pluginuri); pluginul nostru e GPL-3.0-or-later. Modulul HTTP (AmxxEasyHttp) e MIT. JSON-ul
  folosește nativele incluse în AMXX ≥ 1.9 (`json_*`), hash-urile `hash_string(…, Hash_Sha256, …)`.
- **CounterStrikeSharp:** framework-ul e GPL-3.0 cu o excepție explicită: pluginurile pot fi publicate sub MIT. Alegem
  MIT.
- **Licența GCS nu e afectată:** pluginurile sunt programe separate care vorbesc HTTP cu site-ul; nu se leagă de codul
  GCS și nici GCS de ele.
- **Fără compilatoare descărcate de noi:** în depozit stau sursele, scripturile de compilare (care rulează doar dacă
  găsesc compilatorul) și documentația (`servers-plugins/README.md`), cu sursele oficiale de descărcare.

## 3. Identitatea jucătorului

### 3.1 Tipurile și încrederea

Un **jucător** (`game_players`) e o identitate de joc: `(kind, value)`, unică. Există și fără cont pe site.

| `kind` | `value` (normalizat) | Încredere (`trust`) | De unde vine |
|---|---|---|---|
| `STEAM` | SteamID64 (17 cifre, `7656119…`) | `HIGH` | CS2 (mereu); CS 1.6 când stratul de autentificare confirmă Steam (vezi 3.2) |
| `NONSTEAM` | ID-ul raportat de emulator, canonic: `STEAM_0:Y:Z` sau `VALVE_0:Y:Z` | `MEDIUM` | CS 1.6 cu clienți non-Steam (Reunion, dproto și emulatoarele lor) |
| `NAME` | numele, normalizat (NFKC, fără coduri de culoare, spații comprimate, litere mici), 1–32 de caractere | `LOW` | ultimul fallback, doar pe serverele care îl permit (`nameIds`) |

- O identitate `NONSTEAM` cu aceleași cifre ca un SteamID real **e altă identitate** (alt `kind`): nu se confundă
  niciodată cu contul Steam.
- **ID-urile care nu sunt identități** (respinse oricând, de la orice server): `STEAM_ID_LAN`, `VALVE_ID_LAN`,
  `STEAM_ID_PENDING`, `VALVE_ID_PENDING`, `STEAM_666:88:666`, `BOT`, `HLTV`, `UNKNOWN`, `4294967295`, șirul gol, orice
  formă invalidă. Un jucător cu un astfel de ID devine identitate `NAME` (dacă serverul permite) sau nu e urmărit deloc.
- **Numele implicite** (`player`, `unnamed`, `unconnected`) nu devin identități `NAME`.
- Boții și HLTV-ul nu sunt urmăriți.

### 3.2 Cum se stabilește identitatea (server-side, `resolveIdentity`)

Pluginul trimite pentru fiecare jucător o **referință** (`player`, §6.3): `auth` (ce dă serverul), `steam`
(`true` / `false` / lipsă: ce știe pluginul despre autentificare), `name`, `ip`. GCS decide, nu pluginul:

1. **CS2:** `auth` trebuie să fie un SteamID (orice formă) → `STEAM`. Altfel jucătorul nu e urmărit.
2. **CS 1.6**, după modul serverului (`identityMode`, setat în ACP pe fiecare server):
   - `auth` de forma `STEAM_X:Y:Z`:
     - `steam: true` (pluginul a verificat cu ReAPI / Reunion că e un client Steam real) → `STEAM`;
     - `steam: false` → `NONSTEAM`;
     - `steam` lipsă: modul `steam` (serverul primește doar clienți Steam, fără emulator) → `STEAM`; modul `mixed`
       (implicit) → `NONSTEAM`.
   - `auth` de forma `VALVE_X:Y:Z` → `NONSTEAM`.
   - restul (LAN, PENDING, invalid) → `NAME` dacă serverul are `nameIds` pornit, altfel neurmărit.
3. Pe un server cu `identityMode = mixed` **fără** ReAPI / Reunion, toți jucătorii sunt `NONSTEAM` (inclusiv cei cu
   Steam): e corect (nu putem dovedi Steam-ul), iar ACP-ul arată avertismentul.

**Conversiile SteamID** (`servers/bridge/steamid.ts`): `STEAM_X:Y:Z` ↔ SteamID64 ↔ `[U:1:N]` (și `U:1:N`), cu
`accountId = Z × 2 + Y`, `SteamID64 = 76561197960265728 + accountId`; universul `X` (0 sau 1) e ignorat la intrare;
ieșirea Steam2 folosește `STEAM_0` pentru CS 1.6 și `STEAM_1` pentru CS2.

### 3.3 Legarea de contul de pe site

Un membru poate avea **mai multe identități** (`game_players.userId`); o identitate are cel mult un membru.

- **Steam (automat):** contul Steam conectat (`accounts`, `providerId = steam`) leagă identitatea `STEAM` cu același
  SteamID64 (`linkSource = STEAM`): la prima apariție a identității, la conectarea Steam-ului pe site (login sau
  „Conectează Steam”), la dezlegare se dezleagă, iar un job de reconciliere (la 10 minute) repară orice diferență.
  O identitate Steam **nu** se poate lega prin cod (doar prin login-ul Steam de pe site, care dovedește contul).
- **Non-Steam și nume (cod de legare):**
  1. membrul cere un cod pe site (Setări → Cont, partea B): 6 caractere din alfabetul `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
     (fără 0/O, 1/I), **valabil 10 minute**, de unică folosință; un cod nou îl anulează pe cel vechi; max 5 coduri pe
     oră pe membru; în baza de date stă doar hash-ul codului (SHA-256);
  2. jucătorul scrie în joc **`/gcs ABC123`** (sau `say /gcs ABC123`); pluginul trimite `POST /link` cu referința
     jucătorului și codul;
  3. GCS verifică: codul există, nu e folosit, nu a expirat; identitatea nu e `STEAM`, nu e legată de alt membru; →
     leagă identitatea (`linkSource = CODE`), marchează codul folosit, scrie în jurnal, notifică membrul;
  4. pluginul îi arată jucătorului rezultatul („Legat de contul X” / eroarea).
  - Încercările cu cod greșit: max 10 pe minut pe server și 5 pe minut pe identitate (forța brută: 31⁶ ≈ 887 milioane
    de coduri, valabile 10 minute).
- **Dezlegarea:** membrul își dezleagă identitățile non-Steam din setări; staff-ul (dreptul `servers.players_manage`)
  leagă o identitate de orice membru sau o dezleagă (`linkSource = STAFF`). Statisticile rămân pe identitate.
- **Identitățile `NAME` legate** se arată pe profil ca „neverificate”: oricine poate folosi un nume.

### 3.4 Modelul de încredere și limitele lui (de citit înainte de a da drepturi)

- **Steam (HIGH):** dovedit de Steam la conectare; sigur pentru admini, VIP, bannuri.
- **Non-Steam (MEDIUM):** ID-ul e generat de emulator din date ale calculatorului (HWID, cheie, uneori IP-ul). **Se
  poate schimba** (alt PC, reinstalare, alt emulator, altă „sare” a serverului) și **se poate falsifica** de un client
  modificat. Potrivit pentru statistici, VIP și bannuri (cu IP-ul ca plasă), **nu** pentru admini: un admin pe ID
  non-Steam poate fi impersonat de cine îi află ID-ul. De aceea adminii membri se aplică implicit doar pe identitățile
  Steam ale membrului; ID-urile non-Steam doar cu opțiunea explicită „Permite ID-urile non-Steam” (cu avertisment), iar
  pentru non-Steam recomandarea e **nume + parolă** (§7.3).
- **Nume (LOW):** oricine poate intra cu orice nume. Statisticile pe nume sunt orientative; bannurile pe nume se aplică
  doar jucătorilor non-Steam (un jucător Steam nu poate fi banat prin numele lui). Adminii pe nume cer parola.
- **IP:** se schimbă (IP dinamic, VPN) și poate fi comun (aceeași rețea): bannurile pe IP sunt o plasă de siguranță,
  nu o identitate; IP-urile se văd doar cu `servers.view_ips`.
- **Serverul însuși:** o cheie API furată poate scrie statistici false și poate raporta bannuri în numele serverului;
  de aceea cheile sunt pe server, se rotesc și se revocă din ACP, iar bannurile globale venite din joc cer un admin
  cunoscut de GCS pe toate serverele (§8.3).

## 4. Modelul de date

Migrarea **`20261109000000_server_bridge`**. Toate tabelele sunt ale aplicației Servere.

### 4.1 Coloane noi în `game_servers`

| Câmp | Tip | Note |
|---|---|---|
| `identityMode` | text, implicit `mixed` | `steam` (doar clienți Steam) sau `mixed` (emulator non-Steam), §3.2 |
| `nameIds` | bool, implicit `false` | jucătorii fără ID valid devin identități `NAME` |
| `isMix` | bool, implicit `false` | server de meciuri mix 5v5 (pagina meciurilor, ELO) |
| `bridgeSeenAt` | timestamp, opțional | ultimul heartbeat |
| `bridgePlugin` | text, opțional | `gcs-amxx/1.0.0`, `gcs-cs2/1.0.0` (curățat, max 64) |

### 4.2 `game_server_keys`

`id`, `serverId` (FK, cascadă), `keyId` (text unic, 12 caractere `[a-z0-9]`, public), `signingKey` (text: **hash-ul**
secretului, SHA-256 hex, **sigilat** cu `sealSecret` / `GCS_SECRET`), `label`, `createdById`, `createdAt`,
`lastUsedAt`, `lastIp`, `revokedAt`, `expiresAt` (perioada de grație după rotire). Max 5 chei active pe server.

### 4.3 `game_players` (identitățile)

`id`, `kind` (`STEAM` / `NONSTEAM` / `NAME`), `value`, `trust` (`HIGH` / `MEDIUM` / `LOW`), `userId` (FK `SET NULL`),
`linkSource` (`STEAM` / `CODE` / `STAFF`, opțional), `linkedAt`, `name` (ultimul nume văzut, max 32), `firstSeenAt`,
`lastSeenAt`, `lastServerId` (FK `SET NULL`). Unic `(kind, value)`; indexuri `userId`, `lastSeenAt`.

### 4.4 `game_link_codes`

`id`, `userId` (FK, cascadă), `codeHash` (unic), `expiresAt`, `usedAt`, `playerId` (FK `SET NULL`), `createdAt`.

### 4.5 `game_sessions` (conectările)

`id` (bigint), `serverId`, `playerId`, `adminId` (FK `game_admins`, `SET NULL`: adminul recunoscut în sesiune), `name`,
`ip`, `connectedAt`, `disconnectedAt` (gol = online), `seconds`. Indexuri `(serverId, disconnectedAt)`,
`(playerId, connectedAt)`, `(adminId, connectedAt)`.

### 4.6 Statisticile

- **`game_player_stats`** (cheie `(playerId, serverId)`): `kills`, `deaths`, `headshots`, `assists`, `teamkills`,
  `suicides`, `shots`, `hits`, `damage`, `playtime` (s), `rounds`, `roundsWon`, `score` (= ucideri − decese − ucideri
  în echipă), `rank` (locul pe server, calculat de job), `lastSeenAt`.
- **`game_weapon_stats`** (cheie `(playerId, serverId, weapon)`): `kills`, `deaths`, `headshots`, `shots`, `hits`,
  `damage`.
- **`game_map_stats`** (cheie `(playerId, serverId, map)`): `kills`, `deaths`, `headshots`, `playtime`, `rounds`,
  `roundsWon`.
- **`game_bridge_events`** (cheie `(serverId, eventId)`, `createdAt`): id-urile evenimentelor aplicate (idempotența),
  păstrate 14 zile.

### 4.7 Adminii

- **`game_admin_presets`**: `id`, `name`, `flags` (litere AMXX), `immunity` (0–100), `position`. Seed: **Moderator**
  (`bceiju`, 10), **Admin** (`bcdefgijmnouv`, 50), **Head admin** (`abcdefghijklmnopqrstuv`, 90). Editabile.
- **`game_admins`**: `id`, `subject` (`USER` / `PLAYER` / `NAME`), `userId` (FK cascadă), `playerId` (FK cascadă),
  `name` + `nameNormalized` (subiect `NAME`), `passwordSalt`, `passwordVerifier` (§7.3), `serverId` (FK cascadă; gol =
  toate serverele), `presetId` (FK `SET NULL`), `flags` / `immunity` (opționale: suprascriu presetul), `allowNonSteam`,
  `note`, `expiresAt`, `createdById`, `createdAt`, `updatedAt`.

### 4.8 Sancțiunile (bannuri și comunicații)

**`game_sanctions`**: `id`, `type` (`BAN` / `MUTE` / `GAG`), `scope` (`SERVER` / `GLOBAL`), `serverId` (serverul
sancțiunii la `SERVER`; serverul de origine la `GLOBAL`, opțional), `playerId` (FK `SET NULL`), `targetKind` /
`targetValue` (identitatea țintă, păstrată chiar dacă jucătorul dispare), `ip`, `name`, `reason`, `createdAt`,
`expiresAt` (gol = permanent), `adminUserId`, `adminPlayerId`, `adminName`, `source` (`SITE` / `GAME`), `unbannedAt`,
`unbannedById`, `unbannedByName`, `unbanReason`, `evidence` (JSON: `[{ url }]`, max 10 adrese https), `revision`
(bigint din secvența `game_sync_revision`, se schimbă la orice modificare), `updatedAt`. Indexuri pe `revision`,
`playerId`, `(targetKind, targetValue)`, `ip`, `(type, expiresAt)`. Dovezile încărcate sunt atașamente
(`servers.sanction`, legate de id).

**Activă** = `unbannedAt` gol și (`expiresAt` gol sau în viitor). **Se aplică pe serverul S** = `GLOBAL` sau
`serverId = S`.

### 4.9 Jurnalul acțiunilor din joc

**`game_admin_actions`**: `id`, `serverId`, `adminPlayerId`, `adminUserId`, `adminId`, `adminName`, `action` (`ban`,
`unban`, `kick`, `slay`, `slap`, `mute`, `unmute`, `gag`, `ungag`, `map`, `other`), `targetPlayerId`, `targetName`,
`reason`, `details` (JSON, max 2 KB), `sanctionId`, `at`. Indexuri `(serverId, at)`, `(adminId, at)`,
`(adminUserId, at)`.

### 4.10 VIP pe servere

**`game_vip_mappings`**: `id`, `serverId` (FK cascadă), `groupId` (grup VIP, FK cascadă), `enabled`, `flags` (litere
AMXX, implicit `b`). Unic `(serverId, groupId)`.

### 4.11 Meciurile mix și ELO

- **`game_matches`**: `id`, `serverId`, `externalId` (id-ul meciului dat de plugin, unic pe server), `map`, `status`
  (`WARMUP` / `LIVE` / `HALFTIME` / `ENDED` / `ABORTED`), `teamAName`, `teamBName`, `scoreA`, `scoreB`, `round`,
  `winner` (`A` / `B` / `DRAW`, la final), `startedAt`, `liveAt`, `endedAt`, `rated` (ELO aplicat), `createdAt`,
  `updatedAt`.
- **`game_match_players`** (cheie `(matchId, playerId)`): `team` (`A` / `B`), `name`, `kills`, `deaths`, `assists`,
  `headshots`, `damage`, `mvps`, `eloBefore`, `eloAfter`.
- **`game_match_rounds`** (cheie `(matchId, number)`): `winner`, `scoreA`, `scoreB`, `reason`, `endedAt`.
- **`game_ratings`** (cheie `playerId`): `elo`, `matches`, `wins`, `losses`, `draws`, `peak`, `updatedAt`.

### 4.12 Contestații și reclamații

- **`game_tickets`**: `id`, `kind` (`APPEAL` contestație de ban, `CHEATER` reclamație de cheater, `ADMIN` reclamație
  de admin), `status` (`OPEN` deschis, `REVIEW` în analiză, `ACCEPTED` acceptat, `REJECTED` respins, `CLOSED` închis),
  `authorId`, `serverId`, `sanctionId`, `targetPlayerId`, `targetUserId`, `targetAdminId`, `targetName`, `title`,
  `contentJson` / `contentHtml` (documentul editorului, randat ca postările), `evidence` (JSON `[{ url }]`),
  `assigneeId`, `createdAt`, `updatedAt`, `lastActivityAt`, `closedAt`.
- **`game_ticket_messages`**: `id`, `ticketId`, `authorId`, `kind` (`MESSAGE` / `STATUS` / `ASSIGN`), `contentJson`,
  `contentHtml`, `internal` (notă vizibilă doar staff-ului), `data` (JSON: statusul vechi / nou, responsabilul),
  `createdAt`.

### 4.13 Hărțile

**`game_maps`**: `id`, `game`, `name` (numele hărții, litere mici, `[a-z0-9_.-]`, max 64), `imageId` (atașament
`servers.map`, public), `source` (`UPLOAD` / `TEMPLATE`), `fetchedAt`, `fetchError`, `attempts`, `nextFetchAt`,
`createdAt`, `updatedAt`. Unic `(game, name)`.

### 4.14 Redis

- `gcs:bridge:nonce:{keyId}:{nonce}` (10 min): protecția la reluare.
- `gcs:bridge:roster:{serverId}`: jucătorii din ultimul heartbeat (JSON, 5 min).
- `gcs:bridge:match:{serverId}`: starea live a meciului mix (JSON, 6 h).
- `gcs:bridge:version`: versiunea listelor (crește la orice schimbare de admini, presetări, VIP, legături); cache-ul
  listelor `gcs:bridge:list:{tip}:{serverId}:{versiune}` (60 s).

## 5. Securitatea protocolului

### 5.1 Cheile

- ACP → Gaming → Servere → un server → **Plugin și chei API**: „Creează cheie” (eticheta opțională), „Rotește”,
  „Revocă”. Cheia se arată **o singură dată**: `gcs1.<keyId>.<secret>` (`secret` = 32 de octeți aleatori, base64url).
- În baza de date: `keyId` (public) și **hash-ul** secretului (`K = hex(SHA-256(secret))`), sigilat cu `GCS_SECRET`
  (AES-256-GCM): o copie a bazei de date nu ajunge pentru a semna cereri, iar secretul însuși nu e păstrat nicăieri.
- **Rotirea** creează o cheie nouă și lasă cheia veche valabilă încă **10 minute** (cât să se schimbe configul pe
  server); **revocarea** e imediată. Jurnal: `servers.key.create`, `servers.key.rotate`, `servers.key.revoke`.

### 5.2 Semnarea cererilor

Secretul nu circulă pe rețea. Fiecare cerere are anteturile:

| Antet | Valoare |
|---|---|
| `X-GCS-Key` | `keyId` |
| `X-GCS-Timestamp` | timpul Unix (secunde) |
| `X-GCS-Nonce` | 16–64 caractere `[A-Za-z0-9_-]`, unic pe cerere |
| `X-GCS-Signature` | `hmac-sha256=<hex>` sau `sha256-env=<hex>` |

Șirul canonic: `METODĂ \n CALE \n TIMESTAMP \n NONCE \n hex(SHA-256(corp))`, unde **CALE** = partea de după
`/api/servers/bridge/v1` (cu query-ul, exact cum a fost trimis; ex. `/sanctions?since=120`), iar corpul gol are hash-ul
șirului gol.

- `hmac-sha256` = HMAC-SHA256 cu cheia `K` (cei 64 de caractere hex, ca octeți ASCII) peste șirul canonic. Folosit de
  pluginul CS2 și de serverul fals.
- `sha256-env` = `SHA-256(K + "\n" + canonic + "\n" + K)` („plic”: cheia la ambele capete, deci fără extensia de
  lungime). Pentru runtime-uri fără HMAC (AMX Mod X are doar `hash_string`).

### 5.3 Verificarea (în ordine)

1. Aplicația Servere activă (altfel 404).
2. Corpul ≤ **512 KB** (413).
3. Limita eșecurilor de autentificare pe IP: **30 / minut** (429).
4. Anteturile prezente și bine formate (401 `missing_auth`).
5. Cheia există, nu e revocată, nu a expirat (401 `unauthorized` — același cod ca semnătura greșită, ca să nu se
   poată ghici cheile).
6. **Ceasul:** `|acum − timestamp| ≤ 300 s`, altfel 401 `clock_skew` (răspunsul are `serverTime`, pluginul își
   corectează decalajul și retrimite).
7. Semnătura, comparată în timp constant (401 `unauthorized`).
8. **Reluarea:** nonce-ul se rezervă în Redis (`SET NX`, 10 minute); folosit deja → 409 `replay`.
9. Serverul activat (403 `server_disabled`).
10. Limita pe cheie: **240 de cereri / minut** (429 cu `Retry-After`).

Fiecare răspuns (și cele de eroare după pasul 4) are `serverTime` (Unix, secunde) și antetul `X-GCS-Time`. Pluginul
ține decalajul `offset = serverTime − ceasul local` și trimite timpii evenimentelor în ceasul GCS. GCS taie timpii
evenimentelor la intervalul `[acum − 7 zile, acum + 60 s]`.

### 5.4 Limite

| Ce | Limită |
|---|---|
| Corpul unei cereri | 512 KB |
| Evenimente pe lot | 500 |
| Jucători în heartbeat | 128 |
| Id-ul unui eveniment | 1–64 caractere `[A-Za-z0-9_.:-]` |
| Nume / hartă / motiv / armă | 32 / 64 / 200 / 32 de caractere (curățate) |
| Pagina de sancțiuni | 1000 de rânduri |
| Chei active pe server | 5 |
| Coduri de legare | 5 / oră / membru; 10 încercări / minut / server |

## 6. Protocolul (v1)

Baza: `{site}/api/servers/bridge/v1`. JSON UTF-8. Pluginul folosește HTTPS (HTTP doar în LAN, la alegerea operatorului;
semnătura și nonce-ul protejează oricum cererile, dar nu confidențialitatea).

### 6.1 Ritmul recomandat (trimis de GCS în `config`)

| Ce | Interval |
|---|---|
| heartbeat | `servers.bridge_heartbeat` (implicit 30 s) |
| trimiterea evenimentelor | `servers.bridge_events` (implicit 10 s, sau la 100 de evenimente) |
| tragerea listelor | doar când `versions` din heartbeat diferă de ce are pluginul (plus o dată la 10 minute) |

**Reîncercările:** la eroare de rețea sau 5xx, pluginul păstrează lotul și reîncearcă cu backoff exponențial (5 s,
10 s, 20 s … max 5 minute). La 4xx (în afară de 401 `clock_skew`, 409 `replay`, 429) lotul se aruncă (e invalid; a
reîncerca nu ajută). Evenimentele netrimise se salvează pe disc la schimbarea hărții / oprire și se retrimit (aceleași
id-uri).

### 6.2 `POST /heartbeat`

```json
{
  "plugin": "gcs-amxx/1.0.0",
  "map": "de_dust2",
  "maxPlayers": 32,
  "players": [
    { "auth": "STEAM_0:1:12345", "steam": true, "name": "Ion", "ip": "198.51.100.7", "team": "CT", "score": 12, "time": 840 }
  ],
  "match": null
}
```

Răspuns:

```json
{
  "ok": true,
  "serverTime": 1791460800,
  "config": { "heartbeat": 30, "events": 10, "identityMode": "mixed", "nameIds": false, "isMix": false, "linkCommand": "/gcs" },
  "versions": { "admins": "a1b2c3d4", "vip": "e5f6a7b8", "sanctions": 1287 }
}
```

Efecte: `bridgeSeenAt`, versiunea pluginului, lista jucătorilor online (Redis), reconcilierea sesiunilor (un jucător
din listă fără sesiune deschisă → sesiune nouă; o sesiune deschisă al cărei jucător lipsește → închisă), harta văzută
(catalogul hărților), starea live a meciului dacă `match` e trimis.

### 6.3 Referința unui jucător

```json
{ "auth": "STEAM_0:1:12345", "steam": true, "name": "Ion", "ip": "198.51.100.7" }
```

`auth` poate fi `STEAM_X:Y:Z`, `VALVE_X:Y:Z`, SteamID64, `[U:1:N]` sau un ID LAN / gol. `ip` fără port (IPv4 sau
IPv6); un IP invalid se ignoră. `bot: true` → ignorat.

### 6.4 `POST /events`

```json
{ "events": [ { "id": "k7Qp-000042", "type": "kill", "at": 1791460790, "killer": { "...": "..." }, "victim": { "...": "..." }, "weapon": "ak47", "headshot": true } ] }
```

Răspuns: `{ "serverTime": …, "results": [ { "id": "k7Qp-000042", "status": "ok" } ] }` cu `status` = `ok`,
`duplicate` (aplicat deja; tot confirmare) sau `rejected` (+ `error`). Fiecare eveniment se aplică într-o tranzacție
împreună cu id-ul lui (exact o dată). Tipurile:

| `type` | Câmpuri | Efect |
|---|---|---|
| `connect` | `player` | identitatea (creată / actualizată), sesiune deschisă, ultima apariție |
| `disconnect` | `player`, `playtime?` (s) | sesiunea închisă; timpul de joc pe server și pe hartă |
| `map` | `map` | harta curentă (catalog) |
| `kill` | `killer?`, `victim`, `weapon`, `headshot`, `assister?`, `teamkill?` | ucideri / decese / headshot-uri / asistențe / sinucideri (fără `killer` sau `killer = victim`), pe server, armă și hartă |
| `weapon_stats` | `player`, `weapon`, `shots`, `hits`, `damage`, `headshots?` | deltele de precizie și damage (pe server și armă) |
| `round_end` | `winner` (`CT` / `T` / `draw`), `players?: [{ player, team }]` | rundele jucate / câștigate pe server și hartă |
| `admin_action` | `admin`, `action`, `target?`, `reason?`, `details?` | jurnalul acțiunilor din joc |
| `admin_login` | `player`, `adminId` | sesiunea jucătorului e a adminului (adminii nume + parolă) |
| `sanction` | `kind` (`ban` / `mute` / `gag`), `target` (+ `ip`, `name`), `minutes` (0 = permanent), `reason`, `scope` (`server` / `global`), `admin` | sancțiune nouă (`source = GAME`) + intrare în jurnal |
| `unsanction` | `kind`, `sanctionId?` sau `target`, `admin`, `reason?` | ridicarea sancțiunii (cea activă, pe acest server) |
| `match` | `match` (starea completă, §6.9) | meciul mix: creat / actualizat / încheiat |
| `match_round` | `matchId`, `round`, `winner` (`A` / `B`), `scoreA`, `scoreB`, `reason?` | istoricul rundelor meciului |

### 6.5 `GET /admins` (cu `If-None-Match`)

304 dacă ETag-ul e același. Altfel:

```json
{
  "etag": "a1b2c3d4",
  "admins": [
    { "id": 12, "auth": { "kind": "steam", "steamId64": "76561197960287930", "steam2": "STEAM_0:0:11101" }, "flags": "abcdefghijklmnopqrstuv", "immunity": 90, "permissions": ["@css/root"], "expiresAt": null, "label": "Head admin" },
    { "id": 15, "auth": { "kind": "nonsteam", "id": "STEAM_0:1:555" }, "flags": "bceiju", "immunity": 10, "permissions": ["@css/generic", "@css/kick"], "expiresAt": 1794052800, "label": "Moderator" },
    { "id": 19, "auth": { "kind": "name", "name": "Ion", "salt": "9f2c…", "verifier": "5e88…" }, "flags": "bcdefgijmnouv", "immunity": 50, "permissions": ["…"], "expiresAt": null, "label": "Admin" }
  ]
}
```

### 6.6 `GET /sanctions?since=<cursor>`

- `since=0` (sau lipsă): **sincronizare completă**, doar sancțiunile active care se aplică serverului, `full: true`.
- `since=N`: toate schimbările cu `revision > N` care privesc serverul: cele active (adăugate / modificate) și cele
  care nu mai trebuie aplicate (`active: false`: ridicate, expirate prin modificare, mutate pe alt server).
- Pagini de max 1000 de rânduri, în ordinea reviziei; `more: true` → pluginul cere din nou cu `since = cursor`.

```json
{
  "cursor": 1287, "full": false, "more": false, "serverTime": 1791460800,
  "sanctions": [
    { "id": 301, "type": "ban", "active": true, "auth": { "kind": "steam", "steamId64": "7656…", "steam2": "STEAM_0:1:42" }, "ip": "198.51.100.7", "name": null, "reason": "wallhack", "createdAt": 1791460000, "expiresAt": null, "admin": "Mara", "scope": "global" },
    { "id": 288, "active": false }
  ]
}
```

Expirarea naturală nu schimbă revizia: pluginul primește `expiresAt` (în ceasul GCS) și o aplică singur, corectat cu
decalajul. Un ban pe nume (`name` fără `auth`) se aplică doar jucătorilor care nu sunt `STEAM`.

### 6.7 `GET /vip` (cu `If-None-Match`)

```json
{ "etag": "e5f6a7b8", "vip": [ { "auth": { "kind": "steam", "steamId64": "7656…", "steam2": "STEAM_0:0:7" }, "flags": "bt", "permissions": ["@css/reservation", "@gcs/custom_h"], "expiresAt": 1794052800, "group": "VIP Gold" } ] }
```

### 6.8 `POST /check` și `POST /link`

- `/check` `{ "player": {…} }` → `{ "player": { "id": 55, "kind": "steam", "linked": true }, "ban": {…} | null,
  "mute": {…} | null, "gag": {…} | null, "admin": {…} | null, "vip": {…} | null }`: verificarea la conectare, proaspătă
  (pluginul o cere la conectare; dacă site-ul nu răspunde în 3 s, se bazează pe listele locale).
- `/link` `{ "player": {…}, "code": "ABC123" }` → `{ "ok": true, "user": "Mara" }` sau 4xx cu `error` =
  `invalid_code`, `expired_code`, `used_code`, `steam_use_site`, `no_identity`, `already_linked`, `rate_limited`.

### 6.9 Starea unui meci mix (`match`)

```json
{
  "id": "m-1791460000", "status": "live", "map": "de_mirage", "round": 7,
  "teams": { "A": { "name": "Echipa 1" }, "B": { "name": "Echipa 2" } },
  "score": { "A": 4, "B": 2 },
  "players": [
    { "player": { "auth": "STEAM_0:1:1", "steam": true, "name": "Ion" }, "team": "A", "kills": 9, "deaths": 4, "assists": 2, "headshots": 5, "damage": 912, "mvps": 2 }
  ]
}
```

Tranzițiile permise: `warmup → live`, `live → halftime`, `halftime → live`, `live → ended`, orice stare deschisă →
`aborted`; `ended` și `aborted` sunt finale. O tranziție invalidă (eveniment vechi sosit târziu) → `rejected` cu
`invalid_state` (confirmat, nu se reîncearcă). Echipele `A` / `B` rămân aceleași după pauză (`halftime` schimbă doar
părțile CT / T). Statisticile jucătorilor din ultima stare sunt totalurile finale. La `ended`: câștigătorul din scor,
ELO-ul (§10), notificarea live.

**Starea live** (Redis + realtime): la fiecare `match` / `match_round` / heartbeat cu `match`, GCS publică în camera
`servers:{serverId}` evenimentul `servers:match` și în camera `match:{matchId}` evenimentul `match:state`.

## 7. Adminii serverelor

### 7.1 Subiectul

| `subject` | Ce primește drepturile pe server |
|---|---|
| `USER` (membru GCS) | identitățile `STEAM` legate de membru; `NONSTEAM` doar cu `allowNonSteam` (avertisment); `NAME` niciodată |
| `PLAYER` (o identitate brută, cu notă) | acea identitate (`STEAM` sau `NONSTEAM`) |
| `NAME` (nume + parolă, clasic CS 1.6) | jucătorul cu numele respectiv **și** parola corectă în setinfo |

Un membru fără nicio identitate legată poate fi adăugat (ACP-ul avertizează): drepturile apar automat când își leagă
Steam-ul sau o identitate.

### 7.2 Flag-urile

- **Sursa de adevăr: literele AMXX** (`a`–`v`, `z`), ca în `users.ini`: `a` imunitate, `b` rezervare, `c` kick, `d` ban /
  unban, `e` slay / slap, `f` hartă, `g` cvar, `h` cfg, `i` chat (și mute / gag), `j` vot, `k` parola serverului, `l`
  rcon, `m`–`t` nivelurile personalizate A–H, `u` meniuri, `v` ban temporar, `z` utilizator.
- **CS2 (CounterStrikeSharp):** `permissions` se calculează din litere: `b → @css/reservation`, `c → @css/kick`,
  `d → @css/ban + @css/unban`, `e → @css/slay`, `f → @css/changemap`, `g → @css/cvar`, `h → @css/config`,
  `i → @css/chat`, `j → @css/vote`, `k → @css/password`, `l → @css/rcon`, `m`–`t → @gcs/custom_a`…`@gcs/custom_h`,
  `u → @css/generic`, `v → @gcs/tempban`; toate literele de admin (`a`–`v`) → `@css/root` în plus. Imunitatea
  (0–100) e numărul de imunitate al CounterStrikeSharp; `a` fără imunitate explicită → 100.
- **Efectiv** = flag-urile intrării, altfel ale presetului; la fel imunitatea. Mai multe intrări pentru aceeași
  identitate pe același server → reuniunea flag-urilor, imunitatea maximă, expirarea cea mai târzie.
- **Expirarea:** o intrare expirată dispare din listă (ETag nou) și pluginul o scoate; la expirare se scrie în jurnal
  (`servers.admin.expire`, jobul de 5 minute).

### 7.3 Nume + parolă fără parolă în clar înapoi

- Parola se scrie o singură dată în ACP (min 8 caractere; butonul „Generează” dă una aleatorie de 12) și nu se mai
  arată. GCS păstrează doar `salt` (16 octeți hex, nou la fiecare schimbare) și `verifier = hex(SHA-256(salt + ":" +
  parolă))`.
- Lista `/admins` trimite serverului `{ name, salt, verifier }`. Pluginul citește parola din setinfo-ul clientului
  (`_pw`, configurabil: `gcs_password_field`), calculează `SHA-256(salt:parolă)` și compară; **parola nu circulă
  niciodată de la GCS spre server** și nici nu e păstrată în clar.
- Funcționează și fără site (din lista locală). Numele se compară normalizat (ca identitatea `NAME`).
- Cu `gcs_name_protect 1` (implicit), cine intră cu numele unui admin fără parola corectă e dat afară („nume
  rezervat”), ca la `amx_mode 1`.
- **Limita:** verificatorul e un hash rapid; dacă fișierul local al serverului e furat, o parolă slabă se poate ghici
  offline. De aceea minimul de 8 caractere, generatorul și rotirea (o parolă nouă = sare nouă).

### 7.4 ACP → Gaming → Admini servere

Lista (filtru pe server, căutare), adăugarea / editarea (subiectul, serverul sau „toate serverele”, presetul sau
flag-uri proprii, imunitatea, expirarea, nota, „Permite ID-urile non-Steam”), ștergerea, presetările (listă editabilă).
Fiecare schimbare: `servers.admin.create` / `update` / `delete`, `servers.preset.*` în jurnal.

## 8. Sancțiunile

### 8.1 De pe site

- Cine: dreptul de grup **`servers.sanction`** (staff global, implicit Root Admin, Admin, Super moderator) pe orice
  server și scop; **sau** un admin de server (membru cu intrare `USER` în `game_admins`) pe serverele lui: ban
  permanent / temporar cu `d`, doar temporar (≤ `servers.tempban_max` minute, implicit 10080) cu `v`, mute / gag cu `i`;
  scopul `GLOBAL` cere o intrare pe toate serverele.
- Ținta: o identitate (după id-ul jucătorului sau un SteamID / ID non-Steam scris), un IP și / sau un nume (doar
  pentru non-Steam), cel puțin unul. Motivul (obligatoriu, max 200), durata în minute (0 = permanent), scopul, dovezile
  (adrese https și atașamente).
- Ridicarea (unban / unmute / ungag): motivul, cine, când. Modificarea: motivul, durata (de la data creării), scopul,
  dovezile. Toate cu revizie nouă (se propagă la servere) și jurnal (`servers.sanction.create` / `update` / `lift`).

### 8.2 Din joc

- Pluginul aplică imediat (kick / mute / gag local), apoi raportează evenimentul `sanction`; GCS creează sancțiunea
  (`source = GAME`), iar celelalte servere o primesc la următoarea tragere (dacă e globală).
- Adminul din joc: identitatea lui (dacă e cunoscută) și numele afișat. Ridicarea din joc: `unsanction`.

### 8.3 Scopul

- „Acest server” (`SERVER`) sau „Toate serverele” (`GLOBAL`), ales la fiecare sancțiune.
- Din joc, `global` se acceptă doar dacă adminul raportat e cunoscut de GCS (intrare activă pe **toate** serverele, cu
  `d` / `i`); altfel devine `server` (rezultatul are `note: "scope_downgraded"`).

### 8.4 Aplicarea pe server

- La conectare: pluginul verifică lista locală (identitate, IP, nume pentru non-Steam) și cere `/check` (3 s); un ban
  activ → kick cu motivul și durata rămasă. Mute → vocea oprită; gag → chat-ul blocat.
- La sincronizare: o sancțiune nouă pentru un jucător online se aplică imediat.

## 9. Statisticile

- **Pe jucător și server:** ucideri, decese, headshot-uri, K/D (`kills / max(1, deaths)`), precizia (`hits / shots`,
  doar dacă serverul trimite focurile), damage-ul, timpul de joc, ultima apariție și ultimul server, locul pe server.
- **Pe armă și pe hartă** (aceleași cifre, pe chei proprii).
- **Locul pe server** (`rank`): jobul `servers.bridge.ranks` (la 10 minute) ordonează jucătorii cu cel puțin
  `servers.rank_min_minutes` minute de joc (implicit 30) după `score = kills − deaths − teamkills`, apoi după ucideri;
  ceilalți nu au loc. Pe un membru cu mai multe identități se arată cel mai bun loc.
- **Furnizorul pentru clanuri:** `GcsPlayerStatsProvider` înregistrat cu `servers.playerStats.use(…)`: adună
  identitățile `STEAM` și `NONSTEAM` legate de fiecare membru; `scope = "all"` (toate serverele), un id de server sau
  `"mix"` (doar meciurile mix); ELO-ul e al identității cu cele mai multe meciuri.

## 10. Meciurile mix și ELO

### 10.1 Formula (ELO standard pe echipe, cu un mic factor de performanță)

Pentru fiecare jucător `p` din echipa `A` (simetric pentru `B`):

```
R_A = media ELO a jucătorilor din A (înainte de meci), R_B la fel
E_A = 1 / (1 + 10^((R_B − R_A) / 400))          ← scorul așteptat al echipei A
S_A = 1 (victorie), 0.5 (egal), 0 (înfrângere)
K_p = servers.elo_k_new (implicit 40) dacă p are < servers.elo_provisional meciuri (implicit 10), altfel servers.elo_k (implicit 25)
c_p = damage_p / media damage-ului echipei lui p  (1 dacă media e 0)
f_p = 1 + P × clamp(c_p − 1, −1, 1)              ← P = servers.elo_performance / 100 (implicit 0.25)
Δ_p = round(K_p × (S_A − E_A) × f_p)             dacă S_A − E_A ≥ 0  (câștig: cine a contribuit mai mult câștigă mai mult)
Δ_p = round(K_p × (S_A − E_A) × (2 − f_p))       dacă S_A − E_A < 0  (pierdere: cine a contribuit mai mult pierde mai puțin)
ELO nou = max(100, ELO vechi + Δ_p)
```

- ELO-ul de start: `servers.elo_start` (implicit 1000). Factorul de performanță e mic și mărginit (±25 % implicit),
  deci suma nu e strict zero, dar rămâne aproape; `P = 0` dă ELO-ul standard.
- **Doar meciurile încheiate** (`ended`) cu cel puțin `servers.mix_min_rounds` runde jucate (implicit 10) și cel puțin
  un jucător în fiecare echipă se evaluează; meciurile anulate nu schimbă nimic. Un meci se evaluează o singură dată
  (`rated`).
- Istoricul: `eloBefore` / `eloAfter` în `game_match_players` (graficul ELO din profil = acest istoric). Totalurile:
  `game_ratings` (meciuri, victorii, înfrângeri, egaluri, vârful).

### 10.2 Exemple de referință (testele „golden”)

- 1000 vs 1000, K = 25, P = 0, câștigă A → fiecare din A +13 (12.5 rotunjit), din B −13.
- A medie 1200, B medie 1000, K = 25, P = 0, câștigă B → `E_B = 0.2403`, B +19, A −19.
- Același meci cu P = 0.25, un jucător din B cu damage dublu față de media echipei → `f = 1.25`, `Δ = round(19.0 ×
  1.25) = 24`.

## 11. Prezența adminilor

- **Online acum:** jucătorii din lista ultimului heartbeat (max 2 × intervalul) recunoscuți ca admini ai serverului
  (identitate sau `admin_login`), cu serverul și ora intrării (sesiunea deschisă).
- **Văzut în ultimele 24 h / 7 zile, timpul de joc pe 24 h / 7 zile / 30 de zile, ultima apariție, acțiunile (7 / 30
  de zile):** din `game_sessions` (adminul sesiunii) și `game_admin_actions`.
- **Inactiv:** ultima apariție mai veche decât `servers.admin_inactive_days` (implicit 7) sau niciodată.
- Sesiunile rămase deschise pe un server care nu mai trimite heartbeat (> 3 minute) se închid la ultimul heartbeat
  (jobul de 5 minute).

## 12. VIP pe servere

- ACP → serverul → **Plugin și chei API** → „VIP pe server”: fiecare grup VIP, pornit / oprit pe acest server, cu
  flag-urile lui (implicit `b`, rezervarea).
- **Lista efectivă** a serverului: abonamentele VIP **active** ale căror grupuri sunt pornite pe server → identitățile
  `STEAM` și `NONSTEAM` legate de membru (nu `NAME`) → `{ auth, flags, permissions, expiresAt, group }`.
- **Expirarea:** jobul existent `vip.sweep` închide abonamentul; evenimentele `vip.*` cresc versiunea listelor, deci
  ETag-ul se schimbă și pluginul scoate drepturile la următoarea tragere; în plus pluginul scoate singur flag-urile la
  `expiresAt`.

## 13. Hărțile

- Catalogul pe joc (`game_maps`): rânduri create când o hartă e văzută (heartbeat, `map`, meci) sau la încărcare.
- **Încărcarea în masă** (ACP → Gaming → Hărți): mai multe imagini odată; numele fișierului dă numele hărții
  (`de_dust2.jpg` → `de_dust2`); prin pipeline-ul de atașamente (tipul real din magic bytes, recodarea), max 5 MB,
  max 100 de fișiere pe încărcare. Imaginea veche se șterge.
- **Șablonul de adresă** pe joc (`servers.map_template_cs16`, `servers.map_template_cs2`), ex.
  `https://imagini.exemplu.ro/cs/{map}.jpg`: jobul `servers.bridge.maps` (la 10 minute, max 20 de hărți pe rundă) aduce
  imaginile lipsă cu **descărcarea gardată a platformei** (`safeFetchBuffer`: doar http/https pe porturile 80/443,
  adrese publice verificate la conectare, redirecturile re-verificate, max 5 MB, 15 s) și le trece prin pipeline. Un
  eșec se notează (`fetchError`) și se reîncearcă după 1 h × 2^încercări (max 7 zile).
- **Arta generică**: GCS livrează doar artă **originală**, desenată de noi (SVG): un card în culorile jocului cu un
  model geometric; numele hărții se scrie peste ea la afișare. Ruta `GET /api/servers/maps/art/{game}` (SVG,
  cache public o zi). **Nu se livrează niciodată capturi de hărți ale altora.**
- `bridge.maps.image(game, map)` → `{ url, generic }`.

## 14. Contestații și reclamații (date și servicii; paginile în partea B)

- **Feluri:** contestația unui ban („Contestă banul”, `APPEAL`, legată de sancțiune, doar de cel sancționat: membrul
  care are identitatea țintă legată), reclamația unui cheater (`CHEATER`: serverul, jucătorul, dovezile), reclamația unui
  admin (`ADMIN`: adminul — intrare sau membru, serverul, dovezile).
- **Fluxul stărilor:** `OPEN → REVIEW / ACCEPTED / REJECTED / CLOSED`; `REVIEW → ACCEPTED / REJECTED / CLOSED / OPEN`;
  `ACCEPTED / REJECTED → CLOSED / REVIEW`; `CLOSED → REVIEW` (redeschis de staff). Autorul își poate închide
  contestația / reclamația.
- **Acceptarea unei contestații** poate ridica sancțiunea în același pas (opțiunea `lift`).
- **Discuția:** mesaje cu documentul editorului (același model de conținut ca postările, randat și sanitizat de
  renderer-ul platformei), note interne ale staff-ului (invizibile autorului), intrări de sistem pentru schimbarea
  stării și a responsabilului.
- **Cine vede / tratează:**
  - autorul: tichetul lui (fără notele interne);
  - **`servers.tickets_manage`** (staff global): toate;
  - adminii unui server (membri cu `d`) văd și tratează contestațiile și reclamațiile de cheater ale serverului lor;
    **reclamațiile de admin nu le văd niciodată** (doar `tickets_manage`); un admin nu tratează o reclamație despre el.
- **Notificări:** `servers.ticket_new` (staff-ului care poate trata, la tichet nou), `servers.ticket_update`
  (autorului: schimbarea stării, răspuns public; responsabilului: răspunsul autorului).
- **Limite:** max 3 tichete deschise pe autor și fel, o singură contestație deschisă pe sancțiune, 5 tichete pe oră pe
  membru, titlul 3–120 de caractere, max 10 dovezi.
- Jurnal: `servers.ticket.create`, `servers.ticket.status`, `servers.ticket.assign`.

## 15. Permisiuni, setări, ACP

### 15.1 Permisiunile de grup

| Cheie | Implicit |
|---|---|
| `servers.stats_view` (statistici, profiluri de jucător, meciuri) | toți, mai puțin Banat |
| `servers.bans_view` (lista publică a bannurilor și comunicațiilor) | toți, mai puțin Banat |
| `servers.sanction` (sancțiuni de pe site, pe orice server) | Root Admin, Admin, Super moderator |
| `servers.view_ips` (IP-urile din sancțiuni și sesiuni) | Root Admin, Admin |
| `servers.tickets_create` (contestații și reclamații) | toți membrii (fără Vizitator și Banat) |
| `servers.tickets_manage` (toate tichetele) | Root Admin, Admin, Super moderator |
| `servers.link_identity` (legarea identităților non-Steam prin cod) | toți membrii |
| `servers.players_manage` (staff: leagă / dezleagă identități) | Root Admin, Admin, Super moderator |

### 15.2 Setările (ACP → Gaming → Servere → Bridge și ELO, `/admin/settings/servers_bridge`)

| Cheie | Implicit | Interval |
|---|---|---|
| `servers.bridge_heartbeat` | 30 s | 15–120 |
| `servers.bridge_events` | 10 s | 5–60 |
| `servers.elo_start` | 1000 | 100–3000 |
| `servers.elo_k` | 25 | 1–100 |
| `servers.elo_k_new` | 40 | 1–100 |
| `servers.elo_provisional` | 10 meciuri | 0–100 |
| `servers.elo_performance` | 25 (%) | 0–50 |
| `servers.mix_min_rounds` | 10 | 1–30 |
| `servers.rank_min_minutes` | 30 | 0–6000 |
| `servers.admin_inactive_days` | 7 | 1–365 |
| `servers.tempban_max` | 10080 minute | 1–525600 |
| `servers.bridge_retention_days` (sesiuni, jurnalul din joc) | 180 | 30–730 |
| `servers.map_template_cs16`, `servers.map_template_cs2` | gol | adresă http(s) cu `{map}` |

### 15.3 Paginile ACP (partea A)

- **Gaming → Servere → un server → „Plugin și chei API”** (`/admin/gaming/servers/{id}/bridge`, secțiunea
  `gaming.servers`): starea punții (ultimul heartbeat, pluginul, jucătorii online, meciul curent), cheile (creare,
  rotire, revocare; cheia arătată o dată), modul identităților (`steam` / `mixed`, `nameIds`, `isMix`), VIP pe server.
- **Gaming → Admini servere** (`/admin/gaming/server-admins`, secțiunea `gaming.server_admins`).
- **Gaming → Hărți** (`/admin/gaming/server-maps`, secțiunea `gaming.server_maps`).
- **Gaming → Bridge și ELO** (`/admin/settings/servers_bridge`, secțiunea `system.settings_servers_bridge`): setările.

## 16. Joburile (gcs-worker)

| Job | Ritm | Ce face |
|---|---|---|
| `servers.bridge.sweep` | 5 min | închide sesiunile serverelor tăcute; expiră adminii (jurnal + versiune); șterge codurile expirate, id-urile evenimentelor > 14 zile, sesiunile și jurnalul din joc mai vechi decât retenția |
| `servers.bridge.ranks` | 10 min | locurile pe server |
| `servers.bridge.steam` | 10 min | reconcilierea legăturilor Steam (§3.3) |
| `servers.bridge.maps` | 10 min | imaginile hărților după șablon (§13) |

## 17. Ce folosește partea B (serviciile, `services().bridge`)

- `bridge.players`: `resolveRef`, `get(id)`, `byUser(userId)`, `createLinkCode(actor)`, `unlinkOwn(actor, playerId)`,
  `staffLink(actor, playerId, userId | null)`, `search(q)`.
- `bridge.queries` (doar citire, cu permisiunile verificate): `playerProfile(actor, playerId)` (tab-urile: rezumat,
  clasic pe servere, mix + istoric ELO, meciuri, arme, hărți, sancțiuni; identitățile cu tipul și încrederea),
  `userProfile(actor, userId)`, `leaderboard(actor, serverId, page)`, `mixLeaderboard(actor, page)`,
  `matches(actor, { serverId?, playerId?, page })`, `match(actor, id)`, `liveMatch(actor, serverId)`,
  `serverAdmins(actor, serverId)` (cu prezența).
- `bridge.sanctions`: `list(actor, filtre)`, `get(actor, id)`, `create`, `update`, `lift`, `canSanction`.
- `bridge.tickets`: `create`, `list`, `get`, `reply`, `setStatus`, `assign`, `canView`, `canHandle`.
- `bridge.presence.list(actor, { serverId? })`, `bridge.maps.image(game, map)`, `bridge.admins.*`, `bridge.vip.*`,
  `bridge.keys.*`.
- Camerele realtime: `servers:{id}` (`servers:match`), `match:{id}` (`match:state`).

## 18. Serverul fals și testele

- **`servers-plugins/mock/gcs-mock-server.mjs`**: un server de joc fals (Node, fără dependențe) care vorbește
  protocolul: heartbeat-uri, ucideri, un meci mix complet (warmup → live → halftime → ended), un ban; folosit de
  testele unitare (transportul e o funcție: apelează direct `bridge.api.handle`) și de E2E (HTTP real). Are și un mod
  de linie de comandă (`node gcs-mock-server.mjs --url … --key … --scenario full`).
- **Unitare:** autentificarea (cheie necunoscută, revocată, rotită, semnătura, ambele algoritme, ceasul, reluarea,
  limitele), idempotența, conversiile SteamID și identitățile (LAN respins, încrederea), legarea prin cod (expirare,
  refolosire, Steam refuzat), adminii (flag-uri, presetări, expirare, nume + parolă), scopul sancțiunilor (server /
  global) și expirarea, comunicațiile, VIP-ul pe server și expirarea, agregarea statisticilor și locurile, ELO-ul (golden),
  ciclul unui meci din serverul fals, ferestrele prezenței, șablonul hărților (garda SSRF), furnizorul folosit de clanuri,
  regula de brand.
- **E2E (minimal):** cheia creată în ACP, scenariul complet al serverului fals pe instanța reală, datele vizibile în ACP
  (starea punții, meciul încheiat) și prin servicii.

## 19. Întrebări deschise pentru proprietar

1. Ritmul implicit al heartbeat-ului (30 s) și al evenimentelor (10 s) e potrivit pentru câte servere aveți?
2. Pe serverele CS 1.6 aveți ReAPI + Reunion peste tot (necesar pentru a deosebi Steam de non-Steam)? Fără ele, modul
   `mixed` tratează pe toată lumea ca non-Steam.
3. Bannurile globale din joc: e bine ca doar adminii „pe toate serverele” să le poată da?
4. Scorul locului pe server (`kills − deaths − teamkills`) sau preferați altă formulă (ex. puncte pe hartă câștigată)?
5. Pentru mix: folosiți deja un plugin de mix (ready-up, echipe)? Pluginul nostru are un ready-up simplu și o interfață
   (natives / forward-uri) pentru a fi condus de pluginul vostru.
