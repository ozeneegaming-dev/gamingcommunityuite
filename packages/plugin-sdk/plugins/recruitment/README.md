# Recrutare (`gcs.recruitment`)

Aplicație premium GCS (pachet `gcs.<aplicație>`): se instalează și pornește doar dacă licența site-ului include
aplicația `recruitment` (din Marketplace-ul ACP, ca Studio VIP).

- **Posturile echipei** (Moderator, Admin servere, Designer, Editor știri…): nume, descriere, stare (ON / NOU / OFF),
  grup, iconiță, ordine.
- **ACP › Recrutare**: lista posturilor în stânga, panoul de editare în dreapta; **Aplicații**: filtrul după stare,
  răspunsurile și decizia (acceptă / respinge, cu notă).
- **Rândul „Recrutare” pe index**: pe orice forum, pagină sau link, tabul „Recrutare” → „Arată posturile pe rând”;
  posturile apar ca subforumurile, cu eticheta lor. Opțional, un card cu posturile deschise sus, în pagina forumului.
- **Aplicarea**: prin formularul pluginului (întrebările postului, câte una pe rând), printr-un topic nou într-un forum
  ales sau printr-un link (intern sau `https://`).

Datele stau în schema proprie a pluginului (PostgreSQL). Construire: `pnpm --filter @gcs/plugin-sdk build:recruitment`,
apoi semnarea GCS cu `sign:plugin`.
