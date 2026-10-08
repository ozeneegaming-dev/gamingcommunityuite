# Servere: paginile publice ale punții („GCS Server Bridge”), partea B

- **Data:** 2026-10-08
- **Cererea proprietarului:** paginile site-ului peste serviciile punții (partea A, `2026-10-08-servere-bridge.md` §17):
  profilul separat al jucătorului (cu tab-uri), lista bannurilor și sancțiunile date de pe site, contestațiile și
  reclamațiile, prezența adminilor (pagina, widget-ul, indicatorul pe servere, avertismentele din ACP), meciurile mix
  live și istoricul lor, clasamentele, imaginile hărților, „Conturi de joc” în Setări → Cont, statisticile pe profilul
  membrului și în clanuri, meniul.
- **Regula de bază:** tot ce ține de servere stă în aplicația Servere (`packages/modules/src/servers` + paginile ei).
  Clanurile citesc doar prin `GcsPlayerStatsProvider`. Aplicația Servere dezactivată → paginile de aici răspund 404,
  itemii din meniu, widget-ul și blocurile din profil dispar.
- **Referințe:** specul punții (partea A) §3 (identitate și încredere), §8 (sancțiuni), §11 (prezența), §14 (tichete),
  §17 (serviciile); specul Serverelor (`2026-10-07-servere.md`) §1 (direcția vizuală) și §8 (meniul); specul Clanurilor
  §15.

## 1. Rutele

| Ruta | Ce e | Cine o vede |
|---|---|---|
| `/servers/players/{id}-{slug}` | profilul jucătorului (o identitate de joc), cu tab-uri | `servers.stats_view` |
| `/servers/leaderboard` | clasamentul ELO (mix); `?server={id}` = clasamentul clasic al unui server | `servers.stats_view` + vizibilitatea serverului |
| `/servers/matches` | istoricul meciurilor mix (`?server=`, `?page=`) | `servers.stats_view` |
| `/servers/matches/{id}` | pagina meciului: echipele, jucătorii, rundele, ELO-ul; live | `servers.stats_view` + vizibilitatea serverului |
| `/servers/admins` | prezența adminilor (online acum, 24 h / 7 zile, timpul de joc, activitatea) | `servers.stats_view` |
| `/servers/tickets` | tichetele mele și coada staff-ului | membrii autentificați |
| `/servers/tickets/new` | contestație / reclamație nouă (`?kind=appeal&sanction={id}`) | `servers.tickets_create` |
| `/servers/tickets/{id}` | tichetul cu discuția (notificările din partea A duc aici) | autorul și cine îl poate trata (§14 partea A) |
| `/bans` | bannurile și comunicațiile (mute / gag), căutare și filtre | `servers.bans_view` |
| `/bans/{id}` | detaliul unei sancțiuni; editarea și ridicarea (cu drept) | `servers.bans_view` sau cine o poate modifica |
| `/bans/new` | sancțiune nouă de pe site | `canSanction` (staff `servers.sanction` sau adminii serverelor, §8.1) |
| `/api/servers/maps/image/{game}/{map}` | imaginea hărții: redirect la imaginea încărcată sau la arta generică | public (aplicația activă) |
| `/api/servers/live?server={id}` | meciul live al unui server (rezerva fără realtime) | `servers.stats_view` + vizibilitatea serverului |
| `/api/servers/players?q=` | căutarea jucătorilor (formularele: reclamație, sancțiune) | `servers.stats_view`; limită pe IP |

- Rutele sunt în engleză, ca restul site-ului (`/servers`, `/members`); textele din meniu sunt traduse.
- `slug`-ul profilului vine din ultimul nume al jucătorului; un slug greșit redirecționează la cel corect (ca la servere).
- Un jucător fără cont pe site are profil (identitatea există fără membru). Profilul membrului duce la profilul de
  jucător (identitatea principală, §17 partea A `userProfile`), iar profilul jucătorului duce înapoi la membru.

## 2. Direcția vizuală

Identitatea GCS rămâne (fundal aproape negru sau tema luminoasă, accent roșu, Chakra Petch pentru titluri și cifre mari,
Manrope pentru text, benzile titlurilor). Puntea adaugă un singur element nou de culoare: **culorile echipelor** la mix.

| Rol | Valoare | Folosire |
|---|---|---|
| Echipa A | `--gcs-teamA` (= `--gcs-accentInk`) | scorul, rundele câștigate, eticheta echipei |
| Echipa B | `--gcs-teamB` (albastru, `#5B9BFF` închis / `#2563EB` deschis) | idem pentru B |
| Tipurile sancțiunilor | ban = accent, mute = `--gcs-warn`, gag = violet (`#B18CFF` / `#7C3AED`) | eticheta tipului, mereu cu textul |
| Încrederea identității | ridicată = `--gcs-ok`, medie = `--gcs-warn`, scăzută = `--gcs-muted` | eticheta identității, cu iconiță și text |

- **Culoarea nu e niciodată singură:** echipa are mereu numele, tipul are textul, starea are textul („Activ”,
  „Expirat”, „Ridicat”), live are punctul și textul „LIVE”.
- **Cifrele:** `tabular-nums` în tabele; numerele mari (scorul, ELO-ul, K/D-ul) în Chakra Petch.
- **Profilul jucătorului** („cartea jucătorului”): antetul cu numele mare, eticheta identității (tipul + încrederea),
  membrul legat (sau „Fără cont pe site”), ultima apariție și ultimul server; o bandă de cifre (K/D, ucideri,
  headshot %, precizie, timp de joc, ELO, locul cel mai bun); tab-urile sub bandă, ca pe profilul membrului.
- **Pagina meciului:** tabela de scor (echipa A · scorul · starea · scorul · echipa B) peste imaginea hărții, banda
  rundelor (un pătrat pe rundă, în culoarea câștigătorului, cu numărul în text pentru cititoarele de ecran), apoi cele
  două echipe ca tabele.
- **Lista bannurilor:** antetul cu căutarea, filtrele ca legături (merg fără JavaScript), tabelul pe desktop, carduri pe
  mobil (≤ 640 px).
- **Imaginile hărților:** pe cardul serverului și pe pagina lui, bannerul fără imagine încărcată arată harta curentă
  (imaginea încărcată în ACP sau arta generică originală, cu numele hărții scris peste ea); lista „Hărți jucate” are
  miniaturi. Nicio captură de hartă a altora nu se livrează (§13 partea A).

## 3. Profilul jucătorului

- **Tab-urile** (`?tab=`): **Prezentare** (implicit), **Clasic**, **Mix**, **Meciuri**, **Arme**, **Hărți**,
  **Sancțiuni** (doar cu `servers.bans_view`; IP-ul doar cu `servers.view_ips`, din serviciu).
- **Prezentare:** plăcile de cifre, cele mai bune 3 arme și 3 hărți, ultimele 5 meciuri, graficul ELO mic, identitățile
  aceluiași membru (tipul, încrederea, „neverificat” la `NAME`).
- **Clasic:** un rând pe server vizibil: locul, ucideri, decese, K/D, headshot %, precizia (doar dacă serverul trimite
  focurile), damage, timp de joc, ultima apariție; locul duce la clasamentul serverului.
- **Mix:** ELO-ul, vârful, victorii / înfrângeri / egaluri, procentul victoriilor, graficul ELO (ultimele 200 de meciuri,
  SVG, cu tabel ascuns vizual pentru cititoarele de ecran), ultimele meciuri.
- **Meciuri:** istoricul paginat (data, serverul, harta, rezultatul pentru jucător, scorul, K–D, schimbarea de ELO).
- **Arme / Hărți:** tabelul armelor (cu bara uciderilor), cardurile hărților cu imaginea.
- **Datele sunt neîncredere** (numele, hărțile, armele, motivele): se afișează doar ca text.

## 4. Bannurile și sancțiunile de pe site

- **Lista** (`/bans`): căutarea după nume, SteamID (orice formă), ID non-Steam sau motiv; după IP doar cu
  `servers.view_ips` (serviciul ignoră altfel IP-ul). Filtrele: serverul (toate / un server / „doar globale”), starea
  (active / expirate / ridicate / toate), tipul (ban / mute / gag). Pagini de 50.
- **Serviciul** primește filtrul nou `scope` (`SERVER` / `GLOBAL`): „doar globale” = `scope = GLOBAL`; un server =
  sancțiunile care se aplică pe el (ale lui + globale).
- **Detaliul:** ținta (jucătorul cu link spre profil, identitatea, numele, IP-ul cu drept), tipul, scopul, motivul,
  data, expirarea (permanent / data + cât a rămas), adminul, sursa (site / joc), ridicarea (cine, când, motivul),
  dovezile (linkuri `https`, `rel="nofollow noopener ugc"`). Butonul „Contestă” pentru cel sancționat (membrul care are
  identitatea țintă legată), dacă sancțiunea e activă și nu are deja o contestație deschisă.
- **Formularul** (creare / editare), pentru cine are `canSanction`: tipul, ținta (jucător căutat sau ID scris + tipul
  lui, IP, nume), scopul pe sancțiune („acest server” / „toate serverele”), serverul, motivul (obligatoriu, max 200),
  durata (presetări: 30 min, 1 h, 1 zi, 7 zile, 30 de zile, permanent, sau minute scrise), dovezile (până la 10 adrese
  `https`). Opțiunile arătate respectă drepturile (`sanctions.abilities`): serverele unde actorul e admin cu `d` / `v` /
  `i`, scopul global doar cu o intrare pe toate serverele, durata maximă pentru `v`. Serviciul verifică oricum totul.
- **Ridicarea:** motivul obligatoriu; jurnalul și revizia nouă vin din serviciu (partea A).

## 5. Contestații și reclamații

- **`/servers/tickets`:** tab-urile „Ale mele” și „De tratat” (doar cine poate trata ceva: `servers.tickets_manage` sau
  admin de server cu `d`), filtrele pe fel și stare (deschise / toate / fiecare stare), responsabilul.
- **Tichet nou:** felul (contestă un ban / reclamă un cheater / reclamă un admin); contestația alege din sancțiunile
  active ale membrului (`sanctions.mine`); reclamația de cheater: serverul, jucătorul (căutat) sau numele scris;
  reclamația de admin: serverul și adminul (lista adminilor serverului). Titlul (3–120), textul (editorul, aceleași reguli
  ca postările), dovezile (adrese `https`).
- **Pagina tichetului:** starea, felul, serverul, ținta, autorul, sancțiunea (cu link), dovezile, discuția (mesajele
  publice, notele interne marcate „Notă internă” doar pentru cine tratează, intrările de sistem pentru stare și
  responsabil), răspunsul (cu „Notă internă” pentru cine tratează), butoanele stărilor permise (cu motivul opțional și
  „Ridică sancțiunea” la acceptarea unei contestații), responsabilul („Preiau”, „Eliberez” sau, pentru staff, alegerea
  dintre cei care pot trata).
- Serviciul nou `tickets.handlerOptions(actor, id)`: cei care pot trata tichetul (pentru alegerea responsabilului).
  Rezumatul tichetului primește numele responsabilului (`assignee`).

## 6. Prezența adminilor

- **Pagina `/servers/admins`:** adminii activi (neexpirați) ai serverelor vizibile: online acum (serverul, de când),
  văzut în 24 h / 7 zile, timpul de joc pe 24 h / 7 zile / 30 de zile, ultima apariție, acțiunile din joc (7 / 30 de
  zile), tichetele tratate (30 de zile), „Inactiv” (peste `servers.admin_inactive_days`). Filtrul pe server. Cei online
  primii.
- **Vizibilitatea:** un admin al unui server ascuns viewer-ului nu apare; online pe un server ascuns nu se arată
  (`queries.adminPresence` filtrează după serverele vizibile).
- **Widget-ul „Admini online”** (`servers.adminsOnline`, toate zonele): adminii online acum (numele, serverul, de cât
  timp); câmpul „Câte elemente”. Citire ușoară: lista jucătorilor din ultimul heartbeat (Redis), fără istoricul
  sesiunilor (`presence.online`).
- **Indicatorul pe servere:** cardul din `/servers` și antetul paginii serverului arată „Admin online” (cu numărul) când
  în lista ultimului heartbeat e cel puțin un admin recunoscut; pagina serverului listează adminii de joc cu starea lor.
- **ACP → Gaming → Admini servere:** fiecare admin are ultima apariție și eticheta „Inactiv de N zile” / „Nevăzut
  niciodată”; antetul listei avertizează câți admini sunt inactivi, cu legătura spre setarea
  `servers.admin_inactive_days` (Bridge și ELO); filtrul „Doar inactivi”.

## 7. Meciurile mix și clasamentele

- **Live:** pagina serverului (mix) arată meciul în desfășurare (echipele, scorul, runda, jucătorii) din
  `queries.liveMatch`, actualizat prin camera `servers:{id}` (evenimentul `servers:match`); pagina meciului se
  actualizează prin camera `match:{id}` (`match:state`), iar rundele și ELO-ul se reîncarcă (reîmprospătarea paginii,
  cu întârziere) după fiecare schimbare. Fără realtime: `/api/servers/live` la 15 s pe pagina serverului și
  reîmprospătarea paginii meciului la 15 s cât timp meciul e deschis.
- **Clasamentul ELO:** locul, jucătorul (link), ELO-ul, vârful, meciurile, victoriile, procentul; pagini de 50.
- **Clasamentul clasic** al unui server: locul, jucătorul, ucideri, decese, K/D, headshot %, timp de joc; pagina
  serverului are primele 10, cu legătura spre tot clasamentul.
- **Istoricul meciurilor:** data, serverul, harta, echipele și scorul, starea; filtrul pe server.

## 8. Setări → Cont: „Conturi de joc”

- Explicația: Steam se leagă automat prin contul Steam conectat; celelalte identități prin cod.
- „Generează un cod”: codul de 6 caractere, mare, cu „Scrie în joc `/gcs COD`” și cât mai e valabil (10 minute); un cod
  nou îl anulează pe cel vechi; limita (5 / oră) apare ca eroare.
- Identitățile legate: tipul, încrederea, numele / ID-ul, cum a fost legată (Steam / cod / staff), data, link spre
  profilul de jucător, „Dezleagă” (nu pentru identitatea Steam legată prin contul Steam: aceea se dezleagă odată cu
  contul, mai sus).
- Doar cu aplicația Servere activă și `servers.link_identity` (fără drept: secțiunea arată doar lista).

## 9. Statisticile pe profilul membrului și în clanuri

- **Profilul membrului:** caseta „Statistici pe servere” în tab-ul „Jocuri” (K/D, ucideri, timp de joc, ELO, locul cel
  mai bun, ultima apariție) cu legătura „Profilul de jucător”; caseta conturilor (coloana laterală) are legătura spre
  profilul de jucător. Citire ușoară: `queries.userCard(actor, userId)`.
- **Clanuri:** furnizorul e înregistrat (partea A), deci caseta „Statistici de joc” arată cifrele reale. Indicația
  „conectează Steam” nu mai apare unui membru care are o identitate de joc legată (Steam sau prin cod): interfața
  `GcsPlayerStatsProvider` primește metoda opțională `linkedUsers(userIds)` (citită de clanuri doar prin hub).

## 10. Meniul (`nav:v6`)

Itemul „Servere” devine un submeniu, cu copiii impliciți: **Toate serverele** (`/servers`), **Clasament**
(`/servers/leaderboard`), **Meciuri mix** (`/servers/matches`), **Banuri** (`/bans`), **Admini** (`/servers/admins`),
**Contestații** (`/servers/tickets`). Itemul rămâne legat de aplicația Servere (dezactivată → dispare cu tot submeniul).

- **Instalare nouă:** meniul implicit are direct submeniul.
- **Instalare existentă (marcajul `nav:v6`, o singură dată, `GcsNavService.appendDefaultChildren`):** sub fiecare item
  implicit de pe primul nivel găsit neschimbat (aceeași etichetă-cheie, același link, aceeași aplicație) se adaugă la
  coadă, **activi**, copiii impliciți al căror link lipsește din submeniul lui. Itemii creați sau redenumiți de admin nu
  se ating; un copil implicit al cărui link adminul l-a pus singur pe primul nivel (ex. Banuri) nu se dublează.
- Copiii poartă și ei `since` (marcajul care i-a adus), ca recunoașterea meniului nemodificat la marcajele vechi
  (`nav:v3`, `nav:v4`) să rămână corectă.

## 11. Securitate și performanță

- Fiecare pagină verifică aplicația și dreptul în serviciu (și în pagină pentru 404). IP-urile doar cu
  `servers.view_ips` (serviciul le golește), notele interne doar pentru cine tratează (serviciul nu le citește altfel).
- Formularele: Server Actions cu CSRF (Origin), Zod și erorile serviciului; căutarea jucătorilor are limită pe IP.
- Fără N+1: listele încarcă relațiile într-o singură citire; numele responsabililor într-o citire pe pagină; prezența
  într-un număr fix de citiri. Paginare peste tot (50 / 30).
- Imaginea hărții: redirect cu cache public 5 minute; numele hărții validat (`[a-z0-9_.-]`, max 64).

## 12. Teste

- **Unitare (`@gcs/core`):** `nav:v6` (copiii adăugați activi sub itemul neschimbat; itemii adminului neatinși; fără
  dubluri; o singură dată; instalarea nouă).
- **Unitare (`@gcs/modules`):** filtrul `scope` al listei, `sanctions.mine`, `sanctions.abilities`,
  `tickets.handlerOptions` și responsabilul în rezumat, `presence.online`, `queries.adminPresence` (vizibilitatea),
  `queries.serverAdminsOnline`, `queries.userCard`, `linkedUsers` al furnizorului.
- **E2E (`servers-pages.spec.ts`):** serverul fals generează datele (meci, ucideri, ban); profilul jucătorului cu toate
  tab-urile, clasamentele, istoricul și pagina meciului, `/bans` (căutare, filtre, detaliu), sancțiunea dată de staff de
  pe site și ridicată, contestația (creare, coada staff-ului, notă internă invizibilă autorului, acceptare cu ridicare),
  „Conturi de joc” (codul, legarea prin `/gcs COD` din serverul fals, dezlegarea), prezența adminilor și widget-ul,
  meniul (submeniul Servere). Capturi în temele întunecată și luminoasă, desktop și 375 px.
