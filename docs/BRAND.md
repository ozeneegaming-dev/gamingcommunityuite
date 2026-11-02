# Brandul GamingCommunitySuite (GCS)

Direcția **„Forja”**, aleasă pe 2026-11-02: navy închis, portocaliu plin, DM Sans, colțuri mici. Toate suprafețele
produsului arată ca un singur brand.

## Două branduri, nu unul

| | Ce acoperă | Cine îl schimbă |
|---|---|---|
| **Brandul GCS** (produsul) | installer-ul, ACP-ul și intrarea în ACP, editorul vizual, Data Center-ul, portalul și site-ul de prezentare, învelișul emailurilor, „Powered by GamingCommunitySuite” | doar GCS, din `brand.ts` |
| **Brandul comunității** (clientul) | forumul public: logo-ul, numele și tema aleasă de admin | adminul, din ACP › Aspect |

Tema implicită a forumului (GCS Dark / GCS White) pornește din brandul GCS. Temele **doar restilizează**: funcțiile
țin de sistem și merg în orice temă.

## Sursa unică

`packages/core/src/themes/brand.ts` (`GCS_BRAND`, `GCS_MARK`) e singurul loc cu valorile brandului. Din el vin:

- paleta temelor GCS Dark / GCS White (`NOVA_THEME_SETTINGS` în `settings.ts`) și umbrele temelor (`css.ts`);
- `packages/ui/src/tokens.css` (generat): valorile brute `--gcs-brand-*`, rezerva tokenilor comuni pe `:root` și
  cromul produsului, clasa `.gcs-product`;
- `docs/brand/gcs-brand.css` (generat): tokenii pentru panourile PHP;
- `docs/brand/gcs-mark.svg` (generat): marca;
- învelișul emailurilor (`email.layout` în `templates/defaults.ts`) și componenta `GcsMark` din `@gcs/ui`.

O schimbare de brand: editezi `brand.ts`, rulezi `pnpm --filter @gcs/web brand`, apoi testele. `brand.test.ts` pică
dacă fișierele generate nu sunt la zi sau dacă o culoare nu mai trece contrastul.

## Logo

- **Marca**: pătrat plin `#DF390C` (colțuri 14/64) cu un G geometric alb. **Numele**: Gaming**Community**Suite în
  DM Sans 800, cu „Community” în accentul de text. Forma scurtă: **GCS**.
- **Spațiu liber**: jumătate din latura mărcii, pe fiecare parte. **Mărimi minime**: marca 16 px (favicon), numele
  complet 120 px.
- **Monocrom**: pătrat alb cu G navy, pe fundaluri colorate sau foto.
- **Nu**: întinderea, altă culoare, umbre, contururi, gradient, rotirea. Marca GCS nu înlocuiește logo-ul comunității.

## Culori

| Token | Întunecat | Luminos | Folosire |
|---|---|---|---|
| `bg` | `#0B0F17` | `#F1F3F7` | fundalul paginii |
| `chrome` / `chrome2` | `#0E121A` / `#10141D` | `#FFFFFF` / `#F7F8FA` | antet, subsol, bara de iconițe |
| `surface` / `surface2` | `#151922` / `#1A1F29` | `#FFFFFF` / `#F3F5F9` | carduri, benzile titlurilor |
| `border` / `borderStrong` | `#1E2533` / `#2A3242` | `#DCE1E9` / `#C9D0DB` | chenare |
| `text` / `heading` / `muted` | `#CED5DE` / `#FFFFFF` / `#7E8999` | `#1B2230` / `#0B0F17` / `#596374` | text |
| `accent` | `#DF390C` | `#DF390C` | marca, accente mari, grafică |
| `accentInk` | `#FF6A3D` | `#C2300A` | linkuri, etichete (≥ 4.5:1) |
| `accentFill` | `#CD340B` | `#CD340B` | butonul principal cu text alb (≥ 4.5:1 și la hover) |
| `secondary` | `#202630` | `#E9EDF2` | butoane secundare, cipuri |
| `ok` | `#2ECC71` | `#167A45` | online, activ, salvat |
| `warn` | `#F2B33D` | `#9A6200` | avertismente (chihlimbar, nu portocaliul mărcii) |
| `danger` | `#F0444F` | `#C8283A` | erori, suspendări, ștergeri (mereu cu iconiță sau text) |
| `info` | `#4D9BE6` | `#2167C2` | noutăți, sfaturi |
| `premium` | `#F2B33D` | `#9A6200` | aplicații premium, VIP |

**Neutre** (950 → 0): `#0B0F17 #0E121A #151922 #1A1F29 #1E2533 #2A3242 #4A5466 #7E8999 #A9B2BF #CED5DE #E6EAF0 #FFFFFF`.

**Paleta de date** (doar grafice și cardurile KPI din ACP, nu decor): `#20AA92 #9B78DC #3B9EEA #E2A93B #D96BB0 #EF6461`,
cu variantele luminoase din `acp.css`. Restul decorului urmează accentul.

## Tipografie

- **DM Sans** peste tot (titluri și text), **JetBrains Mono** pentru chei, cod și valori tehnice.
- Scara (px, mărime/rând, grosime): Display 44/48 800 · Titlu 1 30/36 800 · Titlu 2 22/28 700 · Titlu 3 17/24 700 ·
  Text 15/24 400 · Mic 13/20 500 · Etichetă 11/14 700, majuscule, spațiere 0.1em. Forumul folosește textul de 13 px
  (setarea temei).

## Forme, spațiu, mișcare

- **Raze**: buton 4 · câmp și insignă 6 · card 12 · pastilă 999 · avatar rotund.
- **Umbre**: card `0 2px 4px -1px rgb(11 15 23 / .1)` · meniu `0 4px 16px rgb(0 0 0 / .16)` · dialog
  `0 12px 34px rgb(0 0 0 / .34)`.
- **Spațiere** pe 4 px: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- **Mișcare**: 0.15 / 0.2 / 0.3 s, `cubic-bezier(0.22, 1, 0.36, 1)`; hover-ul sistemului (stratul de sticlă alb 8%);
  doar opacitate cu `prefers-reduced-motion`.

## Iconuri

Un singur set: **Font Awesome Free** (plin), același în forum, ACP, installer, Data Center și portal. În benzile de
titlu, iconița stă într-un cerc închis, colorată cu accentul.

## Componente

Clasele de bază sunt API-ul public al temelor (`base.css`): `gcs-btn` (`--primary`, `--ghost`, `--sm`), `gcs-card`,
`gcs-input`, `gcs-field`, `gcs-badge` (`--accent`, `--ok`, `--warn`, `--info`), `gcs-table`, `gcs-nav__link`. Culorile
vin numai din tokeni (`var(--gcs-*)`), niciodată scrise de mână.

Sub `.gcs-product` (ACP, installer, intrarea în ACP, editorul vizual) componentele iau culorile, fonturile și formele
brandului, oricare ar fi tema site-ului; `data-theme="light"` pe același element trece pe modul luminos.

## Suprafețe

- **Forum**: tema implicită GCS Dark / GCS White, cu paleta din brand.
- **ACP, installer**: `.gcs-product`; bara de iconițe a ACP-ului rămâne închisă în ambele moduri.
- **Emailuri**: învelișul `email.layout` (antet navy cu numele comunității, corp alb, subsol cu „Powered by”). Adminul
  îl poate modifica din ACP › Aspect › Șabloane.
- **Data Center și portalul (PHP)**: încarcă `docs/brand/gcs-brand.css` și își leagă variabilele proprii de
  `--gcs-*` (ex. `--gcs-primary: var(--gcs-accent-fill)`); marca din `docs/brand/gcs-mark.svg`.
