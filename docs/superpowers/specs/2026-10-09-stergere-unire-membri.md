# Ștergerea și unirea conturilor de membri (GDPR)

- **Data:** 2026-10-09
- **Cererea proprietarului:** GCS nu are încă nicio cale de a șterge un membru sau de a uni conturile duble. Membrii care
  intră cu Steam / Google / Discord înainte să-și lege contul principal ajung cu un al doilea cont. Se cer:
  **ACP → Membri → un membru: „Șterge membrul” și „Unește cu alt cont”**, plus cererea membrului **„Șterge contul meu”**
  (GDPR), din Setări → Cont.
- **Referințe:** specul principal §6.4 (rolurile ACP: secțiune × {view, edit, delete}; protecția Root Admin), §12.1
  (ACP → Membri → „Cereri GDPR”), §12.6 (jurnalele), §15 (GDPR: „ștergerea contului, postările se pot păstra
  anonimizate, cereri gestionate în ACP”); specurile aplicațiilor (forum, profil, mesaje, chat, VIP, clanuri, puntea
  serverelor) pentru datele fiecăreia.

## 1. Decizii de bază

1. **Rândul `users` se șterge la final**, în ambele moduri. Conținutul păstrat rămâne cu autorul gol (`authorId = NULL`,
   relațiile sunt deja `SetNull`) și se afișează ca **„Membru șters”**: o etichetă generică, fără link spre profil, fără
   avatarul și fără numele vechi (numele e și el o dată personală). Nu se păstrează nicio copie a numelui pe conținut.
2. **Istoricul operației** stă într-un tabel nou, `member_removals` (fără chei străine spre `users`, ca să rămână după
   ștergere): felul (ștergere / unire), modul, sursa (ACP / cererea membrului), starea, progresul pe pași, numele vechi și
   id-ul. E singura dată personală păstrată (id + numele vechi), la fel ca în jurnal.
3. **Operația rulează ca job** (`members.removal.run`), pe pași idempotenți, pe loturi, cu progresul salvat după fiecare
   lot (reluabilă după o cădere). Un cont mic (≤ 500 de rânduri numărate în previzualizare) se procesează imediat, în
   aceeași cerere; unul mare doar intră în coadă. Doi „alergători” nu pot lucra simultan: jobul se revendică atomic
   (`QUEUED` → `RUNNING`, sau `RUNNING` cu heartbeat mai vechi de 10 minute).
4. **Blocarea e imediată** (la cererea din ACP; la cererea membrului, la sfârșitul perioadei de răzgândire): sesiunile se
   șterg, conturile de login (parola, Discord, Google, Steam) și 2FA se șterg, iar emailul devine
   `deleted-<id>@deleted.invalid` (eliberează adresa și oprește legarea automată a unui login social pe același email).
   La unire, conturile de login ale sursei se mută / se renunță la ele tot imediat (§4).
5. **Fiecare aplicație își tratează datele** printr-un „handler de date ale membrului” (`GcsMemberDataHandler`) înregistrat
   la pornire, în fișierul aplicației (`forums/memberData.ts`, `clans/memberData.ts`…). Nucleul doar orchestrează: ordinea,
   loturile, progresul, evenimentele, jurnalul. Pluginurile primesc evenimentele `user.deleting`, `user.deleted`,
   `user.merged` și își curăță singure datele.

## 2. Modurile ștergerii

| | **Păstrează conținutul** (implicit) | **Șterge și conținutul** |
|---|---|---|
| Topicuri, postări, revizii | rămân, autor „Membru șters”; IP-ul postărilor se golește | topicurile pornite de membru se șterg **cu tot cu răspunsuri**; postările lui din alte topicuri se șterg; contoarele, ultimul mesaj, indexul de căutare și atașamentele se actualizează prin serviciile forumului |
| Statusuri scrise pe alte profiluri | rămân, autor „Membru șters”, fără IP | se șterg (cu răspunsurile lor) |
| Peretele propriului profil | se șterge | se șterge |
| Mesajele de chat | rămân, autor „Membru șters” | se șterg, cu fișierele lor |
| Mesaje private trimise | **se șterg** (implicit, GDPR); opțiunea „Păstrează mesajele private” le lasă în conversațiile celorlalți ca „Membru șters”, fără IP | se șterg |

Mereu, în ambele moduri:

- **Autentificarea:** sesiuni, conturi de login, 2FA (blocarea, §1.4).
- **Profilul:** câmpurile, avatarul și coperta (fișierele din store), semnătura, aspectul publicat de pluginuri,
  preferințele, permisiunile individuale, ignorările, urmăririle (în ambele sensuri; `followersCount` al celor urmăriți
  scade), insignele, jurnalul de realizări.
- **Reacțiile date:** se șterg, iar reputația autorilor scade cu greutatea fiecărei reacții (nu rămân contoare greșite).
- **Voturile în sondaje:** se șterg, iar `votesCount` al opțiunilor scade.
- **Notificările, preferințele de notificare, marcajele de citire.**
- **Conversațiile:** membrul iese din toate; o conversație rămasă fără niciun participant se șterge cu totul.
- **Fișierele nelegate de conținut** (încărcate și nefolosite) se șterg; cele legate de conținutul păstrat rămân fără
  proprietar; cele legate de alte entități (logo-ul unui clan, bannerul unui server) rămân.
- **VIP:** abonamentele și istoricul VIP al membrului se șterg.
- **Clanurile:** membrul iese din toate. Dacă e **lider**, conducerea trece automat la cel mai vechi ofițer, altfel la cel
  mai vechi membru; un clan rămas fără membri se **arhivează** (staff-ul îl poate desființa). Ecranul de confirmare arată
  dinainte cine preia fiecare clan. Cererile și invitațiile lui se șterg.
- **Serverele de joc:** identitățile de joc se **dezleagă** (rămân jucători fără cont, cu statisticile, ELO-ul și meciurile
  lor); intrările de admin pe servere și adminii afișați pe pagina serverului se șterg; contestațiile / reclamațiile scrise
  de el se șterg; în sancțiunile, acțiunile de admin și tichetele altora referința la cont se golește (numele din joc
  rămâne).
- **Moderarea:** avertismentele primite și bannul de cont se șterg; bannurile pe **email / IP** rămân (fără legătura cu
  contul), ca să nu poată reveni un spammer; rolurile ACP și moderarea pe containere se șterg.
- **Jurnalul ACP:** intrările rămân (`actorId` = id-ul vechi), dar IP-urile lor se golesc.

## 3. Regulile de siguranță (ștergere și unire)

- Dreptul: **`members.members` → `delete`** (ACP → Roluri). Pagina „Cereri GDPR” cere `members.gdpr` → `view`;
  rularea / anularea unei cereri și setarea perioadei de răzgândire cer `members.gdpr` → `edit`.
- Nu te poți șterge pe tine din ACP (cererea proprie trece prin Setări → Cont) și nu poți folosi propriul cont ca sursă a
  unei uniri.
- Un **Root Admin** poate fi șters / unit (ca sursă sau țintă) doar de un alt Root Admin; **ultimul Root Admin** nu poate
  fi șters și nu poate fi sursa unei uniri (ar pierde rolul). Aceeași regulă la cererea membrului: ultimul Root Admin nu
  poate cere ștergerea.
- Nu se unește un cont cu el însuși; un cont nu poate avea două operații active (index unic parțial pe
  `member_removals."userId"` pentru stările `SCHEDULED`, `QUEUED`, `RUNNING`, `FAILED`), iar ținta unei uniri nu poate fi
  în curs de ștergere.
- Confirmarea: staff-ul scrie numele membrului (sursei); butonul e roșu și explică modul ales.
- **Jurnal:** `user.delete.request`, `user.delete.done`, `user.merge.request`, `user.merge.done`,
  `user.delete.self_request`, `user.delete.self_cancel`, `user.delete.cancel`, `user.delete.run_now`,
  `user.delete.retry`, cu `targetType = "user"`, `targetId` = id-ul și, ca date, doar numele vechi, modul și (la unire)
  id-ul țintei. Nicio altă dată personală (email, IP) în jurnal.

## 4. Unirea („Unește cu alt cont”)

Sursa (contul dublu) se mută în țintă, apoi sursa se șterge. **Ținta își păstrează** numele, emailul, parola, 2FA,
grupurile, setările, profilul (câmpurile, avatarul, coperta, semnătura, aspectul), rolurile ACP și moderarea. Staff-ul
pornește din fișa oricăruia dintre conturi; previzualizarea are „Inversează” (schimbă sursa cu ținta).

| Date | Ce se întâmplă |
|---|---|
| Conturi de login | Discord / Google / Steam ale sursei **se mută în țintă dacă ținta nu are deja acel furnizor**; altfel rămâne al țintei, iar al sursei se șterge. Parola, sesiunile și 2FA ale sursei se șterg. Se face imediat, la confirmare (ținta poate intra pe loc cu Steam-ul mutat). |
| Topicuri, postări, revizii, ultimul mesaj din forumuri / topicuri | autorul devine ținta; contoarele țintei se recalculează (postări, soluții) |
| Reacții | cele ale sursei trec la țintă; se șterg (cu reputația corectată) cele care ar deveni reacții la propriul conținut (sursa → conținutul țintei, ținta → conținutul sursei) și cele pe un conținut la care ținta reacționase deja (unicitatea). Reputația primită de sursă se adaugă țintei. |
| Voturi în sondaje | trec la țintă; dacă ținta votase deja în același sondaj, votul sursei se șterge (și contorul opțiunii scade) |
| Urmăriri | ale sursei trec la țintă (fără dubluri, fără „ținta se urmărește pe ea”); urmăritorii sursei devin ai țintei; `followersCount` se recalculează |
| Statusuri, peretele profilului | trec la țintă |
| Ignorări | trec la țintă, fără dubluri și fără a se ignora pe sine |
| Insigne, realizări | trec la țintă, fără dubluri (o regulă / insignă deja primită de țintă nu se dublează); punctele (XP) ale sursei se adaugă țintei, minus cele ale dublurilor |
| Mesaje private | conversațiile sursei trec la țintă (dacă ținta era deja în conversație, rămâne un singur participant); mesajele trimise au autorul ținta |
| Chat | mesajele, reacțiile, camerele private (membru, proprietar), mute-urile trec la țintă (fără dubluri) |
| Notificări | trec la țintă; o notificare necitită care s-ar suprapune cu una a țintei (același grup) se șterge |
| Fișiere | proprietarul devine ținta; avatarul și coperta sursei se șterg |
| VIP | **se păstrează abonamentul activ mai lung** (permanent > dată mai târzie); celălalt se închide. Dacă rămâne al sursei, se mută pe țintă, cu grupul VIP aplicat țintei (ca principal sau secundar, ca la acordare). Istoricul VIP al sursei trece la țintă. |
| Clanuri | dacă **ținta e deja în vreun clan, rămân clanurile țintei**: sursa iese din ale ei (dacă sursa conducea un clan în care e și ținta, conducerea trece la țintă; altfel regula liderului din §2). Dacă ținta nu e în niciun clan, apartenențele sursei (cu rolurile) trec la țintă. Cererile / invitațiile în așteptare ale sursei se anulează. |
| Servere de joc | identitățile de joc ale sursei se leagă de țintă (statisticile vin cu ele); intrările de admin trec la țintă (o intrare pe același server pe care ținta o are deja se șterge); adminii afișați pe servere trec la țintă (fără dubluri); tichetele, sancțiunile date de pe site și acțiunile de admin trec la țintă; legătura Steam a țintei se resincronizează |
| Avertismente, bannuri | trec la țintă (cele primite și cele date); **un ban de cont activ al sursei se aplică și țintei** (aceeași persoană), iar previzualizarea o spune |
| Rapoarte trimise | trec la țintă |
| Roluri ACP, moderare pe containere, permisiuni individuale, profilul sursei | nu se mută (privilegiile nu se transferă tacit); se pierd odată cu sursa — previzualizarea le enumeră |

Previzualizarea („ce se mută”) arată, pe aplicații, numerele sursei și observațiile (conflictele de mai sus). Abia apoi
se confirmă. La final: `user.merged` (`{ sourceId, targetId }`).

## 5. Cererea membrului („Șterge contul meu”)

- Setări → Cont → secțiunea **„Șterge contul”**: ce se șterge și ce rămâne (postările ca „Membru șters”), confirmarea:
  - cu **parolă** (dacă are una); un cont fără parolă (doar Discord / Google / Steam) cere o **autentificare recentă**
    (sesiunea creată în ultimele 15 minute; altfel butonul „Intră din nou” îl scoate din cont și îl trimite la login,
    cu întoarcere în Setări → Cont);
  - plus **codul 2FA**, dacă 2FA e activ.
- Se creează o cerere `SCHEDULED` cu `runAfter = acum + perioada de răzgândire` (setarea
  **`members.deletion_cooling_days`**, implicit **7** zile, 0–90; 0 = la următoarea trecere a jobului). Modul e mereu
  „Păstrează conținutul”, fără păstrarea mesajelor private.
- În perioada de răzgândire contul funcționează normal; după login, o bandă pe tot site-ul anunță data ștergerii, cu
  link spre Setări → Cont, unde butonul **„Anulează ștergerea”** anulează cererea.
- Staff-ul vede cererile în **ACP → Membri → Cereri GDPR**: în așteptare (cu data), în lucru (cu progresul), terminate,
  eșuate (cu „Reia”), anulate; poate **anula** o cerere sau o poate **rula acum**. Setarea perioadei de răzgândire e pe
  aceeași pagină.
- Jobul periodic `members.removal.sweep` (la 5 minute) pornește cererile ajunse la termen (blocarea + jobul) și repune în
  coadă operațiile rămase agățate (`QUEUED` de peste 2 minute, `RUNNING` fără heartbeat de 10 minute).

## 6. Arhitectura

### 6.1 Date

```prisma
enum MemberRemovalKind   { DELETE MERGE }
enum MemberRemovalMode   { KEEP_CONTENT DELETE_CONTENT }
enum MemberRemovalSource { ACP SELF }
enum MemberRemovalStatus { SCHEDULED QUEUED RUNNING DONE FAILED CANCELLED }

model MemberRemoval {
  id, kind, status, source, mode, keepMessages,
  userId, userName,              // contul șters / sursa unirii (fără cheie străină)
  targetId?, targetName?,        // ținta unirii
  requestedById?,                // staff-ul sau membrul însuși
  runAfter?,                     // sfârșitul perioadei de răzgândire
  steps Json,                    // { [handler]: { done, processed } }
  currentStep?, error?, attempts, heartbeatAt?, startedAt?, finishedAt?, createdAt, updatedAt
}
```

Index unic parțial: un singur rând activ pe `userId` (§3).

### 6.2 Handler-ele

```ts
interface GcsMemberDataHandler {
  key: string;                                         // „forums”, „clans”…
  summary(userId): Promise<{ key: string; count: number }[]>;   // ce are membrul (confirmarea, previzualizarea)
  deleteNotes?(userId): Promise<GcsMemberDataNote[]>;  // ex. cine preia clanul
  mergeNotes?(sourceId, targetId): Promise<GcsMemberDataNote[]>;
  erase(ctx: { userId, mode, keepMessages, batchSize }): Promise<number>;   // un lot; 0 = pasul e gata
  merge(ctx: { sourceId, targetId, batchSize }): Promise<number>;           // un lot; 0 = pasul e gata
}
```

Fiecare lot e idempotent: lucrează doar pe rândurile rămase (ce s-a mutat / șters nu mai apare), iar transferurile de
contoare se fac „adaugă la țintă și golește sursa” în aceeași tranzacție. Ordinea înregistrării = ordinea pașilor:
reacții → urmăriri → forum → profil → mesaje → chat → VIP → clanuri → servere → notificări → moderare → fișiere; apoi
pasul final al nucleului (bannurile pe email / IP desprinse, IP-urile din jurnal golite, rândul `users` șters,
evenimentele).

### 6.3 Serviciul și joburile

`GcsMemberRemovalService` (nucleu): `preview`, `requestDelete`, `mergePreview`, `requestMerge`, `requestSelf`,
`cancelSelf`, `cancel`, `runNow`, `retry`, `run`, `sweep`, `list`, `get`, `pendingFor`. Joburile:
`members.removal.run` (`{ id }`, `jobId` = `member-removal-<id>`) și `members.removal.sweep` (5 minute).

### 6.4 Evenimente

- `user.deleting` — `{ userId, removalId, mode }`, la începutul rulării (pluginurile își șterg datele);
- `user.deleted` — `{ userId, removalId, mode }`, după ștergerea rândului; tagurile `user:<id>`, `forums-tree`, `clans`;
- `user.merged` — `{ sourceId, targetId, removalId }`, după unire (sursa nu mai există).

Toate trei se adaugă la evenimentele livrate pluginurilor.

## 7. Interfața

- **Fișa membrului (ACP):** cardul „Zona periculoasă”, doar cu dreptul `delete`: „Șterge membrul” și „Unește cu alt
  cont”. O operație în curs apare ca bandă, cu progresul și link spre ea.
- **`/admin/members/{id}/delete`:** ce are membrul (numere pe aplicații), observațiile (ex. „Conduce clanul [RLX]:
  conducerea trece la Mara”), modul (două carduri radio), „Păstrează mesajele private”, confirmarea cu numele.
- **`/admin/members/{id}/merge`:** căutarea țintei (nume sau email), apoi previzualizarea sursă → țintă cu „Inversează”,
  ce se mută pe aplicații, observațiile, confirmarea cu numele sursei.
- **`/admin/members/removals/{id}`:** progresul pe pași (bară, numere), reîmprospătat cât timp rulează; eroarea, cu
  „Reia”.
- **`/admin/members/gdpr`:** lista operațiilor (filtru pe stare), acțiunile pe cereri, setarea perioadei de răzgândire.
- **Site:** „Membru șters” în postbit, în lista de topicuri, în mesajele private, în statusuri și în chat; banda
  „Contul tău va fi șters pe …” și secțiunea din Setări → Cont.
- Textele în română și engleză (celelalte limbi primesc textul englez, cum cere testul pachetelor).

## 8. Teste

- Unitare / integrare (baza de test reală): fiecare handler (ștergere în ambele moduri, unire, contoarele, coliziunile
  unice, reacțiile la propriul conținut, VIP-ul mai lung, liderul de clan, identitățile de joc), regulile de siguranță,
  idempotența (un lot rulat de două ori; o rulare întreruptă și reluată), cererea membrului (răzgândirea, anularea,
  sweep-ul).
- E2E: staff-ul șterge un membru păstrând conținutul (postarea arată „Membru șters”, membrul nu mai poate intra); unește
  un cont doar-Steam cu contul principal (contul principal intră acum cu acel Steam; postările s-au mutat); un membru
  cere ștergerea și o anulează. Capturi ale ecranelor noi din ACP (dark / light, 375 px).
