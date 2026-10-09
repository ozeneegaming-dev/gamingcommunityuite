# Navigația ACP pe două niveluri și pagina Aplicații

- **Data:** 2026-10-09
- **Cererea proprietarului:** meniul ACP actual (un singur sidebar cu grupuri pliabile) e „mult mai puțin organizat”
  decât referința arătată. Se cer: (1) o **bară de iconițe** cu zonele principale și o **a doua coloană** cu toate
  paginile zonei, pe grupuri; (2) pagina **ACP → Sistem → Aplicații** refăcută ca o listă compactă, profesionistă, cu
  comutator, aplicația de pornire, permisiuni pe grup, secțiuni, meniul „⋯” și reordonare.
- **Referințe:** specul principal §5 (`acpMenu`), §6 (permisiuni), §12 (ACP); specul etapei 6 §1 (cadrul ACP), §2.3
  (pluginurile); specul 2026-10-07-meniu-si-pagini (meniul principal).

## 1. Navigația ACP

### 1.1 Structura

- **Bara de iconițe** (stânga, îngustă, mereu vizibilă pe desktop, închisă la culoare în ambele teme): marca site-ului,
  apoi **Dashboard** (link direct, nu zonă) și zonele, fiecare cu iconiță și eticheta mică dedesubt. Zona care conține
  pagina curentă e marcată (`aria-current`), zona afișată în coloană e „selectată”.
- **Coloana a doua** (lângă bară): titlul zonei, apoi **toate** paginile ei odată, pe grupuri cu titluri mici, cu
  majuscule. Pagina curentă e evidențiată (`aria-current="page"`). Coloana se restrânge (hamburgerul din bara de sus sau
  butonul din antetul ei) și alegerea se ține minte (cookie, citit de layout: prima randare e deja cea corectă). Zona
  afișată e cea a paginii curente; pe Dashboard (care nu e într-o zonă) coloana arată **ultima zonă folosită** (tot
  într-un cookie). Un click pe o zonă din bară o afișează în
  coloană (și redeschide coloana restrânsă), fără navigare.
- **Cardul adminului** (avatar, nume, rolul ACP, 2FA) e la baza coloanei.
- **Mobil (≤ 900 px):** hamburgerul deschide un sertar (dialog modal) cu aceleași două niveluri: bara și coloana, una
  lângă alta. Focus captiv, Escape și click pe fundal îl închid, la navigare se închide singur.
- **Accesibilitate:** link „Sari la conținut” (primul element focusabil); în bară focus „roving” (o singură oprire Tab,
  săgețile sus/jos, Home/End); butoanele zonelor au `aria-controls` spre coloană și `aria-pressed`; coloana e un
  `nav` cu eticheta zonei. Temele ACP întunecată și luminoasă (bara rămâne închisă, coloana urmează tema).
- Căutarea din bara de sus rămâne neschimbată.

### 1.2 Zonele și grupurile

Ordinea zonelor: Dashboard · Sistem · Comunitate · Membri · Aspect · Gaming · VIP & Magazin · Statistici · Aplicații.
O zonă fără nicio pagină vizibilă adminului dispare (drepturile ACP pe secțiuni rămân exact ca acum).

| Zonă | Grupuri (în ordine) și pagini |
|---|---|
| **Sistem** | Prezentare: Fișiere, Stare sistem · Aplicații și integrări: Aplicații și pluginuri, Integrări, API, Webhooks, Import RSS · Setări: Generale … Web App (toate 11) · Descoperire: Căutare, Stream-uri, RSS, Taguri · Promovare: Reclame, SEO, Share · Întreținere: Jurnale sistem, Golire cache · Conversii: Import din altă platformă |
| **Comunitate** | Forumuri: Forumuri, Prefixe, Acțiuni salvate, Setări forum · Chat: Canale, Setări chat · Moderare: Coadă unificată, Rapoarte, Anti-spam, Avertismente, Tichete |
| **Membri** | Membri: Membri, Grupuri, Promovări de grup, Unelte IP, Cereri GDPR · Staff: Moderatori, Administratori și roluri ACP, Pagina Staff · Setări membri: Profiluri, Reputație & Reacții, Notificări, Ban, Referral · Realizări: Reguli, Ranguri, Badge-uri, Setări realizări · Comunicare: Email în masă |
| **Aspect** | Teme și stil: Teme, Șabloane, CSS · Pagini și meniuri: Widget-uri, Manager meniu |
| **Gaming** | Servere: Servere, Admini servere, Hărți, Setări servere, Bridge și ELO · Clanuri: Clanuri, Setări clanuri |
| **VIP & Magazin** | VIP: Niveluri, Abonați, Istoric, Stiluri de nume, Avatar frames, Pagina VIP |
| **Statistici** (nouă) | Prezentare: Prezentare generală (pagină reală: plăcile aplicațiilor) · Activitate: Înregistrări, Activitate membri, Activitate conținut, Online („în curând”) · Aplicații: Servere, Clanuri, VIP („în curând”, aduse de aplicații) |
| **Aplicații** | Gestionare: Aplicații și pluginuri (scurtătură spre pagina din Sistem) · Dezvoltare: Hook-uri, Portare plugin · apoi câte un grup pentru fiecare plugin, cu paginile lui ACP |

- Paginile „în curând” rămân în grupurile lor (pagina generică „în curând”).
- Cheile secțiunilor ACP (drepturile) nu se schimbă: o pagină mutată în altă zonă își păstrează secțiunea
  (ex. Moderarea rămâne `members.queue`…).

### 1.3 Modelul (`acpMenu`)

Compatibil cu modulele existente:

```ts
type GcsAcpArea = "system" | "community" | "members" | "appearance" | "gaming" | "vip" | "stats" | "apps";

interface GcsAcpMenuSection {
  app: GcsAcpApp;     // ca acum (cheile secțiunilor)
  title: string;      // titlul grupului (cheie de traducere), ca acum
  icon?: string;
  area?: GcsAcpArea;  // nou; lipsă = zona aplicației (`app`): system → system, pages → apps …
  group?: string;     // nou; titlul grupului, dacă e altul decât `title`
  items: GcsAcpMenuItem[];
}
interface GcsAcpMenuItem {
  key; labelKey; href; section; icon?;
  area?: GcsAcpArea;  // nou: o intrare poate sta în altă zonă decât secțiunea ei (ex. statisticile unei aplicații)
  group?: string;     // nou: alt grup
  alias?: boolean;    // nou: scurtătură spre o pagină care stă în altă zonă (nu decide zona curentă)
}
```

- Grupul unei intrări: `item.group ?? section.group ?? section.title`; zona: `item.area ?? section.area ?? zona(app)`.
  O intrare fără grup ajunge sub titlul secțiunii ei (pentru pluginuri: numele pluginului).
- Ordinea grupurilor într-o zonă: lista cunoscută a nucleului (`GCS_ACP_GROUP_ORDER`), apoi celelalte în ordinea
  înregistrării modulelor. Ordinea intrărilor: ordinea declarării.
- `acpAreas(menu)` (pur, în `@gcs/core`) construiește zonele din meniul deja filtrat pe drepturi; zona curentă = zona
  intrării cu cea mai lungă potrivire de cale (scurtăturile nu contează).
- **Pluginurile:** paginile ACP din manifest ajung în zona Aplicații, sub numele pluginului; manifestul poate cere opțional
  `area` și `group` (etichetă) pe fiecare rută ACP.

## 2. Pagina Aplicații (Sistem → Aplicații și integrări → Aplicații și pluginuri)

### 2.1 Lista

O listă compactă, aplicațiile întâi, apoi pluginurile (aceeași formă a rândului, secțiune separată). Fiecare rând:
mâner de tragere, iconiță, nume, **versiune**, autor, **„Certificat GCS” / „Necertificat”** (doar pluginuri), starea
**Activă / Oprită / Blocată**, ★ (aplicația de pornire), 🔒 (permisiuni), comutator, ▸ (secțiuni), ⋯ (meniu).

- **Nucleu** și **Forum** sunt **Blocate**: nu se pot opri sau dezinstala (comutatorul e dezactivat, cu explicația).
- Versiunea aplicațiilor de bază = versiunea GCS; autorul = GamingCommunitySuite.
- Un plugin dezinstalat cu datele păstrate apare în secțiunea pluginurilor, fără comutator.

### 2.2 Comutatorul

Pornirea / oprirea se aplică imediat (optimist, cu revenire și mesaj la eroare). **Oprirea cere confirmare** într-un
dialog din pagină (`GcsModal`), nu `window.confirm` (dialogurile native sunt suprimate în browserele integrate). Pentru
aplicații: `GcsAppService.setEnabled`; pentru pluginuri: `pluginAdmin.setEnabled`.

### 2.3 Aplicația de pornire (★)

- Setarea `apps.landing` (cheia modulului; implicit `forums`). Ținte declarate de module (`app.landing.href`):
  Forum (`/forum`), Activitate (nucleul, `/activity`), Servere (`/servers`), Clanuri (`/clans`); Pages va adăuga pagini.
- **Ținta efectivă** pentru un vizitator: aplicația aleasă dacă e pornită și vizitatorul o poate accesa; altfel Forum.
- `/` : proxy-ul face **rewrite** intern (nu redirect) spre ținta efectivă când nu e Forum; altfel `/` randează indexul
  forumului, ca acum.
- **Indexul forumului** are și adresa `/forum`: cu Forum ca țintă efectivă, `/forum` → redirect 307 spre `/`; altfel
  `/forum` randează indexul (canonical `/forum`). Nu există bucle: `/` nu redirecționează niciodată, iar `/forum`
  redirecționează doar când `/` randează chiar forumul.
- **Canonical:** pagina aleasă ca pornire are `canonical` = `/` (atât pe `/`, cât și pe adresa ei); sitemap-ul conține
  `/` și, când pornirea nu e Forum, `/forum`.
- Linkurile spre indexul forumului (itemul „Forum” din meniul principal, breadcrumb-ul forumului) folosesc `/forum`
  când pornirea nu e Forum. Pe `/`, itemul aplicației de pornire din meniu e cel activ.

### 2.4 Permisiunile pe grup (🔒)

- Fiecare aplicație care se poate opri (și fiecare plugin) primește automat o permisiune de grup
  **`<modul>.app_access`** („Poate accesa aplicația X”), booleană, cu valoarea **implicită `true` pentru orice grup**
  (inclusiv grupurile create de admin: câmp nou `fallback` în `GcsPermissionDef`). Folosește sistemul existent: setările
  de grup, uniunea permisivă, Root Admin are mereu acces, bannul îl anulează; apare și în pagina grupului.
- Dialogul: toate grupurile cu „Poate accesa” (Root Admin bifat și blocat; Banat lipsește, bannul anulează oricum tot),
  butoanele „Toate” / „Niciunul”, „Salvează”.
  `GcsAppService.setAccess(actor, app, permission, allowedGroupIds)` (dreptul `system.applications` edit) scrie toate
  grupurile într-o tranzacție, cu jurnal, apoi crește versiunea permisiunilor.
- **Aplicarea pe server:**
  - paginile și rutele API ale aplicației (`app.routes`: prefixele căilor, ex. `/servers`, `/bans`, `/api/servers`) →
    proxy-ul răspunde 404 grupurilor fără acces (pluginurile: `/p/<cheie>`, `/api/plugins/<cheie>`);
  - meniul principal: itemii legați de aplicație dispar;
  - widget-urile aplicației dispar din pagini;
  - aplicația nu poate fi pagina de pornire a celor fără acces (văd Forumul).

### 2.5 Secțiunile (▸)

O aplicație își declară secțiunile de pe site (`app.sections`: cheie, etichetă, iconiță, adresă, permisiune opțională),
ex. Servere → Servere (`servers.view`), Meciuri mix și Clasament (`servers.stats_view`), Banuri (`servers.bans_view`),
Admini (`servers.stats_view`), Contestații (`servers.tickets_create`). Fiecare secțiune cu permisiune are 🔒 cu același
dialog, care editează acea permisiune de grup (doar permisiuni booleene de grup ale aplicației). Pluginurile: paginile
din manifest (cu permisiunea lor, dacă au).

### 2.6 Meniul „⋯”

- **Detalii:** descrierea, versiunea, autorul și ce aduce: pagini (site și ACP), widget-uri, permisiuni.
- **Actualizează** (pluginuri): încărcarea unei versiuni noi, prin fluxul existent (verificare → confirmare).
- **Exportă pachetul** (pluginuri): descarcă arhiva instalată (`/api/acp/plugins/<cheie>/package`, dreptul pluginuri
  edit).
- **Dezinstalează** (pluginuri): dialog cu ce se șterge (schema proprie, setările, permisiunile, widget-urile, fișierele),
  „Păstrează datele”, cheia tastată. Aplicațiile de bază nu se pot dezinstala (opțiunea lipsește, cu explicația).

### 2.7 Ordinea

Aplicațiile se reordonează prin tragere (și cu butoanele sus/jos, din tastatură). Ordinea se salvează în `apps.order`
(implicit: aplicațiile de bază, apoi ordinea lor din meniul principal, ca prima mutare să nu amestece meniul) și se
folosește: în lista din ACP și în meniul principal, unde itemii de pe primul nivel legați de aplicații își schimbă
între ei locurile (ceilalți itemi rămân pe loc).

### 2.8 „Verifică actualizări”

Buton dezactivat, cu explicația „disponibil odată cu licențele” (etapa 11). Nu se simulează nicio verificare.

## 3. Teste

- Unitare: `acpAreas` (zone, grupuri, ordine, scurtături, zona curentă, zone goale), meniul nucleului (fiecare pagină
  existentă rămâne accesibilă), pluginurile în zona Aplicații; permisiunea `app_access` generată (implicit pentru grupuri
  noi, Root Admin, ban), `setAccess`, ordinea, ținta efectivă de pornire, rescrierea meniului principal după ordine.
- E2E: bara + coloana (zona curentă, schimbarea zonei, restrângerea ținută minte, sertarul pe mobil, tastatura); pagina
  Aplicații (oprirea cu confirmare, permisiunile unui grup → 404 și meniul ascuns, pornirea pe Servere cu canonical și
  `/forum`). Capturi: ambele ecrane, temele întunecată și luminoasă, desktop și 375 px.
