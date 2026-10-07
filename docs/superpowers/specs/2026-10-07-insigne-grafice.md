# Insigne grafice pentru badge-uri — designul concret

- **Data:** 2026-10-07
- **Cererea proprietarului:** „badge-uri pentru realizări, nu doar text”. Azi un badge e un pătrățel cu o literă sau un
  simbol (ex. „L” roz, creionul albastru) în postbit, în hover card și pe profil. Fiecare badge primește o **insignă
  desenată**: formă, metal pe nivel, câmp colorat, iconiță, ramă și strălucire, afișată ca imagine peste tot.
- **Regula de denumire:** totul e GamingCommunitySuite (GCS); fără nume de alte platforme, fără imagini copiate.
  Toată grafica e generată de cod din piese proprii (forme desenate aici + glife Font Awesome Free).

## 1. Direcția vizuală: insigna emailată

Comunitățile de gaming poartă insigne de metal: pinii de la turnee, ecusoanele de clan, medaliile de sezon. De acolo
vine limbajul (nu de la „cerculeț colorat cu iconiță albă”, care e ce avem azi și ce face orice listă de realizări):

- **rama de metal turnat** spune **nivelul** (bronz, argint, aur, platină sau metalul culorii proprii);
- **câmpul de email** din interior spune **categoria** — e culoarea badge-ului (`color`), deci culorile alese până
  acum în ACP rămân cu sens;
- **glifa** (iconița sau 1–3 caractere) e turnată din același metal ca rama, în relief, cu umbră proprie;
- **o singură lumină**, din stânga-sus, pentru toate insignele: dunga de reflexie pe ramă, luciul de pe email și
  umbra glifei cad la fel, deci un rând de insigne arată ca un set, nu ca o colecție de clipart.

Singurul lucru „îndrăzneț” e materialul (metal + email). Restul paginii nu se schimbă: insignele stau în layout-ul
existent, fără cadre sau fundaluri noi în jurul lor.

## 2. Anatomia unei insigne (viewBox 100×100, SVG)

Straturile, de jos în sus:

1. **Strălucirea** (doar aur și platină): silueta formei, estompată (σ ≈ 2.2), în culoarea `glow` a nivelului, la
   opacitate 0.55. La 32 px e un halou de ~1 px; la 96 px, ~3 px. Formele lasă 3 unități margine pentru ea.
2. **Decorul din spate**, în culoarea categoriei: panglica medaliei (două benzi în V, cu dunga din mijloc în metalul
   nivelului) sau cozile rozetei (crestate în V).
3. **Rama:** forma plină, cu gradientul de metal (șase opriri: reflexie, lumină, bază, umbră, a doua reflexie, umbră),
   conturată cu `edge` (2.5 unități) — conturul ține silueta lizibilă și pe fundal deschis, și pe întunecat.
4. **Câmpul de email:** aceeași formă micșorată (≈ 0.78), gradient vertical din culoarea categoriei, închis spre bază.
   Luminozitatea câmpului e plafonată (HSL L ≤ 42 % sus, ≤ 22 % jos), ca glifa deschisă să se citească pe orice culoare
   — chiar și pe un badge alb.
5. **Filetul:** o linie subțire (1.2) în culoarea `hi` a nivelului, pe marginea câmpului (impresia de piesă ștanțată).
6. **Luciul:** o elipsă albă la 14 % opacitate pe jumătatea de sus a câmpului (decupată după câmp).
7. **Glifa:** umbra (aceeași glifă, deplasată 2.2 unități în jos, `glyphShadow` la 55 %), apoi glifa cu gradientul
   `glyph` al nivelului. Iconița ocupă ~42 % din lățime; textul: 1 caracter = 44, 2 = 34, 3 = 25 unități.
8. **Scânteia** (doar platină): o stea cu 4 colțuri, albă, pe ramă, sus-dreapta, plus una mai mică.

## 3. Formele, pe categorii

| Formă (`artShape`) | Desen | Categoria | Câmpul (centru glifă) |
| --- | --- | --- | --- |
| `medal` — Medalie | monedă rotundă atârnată de o panglică în V, cu o verigă | activitate (postări, topicuri) | cerc, (50, 60) |
| `shield` — Scut | scut heraldic, umeri drepți, vârf rotunjit | vechime, loialitate | scut, (50, 47) |
| `hexagon` — Hexagon | hexagon cu vârful în sus, colțuri rotunjite | comunitate (reputație, ajutor) | hexagon, (50, 50) |
| `rosette` — Rozetă | disc cu 16 lobi și două cozi de panglică | evenimente, turnee (de obicei manuale) | cerc, (50, 45) |
| `diamond` — Diamant | romb cu fațete spre colțuri | VIP, premium | romb, (50, 50) |
| `star` — Stea | stea cu 8 raze rotunjite (pecete) | speciale, roluri, distincții unice | cerc, (50, 50) |

Siluetele diferă clar și la 16 px (rotund cu panglică / scut / hexagon / floare / romb / stea), deci forma spune
categoria înainte ca ochiul să ajungă la iconiță.

## 4. Nivelurile (paleta de metal)

| Nivel (`artTier`) | hi | light | base | shade | edge | glifă (sus → jos) | umbra glifei | glow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bronze` — Bronz | `#FFD9B3` | `#E8A06A` | `#B86B35` | `#7C4119` | `#3E1D08` | `#FFE7CF` → `#F0B07C` | `#2A1205` | — |
| `silver` — Argint | `#FFFFFF` | `#E3E8EF` | `#A7B1BF` | `#66717F` | `#2B323C` | `#FFFFFF` → `#D4DBE5` | `#1B2028` | — |
| `gold` — Aur | `#FFF6CC` | `#FFD66B` | `#E0A526` | `#9A6508` | `#4A2E02` | `#FFF8DB` → `#FFD25E` | `#2F1C00` | `#FFC93D` |
| `platinum` — Platină | `#FFFFFF` | `#E6F6FF` | `#A9CFE6` | `#5E86A3` | `#1E3447` | `#FFFFFF` → `#CFF0FF` | `#0F1F2C` | `#8FE3FF` |
| `custom` — Culoarea badge-ului | amestec 75 % alb | 40 % alb | culoarea | 40 % negru | 75 % negru | alb → 75 % alb | 85 % negru | culoarea |

Platina are, în plus, o dungă lavandă (`#D9CCFF`) în gradientul ramei (reflexie irizată). La `custom`, câmpul de email
e mai închis decât rama (35 % → 70 % negru), ca insigna să nu devină o pată de o singură culoare.

## 5. Mărimile

| px | Unde | Note |
| --- | --- | --- |
| 16 | liste dense din ACP (fișa membrului, lista de badge-uri) | fără umbră CSS |
| 24 | antetul profilului (lângă nume), activitatea profilului | umbră 1 px |
| 32 | postbit, hover card | umbră 1 px, focus vizibil |
| 48 | grila compactă din coloana profilului | |
| 64 | grila tabului „Badge-uri” | |
| 96 | previzualizarea din ACP | |

Imaginea e vectorială (`<img src="/badge-art/…svg">`), deci e clară la orice mărime și pe ecrane HiDPI. Componenta
primește doar mărimi din scară (`16 | 24 | 32 | 48 | 64 | 96`).

## 6. Unde apar

### 6.1 Postbit
- Rândul de insigne de sub bara de XP: **ultimele 5**, 32 px, spațiu 6 px, centrat. Dacă membrul are mai multe,
  un al șaselea element „+N” (aceeași înălțime, text în fontul de display, fundal `surface2`, ramă `border`) duce la
  `?tab=badges` pe profil.
- Tooltip (la hover și la focus din tastatură): **numele** pe primul rând și **descrierea** pe al doilea (dacă există).
- Nu se schimbă nimic altceva în postbit (layout-ul lui e reproiectat separat).

### 6.2 Hover card
- Rândul de insigne existent (ultimele 3): 32 px, `title` cu numele și descrierea. Restul cardului rămâne neatins.

### 6.3 Profil
- **Antet:** primele 3 insigne ca pastile: insigna de 24 px + numele.
- **Coloana laterală** (celelalte taburi): grilă compactă cu primele 6, insignă de 48 px + nume.
- **Tabul „Badge-uri”:** grila completă, plăci de 148 px minim:
  - **obținute:** insigna 64 px, numele (13 px, bold), descrierea (12 px, `muted`, maxim 2 rânduri), data („Obținut
    pe 7 oct. 2026”);
  - **blocate** (badge-urile încă neobținute, după cele obținute): insigna în tonuri de gri (`grayscale(1)`,
    luminozitate 0.8, opacitate 0.45 pe întunecat / 0.55 pe deschis) cu un lacăt mic în colțul din dreapta-jos,
    numele, **cerința** („100 de postări”, „1 an de membru”, „Acordat de echipă”) și, pentru cerințele numerice,
    o bară de progres de 4 px cu „37 / 100”. Starea nu e transmisă doar prin culoare: lacătul și textul „Blocat”
    (citit de cititoarele de ecran) o spun și ele.
- **Activitate:** „a primit badge-ul …” cu insigna de 24 px.

### 6.4 ACP → Membri → Realizări → Badge-uri
Fiecare badge are un editor cu **previzualizare live**:
- **Scena dublă:** aceeași insignă pe o jumătate întunecată (`#14161C`) și pe una deschisă (`#FFFFFF`), la 96, 32 și
  24 px — adminul vede dintr-o privire dacă insigna se citește în ambele teme și la mărimea din postbit.
- **Formă:** 6 butoane radio, fiecare cu insigna curentă desenată în acea formă (40 px).
- **Nivel:** 5 butoane radio cu mostra metalului; „Culoarea badge-ului” folosește câmpul `Culoare`, care colorează
  oricum emailul și panglica.
- **Iconiță:** selectorul de iconițe existent (Font Awesome Free, căutare); „∅” = folosește textul.
- **Text:** 1–3 caractere, folosit când nu e aleasă o iconiță (ex. „GG”, „RP”).
- **Imagine proprie (opțional):** PNG, JPEG, WebP sau GIF, prin upload-ul existent (tipul real din magic bytes,
  recodare cu `sharp`, fără SVG). Dacă există, înlocuiește insigna generată; „Elimină imaginea” revine la insignă.
- Lista regulilor și fișa membrului arată insigna la 16–24 px lângă nume.

## 7. Tema deschisă și cea întunecată

Insigna e aceeași imagine în ambele teme (metalul și emailul au contrast propriu, iar conturul `edge` închide
silueta pe alb). Se adaptează doar ce o înconjoară, prin tokenuri:
- umbra de sub insignă: `drop-shadow(0 1px 1.5px rgb(0 0 0 / .45))` pe întunecat, `rgb(20 22 28 / .22)` pe deschis;
- starea blocată: opacitate 0.45 (întunecat) / 0.55 (deschis);
- plăcile din grilă folosesc `--gcs-surface2` și `--gcs-border`.

## 8. Datele

- `badges` primește trei coloane opționale: `artShape`, `artTier`, `artIcon` (numele unei iconițe Font Awesome
  Free, ex. `fa-solid fa-trophy`). `symbol` devine textul opțional al insignei; `imageAttachmentId` (existent) e
  imaginea proprie.
- **Rezolvarea** (aceeași funcție peste tot): formă = `artShape` validă, altfel `rosette` pentru badge-urile manuale și
  `medal` pentru cele automate; nivel = `artTier` valid, altfel `custom`; glifă = `artIcon`, altfel `symbol` dacă e un
  nume de iconiță, altfel textul din `symbol` (≤ 3 caractere), altfel prima literă a numelui. Deci orice badge creat
  înainte de această schimbare primește automat o insignă în culoarea lui.
- Migrația `20261022000000_badge_art` adaugă coloanele și atribuie grafica badge-urilor implicite (doar unde
  coloanele sunt goale); seed-ul instalărilor noi creează badge-urile direct cu ea.

### 8.1 Grafica badge-urilor implicite

| Cheie | Badge | Formă | Nivel | Iconiță |
| --- | --- | --- | --- | --- |
| `first_post` | Primul post | medalie | bronz | `fa-solid fa-pen-nib` |
| `posts_100` | 100 postări | medalie | argint | `fa-solid fa-comments` |
| `posts_1000` | 1000 postări | medalie | aur | `fa-solid fa-fire` |
| `member_1y` | 1 an membru | scut | argint | `fa-solid fa-cake-candles` |
| `member_3y` | 3 ani membru | scut | aur | `fa-solid fa-chess-rook` |
| `reputation_100` | 100 reputație | hexagon | argint | `fa-solid fa-thumbs-up` |
| `top_helper` | Top helper | hexagon | aur | `fa-solid fa-handshake-angle` |
| `vip` | VIP | diamant | platină | `fa-solid fa-gem` |
| `tournament_champion` | Campion turneu | rozetă | aur | `fa-solid fa-trophy` |
| `rp_veteran` | Veteran RP | stea | culoarea badge-ului (mov) | `fa-solid fa-masks-theater` |

## 9. Livrarea imaginii și siguranța

- Adresa unei insigne descrie complet desenul: `/badge-art/v1/{formă}-{nivel}-{rrggbb}-{glifă}.svg`, unde glifa e
  `i-{solid|regular|brands}-{nume}` sau `t-{text în UTF-8, hex}`. Exemplu:
  `/badge-art/v1/medal-gold-f4b740-i-solid-fire.svg`.
- Ruta acceptă doar adresa **canonică** (forme, niveluri și stiluri din liste fixe; culoare `#RRGGBB` validată;
  iconița căutată în registrul Font Awesome — o iconiță necunoscută primește glifa implicită; textul: UTF-8 valid,
  1–3 caractere, fără caractere de control, escapat XML). Orice altceva → 404.
- SVG-ul e compus doar din piesele de mai sus: fără `<script>`, `<style>`, `foreignObject`, atribute `on*`, `href`
  sau referințe externe. Răspunsul are `Content-Security-Policy: default-src 'none'`, `nosniff` și cache de un an
  (`immutable`): desenul nu se schimbă la aceeași adresă (o schimbare de desen trece la `/v2/`).
- Imaginea proprie trece prin serviciul de atașamente (magic bytes, recodare, limită de mărime pe grup); SVG-ul
  încărcat de admin nu e acceptat. Atașamentul se leagă de badge (`badges.image`) și e public.
- Șabloanele temei (postbit, hover card) primesc `b.art` (adresa) și `b.description`; sanitizer-ul lor permite deja
  `<img>` cu adrese relative.

## 10. Testele

- Randarea: SVG valid (parsat ca XML), fără `script`/`style`/`on*`/`href`; numele, culorile și iconițele ostile din
  badge nu ajung în SVG (doar forme, niveluri și iconițe din liste; culori `#RRGGBB`); textul e escapat.
- Adresa: construită → citită → aceeași; variantele necanonice sunt respinse.
- Datele: fiecare badge implicit are grafică validă, iar migrația atribuie exact grafica din seed.
- ACP: formă, nivel, iconiță și text validate; imaginea trebuie să fie un atașament de tip imagine.
- E2E: insignele apar ca imagini în postbit, hover card și pe profil; grila arată și badge-urile blocate.
