# Hover card-ul membrului și coperta în postbit

Data: 2026-10-07 · Stare: implementat · Sursa: rapoartele proprietarului (cardul apare departe de nume, arată
„buguit” și neordonat; coperta nu apare în postbit; statusul online apare de două ori în postbit)

## Scop

1. Cardul care apare la hover pe un nume stă **lipit de nume** (8 px), deasupra sau dedesubt, după spațiul real.
2. Cardul are o ordine clară: coperta sus, apoi identitatea **sub** copertă (numele nu se mai desenează peste
   imagine), apoi insignele, câmpurile, contoarele și acțiunile.
3. Coperta aleasă de membru („bannerul”) apare și în postbit, ca fundal al blocului cu avatarul și numele.
4. Postbit-ul arată statusul online o singură dată (sus, lângă @handle).

Direcția vizuală e cea existentă (carduri întunecate, `--gcs-surface`, `--gcs-border`, roșul de accent, Chakra Petch
pentru titluri și cifre, Manrope pentru text). Singurul element „îndrăzneț”: **cusătura de accent** — o linie de 2 px
în culoarea de accent a membrului sub copertă, pe care stă avatarul. Restul rămâne liniștit.

## Tokenuri folosite

| Rol | Token | Întunecat | Deschis |
| --- | --- | --- | --- |
| Fundalul cardului, inelul avatarului | `--gcs-surface` | #14161C | #FFFFFF |
| Panoul câmpurilor | `--gcs-surface2` | #1B1E26 | #EEF0F3 |
| Margini, separatoare | `--gcs-border` | #262A34 | #D9DCE2 |
| Text / text secundar | `--gcs-text` / `--gcs-muted` | #ECEDF1 / #A1A7B4 | #14161C / #5B6170 |
| Online | `--gcs-ok` | #3DDC97 | #3DDC97 |
| Accentul membrului | `user.accentColor` (implicit #D62839) | — | — |

Nicio culoare fixă nouă pentru suprafețe: tema deschisă merge doar prin tokenuri. Singurele valori fixe sunt
umbrele și voalurile negre peste imagini (o imagine are aceeași luminozitate în ambele teme).

## 1. Hover card-ul

### Structura (de sus în jos)

```
┌──────────────────────────────────────────┐  340 px (max: lățimea ecranului − 24 px)
│ COPERTA 88 px                            │  imagine: cover, poziția verticală salvată (Y %)
│ (voal negru discret în partea de jos)    │  fără imagine: degradeul accentului
╞═══╤══════════════════════════════════════╡  cusătura: 2 px, culoarea de accent
│ ┌─┴──┐                                   │
│ │ AV │  Numele (Chakra Petch 18/700)      │  avatar 64 px + inel 3 px (--gcs-surface),
│ │64px│  [GRUP] ★ Rang  ● Online           │  jumătate peste copertă; identitatea începe
│ └────┘                                   │  la 10 px SUB copertă
│  Bio, cel mult 2 rânduri                 │
│  [■][■][■]  insignele                    │
│ ┌──────────────────┬──────────────────┐  │  câmpurile: grilă 2 coloane, panou --gcs-surface2
│ │ Țară             │ Rank CS2         │  │
│ │ Romanian         │ REGE             │  │
│ └──────────────────┴──────────────────┘  │
│ ──────────────────────────────────────── │  separator 1 px
│    9         0          0        2026    │  contoarele: grilă 4 coloane egale, centrate
│ Postări  Reputație  Urmăritori Membru din│
│ [  Urmărește  ] [  Mesaj  ]              │  acțiunile: 2 butoane egale
└──────────────────────────────────────────┘
```

### Dimensiuni și spațiere

- Cardul: `width: 340px; max-width: calc(100vw - 24px)`, colțuri 14 px (`gcs-card`), `overflow: hidden`, marginea
  `--gcs-border`. Umbra: întunecat `0 18px 48px rgb(0 0 0 / .55)`; deschis `0 16px 40px rgb(20 22 28 / .16)`.
- Coperta: 88 px înălțime. Cu imagine: `background: center Y% / cover no-repeat url(…)` (Y = `coverPositionY`,
  aceeași încadrare ca pe profil); `::after` cu `linear-gradient(180deg, transparent 40%, rgb(0 0 0 / .35))`.
  Fără imagine: `linear-gradient(120deg, accent 55%, accent 12%)` (opacități), ca până acum.
- Cusătura: `border-bottom: 2px solid` culoarea de accent (`--gcs-hoverCard-accent`, din stilul inline).
- Corpul: `padding: 0 16px 16px`, secțiuni la 12 px una de alta (flex coloană).
- Capul: grilă `70px minmax(0, 1fr)`, coloane la 12 px. Avatarul (64 px, mărimea `l` redusă din CSS, inițiala
  26 px) e într-un inel de 3 px `--gcs-surface` (rotund) și urcă 35 px peste copertă (`margin-top: -35px`).
  Identitatea are `padding-top: 10px` — e mereu complet sub copertă.
- Numele: Chakra Petch 18 px / 700, `line-height: 1.2`, un singur rând cu „…”; clasa stilului de nume
  (`gcs-name--<cheie>`) se păstrează.
- Rândul de meta (sub nume, la 6 px): pastila grupului (`gcs-badge`; fundal = culoarea grupului 16 %, text = culoarea
  grupului amestecată 62 % cu `--gcs-text`, ca să rămână lizibilă și pe tema deschisă), rangul (12 px,
  `--gcs-muted`, iconița sau emoji-ul), „Online” (12 px, `--gcs-ok`, punct de 8 px cu strălucire). `flex-wrap`,
  spații 6×8 px; fără separatoare de text („·”).
- Bio: 13 px / 1.45, `--gcs-muted`, cel mult 2 rânduri (`-webkit-line-clamp: 2`).
- Insignele: rând `flex-wrap`, spațiu 6 px, aliniate pe centru. Cipurile nu se restilizează aici (alt lucru le
  transformă în imagini de ~28–32 px); rândul nu fixează înălțimi.
- Câmpurile: `<dl>` în grilă de 2 coloane egale, panou `--gcs-surface2`, colțuri 10 px, `padding: 10px 12px`,
  spații 8×12 px. Eticheta 11 px `--gcs-muted`; valoarea 13 px / 600 `--gcs-text`, un rând cu „…” și `title` cu
  valoarea întreagă.
- Contoarele: grilă de 4 coloane egale, centrate, separator sus (1 px `--gcs-border`, `padding-top: 12px`).
  Cifra: Chakra Petch 16 px / 700, `tabular-nums`; eticheta 11 px `--gcs-muted` (poate trece pe 2 rânduri pe
  ecrane înguste). Reputația pozitivă `--gcs-ok`, negativă `--gcs-accentInk`.
- Acțiunile: 2 butoane egale (`flex: 1`), spațiu 8 px; un singur buton ocupă tot rândul.

### Stări

| Stare | Ce se schimbă |
| --- | --- |
| Vizitator | Fără rândul de acțiuni; cardul se termină cu contoarele. |
| Membru (altcineva) | „Urmărește” (primar) + „Mesaj” (ghost, dacă are voie). După urmărire: „Nu mai urmări” (ghost). |
| Propriul card | Fără acțiuni (nu se poate urmări singur). |
| Fără copertă | Degradeul accentului + cusătura; restul identic. |
| Cu copertă | Imaginea încadrată cu poziția salvată, voal jos, cusătura. |
| Cu / fără câmpuri | Panoul câmpurilor apare doar dacă există valori publice „pe card”. |
| Cu / fără insigne | Rândul insignelor apare doar dacă există. |
| Membru nou | Fără bio, insigne, câmpuri; contoare 0 — card compact, aceeași ordine. |
| Membru banat | Nu are o stare proprie în datele cardului: pastila arată grupul lui, ca oricare. |
| Ecran îngust | Lățimea `100vw − 24px`; poziționarea îl ține la 12 px de margini. |
| Temă deschisă | Doar tokenuri: card alb, panou #EEF0F3, umbră mai slabă; inelul avatarului e alb. |
| Animație | Apariție 120 ms (opacitate + 4 px dinspre nume); dezactivată la `prefers-reduced-motion`. |

### Poziționarea

Funcție pură `placeHoverCard(anchor, card, viewport)`:

- `anchor` = dreptunghiul numelui (coordonate de viewport — stratul e `position: fixed`), `card` = mărimea
  **măsurată** a cardului (`offsetWidth/offsetHeight`), `viewport` = lățimea/înălțimea vizibilă.
- Dedesubt (8 px sub nume) dacă încape; altfel deasupra (8 px deasupra) dacă încape; altfel pe partea cu mai mult
  loc, cu înălțimea limitată la locul de acolo (`maxHeight`; cardul derulează în el, fără să acopere numele).
- Orizontal: aliniat la marginea stângă a numelui, limitat în `[12, lățime − card − 12]`.
- Întoarce și partea (`below` / `above`) → `data-side` pe strat (direcția animației).

Gazda randează stratul ascuns (`visibility: hidden`), îl măsoară într-un layout effect (înainte de desenare, fără
pâlpâire; înălțimea = `scrollHeight`, adică întreagă și când e limitată), îl așază, apoi îl reașază la orice schimbare de mărime (`ResizeObserver`: conținut încărcat, butonul
„Urmărește” schimbat, șablon) și la redimensionarea ferestrei. La scroll se închide (ca până acum).

### Accesibilitate

`role="dialog"`, `aria-label` = numele (neschimbat); Escape închide și întoarce focusul pe nume; coperta e
decorativă (fără text); insignele au numele în `title` și `gcs-srOnly`; contrastul textului rămâne cel al
tokenurilor (textul nu mai stă peste imagine).

### Șablonul `members.hover_card`

Sursa implicită reproduce exact markup-ul componentei React (aceleași clase și ordine). Variabilă nouă:
`user.coverPositionY` (0–100). `user.cover` rămâne URL-ul (compatibil cu șabloanele existente). Versiunea crește
la 2 (suprascrierile vechi apar „necesită revizuire”).

## 2. Postbit-ul: coperta în blocul de profil

### Structura

```
┌────────────────────────────────────┐  .gcs-postbit__profile (grilă 84 px + identitate, padding 8 px)
│▓▓ coperta (fundal, poziția Y %) ▓▓▓│
│ ┌────────┐  Numele                 │  voal: mai deschis în stânga (se vede coperta lângă avatar),
│ │ avatar │  PLAN / GRUP SECUNDAR   │  mai închis în dreapta (sub text)
│ │ 84 px  │  [titlul personalizat]  │
│ └────────┘  ♛♛♛                    │
└────────────────────────────────────┘
```

- Coperta e un strat separat, decorativ (`<span class="gcs-postbit__cover" aria-hidden="true">`), poziționat
  absolut pe tot blocul (`inset: 0`, `z-index: -1` într-un bloc cu `isolation: isolate`), cu
  `background: center Y% / cover no-repeat url(…)`.
- Voalul (`::after` pe strat): `linear-gradient(90deg, rgb(8 9 12 / .20), rgb(8 9 12 / .62) 42%,
  rgb(8 9 12 / .85))` — coperta se vede în jurul avatarului, textul stă pe partea întunecată.
- Blocul cu copertă (`.gcs-postbit__profile--cover`) devine o „insulă întunecată” în ambele teme: redefinește local
  `--gcs-text` (#F3F4F7), `--gcs-muted` (#C5CAD3), `--gcs-surface` (negru 55 %) și `--gcs-border` (alb 16 %), deci
  numele, rândul al doilea, titlul și coroanele rămân lizibile și pe tema deschisă. Textul identității primește
  `text-shadow: 0 1px 2px rgb(0 0 0 / .7), 0 0 10px rgb(0 0 0 / .45)`.
- Fără copertă: blocul arată exact ca înainte.
- Pe mobil (avatarul de 56 px) coperta rămâne, cu aceleași reguli.

### Date

`GcsPostbitData.cover: { url, positionY } | null`, din aceeași interogare a userilor (fără interogări în plus pe
postare). Coperta apare doar dacă profilul e vizibil viewer-ului (aceeași regulă ca motto-ul și hover card-ul).
Șablonul `postbit.author` primește `author.cover` (URL sau nil) și `author.coverPositionY`; versiunea crește la 2.

### Statusul online o singură dată

Indicatorul de sus („● Online” lângă @handle) rămâne. Subsolul păstrează doar „Membru din: <data>” (linia
„Status:” dispare, din componentă și din șablon).
