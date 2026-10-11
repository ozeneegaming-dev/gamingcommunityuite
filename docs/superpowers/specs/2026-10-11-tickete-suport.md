# Pluginul „Tickete suport” (`gcs.tickets`)

- **Data:** 2026-10-11
- **Cererea proprietarului:** un plugin de sistem de tickete, livrat ca fișier care se încarcă direct în ACP.
- **Locul:** `packages/plugin-sdk/plugins/tickets` (ca Studio VIP); arhiva: `pnpm --filter @gcs/plugin-sdk build:tickets`
  → `plugins/tickets/dist/gcs.tickets-<versiune>.zip`. Se instalează din ACP → Sistem → Aplicații și pluginuri.

## 1. Pachetul

- Capabilități: `db`, `widgets`, `pages`, `acp`, `api`, `menus`, `jobs`, `settings`, `permissions`, `client-css`.
  **Fără JS în browser**: arhiva se poate instala și nesemnată (Root Admin, cu codul 2FA și cheia tastată).
- Tabele proprii (`migrations/001_init.sql`): `tickets`, `messages` (cu `staff` și `internal`), `events` (schimbările de
  stare / prioritate / categorie / responsabil și închiderea automată), `reads` (marcajul „nou”).
- Textele: `ro` și `en` (celelalte limbi cad pe engleză).

## 2. Drepturi și setări

- `create` — poate deschide tickete și le vede pe ale lui (implicit toate grupurile de membri);
- `manage` — staff-ul: coada, toate ticketele, notele interne, starea, prioritatea, categoria, responsabilul (implicit
  Root Admin, Admin, Super Moderator, Moderator).
- Un ticket străin e **negăsit** (404) pentru cine nu e staff; rutele API verifică la fel.
- Setări: categoriile (câte una pe rând, cel mult 30), textul de deasupra formularului, tickete deschise odată per
  membru (sau nelimitat), dacă membrii aleg prioritatea (fără „Urgentă”), redeschiderea ticketelor închise, închiderea
  automată după N zile de la răspunsul staff-ului (sau niciodată), tickete pe pagină.

## 3. Fluxul

- Stările: **În așteptare** (`open`, așteaptă staff-ul), **În lucru** (`in_progress`), **Răspuns** (`answered`, așteaptă
  membrul), **Închis** (`closed`). Răspunsul staff-ului → „Răspuns”; al membrului → „În așteptare” (rămâne „În lucru”
  dacă ticketul e preluat); nota internă nu schimbă starea. Staff-ul poate alege starea de după răspuns.
- Membrul închide ticketul lui sau îl redeschide (cu un răspuns sau cu butonul), dacă setarea o permite.
- Primul răspuns public al staff-ului e memorat (timpul mediu până la primul răspuns, în ACP).
- Jobul `autoclose` (la oră) închide ticketele „Răspuns” fără reacția membrului de N zile și lasă evenimentul în fir.

## 4. Paginile

- `/p/gcs.tickets`: membrii — „Ticketele mele” (filtrul de stare); staff-ul — „Coada de tickete” (cele urgente și în
  așteptare întâi), cu plăcile „În așteptare / Nepreluate / Ale mele” și filtrele stare, categorie, responsabil,
  căutare (subiect sau `#număr`), plus tab-ul „Ticketele mele”. Paginare. Vizitatorii văd îndemnul de autentificare.
- `/p/gcs.tickets/new`: formularul (categorie, prioritate, subiect, mesaj), textul din setări, limita de tickete.
- `/p/gcs.tickets/t/:id`: firul (mesajele cu avatarul și numele membrilor, insigna „Staff”, notele interne și
  evenimentele, în ordine), răspunsul (staff: „Notă internă” și starea de după), detaliile, gestionarea staff-ului
  (stare, prioritate, categorie, „Preiau eu” / fără responsabil) și închiderea / redeschiderea pentru membru.
- Titlul paginii îl afișează GCS (banda lui); pluginul nu-l repetă. Mesajele după acțiuni vin din `?done=` / `?error=`.
- Mesajele sunt text simplu: escapat, paragrafe și linkuri `http(s)` (sanitizer-ul GCS adaugă `rel`).

## 5. Widget-ul și ACP-ul

- Widget-ul „Tickete suport” (bara laterală, sus, jos): staff-ul vede coada și ticketele active; membrii, ticketele lor
  active și butonul „Deschide un ticket”; vizitatorii, îndemnul de autentificare.
- ACP → Tickete suport: total, pe stări, timpul mediu până la primul răspuns, ultimele 7 zile (deschise / închise), pe
  categorii, pe responsabili, activitatea recentă și linkurile spre coadă și setări.
- Meniul contului: „Tickete suport”.

## 6. Teste

- `plugins/tickets/test/model.test.ts`: setările, formularul, fluxul stărilor, id-urile, HTML-ul mesajelor.
- `packages/modules/src/plugins/tickets.integration.test.ts`: arhiva nesemnată instalată, ticketul creat și privat,
  coada și filtrele, preluarea, nota internă nevăzută de membru, răspunsurile și stările, limita și redeschiderea din
  setări, widget-ul, pagina din ACP, închiderea automată.
- `apps/web/e2e/tickets.spec.ts`: instalarea din ACP (2FA + cheia), membrul deschide un ticket din formular, staff-ul
  preia, lasă o notă internă și răspunde, membrul vede răspunsul (fără notă) și închide ticketul, statisticile din ACP,
  dezinstalarea cu date.
