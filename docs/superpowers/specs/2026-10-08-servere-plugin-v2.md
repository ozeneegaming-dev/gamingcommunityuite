# Servere: pluginurile v2 — colectare de date implicit, configurare zero pe orice server nou

- **Data:** 2026-10-08
- **Cererea proprietarului:** „pluginurile trebuie configurate încât să funcționeze pe orice server nou adăugat”. Plus
  decizia de scop din aceeași zi: serverele comunității au deja sistemul lor de admini, bannuri și comenzi, deci
  **pluginul GCS doar colectează date pentru platformă și nu schimbă nimic pe server**, în mod implicit. Tot ce
  administrează serverul devine **modul opțional, oprit implicit**, pornit din ACP pe fiecare server.
- **Ce intră aici:** modul colector și modulele opționale (pluginuri + site), raportarea flag-urilor de admin existente
  (prezența adminilor), detectarea pasivă a meciurilor mix, pachetul gata făcut pe server (ACP), pachetul general și
  înrolarea automată a serverelor necunoscute (cu aprobare în ACP), pasul de release reproductibil al binarelor,
  serverul fals, documentația și livrabilele proprietarului.
- **Regula de bază:** tot ce ține de servere stă în aplicația Servere. Fără integrarea cu alte sisteme de bannuri (nu
  citim baze de date ale altor pluginuri).
- **Referințe:** puntea, partea A (`2026-10-08-servere-bridge.md`: protocolul §6, securitatea §5), paginile, partea B
  (`2026-10-08-servere-pagini.md`), specul Serverelor (`2026-10-07-servere.md`: interogarea și garda SSRF §10).

## 1. Modul colector (implicit) și modulele opționale

### 1.1 Ce face pluginul mereu (colector)

- heartbeat-ul (harta, sloturile, jucătorii online), evenimentele (conectări / ieșiri / timp de joc, ucideri, decese,
  headshot-uri, arme, focuri, runde, scorul echipelor), meciurile mix detectate pasiv pe serverele marcate „mix” (§3),
  legarea contului cu `/gcs COD` și înrolarea (§5);
- **flag-urile de admin existente** ale fiecărui jucător online, citite din sistemul de admini al serverului (§2);
- **nu** scrie flag-uri, nu dă kick, nu dă mute / gag, nu rulează comenzi pe server, nu mută jucători, nu înregistrează
  comenzi de admin. Nu atinge `users.ini` / `configs/admins.json`.

### 1.2 Modulele opționale (oprite implicit)

| Modul | Cheia | Ce face când e pornit |
|---|---|---|
| Admini din GCS | `admins` | adminii din ACP înlocuiesc drepturile jucătorilor (inclusiv adminii pe nume + parolă și protecția numelui) |
| Bannuri, mute, gag din GCS | `sanctions` | sincronizarea sancțiunilor, verificarea la conectare (`/check`), kick-ul celor banați, mute / gag |
| VIP din GCS | `vip` | flag-urile VIP adăugate peste drepturile existente (fără să le scoată pe ale serverului) |
| Ready-up mix | `mixReady` | `/ready`, GCS pornește meciul (restart, schimbarea părților la pauză) |
| Comenzile de admin GCS | `commands` | `gcs_ban` / `css_gcsban` …, aliasurile `amx_ban` / `amx_unban`, `gcs_match`, `gcs_sync` și jurnalul acțiunilor (`amx_kick`, `amx_slay` …) |

- **Pe site:** coloane noi în `game_servers` (`manageAdmins`, `enforceSanctions`, `manageVip`, `mixReady`,
  `adminCommands`, toate `false` implicit; migrarea `20261110000000_server_bridge_v2`). ACP → serverul → Plugin și chei
  API → „Module opționale — doar dacă vrei ca GCS să administreze serverul”; fiecare schimbare în jurnal
  (`servers.bridge.update`).
- **În protocol:** răspunsul heartbeat-ului are `config.features = { admins, sanctions, vip, mixReady, commands }`.
- **În plugin:** un modul oprit nu își înregistrează nici comenzile, nici hook-urile, iar listele lui nu se trag de la
  site (`/admins`, `/vip`, `/sanctions`, `/check`). Starea primită se salvează local (pornirea următoare înregistrează
  direct ce e pornit). Un modul pornit în timpul jocului se activează imediat; unul oprit devine inert imediat, iar
  comenzile lui dispar la repornirea hărții (AMX Mod X nu poate șterge o comandă). La oprirea modulului „Admini din GCS”
  pluginul cere sistemului serverului să își reîncarce adminii (`amx_reloadadmins` / `css_reloadadmins`).
- **Acordul local:** `gcs_allow_manage 0` (CS 1.6) / `"AllowManage": false` (CS2) ține pluginul colector oricum ar fi
  setările din ACP. Implicit `1` / `true`: decide ACP-ul.
- Rutele listelor rămân disponibile (compatibilitate cu pluginul 1.0); pluginul 1.1 nu le cere când modulul e oprit.

## 2. Flag-urile de admin raportate și prezența adminilor

- **Heartbeat-ul** (și referința din `connect`) are pe fiecare jucător: CS 1.6 `flags` (literele din `get_user_flags`,
  fără `z`); CS2 `permissions` (permisiunile CounterStrikeSharp ale jucătorului, doar citite) și `groups`.
- **GCS normalizează** în litere AMXX: pe CS2 prin inversul tabelului `FLAG_CSS` (§7.2 partea A; `@css/root` = toate
  literele de admin). Un jucător e **admin raportat** dacă are cel puțin o literă de putere: `c d e f g h i j k l u v`
  (`a` imunitatea singură, `b` rezervarea și nivelurile `m`–`t`, folosite des pentru VIP, nu contează).
- **Datele:** `game_sessions.adminFlags` (literele la intrare, actualizate de heartbeat), lista online din Redis are
  `flags` pe fiecare jucător.
- **Prezența** (`presence.list` / `online` / `onlineCounts`): pe lângă intrările GCS (`game_admins`), adminii
  raportați de servere apar ca „admin al serverului” (subiectul `SERVER`, id-ul identității), cu numele din joc,
  membrul legat (dacă identitatea e legată), flag-urile raportate, timpul de joc din sesiunile cu `adminFlags`, ultima
  apariție. Un jucător care e și intrare GCS nu apare de două ori. Acțiunile din joc există doar cu modulul
  `commands`.

## 3. Meciurile mix detectate pasiv

Pe un server marcat „mix” (`isMix`), fără ready-up GCS și fără ca alt plugin să conducă meciul prin nativele / comanda
GCS, pluginul observă jocul și nu schimbă nimic:

1. **Start:** un restart al jocului (CS 1.6: mesajele `#Game_Commencing` / `#Game_will_restart_in`; CS2:
   `round_announce_match_start` / `begin_new_match`), urmat de începutul unei runde cu cel puțin 2 jucători în fiecare
   echipă → meci nou, direct `live`; echipa A = jucătorii CT de atunci.
2. **Restart în timpul meciului:** cu 0 runde jucate (LO3) sau după schimbarea părților (LO3-ul reprizei a doua) se
   ignoră; înainte de runda 3 → meciul curent se anulează și începe altul; după runda 3 se ignoră.
3. **Pauza:** la începutul unei runde, dacă majoritatea jucătorilor din A sunt pe partea cealaltă → `halftime` apoi
   `live` (A / B rămân aceleași, părțile se schimbă). Jucătorii veniți târziu intră în echipa părții lor.
4. **Rundele:** câștigătorul părții → A / B, `match_round`; scorul e numărat de plugin (restarturile jocului nu îl
   strică).
5. **Final:** o echipă trece de jumătatea lui `mp_maxrounds` (sau 30 pe CS 1.6 / 24 pe CS2 dacă e 0), runda
   `mp_maxrounds` (egal), sau (CS2) `cs_win_panel_match` → `ended`. Harta schimbată cu meciul deschis → `aborted`.
   GCS evaluează ELO-ul doar pentru meciurile încheiate cu destule runde (partea A §10).

Ready-up-ul (modul `mixReady`) și comanda `gcs_match` (modul `commands`) conduc meciul ca înainte; nativele
(`gcs_mix_command`) îl conduc fără restart sau mutări (alt plugin le face). În toate aceste cazuri detectarea pasivă se
oprește până la harta următoare.

## 4. Pachetul gata făcut pe server (ACP)

- ACP → Gaming → Servere → serverul → Plugin și chei API → **„Descarcă pluginul pentru acest server”** (CS 1.6 sau CS2,
  după jocul serverului). Dreptul: ca la cheile API (`gaming.servers`, `edit`). Limita: 10 pachete pe oră pe admin.
- Creează o **cheie API nouă** cu eticheta „Pachet descărcat AAAA-LL-ZZ” (jurnal `servers.key.create`, cu
  `source: "package"`), pusă doar în arhivă (nu se arată în pagină). Limita de 5 chei active se aplică.
- Arhiva ZIP (structura folderului jocului):
  - **CS 1.6:** `addons/amxmodx/plugins/gcs_bridge.amxx`, `addons/amxmodx/configs/plugins-gcs.ini` (AMX Mod X încarcă
    singur fișierele `plugins-*.ini`, deci nu se editează `plugins.ini`), `addons/amxmodx/configs/gcs_bridge.cfg`
    (adresa site-ului și cheia completate), `addons/amxmodx/scripting/gcs_bridge.sma`,
    `addons/amxmodx/scripting/include/gcs_bridge.inc`, `LICENSE.txt` (GPL-3.0-or-later), `INSTALARE.txt`.
  - **CS2:** `addons/counterstrikesharp/plugins/GcsBridge/GcsBridge.dll`,
    `addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json` (completat), `LICENSE.txt` (MIT),
    `INSTALARE.txt`. Fără `.pdb`.
- **Adresa site-ului:** setarea `site.url`, altfel `GCS_BASE_URL`; trebuie să fie o adresă http(s) absolută.
- **Nota de instalare** (română) are trei pași: încarcă fișierele, repornește serverul, verifică / aprobă în ACP.
  Sus scrie clar că pluginul doar colectează date și nu atinge adminii, bannurile sau comenzile serverului; modulele
  opționale sunt listate separat.

## 5. Pachetul general și înrolarea automată

### 5.1 Pachetul general

ACP → Gaming → Servere → **„Descarcă pluginul general”** (CS 1.6 / CS2): aceeași arhivă, cu adresa site-ului completată
și **fără cheie**. Se pune pe orice server încă neadăugat: pluginul se înrolează singur, adminul îl aprobă.

### 5.2 Protocolul înrolării (fără cheie, întărit)

Ambele rute sunt sub `/api/servers/bridge/v1`, fără semnătură (pluginul nu are încă o cheie), doar JSON (max 4 KB).

- `POST /enroll` `{ game, port, hostname, map, maxPlayers, players, plugin, secret }` → `{ status, enrollment,
  retryAfter, serverTime }`.
  - `secret`: 32–128 caractere `[A-Za-z0-9_-]`, generat **o singură dată** de plugin și păstrat local (CS2:
    `RandomNumberGenerator`, 32 de octeți; CS 1.6: SHA-256 peste un rezervor de entropie — timpul, `tickcount`,
    generatorul AMX Mod X, harta, întârzierile rețelei). Site-ul păstrează doar `SHA-256(secret)`.
  - `enrollment`: referința înrolării, 24 de caractere `[a-z0-9]` aleatorii criptografic, dată doar celui care a trimis
    cererea. Pluginul o păstrează lângă secret.
  - Același secret retrimis (răspuns pierdut, repornire) întoarce aceeași înrolare: niciun duplicat.
  - `status`: `pending`, `approved` sau `rejected`.
- `POST /enroll/status` `{ enrollment, secret }` → `{ status: "pending" }`, `{ status: "approved", key }` (o singură
  dată), `{ status: "approved", delivered: true }`, `{ status: "rejected" }`; referința necunoscută / expirată sau
  secretul greșit → același `404 unknown_enrollment` (fără să se poată ghici care).
- Erori: `403 enroll_disabled`, `403 blocked`, `400 invalid_*`, `429 rate_limited` (`Retry-After`), `503
  too_many_pending`.

### 5.3 Ce verifică site-ul

1. Aplicația Servere activă (404), corpul ≤ 4 KB (413), setarea `servers.enroll_enabled` (implicit pornită),
   IP-ul sursei nu e în lista `servers.enroll_blocked_ips` (IP-uri sau CIDR-uri, separate prin virgulă / spațiu).
2. **Limitele pe IP:** `POST /enroll` 10 pe oră; `POST /enroll/status` 30 pe minut; eșecurile (referință sau secret
   greșit) intră în limita comună a eșecurilor de autentificare (30 pe minut, apoi 429).
3. **Plafoanele:** max 50 de înrolări în așteptare în total și 5 pe IP (`503 too_many_pending`).
4. **Datele raportate nu sunt de încredere:** `hostname`, `map`, `plugin` trec prin `cleanGameText` (128 / 64 / 64),
   numerele se taie la intervale, `game` doar `cs16` / `cs2`, portul 1024–65535.
5. **Verificarea prin interogare** (interogarea existentă a aplicației, `queryGameServer`): doar la **IP-ul sursei
   cererii** (niciodată o adresă raportată), pe portul raportat (1024–65535), cu garda SSRF a aplicației (adrese
   publice sau excepția operatorului `GCS_SERVERS_ALLOW_NETS`), 3 s. Rezultatul: `ok` (răspunde și folderul jocului
   corespunde: `cstrike` = CS 1.6, `csgo` = CS2), `game_mismatch`, `offline` (codul erorii) sau `blocked`. Se face la
   înrolare și se repetă la interogarea stării cel mult o dată la 5 minute cât timp nu e `ok`. Numele și harta
   interogate se compară cu cele raportate (afișat în ACP).
6. **Expirarea:** o înrolare în așteptare expiră după 7 zile; una aprobată și neridicată după 7 zile de la aprobare;
   cele respinse rămân 30 de zile (pluginul cu același secret primește `rejected`), apoi dispar (jobul de curățenie).

### 5.4 ACP: „Servere noi detectate”

ACP → Gaming → Servere: tabelul înrolărilor în așteptare (IP:port, jocul, numele, harta, jucătorii / sloturile,
versiunea pluginului, prima / ultima apariție, rezultatul interogării, „aceeași adresă de mai multe ori” când două
înrolări cer același IP:port), plus ultimele decise (7 zile). Acțiunile (dreptul `gaming.servers` `edit`, jurnal):

- **Aprobă:** creează un server nou în aplicația Servere (jocul, IP-ul, portul, numele curățat; jurnal
  `servers.create`) sau **atașează** la un server existent al aceluiași joc (implicit cel cu aceeași adresă). Cu
  interogarea neconfirmată cere confirmarea explicită („Aprobă oricum”). Jurnal `servers.enroll.approve`.
- **Respinge:** `servers.enroll.reject`.
- **Blochează IP:** adaugă IP-ul în `servers.enroll_blocked_ips` (jurnal `settings.update`) și respinge toate înrolările
  în așteptare de la el (`servers.enroll.block`).
- **Verifică din nou:** repetă interogarea (limita butonului „Testează”).

### 5.5 Livrarea cheii (o singură dată)

- La prima interogare a stării după aprobare (cu referința și secretul corecte), GCS **creează atunci** cheia (eticheta
  „Înrolare automată AAAA-LL-ZZ”, jurnal `servers.key.create` cu `source: "enrollment"`, fără actor) și o întoarce o
  singură dată. Secretul cheii nu e păstrat nicăieri (doar hash-ul sigilat, ca la orice cheie).
- Dacă pluginul cere din nou înainte ca cheia să fi fost folosită vreodată (răspunsul s-a pierdut), cheia nefolosită
  se revocă și se emite alta (max 3 livrări). După prima cerere semnată cu ea: doar `delivered: true`.
- Pluginul salvează cheia (CS 1.6: `addons/amxmodx/configs/gcs_bridge_key.cfg` cu `gcs_key "…"`, citit doar dacă
  `gcs_key` din `gcs_bridge.cfg` e gol; CS2: `plugins/GcsBridge/data/gcs_bridge_key.txt`, folosit doar dacă `Key` e gol)
  și continuă imediat cu protocolul semnat.
- Ritmul pluginului: starea la 60 s; erorile de rețea / 5xx cu backoff (60 s → 15 minute); `rejected` → oprește
  întrebările 24 de ore și scrie în log; `unknown_enrollment` → se înrolează din nou (același secret).
- Adresa `http://` (fără TLS) e permisă doar cu avertisment în log: cheia livrată ar trece în clar.

### 5.6 Modelul de amenințări (pe scurt)

- **Servere false care împing statistici:** nimic nu primește o cheie fără aprobarea unui admin; interogarea arată
  dacă la acel IP:port răspunde un server de joc real.
- **Furtul cheii altui server:** cheia se dă doar celui cu referința (aleatorie, dată doar lui, prin TLS) și secretul
  (al cărui hash e pe site); comparația e în timp constant.
- **Limita verificării:** interogarea dovedește că un server real răspunde la IP:port, nu că cel care cere îl
  controlează (ex. un alt server de pe același IP). De aceea aprobarea rămâne manuală, iar ACP-ul semnalează adresele
  cerute de mai multe ori. IP-ul sursei e cel văzut de site prin proxy-ul de încredere (Caddy).
- **SSRF / amplificare:** interogarea pleacă doar spre IP-ul sursei, pe porturi de joc, cu garda aplicației și cu
  limitele pe IP.

## 6. Binarele pe site: pasul de release

- `servers-plugins/release.ps1` (Windows) și `release.sh` (Linux) compilează ambele pluginuri cu uneltele date
  (amxxpc 1.10 + include-urile AmxxEasyHttp / ReAPI, .NET SDK 8 + CounterStrikeSharp.API 1.0.368; nimic descărcat) și
  scriu în `servers-plugins/release/` (în depozit): `cs16/gcs_bridge.amxx`, `cs16/gcs_bridge.sma`,
  `cs16/gcs_bridge.inc`, `cs16/LICENSE`, `cs2/GcsBridge.dll`, `cs2/LICENSE` și `manifest.json` (versiunile
  pluginurilor, sha256 pentru fiecare fișier, sha256 al surselor folosite, versiunile uneltelor).
- Testul unitar `release.test.ts`: fiecare fișier are sha256-ul din manifest, versiunea din manifest e cea din surse
  (`VERSION` / `PLUGIN_ID` din `.sma`, `<Version>` din `.csproj`, `PluginId` din `BridgeClient.cs`), iar hash-ul
  surselor e cel al surselor curente (o sursă schimbată fără release nou = test roșu).
- Next.js (standalone) include folderul prin `outputFileTracingIncludes`; calea se poate schimba cu
  `GCS_PLUGIN_RELEASE_DIR`.
- Versiunea pluginurilor: **1.1.0** (`gcs-amxx/1.1.0`, `gcs-cs2/1.1.0`).

## 7. Serverul fals și testele

- `servers-plugins/mock/gcs-mock-server.mjs`: `enroll()` / `enrollStatus()` / `waitForKey()`, scenariul `enroll`
  (linia de comandă `--scenario enroll`: se înrolează, așteaptă aprobarea, primește cheia, trimite un heartbeat),
  flag-urile de admin în heartbeat, un răspuns A2S opțional pe UDP (`--a2s-port`) ca interogarea să găsească un
  server real.
- **Unitare:** înrolarea (limitele, plafoanele, expirarea, hash-ul secretului, livrarea unică și relivrarea cheii
  nefolosite, aprobarea / atașarea / respingerea / blocarea, interogarea, lista blocată, setarea oprită), rutele,
  arhiva (conținutul, configul completat, cheia nouă în jurnal), manifestul release-ului, modulele în configul
  heartbeat-ului, flag-urile raportate și prezența.
- **E2E:** serverul fals se înrolează, adminul aprobă în ACP, serverul fals primește cheia și trimite un heartbeat
  vizibil în ACP; pachetul descărcat pentru un server conține configul corect.
- **Verificarea încrucișată a protocolului:** clientul CS2 (C#) contra codului real al site-ului și pașii pluginului
  AMX Mod X refăcuți în Node.
