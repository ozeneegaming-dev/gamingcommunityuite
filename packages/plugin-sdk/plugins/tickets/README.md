# Tickete suport (`gcs.tickets`)

Sistem de tickete de suport pentru GamingCommunitySuite.

## Ce face

- **Membrii** deschid tickete pe categorii (din setări), cu prioritate (opțional), văd răspunsurile staff-ului, răspund,
  închid sau redeschid ticketele lor. Ticketele sunt private: le vede doar autorul și staff-ul.
- **Staff-ul** (dreptul „Gestionează ticketele”) are coada cu filtre (stare, categorie, responsabil, căutare după
  subiect sau `#număr`), preia tickete, răspunde, lasă **note interne** (nevăzute de membru), schimbă starea,
  prioritatea și categoria. Fiecare schimbare apare în firul ticketului.
- Stările: **În așteptare** (așteaptă staff-ul), **În lucru**, **Răspuns** (așteaptă membrul), **Închis**. Un răspuns
  al staff-ului trece ticketul în „Răspuns”, unul al membrului înapoi în „În așteptare”.
- Marcajul **„nou”** pe ticketele cu mesaje necitite.
- **Widget** (bara laterală, sus, jos): pentru staff, coada (în așteptare / nepreluate / ale mele) și ticketele active;
  pentru membri, ticketele lor active și butonul „Deschide un ticket”.
- **ACP**: statisticile (pe stări, categorii, responsabili, timpul mediu până la primul răspuns, ultimele 7 zile).
- **Închidere automată**: ticketele „Răspuns” fără reacția membrului se închid după N zile (setare; jobul rulează la oră).
- Meniul contului: „Tickete suport”. Pagina: `/p/gcs.tickets`.

## Setări (ACP → Sistem → Aplicații și pluginuri → Tickete suport)

Categoriile (câte una pe rând), textul de deasupra formularului, câte tickete deschise poate avea un membru, dacă
membrii aleg prioritatea, dacă pot redeschide ticketele închise, închiderea automată și câte tickete pe pagină.

## Drepturi (ACP → Grupuri)

- `create` — poate deschide tickete (implicit: toți membrii);
- `manage` — gestionează ticketele (implicit: Root Admin, Admin, Super Moderator, Moderator).

## Construire

```
pnpm --filter @gcs/plugin-sdk build:tickets
```

scrie `plugins/tickets/dist/gcs.tickets-<versiune>.zip`. Pluginul nu are JS în browser, deci arhiva se poate instala
și nesemnată (doar Root Admin, cu codul 2FA și cheia pluginului tastată).
