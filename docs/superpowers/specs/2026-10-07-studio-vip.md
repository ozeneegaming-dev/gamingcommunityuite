# Studio VIP — designul concret

- **Data:** 2026-10-07 · **Stare:** în implementare
- **Ce e:** un plugin GCS premium (`gcs.vip_studio`), livrat ca `.zip` semnat, pe care proprietarul îl instalează din
  ACP → Sistem → Aplicații și pluginuri. Membrii VIP își aleg „echipamentul” profilului (stilul numelui, rama avatarului,
  banner-ul, fundalul cardului, arma preferată, fundalul video al profilului, citatul, tema și melodia), cu
  previzualizare live; adminii gestionează cataloagele (inclusiv rame noi încărcate din ACP).
- **Specul părinte:** `2026-10-06-pluginuri.md` (pachetul, manifestul, izolarea, CSS-ul închis în container, JS doar
  pentru pluginurile semnate). Acest spec adaugă **puncte de extensie generice** în nucleu (§2), apoi pluginul (§3).
- **Regula de bază:** lucru original. Nicio denumire, cod, clasă CSS sau imagine din alte platforme ori comunități;
  toate presetările, gradientele și desenele (rame, arme, fundaluri) sunt create pentru GCS.

## 1. De ce e nevoie de nucleu

Un plugin nu poate restiliza nucleul: CSS-ul lui e închis în containerul lui (`.gcsp--<vendor>--<nume>`), HTML-ul trece
prin sanitizer (fără `style`, formulare, `audio`/`video`) și nu are unde păstra fișiere încărcate. Pentru studio
lipsesc patru lucruri, adăugate **generic** (orice plugin le poate folosi, cu capabilitatea lui):

| Lipsă | Soluția (nucleu) |
| --- | --- |
| Numele, rama, banner-ul, fundalul cardului și profilul se randează în nucleu | capabilitatea **`appearance`**: pluginul *publică* aspectul validat al unui membru; nucleul îl randează (§2.1) |
| Rame, fundaluri, videoclipuri, melodii încărcate din ACP | capabilitatea **`media`**: fișiere proprii, verificate și recodate de nucleu (§2.2) |
| Formulare (salvare fără JS, toată administrarea din ACP) | **formulare în paginile pluginului**, trimise doar spre propriile rute API (§2.3) |
| Previzualizare cu culorile alese în ACP | **variabile CSS** în `style` (doar `--nume: valoare` sigură) (§2.4) |
| Planul VIP al membrilor, lista VIP | **API-ul VIP** în `ctx.api` (§2.5) |
| Caruselul pe paginile unde apare widget-ul | **JS-ul pluginurilor semnate** se încarcă și unde apare un widget al lor (§2.6) |

Versiunea platformei (`minGcs`) devine **0.7.0**.

## 2. Punctele de extensie din nucleu

### 2.1 Aspectul membrilor (`appearance`, risc mediu)

**Model „publicare”, nu „cerere la fiecare pagină”.** Pluginul scrie aspectul unui membru când acesta se schimbă
(`ctx.members.appearance.set(userId, aspect)`); nucleul îl validează, îl păstrează în `member_appearances` și îl
randează peste tot fără să mai cheme pluginul. Motive: numele stilizate apar pe orice pagină (liste, widget-uri, chat),
deci ar trebui un apel per pagină și per listă; un plugin lent sau oprit nu întârzie randarea; CSS-ul se poate
compila o dată și pune în cache.

- **Tabelul** `member_appearances`: `(plugin_key, user_id)` cheie, `data` (JSON validat), `updated_at`; ștergerea
  userului șterge rândul. La dezinstalare (fără „Păstrează datele”) rândurile pluginului se șterg.
- **Doar pluginurile încărcate contează**: un plugin dezactivat (sau în modul sigur) nu mai schimbă aspectul nimănui;
  la orice schimbare de stare versiunea aspectului crește și CSS-ul se recompilează.
- **Mai multe pluginuri**: câmpurile de pe primul nivel se iau, în ordinea priorității hook-ului `appearance`, de la
  primul plugin care le are.
- **RPC** (`ctx.members.appearance`): `set(userId, data | null)` (validare completă; o eroare listează câmpurile),
  `get(userIds)` (doar rândurile proprii), `clear()` (toate rândurile proprii). Un user inexistent → `not_found`.

**Forma validată** (`parseMemberAppearance`, `packages/core/src/members/appearance.ts`). Nu există CSS sau HTML brut:
doar culori `#RRGGBB`, numere în intervale, chei din liste albe și căi spre fișierele pluginului.

```ts
type Fill = { colors: Hex[] /* 1–5; 1 = culoare plină */; angle?: 0..360; animation?: FillAnimation; speed?: "slow" | "normal" | "fast" };
type MediaRef = string; // `/plugins/<cheia proprie>/assets/<cale>.(png|jpg|jpeg|gif|webp)` sau `/plugins/<cheia proprie>/media/<id>.<ext>`
type Appearance = {
  name?: { fill: Fill; effect?: NameEffect; glow?: Hex; bold?: boolean; italic?: boolean; style?: StyleKey /* 0.7.1 */ };
  banner?: { fill: Fill; text?: Hex; label?: string /* ≤ 32 */; style?: StyleKey /* 0.7.1 */ };
  frame?: { image: MediaRef; scale?: 100..160; x?: -20..20; y?: -20..20 };
  card?: { image: MediaRef; x?: 0..100; y?: 0..100; dim?: 0..80 };
  flair?: { icon: MediaRef; label: string /* ≤ 40 */ };
  profile?: {
    background?: { image?: MediaRef; video?: MediaRef /* cere `image` ca poster */; x?: 0..100; y?: 0..100; dim?: 0..80 };
    quote?: { text: string /* ≤ 200, text simplu */ };
    theme?: { key: string /* [a-z0-9_]{1,30} */; accent: Hex; accent2?: Hex; surface?: Hex; glow?: boolean };
    song?: { title: string /* ≤ 80 */; artist?: string; audio?: MediaRef; youtube?: string /* id de 11 caractere */; autoplayMuted?: boolean };
  };
};
```

- `NameEffect` (listă albă; din GCS 0.7.1 definite toate în `packages/core/src/members/nameEffects.ts`, o singură dată,
  aplicate atât pe numele membrilor, cât și pe clasele de previzualizare `.gcs-nfx.gcs-nfx--<efect>`): `none`,
  `gradient`, `shimmer`, `pulse`, `neon`, `glitch`, `scan`, `chrome`, `fire`, `holo`, `caret`, `inferno`, `typewriter`,
  `reveal`, `shatter`, `citylights`, `cosmic`, `crosshair`, `love`, `electric`, `mirror`, `lightning`, `money`, `razor`,
  `shadowdance`, `toxic`, `vscan`, `gold`, `aura`, `matrix`, `frost`, `plasma`, `outline`, `extrude`.
  - Culorile ajung doar ca variabile (`--nfx-c1…5`, `--nfx-gc`, `--nfx-sp`), din `#RRGGBB` validate; „cernelurile”
    `--nfx-i*` își limitează luminozitatea pe fiecare temă (închise pe tema deschisă, ridicate pe cea închisă), ca
    numele să rămână lizibile pe ambele.
  - Decorațiile (straturi cu textul dublat din `data-text`, particule, iconițe — cel mult `::before` și `::after`, fără
    evenimente de mouse, poziționate absolut) apar doar în locurile mari: profilul, postbit-ul, hover card-ul, meniul
    userului și previzualizările. În listele dense numele are doar culoarea și animația ușoară a efectului.
  - Animații doar pe transform, opacity, background-position, clip-path, mask și text-shadow; sub reduced-motion se
    opresc toate, iar tăieturile / măștile dispar (rămâne aspectul static).
- `StyleKey` (`[a-z0-9_]{1,40}`): un stil CSS scris de un admin în ACP-ul pluginului (§2.5); nucleul pune clasa lui
  (`gcs-nameStyle--<plugin>--<cheie>` / `gcs-bannerStyle--…`) pe numele, respectiv banner-ul membrului.
- `FillAnimation` pentru banner și nume: `none`, `flow` (gradientul curge), `pulse`, `shine` (dungă de lumină),
  `aurora` (curgere lentă + nuanță).
- Textele (etichete, citat, titluri) sunt text simplu: caracterele de control se scot, spațiile se strâng, React le
  escapează la randare. Căile media sunt verificate cu expresii stricte (fără `..`, `%`, `\`, query) și doar spre
  pluginul care publică.
- Toate animațiile se opresc sub `prefers-reduced-motion: reduce`.

**Randarea:**
- **Numele** (oriunde): CSS generat per user, adăugat la `/gcs-names.css` (aceeași versiune în URL):
  `.gcs-root :is(a.gcs-userLink[data-user-id="<id>"], [data-name-user="<id>"]) { … }` — specificitatea bate stilul
  grupului. Linkurile spre profil (`GcsUserLink`, șabloane) au deja `data-user-id`; numele care nu sunt linkuri (titlul
  profilului, meniul userului) primesc `data-name-user` (fără hover card).
- **Rama**: `GcsAvatar` primește `userId` (→ `data-avatar-user`, nu `data-user-id`: avatarul nu deschide hover card-ul);
  CSS-ul generat pune imaginea ramei peste avatar (`::after`, `scale`/`x`/`y` validate), iar rama clasică a nucleului se
  ascunde pentru acel user.
- **Banner-ul** colorează bara grupului din postbit (cu eticheta lui) și apare ca pastilă lângă grup în hover card și pe
  profil (stilul compilat de nucleu din forma validată, eticheta ca text).
- **Pagina /vip**: punctul de extensie `vip.page` (sub planuri), pentru blocul pluginului (link spre studio).
- **Fundalul cardului**: în caseta autorului din postbit și în coperta hover card-ului (poziție și întunecare validate).
- **Insigna (flair)**: iconița lângă nume (postbit, hover card) și în statisticile profilului („Arma preferată”).
- **Profilul** (structura paginii nu se schimbă; elementele se adaugă în locurile existente): fundalul (imagine sau
  video într-un strat în spatele paginii, cu vignetă; video `muted`, `loop`, `playsinline`, posterul afișat și pauză
  sub `prefers-reduced-motion`, buton de pauză), rama pe avatarul existent, banner-ul ca pastilă în rândul existent de
  titluri, arma ca încă o statistică în zona existentă, citatul ca un card în plus în coloana de conținut, melodia ca
  un bloc în plus în coloana laterală (player audio sau YouTube cu încărcare la click, niciodată redare automată cu
  sunet), tema doar prin variabile CSS (accent, panouri) pe pagina existentă. La fel în postbit și hover card:
  elementele VIP intră în structura existentă.
- **Cache**: CSS-ul compilat în Redis (cheia include versiunea), datele per user în cache-ul GCS (TTL 5 min, eticheta
  `appearance:user:<id>`), invalidate la fiecare `set`.

### 2.2 Fișierele media ale pluginului (`media`, risc mediu)

- **Declarația** din manifest: `media: { image?: { maxMb ≤ 10, maxSide ≤ 4096, animated? }, video?: { maxMb ≤ 50,
  maxSeconds ≤ 300 }, audio?: { maxMb ≤ 30 }, quotaMb ≤ 4096 }`. Tipurile nedeclarate sunt refuzate.
- **Încărcarea** trece doar prin formularele `multipart/form-data` trimise spre o rută API a pluginului (§2.3): nucleul
  preia fișierele **înaintea** pluginului, iar pluginul primește în corp, pe câmpul fișierului,
  `{ id, kind, mime, size, width, height, durationMs, url }`.
  - tipul real din conținut (`file-type`), nu din extensie sau din antetul browserului;
  - imaginile se **recodează** în WebP cu `sharp` (fără metadate, transparența păstrată, latura ≤ `maxSide`, animația
    doar cu `animated: true`); fișierul original nu se păstrează. Cu `animated: true`, GIF și WebP animat rămân animate,
    iar **APNG** (din 0.7.1) se compune în nucleu (`apng.ts`: decalaje, `blend_op` SOURCE/OVER, `dispose_op`
    NONE/BACKGROUND/PREVIOUS) și devine WebP animat cu duratele și buclele lui; duratele sub 11 ms devin 100 ms, ca în
    browsere. Limite: 600 de cadre, pânza ≤ 4096 px, 32 de milioane de pixeli în toate cadrele, 20 s de lucru
    (`too_many_frames`, `animation_too_large`, `processing_timeout`);
  - video: doar MP4/WebM; durata citită din container (`mvhd` / `Duration` din EBML) trebuie să fie ≤ `maxSeconds`;
  - audio: doar MP3/Ogg;
  - mărimea per tip, **cota** pluginului (`quotaMb`, toate fișierele lui) și o limită de rată per user (60 / oră pe
    site; 300 / oră, separat, pentru încărcările din rutele ACP ale pluginului).
  - rezultatul încărcării (doar în corpul formularului, din 0.7.1) are și `sha256` (al fișierului trimis, pentru
    duplicate), `originalName` (fără cale, doar text) și `frames`; o eroare are și ea `originalName`.
- **Ciclul de viață**: un fișier încărcat e *în așteptare* până când pluginul îl păstrează (`ctx.media.keep(ids)`);
  cele nepăstrate în 6 ore se șterg (la următoarea încărcare). `ctx.media.get(ids)`, `list({ kind, limit, offset })`,
  `delete(ids)`, `usage()`. La dezinstalare (fără „Păstrează datele”) se șterg toate.
- **Servirea**: `/plugins/<cheie>/media/<id>.<ext>` — public, `Content-Type` din tipul verificat, `nosniff`, CSP
  `sandbox`, cache lung (fișierul nu se schimbă niciodată sub același id), cereri `Range` (derularea video/audio).
- **Tabelul** `plugin_media`: id, plugin, tipul, mime, mărimea, dimensiunile, durata, cheia din store, starea,
  cine a încărcat, data.

### 2.3 Formulare în paginile pluginului

- **Sanitizer-ul** acceptă, **doar în paginile pluginului** (site și ACP; nu în widget-uri și puncte de extensie):
  `form`, `input`, `select`, `option`, `optgroup`, `textarea`, `button`, `label`, `fieldset`, `legend`, `output`.
  - `form`: `method` `get`/`post`; `action` obligatoriu și doar spre pluginul însuși: `/api/plugins/<cheie>/…` (POST)
    sau paginile lui (GET, ex. filtre); `enctype` urlencoded sau `multipart/form-data`;
  - `input` doar de tipurile `text`, `search`, `number`, `range`, `color`, `checkbox`, `radio`, `hidden`, `file`,
    `submit`, `url`; atributele `name` (`[A-Za-z][A-Za-z0-9_.:-]{0,59}`), `value`, `checked`, `min`/`max`/`step`,
    `maxlength`, `placeholder`, `accept`, `required`, `disabled`, `readonly`, `multiple`, `autocomplete` (`on`/`off`);
  - fără `formaction`, `formmethod`, `formenctype`, `formtarget`, `form` (s-ar putea trimite în altă parte).
- **Ruta API** primește, pe lângă JSON: `application/x-www-form-urlencoded` (≤ 64 KB; câmpurile repetate devin liste) și
  `multipart/form-data` (doar cu `media`; mărimea din `Content-Length` verificată înainte de citire). Pe site, cel mult
  4 fișiere; spre o rută ACP (încărcarea în bloc, din 0.7.1), cel mult 50 de fișiere într-un corp de cel mult 48 MB (sub
  limita proxy-ului Next de 64 MB și sub cei 50 MB ai nginx-ului standard).
  - CSRF: ca până acum, `Origin` trebuie să fie site-ul (browserele îl trimit la formulare POST);
  - răspunsul unui formular: `{ redirect }` întors de plugin devine **303** spre acea adresă, doar dacă e una dintre
    paginile pluginului (`/p/<cheie>…` sau `/admin/plugins/<cheie>…`); altfel înapoi la pagina de unde a venit
    (dacă e a pluginului) sau JSON.
- **Rute API ale ACP-ului**: `routes.api[].acp: "view" | "edit" | "delete"` — nucleul cere poarta ACP (sesiune ACP
  validă, 2FA) și dreptul pe secțiunea `plugin.<cheie>`; pluginul primește `request.acp = true`. Paginile ACP ale
  pluginului își trimit formularele doar spre astfel de rute.

### 2.5 Stilurile CSS scrise de admini (GCS 0.7.1)

- `ctx.members.appearance.styles.check(kind, key, css)`, `set(kind, key, css | null)`, `list(kind?)`, cu `kind`
  `name` sau `banner`. `set` merge doar dintr-o rută API sau o pagină ACP a pluginului (jetonul apelului știe asta;
  altfel `acp_required`), iar adminul ajunge în jurnalul ACP (`plugin.appearance_style.create/update/delete`).
- Gramatica (`customStyle.ts`): declarații, blocurile `::before { }` / `::after { }` și `@keyframes nume { }`; niciun
  selector scris de admin. Aceleași interdicții ca la CSS-ul pluginurilor (normalizarea CR/FF, `<`, `\`, `@import`,
  `expression(`, `javascript:`, `behavior:`, `-moz-binding`…), plus: fără `!important`, fără `position: fixed/sticky`,
  fără `image-set(` / `src(`, `url()` doar spre fișierele pluginului. Erorile au linia lor.
- Compilarea (în `/gcs-names.css`): pe clasa stilului (previzualizări, banner-ele randate de nucleu) și pe numele
  membrilor care l-au ales; `@keyframes` primesc prefixul stilului, animațiile se opresc sub reduced-motion. Tabelul
  `plugin_appearance_styles` (plugin, tip, cheie, sursa, cine, când).

### 2.4 Variabile CSS și elemente media în HTML-ul pluginului

- `style` e acceptat **doar ca listă de variabile CSS**: `--nume: valoare`, unde valoarea e o culoare `#hex`, un număr
  cu unitate (`px`, `%`, `deg`, `s`, `ms`, `em`, `rem`, `vw`, `vh`, `fr`) sau un identificator simplu. Fără `url()`,
  funcții, ghilimele sau proprietăți obișnuite. Variabilele se moștenesc doar în containerul pluginului.
- `audio`, `video`, `source` (doar în pagini): `src`/`poster` doar spre fișierele pluginului; `video` primește mereu
  `muted` și `playsinline`; `audio` nu acceptă `autoplay`.
- Clasele de prezentare ale numelor și avatarelor (`gcs-userLink`, `gcs-name--<cheie>`, `gcs-avatar`, `gcs-avatar__img`)
  și `data-user-id` pe linkuri: pluginul afișează membri exact ca nucleul (stilul numelui, rama, hover card-ul).

### 2.5 API-ul VIP (`ctx.api.vip`, fără capabilitate: citiri publice)
- `plans()`: planurile (grupurile VIP): cheia, numele, culoarea, iconița, poziția;
- `status(userIds)`: abonamentul activ al fiecărui user (planul, expirarea) — ≤ 100 de useri;
- `members({ limit })`: membrii VIP activi (online întâi, apoi după ultima activitate), cu numele, linkul, avatarul,
  planul și starea online (respectând setarea de confidențialitate a fiecăruia).
- `ctx.api.users.get` întoarce în plus `nameKey` și `frameKey` (clasele stilului numelui și ale ramei).

### 2.6 JS-ul pluginurilor semnate în widget-uri
Un plugin semnat, cu `client-js`, își primește scripturile și pe paginile unde apare un widget al lui (pe lângă
`/p/<cheie>/…`). Pluginurile nesemnate rămân fără JS. În ACP nu se încarcă niciodată JS de plugin.

## 3. Pluginul `gcs.vip_studio`

Sursele: `packages/plugin-sdk/plugins/vip-studio/` (TypeScript compilat cu esbuild). Construcția:
`pnpm --filter @gcs/plugin-sdk build:vip-studio` → `dist/gcs.vip_studio-<versiune>.zip` (nesemnat); semnarea e un pas
separat: `GCS_PLUGIN_SIGNING_KEY=<cale PEM> GCS_PLUGIN_SIGNING_KEY_ID=<id> pnpm --filter @gcs/plugin-sdk sign:vip-studio`.
Fără cheie privată în repo.

### 3.1 Capabilități
`db`, `events`, `widgets`, `pages`, `acp`, `api`, `menus`, `jobs`, `settings`, `permissions`, `client-css`,
`client-js`, `media`, `appearance`, `hooks`.

### 3.2 Datele (schema proprie a pluginului)
- `categories` (id, tipul catalogului, numele, poziția) — pentru rame, fundaluri de card și fundaluri de profil;
- `items`: un singur tabel pentru toate cataloagele — `kind` (`name_style`, `banner`, `frame`, `card`, `weapon`,
  `background`, `theme`, `song`), cheia, numele, categoria, `data` (definiția validată: culori, efect, variante, id-uri
  media, poziții), `plans` (lista planurilor; goală = toți VIP-ii), `enabled`, `retired`, poziția, data adăugării;
- `loadouts`: alegerile membrului (`user_id`, `data` JSON, data), plus cine l-a resetat;
- `audit`: resetările și modificările din ACP (ultimele 500).
Presetările implicite se inserează la prima rulare (din cod, cu aceeași validare) și se pot restaura din ACP.

### 3.3 Cine ce poate
- Permisiunile pluginului: `use` (deschide studioul; implicit toți membrii), `test_all` (folosește tot catalogul fără
  plan, pentru test; implicit Root Admin și Admin).
- Un element e disponibil dacă e activ, nu e retras, are fișierul media și planul membrului e în `plans` (sau lista e
  goală). Planul vine din `ctx.api.vip.status`.
- **Ne-VIP**: deschide studioul și încearcă totul în previzualizare; „Salvează” deschide fereastra „Devino VIP” (link
  spre pagina VIP din setări). Serverul refuză oricum salvarea (`vip_required`).
- **Expirarea VIP**: alegerile rămân salvate, dar aspectul publicat se șterge (evenimentul `vip.expired`), deci peste tot
  apar valorile implicite. La `vip.granted` aspectul se publică din nou, filtrat după noul plan. Un job (la 60 min)
  reconciliază toate alegerile (planuri schimbate, elemente dezactivate sau șterse).
- **Moderare**: ACP → Studio VIP → Membri: lista echipamentelor, resetare completă sau doar a citatului; în jurnalul
  pluginului.

### 3.4 Pagina studioului (`/p/gcs.vip_studio`)
- **Antet**: titlul, explicația și caseta „identitate live” cu numele stilizat al membrului.
- **Două moduri** (comutator): *Profil mic* — Stilul numelui, Rame avatar, Banner, Fundal card, Arma preferată;
  *Profil complet* — Fundal profil, Citat personal, Tema profilului, Melodia profilului. Tab-uri ARIA, săgețile
  schimbă tab-ul.
- **Două coloane**: grila de opțiuni (stânga) și previzualizarea lipită (dreapta): pentru *Profil mic*, cardul membrului
  (avatar cu ramă, nume, banner, statistici cu arma, fundalul cardului) plus antetul site-ului cu numele; pentru
  *Profil complet*, macheta profilului (fundal, nume, banner, armă, citat, tab-uri); pe tab-ul melodiei, playerul.
- **Bara de jos** lipită: „Resetează la implicit”, „N modificări nesalvate” (câte un grup schimbat), „Salvează”.
- **Stiluri de nume**: ~50, cu efectele din §2.1; unele au **variante de culoare** (roșu, albastru, mov, cyan, roz,
  auriu, curcubeu, verde, portocaliu, alb): alegerea stilului deschide banda de variante, iar varianta se salvează.
- **Rame, fundaluri de card, fundaluri de profil**: filtre pe categorii („Toate” + categorii), eticheta „NOU” (adăugate
  în ultimele 7 zile, configurabil), elementele fără fișier apar „retras” și nu se pot alege; videoclipurile apar cu
  posterul. Grilele se randează pe loturi la derulare.
- **Bannere**: ~60 de presetări (culori pline, gradiente, animate), afișate ca pastila reală cu eticheta planului.
  Implicit: banner-ul grupului.
- **Arme**: iconițe liniare originale + „Niciuna”.
- **Citat**: maxim 200 de caractere, numărătoarea devine galbenă la 160 și roșie la 190; gol = fără citat.
- **Teme**: Implicit + patru teme originale.
- **Melodie**: din catalog, fișier propriu (MP3/Ogg, dacă setarea permite) sau link YouTube (validat la id-ul de 11
  caractere); „pornește automat (fără sunet)” oprit implicit.
- **Fără JS** (plugin instalat nesemnat): previzualizarea merge doar din CSS (`:has()` + variabilele CSS ale
  opțiunilor), salvarea e un formular POST obișnuit. **Cu JS** (semnat): numărătoarea modificărilor, ferestrele
  („Devino VIP”, „Se echipează…”), tragerea fundalului cardului pentru poziție, player-ul, previzualizarea YouTube,
  încărcarea pe loturi, salvarea într-o singură cerere și reîmprospătarea.

### 3.5 Widget-ul „VIP online” (`roster`)
Caruselul membrilor VIP (online întâi): avatar cu ramă, nume stilizat, planul, banner-ul. Săgeți, swipe, tastatură,
buclă infinită (cu JS); fără JS, o listă orizontală cu `scroll-snap`. Gol: „Devino VIP”.

### 3.6 Pagina „Beneficii VIP” (`/p/gcs.vip_studio/benefits`)
Lista beneficiilor generată din ce e activ în ACP (ex. „N stiluri de nume”, „rame exclusive”, „fundal video pe
profil”), cu link spre pagina VIP a site-ului și spre studio.

### 3.7 ACP (doar HTML + formulare, fără JS)
Prezentare (numere, link-uri), Stiluri de nume (cu variante), Bannere, Rame avatar (încărcare PNG/WebP cu transparență,
previzualizare peste un avatar de probă, scară și decalaj), Fundaluri card, Arme, Fundaluri profil (imagine sau video
cu poster), Teme, Melodii, Categorii, Membri. Pentru fiecare element: nume, categorie, planuri, activ/retras, ordine
(sus/jos), ștergere (membrii care îl foloseau revin la implicit).

### 3.8 Setări
Pagina VIP a site-ului (link), fișiere audio proprii (da/nu, mărime maximă), zilele etichetei „NOU”, rândul cu arma în
postbit, numărul de membri din widget.

## 4. Teste
- nucleu (unit): validarea aspectului (injecții CSS/HTML, culori, intervale, căi media străine), compilarea CSS-ului,
  sanitizer-ul (formulare, acțiuni străine, `style`, media), manifestul (`media`, `acp`), durata video, corpurile de
  formular, gating-ul API-ului ACP;
- plugin (unit): validarea catalogului și a presetărilor, gating-ul pe planuri, expirarea, salvarea echipamentului,
  limitele media, citatul;
- E2E: instalarea pluginului semnat (cheie de test generată la pornirea rulării E2E, doar în memorie), studioul
  (alegeri → previzualizare → salvare → nume/ramă/banner vizibile în postbit și pe profil), widget-ul și ACP-ul.

## 5. Lăsat deoparte
- Linkuri externe pentru videoclipuri de fundal (ar dezvălui IP-ul vizitatorilor altor site-uri): doar fișiere încărcate.
- Recodarea video/audio (ar cere ffmpeg): fișierele se verifică după tip, mărime și durată, nu se recodează.
- Durata fișierelor audio: doar limita de mărime.
