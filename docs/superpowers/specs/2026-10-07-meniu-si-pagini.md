# Meniul principal și paginile noi: Activitate, Clasament, VIP, Reguli

- **Data:** 2026-10-07
- **Decizia proprietarului:** meniul (Forum, Chat, Membri, Staff) e incomplet. Se adaugă **Activitate**, **Clasament**,
  **VIP**, **Reguli**, iar **Membri** devine un submeniu: Toți membrii, Online acum, Staff, Clasament.
- **Locul în cod:** meniul e cel din ACP → Sistem → Manager meniu (`NavItem`, `GcsNavService`); itemii impliciți vin din
  câmpul `nav` al modulelor. Paginile noi stau în `apps/web/app/(site)/`, serviciile în `packages/modules`.

## 1. Direcția vizuală

### 1.1 Planul
GamingCommunitySuite are deja o identitate: fundal aproape negru, accent roșu, titluri în Chakra Petch (unghiulară,
„de joc”), text în Manrope, marcajul logo-ului înclinat (`skewX(-12deg)`). Paginile noi nu inventează alt limbaj; îl
duc mai departe și își cheltuie îndrăzneala într-un singur loc: **podiumul clasamentului**.

| Rol | Valoare | Folosire |
|---|---|---|
| Fundal / suprafețe | `--gcs-bg`, `--gcs-surface`, `--gcs-surface2` | tot (tema le poate schimba) |
| Accent | `--gcs-accent` (#D62839) | linkul activ (linia de jos), butonul principal |
| Aur | #F4B740 (= `--gcs-warn`, culoarea grupului VIP Gold) | locul 1 |
| Argint | #D8DFEA (culoarea grupului VIP Silver) | locul 2 |
| Bronz | #CD7F32 (culoarea grupului VIP Bronze) | locul 3 |
| Tipurile din Activitate | chihlimbar (topic), albastru (răspuns), `--gcs-ok` (status) | iconița mică de lângă avatar |

- **Tipografie:** Chakra Petch pentru titlurile paginilor, cifrele locurilor și valorile din clasament (cifre tabulare);
  Manrope pentru tot restul. Fără etichete în majuscule deasupra titlurilor; numerotarea apare doar unde conținutul chiar
  e o ordine (locurile din clasament).
- **Aliniere:** totul la stânga, pe coloana paginii; textul lung (reguli, fragmentele din Activitate) are maximum ~72 de
  caractere pe rând.
- **Principii:**
  1. Structura spune ceva: zilele din Activitate grupează cu adevărat, locurile din clasament sunt o ordine reală,
     culoarea unui plan VIP e culoarea grupului lui.
  2. Mișcare doar ca răspuns la o acțiune (deschiderea submeniului, a sertarului); `prefers-reduced-motion` o oprește.
  3. Totul vine din tokenurile temei, ca editorul vizual și temele luminoase să funcționeze fără excepții.

```
Clasament
[Reputație] [Postări] [XP] [Soluții]               (Săptămâna | Luna | Tot timpul)

            ┌──────────┐
 ┌────────┐ │   (A1)   │ ┌────────┐
 │  (A2)  │ │  Nume 1  │ │  (A3)  │      ← avatar mare, nume stilizat, grup
 │ Nume 2 │ │   1 240  │ │ Nume 3 │
 │   980  │ ├──────────┤ │   640  │      ← valoarea în Chakra Petch
 ├────────┤ │    1     │ ├────────┤
 │   2    │ │          │ │   3    │      ← soclu înclinat, culoarea metalului
 └────────┘ └──────────┘ └────────┘
 #4   (a) Nume 4     Grup         512
 #5   (a) Nume 5     Grup         498
```

### 1.2 Revizia planului (ce era generic și ce am schimbat)
- **VIP:** prima idee era un „tabel de prețuri” clasic: carduri identice, unul evidențiat „Cel mai popular”, fundal în
  degrade. E șablonul oricărui SaaS și nici nu avem prețuri stocate. **Acum:** fiecare plan arată *ce primești de fapt*:
  numele tău randat cu stilul grupului (aceeași clasă `gcs-name--<cheie>` ca peste tot pe site), culoarea și iconița
  grupului ca margine și semn, iar beneficiile sunt calculate din drepturile grupului față de un membru obișnuit. Fără
  „Cel mai popular”, fără degrade decorative.
- **Activitate:** prima idee era câte un card pentru fiecare eveniment. Un flux de zeci de carduri identice devine
  zgomot. **Acum:** o listă continuă, grupată pe zile (Azi, Ieri, data), cu avatarul autorului și o iconiță mică de tip;
  doar titlul topicului e evidențiat.
- **Reguli:** prima idee era un banner mare deasupra textului. Regulile se citesc, nu se admiră. **Acum:** o coloană de
  document (max ~72 de caractere), cu data ultimei actualizări sub titlu.
- **Clasament:** rămâne locul îndrăzneț: soclurile sunt înclinate ca marcajul logo-ului, în culorile metalelor (care sunt
  deja culorile grupurilor VIP), iar locul 1 e mai înalt. Tabelul de sub podium e liniștit.

## 2. Meniul

### 2.1 Structura implicită

| Poz. | Etichetă | Iconiță | Link | Note |
|---|---|---|---|---|
| 0 | Forum | `fa-comments` | `/` | |
| 5 | Activitate | `fa-bolt` | `/activity` | |
| 10 | Chat | `fa-comment-dots` | `/chat` | legat de aplicația Chat (`appKey`) |
| 20 | Membri ▾ | `fa-users` | `/members` | submeniu: |
|  | ↳ Toți membrii | `fa-user-group` | `/members` | |
|  | ↳ Online acum | `fa-signal` | `/members?online=1` | |
|  | ↳ Staff | `fa-shield-halved` | `/staff` | |
|  | ↳ Clasament | `fa-ranking-star` | `/leaderboard` | |
| 40 | Clasament | `fa-ranking-star` | `/leaderboard` | |
| 50 | VIP | `fa-crown` | `/vip` | legat de aplicația VIP (`appKey`) |
| 60 | Reguli | `fa-scale-balanced` | `/rules` | ascuns automat cât timp regulile sunt goale |

Bara: **Forum · Activitate · Chat · Membri ▾ · Clasament · VIP · Reguli**. Clasamentul apare și în submeniul Membri
(cum a cerut proprietarul) și pe bară (e o pagină pe care oamenii o caută direct). Dublura e tratată explicit:
- pe bară, butonul **Membri** nu se aprinde pe `/leaderboard` (se aprinde Clasament);
- în sertarul de pe mobil, un subitem care repetă un link de pe primul nivel nu se mai afișează.

Toți itemii sunt rânduri obișnuite în Manager meniu: adminul îi poate redenumi, muta, ascunde pe grupuri sau
dezactiva. Etichetele implicite sunt chei de traducere (`site.nav.*`), deci apar în limba vizitatorului.

### 2.2 Desktop (> 1024 px) și stările active
- Itemii cu copii devin dropdown (`GcsDropdown`, `role="menu"`): Enter / Spațiu / săgeata în jos îl deschid, săgețile,
  Home și End mută focusul, Escape îl închide și readuce focusul pe buton.
- **Linkul activ** se alege o singură dată pentru tot meniul: dintre linkurile a căror cale se potrivește cu pagina
  (egală sau prefix, „/” doar exact) și ai căror parametri (`?online=1`) sunt toți în adresa curentă, câștigă cel cu
  mai mulți parametri, apoi cel cu calea mai lungă. Astfel, pe `/members?online=1` e activ „Online acum”, nu și
  „Toți membrii”.
- Linkul activ primește `aria-current="page"` și stilul existent (`gcs-nav__link--active`: fundal + linia de accent).
  Un dropdown e activ când unul dintre copiii lui e activ (fără dublura de mai sus); în listă, copilul activ are
  `aria-current="page"` și o bară de accent în stânga.

### 2.3 „Mai mult” pe lățimi medii
Cu șapte butoane, logo, căutare, clopoțel, mesaje și meniul contului, bara e strânsă. Butoanele barei au un padding mai
mic decât `.gcs-nav__link` de bază (10 px, iconița la 6 px de text), ca bara implicită să încapă întreagă la lățimea
maximă a paginii (1320 px) cu un nume de cont obișnuit. Sub ea (și mai devreme în germană sau cu un nume lung):
**priority+**:
- meniul ocupă tot spațiul dintre logo și unelte; un `ResizeObserver` măsoară lățimile butoanelor (la montare, la
  redimensionare, după încărcarea fonturilor și la schimbarea etichetelor) și câte încap;
- butoanele care nu încap (de la coadă) sunt scoase din bară (`visibility: hidden`, `inert`, fără spațiu ocupat) și apar
  în dropdown-ul **Mai mult** (`fa-ellipsis`), în aceeași ordine; un item cu submeniu apare acolo ca titlu de secțiune
  urmat de copiii lui, fără subitemii care repetă un item mutat tot acolo (Clasament);
- „Mai mult” e activ când pagina curentă e printre itemii mutați;
- înainte de hidratare, bara are `overflow: hidden` cu marginea dreaptă estompată, deci nu se suprapune niciodată peste
  unelte și nu arată o etichetă tăiată brusc.

### 2.4 Mobil (≤ 1024 px): sertarul
- Butonul ☰ deschide sertarul (`role="dialog"`, `aria-modal`); focusul intră pe primul link, Tab rămâne în sertar,
  Escape sau un click în afară îl închid și readuc focusul pe ☰.
- Itemii simpli sunt linkuri; **Membri** e un buton-dezvăluire (`aria-expanded`, săgeata se rotește) cu subitemii
  indentați sub el, pe o linie verticală. Grupul e deschis din start dacă pagina curentă e în el.
- Linkul activ: `aria-current="page"` + fundalul existent (`gcs-drawer__link--active`).

### 2.5 Ascunderi automate
- **VIP** și **Chat** dispar când aplicația lor e dezactivată (`appKey`, mecanismul existent).
- **Reguli** dispare (de pe bară, din „Mai mult” și din sertar) cât timp regulile sunt goale. Pagina `/rules` rămâne
  accesibilă și arată o stare goală.

### 2.6 Instalările existente (migrarea meniului)
Seed-ul are un marcaj nou, `nav:v2` (lângă `nav`):
- **instalare nouă:** meniul se creează direct în forma nouă;
- **meniu nemodificat** (identic cu meniul implicit vechi: Forum, Chat, Membri, Staff, cu etichetele, iconițele și
  linkurile implicite, toate active, fără grupuri, fără subitemi): e înlocuit cu meniul nou;
- **meniu modificat de admin:** nu se schimbă nimic din ce a făcut adminul. Itemii noi de pe primul nivel al căror link
  nu există deja în meniu (Activitate, Clasament, VIP, Reguli) sunt **adăugați la coadă, dezactivați**: adminul îi vede
  în Manager meniu și îi activează dacă vrea.
- Rulează o singură dată (marcajul), în aceeași tranzacție cu restul seed-ului; după seed, cache-ul meniului (tag
  `nav`) e invalidat la pornire.
- Meniul implicit vechi e declarat de module (`navPrevious`), nu scris în nucleu.

## 3. Activitate (`/activity`)
```
Activitate                                                      
Ce s-a întâmplat recent în comunitate.
[Tot] [Topicuri] [Răspunsuri] [Statusuri]            [ ] Doar necitite (membri)

Azi
 (av)▪ Mara a deschis topicul  Cum setez serverul?           [Ajutor]   acum 5 min
       Am instalat ultima versiune și...
 (av)▪ Ion a răspuns în  Turneul de vineri               [Evenimente]   acum 1 h
 (av)▪ Ana și-a actualizat statusul                                    acum 2 h
       Diseară stream de la 21:00!
 (av)▪ Radu s-a alăturat comunității                                   acum 3 h
Ieri
 ...
                                [ Mai vechi ]
```
- **Conținutul:** topicuri noi, răspunsuri, statusuri de profil (doar cele de pe primul nivel) și, la „Tot”, membrii noi.
  Cele mai noi primele, 25 pe pagină, paginare cu cursor (`?before=`), deci adrese stabile și randare pe server;
  „Cele mai noi” readuce la început.
- **Permisiunile, exact ca la căutare și la listele de topicuri:**
  - topicuri / răspunsuri doar din forumurile cu `forums.read` pentru viewer (`filterContainers`), doar postări
    `VISIBLE` în topicuri `VISIBLE` (nimic în așteptare sau ascuns, nici pentru moderatori: fluxul e public);
  - statusuri doar `VISIBLE`, doar de pe profilurile pe care viewer-ul le poate vedea (regula `canView`: PUBLIC; MEMBERS
    pentru membri; FOLLOWED dacă proprietarul îl urmărește; staff-ul cu `profile.moderate` vede tot) și doar cu
    `core.view_public`;
  - membrii noi: fără cei banați și cu aceeași regulă de profil;
  - autorii ignorați de viewer (ignorarea postărilor) nu apar;
  - un viewer banat nu vede nimic.
- **„Doar necitite”** (doar membri): topicurile și răspunsurile pe care nu le-a citit, cu aceeași regulă ca indicatorul
  de necitit (marker-ul topicului, „marchează tot citit” pe forum, ultimele 60 de zile, după înregistrare); propriile
  postări nu sunt necitite. Statusurile și membrii nu au stare de citire, deci nu apar cu filtrul.
- **Cache:** fluxul vizitatorilor (cel mai des cerut) e păstrat 30 s în Redis, pe cheia formată din forumurile citibile,
  filtru și cursor (tag `forums-tree`, invalidat la orice postare). Membrii primesc fluxul direct (depinde de urmăriri,
  ignorări și necitite); interogările folosesc indexuri noi pe `createdAt` (migrația `20261023000000_activity_indexes`:
  topicuri, postări, statusuri, plus reacții și jurnalul XP pentru clasament).
- Cursorul e (momentul exact din bază, până la microsecunde; tipul; id-ul), deci paginile nu sar și nu repetă rânduri.
- Stare goală: „Nimic încă. Fluxul se umple pe măsură ce membrii postează.”; cu „Doar necitite”: „Ești la zi: nimic
  necitit.”

## 4. Clasament (`/leaderboard`)
- **Măsuri:** Reputație, Postări, XP (din realizări), Soluții. **Perioade:** Săptămâna (ultimele 7 zile), Luna
  (ultimele 30 de zile), Tot timpul. Linkuri (`?metric=&period=`), deci randare pe server și adrese partajabile.
- **Valorile pe perioadă** (calculate din ce s-a creat în perioadă):
  - Reputație: suma ponderilor reacțiilor primite în perioadă pe postări și statusuri;
  - Postări: postările vizibile din topicuri vizibile, create în perioadă (aceeași regulă ca contorul);
  - XP: punctele din jurnalul realizărilor primite în perioadă;
  - Soluții: răspunsurile create în perioadă care sunt marcate „cel mai bun răspuns”.
  „Tot timpul” folosește contoarele userului (`reputation`, `postsCount`, `points`, `solutionsCount`).
- **Cine apare:** doar valori > 0; fără membrii banați (grupul „Banat” principal sau secundar, ori un ban de cont activ);
  confidențialitatea profilului: vizitatorii văd doar profilurile publice, membrii și pe cele „doar membri”, staff-ul
  (`profile.moderate`) pe toți. Accesul la pagină cere `core.members_list`, ca lista de membri.
- **Afișare:** podiumul (locurile 1–3, ordinea vizuală 2-1-3; pe mobil 1-2-3 pe verticală) și tabelul locurilor 4–50:
  locul, avatarul cu rama, numele stilizat (`gcs-name--<cheie>`), grupul (iconița în culoarea lui, textul neutru, ca să
  rămână lizibil și pe tema luminoasă), valoarea. Rândul viewer-ului e evidențiat. Egalitățile au același loc (1, 2, 2,
  4). Perioada implicită: Luna.
- **Cache:** 5 minute pe (măsură, perioadă, public), tag `leaderboard` + `user:<id>` pentru cei din listă.

## 5. VIP (`/vip`)
- **Planurile** sunt grupurile VIP (`isVip`), în ordinea din ACP. Pentru fiecare: iconița și culoarea grupului, un nume
  de exemplu randat cu stilul grupului, beneficiile și butonul de acțiune.
- **Beneficiile** se calculează, nu se scriu de mână: drepturile de grup unde planul are mai mult decât grupul Membru
  (ex. „Poate crea camere private”, limite mai mari), forumurile la care planul are acces în plus (doar cele pe care
  viewer-ul le poate vedea) și stilurile de nume / ramele de avatar deblocate de plan.
- **Preț și durată** nu sunt stocate încă: planul spune „Durata și prețul le stabilești cu staff-ul”.
- **Butonul:** „Contactează staff-ul”, cu linkul din ACP → VIP → Pagina VIP (setarea `vip.contact_url`, implicit
  `/staff`), plus un text de introducere opțional (`vip.page_intro`). **Cârligul pentru plăți:** serviciul paginii
  primește un `checkout(plan, viewer)` opțional; azi lipsește, iar când vine magazinul întoarce linkul de plată și
  butonul devine „Cumpără” fără alte schimbări în pagină.
- **Viewer-ul VIP** vede sus planul lui și expirarea („expiră pe 12 nov. 2026, în 36 de zile” sau „fără expirare”).
- Aplicația VIP dezactivată: pagina răspunde 404 și itemul dispare din meniu.

## 6. Reguli (`/rules`)
- **Editarea:** ACP → Setări → Reguli comunitate (`/admin/settings/rules`, secțiunea `system.settings_rules`), cu
  editorul standard al postărilor (`GcsEditor`, fără încărcări). Salvarea trece prin același randator ca postările
  (`posting.render`: validarea documentului, HTML sanitizat) și păstrează documentul JSON și HTML-ul (setările
  într-o singură setare JSON, `rules.content` = `{ doc, html, updatedAt }`); jurnalul ACP primește modificarea
  (`settings.update`). Un document gol (sau „Șterge regulile”) șterge regulile. La afișare, HTML-ul mai trece o dată prin
  sanitizer.
- **Pagina:** titlul, „Actualizat pe …”, apoi textul în coloana de document (`gcs-postBody`). Fără reguli: o stare goală
  („Regulile nu au fost publicate încă.”) și, pentru cine are dreptul, linkul „Scrie regulile” spre ACP.
- Itemul din meniu se ascunde singur cât timp regulile sunt goale (§2.5).

## 7. Texte
Toate textele noi sunt în `apps/web/messages/{ro,en,de,es,fr,ru}.json`: ro și en scrise de mână, de/es/fr/ru cu textul
englez (traduse automat mai târziu). Testul de paritate (`lib/i18n-messages.test.ts`) și garda de branding trec.

## 8. Teste
- **Unitare:** clasamentul (valorile pe perioadă, „tot timpul”, excluderea banaților, confidențialitatea, ordinea),
  fluxul de activitate (conținutul din forumurile ascunse și postările ascunse / în așteptare nu apar niciodată;
  statusurile profilurilor private; filtrele; necititele; cursorul), migrarea meniului (instalare nouă, meniu nemodificat,
  meniu modificat, idempotența), potrivirea linkului activ și ascunderea itemilor.
- **E2E:** meniul pe desktop (submeniul Membri din tastatură, „Online acum”), „Mai mult” pe lățime medie, sertarul de pe
  mobil, apoi fiecare pagină: Activitate (fără conținutul unui forum ascuns, filtrele), Clasament (podium, perioade),
  VIP (planurile, planul viewer-ului VIP), Reguli (starea goală și itemul ascuns, editarea din ACP, pagina publicată).

## 9. În afara scopului
- Prețurile, plata și checkout-ul VIP (magazinul): doar cârligul de mai sus.
- „Locul tău” pentru cine nu e în primii 50 din clasament.
- Cuprinsul automat al regulilor (din titluri).
