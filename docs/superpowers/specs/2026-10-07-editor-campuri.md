# Editorul platformei în câmpurile cu formatare (semnătură, reguli, anunț, „Despre”)

- **Data:** 2026-10-07
- **Cererea:** „Editorul trebuie pus la semnături și în locurile asemănătoare, ca să putem formata — font, culoare
  etc.” (captura: ACP → Chat → Setări, „Textul regulilor” era un `<textarea>` simplu).
- **Decizia de bază:** nu adăugăm un editor extern (licența editoarelor comerciale nu e compatibilă cu redistribuirea
  GCS). Folosim **editorul GCS** (`GcsEditor`, `@gcs/ui/editor`, construit pe Tiptap, MIT) — același ca la postări —
  într-o **variantă compactă**: schema și bara de unelte restrânse la ce permite câmpul.

## 1. Inventarul câmpurilor

### 1.1 Trec pe editor (text formatat)

| Câmpul | Unde se scrie | Unde apare | Ce permite |
|---|---|---|---|
| **Semnătura** membrului | Setări → Semnătură | sub postări (și previzualizarea din setări) | bold, italic, subliniat, tăiat, culoare, mărime, aliniere, link, emoji, ștergerea formatării; **imagini din adrese https** (cel mult `profile.signature_max_images`, implicit 1, afișate mici). Fără video, fără upload. |
| **Regulile chat-ului** (`chat.rules`) | ACP → Comunitate → Chat → Setări → General, „Textul regulilor” | dialogul „Reguli” din chat | bold, italic, subliniat, tăiat, exponent / indice, culoare, mărime, evidențiere, aliniere, titluri (din lipire), liste, citat, linie, link, emoji. Fără imagini, video, mențiuni. |
| **Anunțul** (widget-ul `core.announcement`, câmpul „Text”) | Editează pagina → configurarea widget-ului | anunțul de pe pagina principală (și oriunde e pus widget-ul) | ca la reguli, plus imagini din adrese https (cel mult 4). Fără video, upload, mențiuni. |
| **Câmpurile de profil de tip „Text lung”** (`TEXTAREA`, ex. „Despre mine”) | Setări → Profil; ACP → Membri → fișa membrului | tabul „Despre” al profilului | bold, italic, subliniat, tăiat, culoare, evidențiere, aliniere, liste, link, emoji. Fără imagini, video, mențiuni. |

### 1.2 Rămân text simplu

| Câmpul | De ce |
|---|---|
| Descrierea scurtă (bio, 160 de caractere) | un singur rând: sub nume, pe card și în descrierea paginii (OpenGraph). |
| Descrierile forumurilor și categoriilor | un rând în lista forumurilor, descrierea paginii (`<meta>`) și variabila `forum.description` din șabloanele temei; blocurile formatate ar strica rândul. |
| Descrierea camerelor de chat, descrierea badge-urilor | câmpuri scurte, pe un rând (listă, tooltip). |
| Anunțurile globale din chat | un banner pe un rând, trimis în timp real; mesajele de chat sunt text simplu prin design. |
| Mesajele de chat, statusurile și comentariile de pe perete | mesaje sociale scurte, scrise rapid; peretele salvează deja documentul (paragrafe din rânduri), dar un editor greu ar încetini profilul. |
| Motivul raportării, al avertismentelor și al banurilor, notițele adminilor | text intern de moderare, nu se afișează formatat membrilor. |
| Răspunsul din acțiunile salvate ale moderatorilor | un text scurt standard; devine o postare obișnuită, care se poate edita apoi cu editorul complet. |
| Filtrul de cuvinte, imaginile opțiunilor, setările JSON | liste și date, nu text de citit. |
| CSS-ul temei, șabloanele, șabloanele de email | cod, cu editoarele lor. |
| Câmpurile `textarea` ale pluginurilor | pluginul decide cum afișează valoarea; GCS nu știe dacă o tratează ca HTML. |
| Descrierea site-ului (`site.description`) | ajunge doar în `<meta name="description">`. |
| Textul paginii VIP (`vip.page_intro`) | un paragraf sub titlul paginii `/vip` (antetul paginii, ca descrierile forumurilor); rândurile se păstrează (`pre-line`). |
| Descrieri de grupuri / planuri VIP | nu există astfel de câmpuri (beneficiile planurilor se calculează din drepturile grupului). |

### 1.3 Deja cu editorul

- **Regulile comunității** (pagina `/rules`, ACP → Setări → Reguli comunitate, `rules.content`): conținut de pagină
  întreagă, scris cu editorul complet al postărilor (cu imagini și video), randat de același randator și re-sanitizat la
  afișare. Rămâne așa: varianta compactă e pentru câmpurile mici.
- **Setările generice din ACP** (`multiline` → `textarea`) rămân pentru textele simple (ex. `vip.page_intro`). Regulile
  chat-ului nu mai sunt `multiline`: sunt o setare `json` cu formularul lor (ACP → Chat → Setări), deci nu apar ca
  `textarea`.

## 2. Modelul comun

### 2.1 Profilurile câmpurilor (`@gcs/core`, `content/richFields.ts`)

Fiecare câmp are un **profil**: nodurile și mărcile permise, limita de caractere (text, ca la postări) și numărul
maxim de imagini. Profilurile sunt date pure, exportate și separat (`@gcs/core/rich-fields`), ca paginile client să
dea editorului exact aceeași listă (o singură sursă de adevăr):

- `signature`: tot ce produce editorul postărilor, fără `embed` (semnăturile vechi, scrise cu editorul complet, se
  deschid și se salvează la fel); imaginile doar din adrese https (fără atașamente);
- `chatRules`, `announcement`, `profileText`: listele din tabelul de mai sus.

### 2.2 Salvarea (server)

`renderRichField(valoare, profil, limite)`:

1. un text simplu (valorile vechi) devine document: **un paragraf pe rând** (rândurile goale devin paragrafe goale);
2. documentul trece prin **validatorul existent** (`GcsContentRenderer`: noduri, atribute, linkuri http/https/mailto,
   imagini doar https, adâncime, număr de noduri) și prin sanitizer (a doua linie de apărare);
3. apoi prin profil: un nod sau o marcă nepermisă → `format_not_allowed`; prea multe imagini → `too_many_images`; o imagine
   din atașamente → `format_not_allowed`; textul peste limită → `too_long` (cu `{max}`).

Clientul trimite **doar JSON-ul** editorului; HTML-ul îl produce numai serverul. Nimic din ce trimite clientul nu
ajunge în pagină fără să treacă prin pașii de mai sus.

### 2.3 Stocarea și valorile vechi

| Câmpul | Stocare | Valorile vechi |
|---|---|---|
| Semnătura | neschimbată: `users.signature_json` + `users.signature_html` (HTML-ul randat la salvare) | erau deja documente |
| Regulile chat-ului | setarea `chat.rules` devine de tip `json`: `""`, un text (vechi) sau documentul | **conversie la citire**: textul devine paragrafe; HTML-ul se randează la citire (memorat în proces după valoare) |
| Anunțul | `config.body` al amplasării: `""`, un text (vechi: HTML sau text simplu) sau documentul | textul vechi se afișează ca înainte (HTML sanitizat / paragrafe); în editor, HTML-ul vechi e parsat de schema restrânsă |
| Câmpurile „Text lung” | `profile_field_values.value` rămâne textul simplu (postbit, card, căutare, import); coloane noi `json` și `html` (migrația `20261024000000_rich_profile_fields`) | **conversie la citire**: fără `html`, textul vechi se afișează ca paragrafe; în editor devine document |

Alegerea „conversie la citire” (fără migrație de date): valorile vechi rămân valabile fără un pas de migrare care ar
putea eșua la actualizare, iar prima salvare din editor le transformă în documente.

### 2.4 Limitele

- **Semnătura:** `profile.signature_max_chars` (setarea existentă, 0 = semnături oprite) și setarea de grup existentă
  `signature.max_chars` (convenția grupurilor: `-1` = nelimitat, `0` = interzis; se aplică limita mai strictă). Nouă:
  `profile.signature_max_images` (0–5, implicit 1). Imaginile din semnătură au cel mult 90 px înălțime; semnătura
  rămâne la 160 px (CSS-ul existent).
- **Regulile:** 5000 de caractere (ca înainte).
- **Anunțul:** 5000 de caractere, cel mult 4 imagini.
- **Câmpurile „Text lung”:** lungimea maximă a câmpului (din ACP).

## 3. Editorul compact (`GcsEditor`)

- `allow` restrânge **schema** (nodurile și mărcile încărcate): ce nu se poate scrie nu se poate nici lipi (lipirea
  unui titlu într-o semnătură devine paragraf).
- `tools` restrânge **bara de unelte**; implicit, bara rezultă din schemă (fără `allow`, editorul postărilor rămâne
  neschimbat).
- Butonul „Imagine” fără upload deschide câmpul „Adresa imaginii (https://…)”.
- Culorile și mărimile lipite din alte pagini (`rgb(…)`, `#abc`, mărimi din afara listei) sunt aduse la forma
  serverului (`#RRGGBB`, mărimile din bară) sau scoase; altfel tot documentul ar fi respins ca invalid (se aplică și
  editorului postărilor).
- Listele și titlurile au stiluri proprii în conținutul formatat (`richtext.css`: postări, câmpuri, editor): stilurile
  de bază ale Tailwind le scoteau marcajele și mărimea.
- Editorul își recapătă focusul după comenzile din bară la cadrul următor (comportamentul Tiptap); testele E2E așteaptă
  focusul înainte de taste.
- `compact`: înălțime mai mică, fără „Tot ecranul”; `labelledBy` leagă eticheta formularului de zona de scris (și
  pentru cititoarele de ecran).
- `GcsRichTextInput` (aplicația web): editorul + un câmp ascuns cu JSON-ul, pentru formularele trimise ca `FormData`
  (setările chat-ului, fișa membrului din ACP).

## 4. Teste

- `richFields.test.ts` (core): conversia textului vechi, profilurile (noduri / mărci / imagini / atașamente
  respinse), linkurile `javascript:` și `<script>`-ul respinse, limitele, HTML-ul produs.
- editorul: schema restrânsă, bara derivată, imaginea din adresă; paritatea profil ↔ schemă (`editor-schema.test.ts`).
- setarea `chat.rules`, widget-ul anunțului, câmpurile de profil (unit, cu baza de date de test).
- E2E: semnătura formatată (sub postare), regulile scrise în editorul din ACP și afișate în dialog.
