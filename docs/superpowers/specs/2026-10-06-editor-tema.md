# Editorul vizual de temă (ACP → Aspect → Teme → „Editează vizual”)

Data: 2026-10-06 · Stare: implementat pe ramura editorului de temă

## Scop

Un mod „customize” pe tot ecranul, în care adminul schimbă aspectul site-ului și vede imediat rezultatul într-o
previzualizare live a site-ului public, fără să salveze. „Salvează” publică tema pentru toți; până atunci modificările
stau în draft-ul temei (vizibil doar adminilor cu drept pe `appearance.themes`).

## Ruta și accesul

- `/admin/theme-editor/[key]` — în afara shell-ului ACP (grupul `admin/(fullscreen)`), aceeași gardă: `requireAcpSection("appearance.themes", "edit")`
  (fără acces → 404; fără 2FA → configurare; sesiune ACP expirată → reautentificare).
- Butonul „Editează vizual” (`fa-paintbrush`) pe fiecare temă din ACP → Aspect → Teme.

## Aspect

1. **Bara de iconițe** (stânga, întunecată): culori luminoase (`fa-lightbulb`) / întunecate (`fa-moon`); mărimea
   previzualizării: mobil 390px (`fa-mobile-screen-button`), tabletă 820px (`fa-tablet-screen-button`), desktop 100%
   (`fa-display`); CSS personalizat (`fa-code`); jos „Ieșire” (`fa-arrow-right-from-bracket`) și „Salvează”
   (`fa-floppy-disk`, verde). Fiecare buton are tooltip și `aria-label`.
2. **Panourile** (coloana a doua): navigare în adâncime (titlu, „Înapoi”, rânduri cu chevron). Pornire: CSS personalizat,
   separator, Paletă de culori, Mod luminos/întunecat, Logo-uri, Aspect pagini, Tipografie, Antet (Desktop, Mobil),
   Subsol, Navigare mobilă, Global (Body, Casete conținut, Bară laterală, Avatare, Butoane).
   Sub-panourile cu setări și culori au tab-urile „Setări” și „Culori”.
3. **Previzualizarea** (dreapta): un `iframe` cu site-ul public, la lățimea aleasă.

Fiecare rând de setare: eticheta, controlul, un text scurt de ajutor și butonul „Revino la implicit”
(`fa-clock-rotate-left`), vizibil doar când valoarea diferă de cea implicită.

Selectorul de culoare (sub-panou): tab-ul „Mostre” (tokenurile paletei modului curent; pentru elemente și
„transparent”) și tab-ul „Selector” (`input type=color` + câmp hex). Culorile elementelor pot fi o referință la un
token (`@accent` → `var(--gcs-accent)`) sau un hex; culorile paletei sunt doar hex (fără cicluri).

## Setări și ce schimbă

Toate setările sunt în `GcsThemeSettings` (JSON-ul temei). Temele vechi se completează cu valorile implicite
(`normalizeThemeSettings`), iar valorile implicite reproduc exact aspectul actual.

| Setare | Unde acționează |
| --- | --- |
| Paleta (dark / light): primară = `accent`, secundară = `accentInk`, bază = `bg` + restul tokenurilor | `--gcs-*` pe `html` |
| Mod implicit (al site-ului / sistem / luminos / întunecat), comutatorul în subsol (da/nu) | `data-theme` pe `html`; formularul din subsol |
| Logo text: text, slogan, font, grosime, mărime desktop / mobil, text vizibil pe mobil | `.gcs-brand__name`, `.gcs-brand__slogan` |
| Logo imagine desktop (dark + light, înălțime % din antet), mobil (dark + light, înălțime %) | `.gcs-brand__logo--*` |
| Index forum: listă / grilă; topic: normal / compact; prima postare evidențiată | `.gcs-forumIndex`, `.gcs-post` |
| Tipografie: fonturi (lista + orice Google Font), mărimea de bază, mărimea conținutului (%) | `--gcs-font-*`, `.gcs-root`, `.gcs-postBody` |
| Culori text: titluri, linkuri, linkuri la hover | `--gcs-heading`, `--gcs-link`, `--gcs-link-hover` |
| Antet: înălțime desktop / mobil, iconițe în meniu, fix la scroll, fundal, text | `.gcs-siteHeader*` |
| Subsol: fundal, text | `.gcs-siteFooter*` |
| Navigare mobilă (sertarul): partea (stânga/dreapta), iconițe, fundal, linkuri | `.gcs-drawer*` |
| Body: lățimea maximă, fundalul | `--gcs-page-width`, `body` |
| Casete: grosimea și raza chenarului, umbra, rânduri de forum clicabile, fundal, chenar, antet (fundal + text), titlul și iconița widget-urilor | `.gcs-card`, `.gcs-category__header`, `.gcs-widgetTitle` |
| Bara laterală: lățime, în stânga, fixă la scroll | `.gcs-forumSidebar`, `.gcs-forumLayout` |
| Avatare rotunde (da/nu) | `.gcs-avatar`, `.gcs-avatarFrame` |
| Butoane: rază, culorile butonului principal și secundar | `.gcs-btn--primary`, `.gcs-btn--ghost` |

Lăsate deliberat deoparte (nu există elementul pe site): bara de navigare mobilă în subsol (sertarul e singura navigare
mobilă), reordonarea elementelor din antet prin drag-and-drop (antetul are un flux fix brand → meniu → unelte).

## Previzualizarea live, în siguranță

- `iframe`-ul încarcă `/?gcs-theme-preview=<cheie>`. Proxy-ul transformă parametrul în header-ul intern
  `x-gcs-theme-preview` (și șterge orice header cu același nume venit din afară) și pune un cookie de sesiune
  `gcs-theme-preview`, folosit doar pentru documentele încărcate într-un `iframe` (`Sec-Fetch-Dest: iframe`).
- Layout-ul arată draft-ul doar dacă viewerul are drept de editare pe teme și a trecut poarta ACP; altfel tema publicată.
- `X-Frame-Options` rămâne `DENY` pentru toți; `SAMEORIGIN` doar pentru cererile cu parametrul sau cookie-ul de mai sus.
- În `iframe` rulează o punte mică (`GcsThemePreviewBridge`): primește prin `postMessage` (doar de la `window.parent`,
  doar de pe aceeași origine) CSS-ul compilat al draft-ului, modul (luminos/întunecat) și textul logo-ului.
- Editorul compilează CSS-ul local, cu aceeași funcție ca serverul (`compileThemeCss`, din `@gcs/core/themes`, fără
  Prisma), deci previzualizarea e instantanee.

## Salvare

- Draft-ul se salvează automat (debounce 700 ms) prin `saveThemeStudioDraft` (`runAcpAction`, secțiunea
  `appearance.themes`, dreptul `edit`); validarea completă e în serviciu (intervale, enumerări, hex/tokenuri, fișiere).
- „Salvează” = `publishThemeStudio` (draft → temă, `version + 1`, jurnal `theme.publish`).
- „Ieșire” cu modificări nepublicate → dialog „Ieși fără salvare” (renunță la draft, jurnal `theme.discard`) /
  „Continuă editarea”.
- Logo-urile se încarcă prin `/api/themes/images` (aceeași poartă ACP, imaginea devine WebP).

## Teste

- Unitare (`packages/core/src/themes/themes.test.ts`): completarea cu valorile implicite, validarea (intervale,
  enumerări, culori, tokenuri, fișiere, chei necunoscute), compilarea CSS (variabile, reguli condiționale), draft-ul adânc.
- E2E (`apps/web/e2e/theme-editor.spec.ts`): deschiderea editorului, o culoare + un interval, previzualizarea, dialogul
  de ieșire, salvarea, CSS-ul public, revenirea.
