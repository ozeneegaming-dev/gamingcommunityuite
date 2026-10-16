# Hero Cockpit și constructorul de antet

- **Data:** 2026-10-10
- **Cererea proprietarului:** un antet nou pentru GCS Nova, aprobat pe macheta interactivă („bravo, așa trebuie să arate”):
  căutarea într-un panou, „+ Creează”, mesajele și notificările, avatarul cu inelul de XP, meniul cu mega meniuri, meniul
  contului cu cardul de rang, consola de sub antet (feed, meci live, top) și benzile serverelor; apoi (2026-10-10) un
  **constructor de antet** în editorul vizual, cu presetări (Nova clasic, Cockpit, Centrat, Panou lateral, Esports) și
  starea compactă la derulare, cu tranziția aprobată („bravo, perfect, așa rămâne”).
- **Regula de bază:** design original GCS. Machetele sunt referința de structură și comportament; nu se copiază cod,
  imagini sau nume ale altor platforme.

## 1. Constructorul de antet (`packages/core/src/themes/headerBuilder.ts`)

- O grilă **3 rânduri × 3 zone** (bara de sus, rândul principal, rândul secundar × stânga, centru, dreapta), separat
  pentru **desktop, tabletă și mobil** (`header.layout` în setările temei, validat strict: chei cunoscute, fiecare
  element o dată pe dispozitiv, cel mult 12 pe zonă).
- **Elementele:** logo, navigație (și partea ei din dreapta, pentru meniul împărțit), căutare (iconiță sau câmp),
  Creează, Mesaje, Notificări, Cont, breadcrumb, status servere live, rețele sociale, comutator temă, limbă,
  text/HTML propriu. Aplicațiile își adaugă elementele cu cheia `aplicație.element` (acum `chat.button`,
  `servers.playNow`); un element al unei aplicații oprite nu apare.
- **Presetările** sunt aspecte gata făcute ale aceleiași grile; „Nova clasic” neatins păstrează antetul de până acum
  (alt component), orice altă presetare sau mutare folosește antetul construit.
- **Esports:** sus rețelele sociale („Urmărește-ne”) și, în dreapta, Înregistrare / Autentificare pentru vizitatori
  sau acțiunile membrului; jos meniul împărțit în jurul **crestăturii** trapezoidale cu logo-ul (bare de accent
  înclinate), căutarea pătrată în dreapta; etichetele în Chakra Petch, majuscule. Adminul alege itemii din dreapta
  (`header.layout.split`; implicit jumătate-jumătate). Pe mobil: meniul stânga, logo-ul centru, contul dreapta.
- **Starea compactă** (toate presetările, `header.compact`): după 120 px de derulare.
  - Esports (doar CSS): rândul de sus 76 → 0 cu fade, meniul 94 → 74 px, crestătura la 0,68 din centrul de sus
    (rămâne agățată sub bară), umbra antetului; 0,3 s, `cubic-bezier(.22,1,.36,1)`, inversă la urcare.
  - Celelalte presetări: un singur rând cu logo-ul, meniul și iconița de căutare (`compactHeaderLayout`); acțiunile
    contului revin la urcare.
  - Opțional `header.hideOnScroll` (dispare la derularea în jos, revine la urcare). Cu `prefers-reduced-motion`,
    fără animație.
- **Setări:** înălțimea fiecărui rând, antet fix, compact, ascuns la derulare, iconițele meniului, meniurile la click
  sau la hover, mega meniuri, alinierea meniului, textul/HTML-ul propriu (sanitizat la afișare).
- **Mobil:** iconițele în antet sau într-o **bară jos** (`mobileNav.placement`), cu textul sub iconițe opțional și
  elementele alese (1–5; implicit Forum, Servere, + Creează în centru, Mesaje, Notificări).
- **Dispozitivul** se ghicește pe server din user-agent (prima randare), apoi după lățime (< 768 mobil, < 1100
  tabletă). Elementele sunt randate o singură dată pe server; `GcsHeaderFrame` le așază în client.

## 2. Elementele antetului

- **Căutarea** (iconița sau câmpul, Ctrl+K de oriunde): câmpul, domeniile (Tot, Topicuri, Postări, Membri, Servere,
  Jucători, Clanuri: doar aplicațiile instalate și drepturile lor), filtrele forumului (forum, autor, perioadă, doar
  titluri), rezultatele rapide cu eticheta tipului (`/api/search/quick`), căutările recente (în browser), indiciile de
  tastatură și „Căutare avansată →” (pagina completă a domeniului). Enter fără selecție deschide pagina completă.
- **„+ Creează”** (`/api/header/create?path=`): itemii vin din aplicații și drepturi (mesaj privat, clan, contestație,
  sancțiune, „Topic nou în…” pentru forumurile în care poți posta); într-un forum sau topic, primul item e
  „Topic nou în <forum>”.
- **Mesaje:** numărul de necitite (live) și ultimele conversații (`/api/header/messages`). **Notificări:** clopoțelul
  existent.
- **Contul:** avatarul cu **inelul de XP**, insigna nivelului, numele stilizat și „x% până la Nv n”. Nivelul = locul
  rangului în scară (`levelProgress`), progresul pe pragul rangului următor (XP, apoi postări, apoi reputație).
  - **Cardul de rang:** numele, pastilele grupurilor (`/members?group=<id>`), statusul Online / Invizibil (legat de
    „Arată când sunt online”), nivelul și rangul, bara, „Mai ai N … până la rangul X”, postările, reputația și ELO-ul
    mix (cu Servere).
  - **Secțiunile:** Conținutul meu (profilul, conținutul, atașamentele, ce urmăresc, cu numerele), Gaming (profilul de
    jucător cu ELO, clanul, conturile legate: doar cu aplicațiile), Setări (contul, notificările, confidențialitatea,
    Studio VIP când pluginul e pornit), Staff (coada de moderare cu numărul, editorul temei, „Editează pagina”, ACP:
    doar cu drepturile lor).
  - **Rândul de jos:** tema întunecată / luminoasă, limba, ieșirea (nuanță roșie).
  - Pagini noi în Setări: **Ce urmăresc** și **Atașamentele mele**.
- **Mega meniurile:** itemii cu submeniu, pe 2 coloane: iconița, titlul, descrierea de un rând (Manager meniu →
  câmpul nou „Descriere”, pe limbi; implicit textul `site.navDesc.*` al itemilor standard), insigna fixă („NOU”) sau
  live (`N ONLINE`, `N LIVE` din aplicații) și rândul de jos cu o linie live și un îndemn (Servere: „Joacă acum” spre
  cel mai bun server; Comunitate: „Vezi cine e online”; VIP: „Devino VIP”).
- **Status servere live:** serverele online, jucătorii și meciurile live (actualizate din camerele serverelor).

## 3. Consola Hero Cockpit (sub antet)

- Setările temei `cockpit.*`: pornită / oprită (implicit oprită), **doar pe pagina principală** (implicit) sau pe toate
  paginile, ce widget în fiecare din cele 3 panouri (Feed live, Live acum, Top, Recomandate, nimic; implicit Feed /
  Live / Top) și imaginea de fundal (implicit grafica GCS).
- **Banda personală:** bun venit, topicurile necitite, prietenii (membrii urmăriți) online și pe ce server joacă,
  rangul și XP-ul, „Profilul meu →”.
- **Feed live:** tab-urile Tot / Forum / Servere / Mix (fluxul de activitate, intrările membrilor pe servere, meciurile
  mix încheiate cu ELO-ul câștigat); rândurile noi intră animat.
- **Live acum:** meciul mix în desfășurare (scorul, echipele, primii jucători, Urmărește (HLTV) / Conectează-te / Toate
  meciurile), actualizat din camera meciului; fără meci live, recomandatele (topicurile evidențiate).
- **Top:** Postatori / Jucători (ELO mix) / Clanuri / Timp online, perioada Azi / Săpt. / Lună / An / Tot (fără perioadă
  la jucători și clanuri). **Primele 3 locuri mereu aur / argint / bronz:** trofeul într-o insignă pătrată rotunjită
  nuanțată, rândul nuanțat cu chenar și lumină, inelul pe avatar, valoarea colorată; de la 4, numărul într-o insignă
  neutră pe un card discret. Pastila perioadei alunecă între opțiuni.
- **Benzile serverelor:** o bandă pe server, umplerea și culoarea = ocuparea, click = conectare, eticheta accesibilă cu
  detaliile; **„Joacă acum”** alege serverul cel mai plin care mai are locuri. Ascunse fără aplicația Servere.
- **Mobil:** cardul LIVE primul, panourile ca un șir de carduri cu puncte, serverele ca cipuri.
- **Live:** semnalul `activity:new` (camera `presence`, fără date) la postări noi și meciuri încheiate reîmprospătează
  feed-ul și topul; serverele pe camerele lor; meciul pe camera lui. Prima randare vine de pe server (când pagina
  cerută e una pe care apare consola, după header-ul intern `x-gcs-path`); după o navigare fără reîncărcare, datele se
  cer de la `/api/cockpit`.

## 4. Clasamentul și timpul online

- **Timpul online:** fiecare semn de prezență al unui membru adaugă pauza de la semnul precedent (dacă e ≤ 5 minute)
  la totalul zilei (fusul orar al site-ului) în Redis; jobul de 5 minute (și citirile) copiază totalurile în
  `member_online_days` (valoarea cea mai mare câștigă). Afișat ca „1h 35m”. Membrii cu statusul ascuns nu apar în
  clasamentul timpului online. Ștergerea / unirea conturilor tratează zilele (șterse / adunate).
- **Clasamentul** (`GcsLeaderboard`): măsurile noi `topics` și `online`, perioadele noi `day` (de la miezul nopții) și
  `year` (365 de zile), locul viewer-ului (`place`). Pagina `/leaderboard` le arată.
- **Widget-ul „Clasament”** (`core.ranking`, un singur widget): tab-urile Postări / Topicuri / Reputație / Timp online,
  perioada, primele 3 cu trofee, butonul de mesaj pe fiecare rând, „Tu: locul X …” și „Clasament complet →”.

## 5. Editorul vizual

- Panoul **Constructor antet** (doar Nova): presetările, tab-urile Desktop / Tabletă / Mobil (previzualizarea trece pe
  același dispozitiv), grila cu **drag & drop** între zone și rânduri și tava „Nefolosite”; cu tastatura: Enter alege,
  săgețile mută, Delete scoate (anunțat pentru cititoarele de ecran). Alegerea itemilor din dreapta logo-ului pentru
  meniul împărțit. Setările rândurilor și ale meniurilor.
- Panoul **Consola Hero Cockpit**: pornită, paginile, panourile, imaginea de fundal (încărcare).
- **Navigarea pe mobil:** locul iconițelor, textul din bara de jos, elementele barei (ordonate).
- Totul intră în draft, previzualizarea se schimbă live (mesajul `apply` poartă aspectul antetului; trecerea de la /
  la antetul clasic reîncarcă previzualizarea) și se aplică la „Salvează”.

## 6. Hover, tranziții, sweep

- **Sweep-ul de sticlă** pe orice element de tip buton (butoane, iconițe pătrate, tab-uri, segmente, paginare, cipuri,
  itemi de meniu / dropdown / sugestii): un strat alb transparent (8 %; 30 % pe butoanele deschise) ca
  `background-image`, cu `background-size` 0 % → 100 % din stânga; intrarea `cubic-bezier(.52,1.64,.37,.66)` 1,2 s,
  ieșirea ease-out 1,2 s. Regulile de hover schimbă doar `background-color`. Butonul plin: umbră de accent; cel
  conturat: chenarul alb 22 %, textul alb. Fără mișcare redusă: schimbare imediată.
- Tranziții comune (`--gcs-dur-*`, `--gcs-ease-out`): dropdown-uri fade + 6 px, săgeți rotite, liste live cu intrare
  animată, pastila activă alunecă, imaginile apar cu fade și se măresc 1,1 în carduri. Rândurile din consolă și
  widget-uri: doar fundalul se luminează (fără ridicare, fără chenar de accent).

## 7. Accesibilitate

Meniurile au `aria-expanded`, Escape închide și readuce focusul pe buton, săgețile mută între itemi, panourile de
dialog (căutarea, contul) țin focusul (Tab), închise sunt `inert`. Fără scroll orizontal la 375 px. Întunecat și
luminos (antetul rămâne închis, consola urmează tokenurile temei).

## 8. Teste

- `@gcs/core`: constructorul de antet (presetări, validare, mutări, starea compactă, meniul împărțit, setările noi),
  descrierea și insigna itemilor de meniu.
- `@gcs/modules`: timpul online (pauze, fusul orar, copierea, perioade, ștergere / unire), clasamentul (topicuri,
  azi, timpul online, locul), nivelul, semnalul de activitate.
- `apps/web`: „+ Creează”, dispozitivul, rezumatul live (insigne, rândul de jos, „Joacă acum”, ocuparea), textele în 6
  limbi; E2E `hero-cockpit.spec.ts` (antetul Esports și starea compactă, mega meniurile, căutarea și Ctrl+K,
  „Creează” pe aplicații, meniul contului pe drepturi, consola pornită / oprită, trofeele, widget-ul, bara de jos pe
  mobil, constructorul din editor cu drag & drop și presetări).
