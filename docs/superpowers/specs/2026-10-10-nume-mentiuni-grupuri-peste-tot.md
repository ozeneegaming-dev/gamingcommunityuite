# Nume, mențiuni și grupuri peste tot

- **Data:** 2026-10-10
- **Ce rezolvă:** numele membrilor aveau stiluri diferite de la un loc la altul (stilul grupului pierdut sub culorile
  linkurilor din Nova / Clasic, efectele Studio VIP doar în câteva locuri); @mențiunile existau doar în editorul
  postărilor; pastilele grupurilor nu duceau nicăieri; grupurile secundare nu se vedeau.
- **Regula de bază:** implementare GCS proprie; efectele noi de text sunt adaptate după biblioteca MIT „CSS Text
  Effects” (licența în `THIRD-PARTY-NOTICES.md`, la rădăcină și în pachetul Studio VIP; fără credit în interfață).

## 1. Numele membrilor: o componentă, un markup

- **Markup comun** (`@gcs/core/member-name`, `GcsMemberName` în `@gcs/ui`, `{% username %}` în șabloane, pluginuri):
  `<a class="gcs-userLink gcs-name gcs-name--<cheie>" href data-user-id data-text>Nume</a>`; fără link:
  `<span data-name-user>`; varianta mare: `data-name-fx="full"`. Efectele pe litere: `<span class="gcs-name__t">Nume</span>`
  (numele accesibil, ascuns vizual) + `<span class="gcs-name__ls" aria-hidden="true"><b data-c="N" style="--i:0"></b>…`
  (glifa din `::before`), afișate doar de regulile generate. `prefers-reduced-motion` oprește și literele.
- **Cheia stilului:** stilul ales din Studio VIP (`ns_*`) → grupul afișat (`users.nameGroupId`) → grupul principal
  (`nameKeyOf`). Efectul personal VIP vine peste, din CSS-ul generat pe `data-user-id`.
- **Precedența CSS:** regulile generate au specificitatea unui id (`:is(.gcs-root,#gcs-names)`), iar culorile linkurilor
  din temă nu se aplică numelor (`a:where(:not(.gcs-name, [data-group-pill]))`). Fără `!important`.
- **HTML salvat / pluginuri / șabloane:** `decorateMemberNamesHtml` (core) și `namesHtml` / `GcsNamedHtml` (web) aduc
  orice `a.gcs-userLink` / `.gcs-mention` cu `data-user-id` la markup-ul comun, cu stilul de acum.
- Inventarul locurilor (forum, topic, widget-uri, antet, notificări, mesaje, activitate, căutare, membri, clasamente,
  staff, profil, urmăritori, mențiuni, cardul grupului, chat standard și Chat Pro — cameră, clasament, istoric —, clanuri,
  servere, VIP, ACP) e păzit de `apps/web/lib/names-guard.test.ts` (nicio clasă `gcs-name--${…}` scrisă de mână în afara
  locurilor de grup listate; componenta comună folosită în locurile cerute).

## 2. Efectele de text (Studio VIP 1.1.0)

- Categoria „Efecte text” (62 de efecte, nume românești, variante de culoare), plus efectele cerute: Oglindă neagră,
  Cameleon, Sclipire în cruce, Glitch scanat, Magnetic, Vid, Undă de lumină, Val de litere; Electric curcubeu (culorile
  ciclează). Instalările existente primesc stilurile lipsă (`PRESETS_VERSION` 3, cele neatinse de admin se reîmprospătează).
- Fiecare efect are comentariul `/* adapted from CSS Text Effects (MIT) — <cheie> */`.

## 3. Grupurile

- **Pastila unui grup** (`GcsGroupPill`, `GcsGroupLink` pe server): link spre `/members?group=<id>` (doar grupurile
  publice; vizitatorii și grupurile marcate „ascuns” nu au link și dau 404), `aria-label` „Membrii grupului X · …”, focus
  vizibil, tooltip (hover + tastatură): descrierea scurtă (setarea grupului), „31 de membri (12 ca grup secundar) · 7
  online acum”, opțional un rând dat de o aplicație. Orice grup, și unul creat acum („0 membri · 0 online acum”).
  Numărătorile vin din cache (`GcsGroupDirectory.counts()`, 60 s).
- **Locuri:** legenda din panoul de statistici și widget-ul ei, postbit (grupul afișat + rândul grupurilor secundare),
  hover card, antetul profilului, cardurile membrilor (eticheta „principal” / „secundar”), titlurile paginii Staff.
- **`/members?group=<id>`:** titlul în culoarea grupului, descrierea, membrii cu grupul ca principal sau secundar
  (sau doar principal, cu setarea „doar principal”), paginat.
- **Grupul afișat** (`GcsGroupDisplayService`): setarea „Prioritate afișare” (staff 100–70, VIP 50, ceilalți 10); dintre
  grupurile membrului cu stil de nume câștigă prioritatea cea mai mare; „Membrii pot alege acest grup ca grup afișat” +
  Setări → Aspect → „Grupul afișat” (Automat / alegerea). Recalculat la schimbarea grupurilor membrului sau a setărilor.
- **Setările de afișare ale grupului** (ACP → Grupuri → grup → „Afișare”): prioritatea, alegerea, „Afișează ca grup
  secundar”, „doar membrii cu grupul principal” (pagina membrilor și @mențiunile grupului), pagina membrilor (public),
  „Descriere scurtă (tooltip)”.

## 4. Grupuri Pro (aplicație premium, `groups_pro`)

- Pornită prin seed oprită (instalări noi și existente), `groups_pro.app_access` generat. Oprită: legenda simplă și 404
  pe `/members/groups`.
- **Legenda pe categorii** (înlocuiește tot blocul din panou prin registrul `registerGroupLegend`): antetul „Legenda
  grupurilor” (iconița de accent, butonul „i” cu tooltip, numărul de grupuri, „Vezi toate grupurile”), carduri pe 3
  coloane (bara de accent, totalul), rândurile grupurilor (iconița în pătrat nuanțat, numele în culoare, membri + online),
  grupurile legate într-un dropdown (antetul „Grupuri secundare legate · N membri în total”, Escape / click în afară).
- **Categoriile** (setarea `groups_pro.legend_categories`): implicit Staff, Moderatori, VIP, Membri (etichete traduse);
  la instalare / actualizare, fiecare grup fără categorie primește una după tip (doar dacă nu are). ACP → grup →
  „Legendă (Grupuri Pro)”: „Categorie în legendă” și „Apare în legendă sub grupul…”. Pagina ACP „Legenda grupurilor”
  (gestionarea categoriilor) rămâne pe mai târziu.
- **`/members/groups`** („Grupurile comunității”): căutare (grup sau membru), filtrul Toți / Doar principal / Doar
  secundar, filtrul pe categorie, rânduri care se deschid (`aria-expanded`, înălțime + opacitate) cu membri / ca secundar
  / online și primii 12 membri cu eticheta lor, „N afișați din M” și „Toți membrii grupului →”.

## 5. Mențiunile peste tot

- **Sugestiile:** aceeași listă (membri cu avatar și nume stilizat, grupurile pe care autorul le poate menționa) în
  editorul postărilor și în câmpurile simple, prin `useMentionInput` (`@gcs/ui/mention-input`): ↑ ↓, Enter / Tab, Escape,
  click; lista încape pe 375 px.
- **Pe server, după id:** `GcsTextMentions` hotărăște mențiunile textului simplu (sugestiile alese încă în text, `@nume`
  exact, grupurile permise de setările `mentions.*`), păstrate lângă text (`meta.mentions` la chat). Pastilele au
  markup-ul postărilor (`a.gcs-mention[data-user-id]`, `a.gcs-groupMention[data-group-id]`), deci hover card-ul și
  cardul grupului merg peste tot; un membru redenumit rămâne legat prin id.
- **Notificările:** `chat.mention` (chat), `forums.mention` (postări, statusuri și comentarii pe profil, mesaje private —
  doar participanții —, tichete), `core.group_mention` prin evenimentul `mentions.created` (setările grupului: notificare,
  limită, pauză). Editările și semnăturile nu notifică. Chat Pro evidențiază mesajul după id (și după poreclă).

| Compozitor | Cum primește sugestiile | Pastile | Notificări |
| --- | --- | --- | --- |
| Topic nou, răspuns, editare | editorul (`mentionUrl`) | da (după id) | da (editarea: nu) |
| Mesaje private | editorul | da | participanții menționați |
| Chat, Chat Pro, shoutbox | `useMentionInput` | da (`meta.mentions`) | da, și grupurile |
| Statusuri și comentarii pe profil | `useMentionInput` (noduri `mention`) | da | da, și grupurile |
| Tichete (Servere) | `GcsRichTextInput` cu `mention` | da | da (nu din notele interne) |
| Semnătura, textele profilului, descrierea clanului | editorul / `GcsRichTextInput` | da | nu (conținut static) |
| Motive de moderare, cererea de intrare în clan | text simplu | nu | nu |

| Afișare | Cum primește stilul numelor |
| --- | --- |
| Postări, revizii | `namesHtml` în pagina topicului |
| Chat (cameră, mesaj fixat, istoric) | decorarea de bază a chat-ului (`chatMentionNames`), `namesHtml` în istoric |
| Profil (statusuri, câmpuri), mesaje private, tichete, clan, semnătura, ACP moderare | `GcsNamedHtml` |
| Hover card, pluginuri, widget-uri ale pluginurilor | `namesHtml` |

`apps/web/lib/mentions-guard.test.ts` păzește lista compozitorilor și a locurilor cu HTML brut.

## 6. Hover și mișcare (design Nova)

- **Butoane:** stratul de sticlă (8% alb) se umple de la stânga la hover / focus (`background-size` 0 → 100%, 1,2 s, cu
  recul la intrare) pe toate butoanele, butoanele-iconiță, pătratele din antet, tab-uri, paginare, cipuri, itemii
  meniurilor și ai sugestiilor (`html.gcs-nova …`; utilitarul `.gcs-sweep` în `base.css`). Regulile de hover setează
  `background-color`, nu `background`. Plin: aceeași culoare + umbră de accent 25%; secundar: chenarul luminat + text alb;
  tab-urile inactive 5% alb; itemii meniurilor 3% alb + `scale(1.01)`; pastilele grupurilor nuanță 30%, chenar 60%,
  strălucire 12 px, −1 px; mențiunile de grup `brightness(1.2)`.
- **Mișcarea:** tokenurile `--gcs-motion-fast|base|slow` (.15 / .2 / .3 s) și `--gcs-motion-ease`
  (`cubic-bezier(.22,1,.36,1)`) în `base.css`; hover card, sugestii și dropdown-urile legendei apar cu opacitate + 6 px;
  tooltip-urile pastilelor intră înclinat; rândurile paginii grupurilor se deschid în înălțime + opacitate, săgeata se
  rotește; filtrul paginii schimbă lista cu o trecere de opacitate; numărătorile urcă de la zero. Cu „reduced motion”:
  doar opacitatea.

## 7. Teste

- Unitare: `memberName`, `nameStyles`, `nameEffects`, `appearance*`, `display` (grupul afișat), `textMentions` (core);
  `groupDirectory`, `groups-pro/service`, chat (pastile, `meta.mentions`, notificări de membru și de grup), statusuri,
  tichete (modules); `GcsMemberName`, CSS-ul Nova (ui); `names-guard`, `mentions-guard`, `group-pill-text` (web).
- E2E: `names-everywhere` (VIP + gradient Root Admin în 5 locuri și meniul userului, temă închisă și deschisă; sweep-ul
  butoanelor), `groups-everywhere` (grup nou în ACP → „1 membru”, legenda și postbit-ul → membrii grupului, Moderator +
  VIP secundar, Grupuri Pro oprit / pornit), `mentions-everywhere` (chat, Chat Pro, perete, postări, mesaje private).
