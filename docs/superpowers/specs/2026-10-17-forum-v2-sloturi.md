# Forum v2: sloturile de extensie ale forumului

Status: implementat (Forum v2, 2026-10-17). Tipurile: `packages/core/src/modules/forumSlots.ts`. Serviciul:
`packages/modules/src/forums/slots.ts`. Desenarea pe site: `apps/web/lib/forum-slots.tsx`. Exemplul complet:
`packages/modules/src/forums/slotsDemo.ts` (modul) și `packages/plugin-sdk/examples/hello` (plugin).

Sloturile sunt **ale sistemului**: merg în orice temă (Clasic, GCS Dark / White, pachetele importate), pe tokenurile
temei. O extensie nu scrie HTML în pagină (în afară de pluginuri, prin sanitizerul lor); trimite elemente pe care nucleul
le desenează cu componentele lui.

## 1. Punctele

| Punct | Unde | Ce primește |
| --- | --- | --- |
| `forum.row.title` | lângă titlul unui forum din listă (index, subforumuri) | pastile (`chip`) |
| `forum.row.meta` | un rând sub descrierea forumului | pastile, text, valori (`stat`) |
| `forum.row` (stil) | rădăcina rândului (`.gcs-forumRow`, și în aspectul „Carduri separate”) | clase + variabile CSS |
| `category.header` | banda de titlu a categoriei, înaintea butonului de restrângere | pastile, text, valori |
| `category` (stil) | secțiunea categoriei (`.gcs-category`) | clase + variabile CSS |
| `forum.page.top` | carduri sus pe pagina forumului (și a unei pagini „Pagină / Anunț”) | carduri, pastile, text |
| `topic.bar` | o bară sub antetul topicului | pastile, text, valori, carduri |
| `forum.edit.tabs` | taburi în ACP → Comunitate → Forumuri → Editează | câmpuri / componentă / HTML de plugin |

Șablonul `forum.row` (ACP → Aspect → Șabloane, versiunea 2) are sloturile `{% slot "title_extra" %}` și
`{% slot "meta" %}` și variabilele `forum.ext.className` / `forum.ext.style` (stilul extensiilor).

## 2. Un modul (aplicație din `@gcs/modules`)

```ts
import type { GcsForumExtension, GcsModule } from "@gcs/core";

const serverExt: GcsForumExtension = {
  key: "servers",            // spațiul de nume al valorilor salvate (unic)
  position: 100,             // ordinea între extensii (implicit 100; pluginurile vin după module)
  tabs: [{
    key: "server", labelKey: "servers.forumTab", icon: "fa-solid fa-server", types: ["FORUM"],
    fields: [
      // `optionsFrom`: o sursă din apps/web/lib/forum-ext-options.ts (aplicația Servere își adaugă sursa `servers`).
      { key: "serverId", type: "select", labelKey: "servers.forumTab.server", optionsFrom: "servers" },
      { key: "tag", type: "text", labelKey: "servers.forumTab.tag", maxLength: 24,
        slot: { slot: "forum.row.title", as: "chip", icon: "fa-solid fa-signal" } },     // fără cod: pastilă lângă titlu
      { key: "accent", type: "color", labelKey: "servers.forumTab.accent", style: { var: "--gcs-forum-color" } },
      { key: "caps", type: "toggle", labelKey: "servers.forumTab.caps", style: { class: "gcs-forumRow--titleCaps" } },
    ],
    component: "servers.forumLink",   // opțional: o componentă a site-ului sub câmpuri (FORUM_TAB_COMPONENTS)
  }],
  validate: (values) => (values.serverId === "" && values.tag ? { tag: "required" } : null),
  style: (node) => (node.data.serverId ? { classes: ["gcsx-servers-row"] } : null),        // pur, fără IO
  list: async (ctx, nodes) => {        // O SINGURĂ dată pe pagină, pentru toate rândurile
    const ids = nodes.map((n) => Number(n.data.serverId)).filter(Boolean);
    const live = await liveStatus(ctx.db, ids);
    return Object.fromEntries(nodes.filter((n) => n.data.serverId).map((n) => [n.id, {
      meta: [{ kind: "stat", label: { key: "servers.players" }, value: `${live[n.id]?.players ?? 0}/32`, icon: "fa-solid fa-users" }],
    }]));
  },
  forumPage: async (ctx, node) => [{ kind: "component", component: "servers.statusCard", props: { serverId: Number(node.data.serverId) } }],
  topicBar: async (ctx, { node, topic }) => null,
};

export const serversModule: GcsModule = { /* … */ forumExtensions: [serverExt] };
```

- **Activă doar cu aplicația pornită** (ACP → Aplicații); fără `app` (ex. modulul demo) e mereu activă.
- **Valorile taburilor** le validează și le salvează nucleul (`GcsForumSlotService.saveTab`, tabelul
  `forum_extension_data`, cu jurnal și invalidarea cache-ului `forums-tree`). Extensia le primește în `node.data`, cu
  valorile implicite completate. Tipuri de câmpuri: `text`, `textarea`, `number`, `toggle`, `select` (`options` fixe sau
  `optionsFrom`: `groups`, `forums`; o sursă nouă se adaugă în `apps/web/lib/forum-ext-options.ts`), `color`, `icon`.
- **Componentele** de slot (`{ kind: "component" }`) și de tab (`tab.component`) se înregistrează în
  `apps/web/lib/forum-slot-components.tsx` (`FORUM_SLOT_COMPONENTS`, `FORUM_TAB_COMPONENTS`), cu prefixul cheii
  modulului. O cheie necunoscută nu desenează nimic.
- **Textele**: `GcsSlotText` = text deja tradus sau `{ key, params }` (cheie din `apps/web/messages/*.json`).
- O extensie care aruncă o eroare sau trece de 3 s lasă slotul gol (pagina nu se strică).

## 3. Elementele (`GcsSlotItem`)

| `kind` | Câmpuri | Sloturi |
| --- | --- | --- |
| `chip` | `label`, `icon?`, `tone?` (`accent` `neutral` `ok` `warn` `danger` `info`), `color?` (#RRGGBB), `href?`, `tooltip?` | toate |
| `text` | `text`, `icon?`, `tone?`, `href?` | meta, header, page.top, topic.bar |
| `stat` | `label`, `value`, `icon?`, `tone?` | meta, header, page.top, topic.bar |
| `card` | `title?`, `icon?`, `body?`, `tone?`, `items?` (chip/text/stat), `actions?` (`label`, `href`, `variant`), `image?` | page.top, topic.bar |
| `component` | `component` (`modul.nume`), `props` (JSON) | toate |
| `html` | doar pluginuri (gazda le dă HTML-ul deja sanitizat) | toate |

Totul trece prin `sanitizeSlotItems`: linkurile doar interne (`/…`) sau `https://`, iconițele `fa-(solid|regular|brands)
fa-…`, cel mult 12 elemente pe slot și extensie, textele tăiate la lungimi rezonabile.

## 4. Stilul (`GcsSlotStyle`)

`{ classes?: string[]; vars?: Record<string, string> }`, curățat de `sanitizeSlotStyle`:

- **clase**: modificatorii nucleului (`GCS_FORUM_STYLE_CLASSES`: `gcs-forumRow--image`, `--titleCaps`, `--titleGlow`,
  `--muted`, `gcs-category--image`, `--titleCaps`), clasele aplicațiilor `gcsx-*` și ale pluginurilor `gcsp-*`;
- **variabile**: cele ale nucleului (`GCS_FORUM_STYLE_VARS`: `--gcs-forum-color`, `--gcs-forum-title-color`,
  `--gcs-forum-row-bg`, `--gcs-forum-row-image`, `--gcs-forum-row-image-pos`, `--gcs-forum-row-veil`,
  `--gcs-forum-row-veil-hover`, `--gcs-forum-row-border`), `--gcsx-*` și `--gcsp-*`;
- **valori**: culori hex, numere (cu unitate), cuvinte simple, poziții (`50% 30%`), `url("/files/<id>")` sau fișierele
  unui plugin (`/plugins/<cheie>/assets|media/…`), `linear-gradient(<unghi>deg, #hex, #hex…)`.

Mai multe extensii pe același rând: clasele se adună, la aceeași variabilă câștigă ultima (după `position`). CSS-ul
nucleului pentru variabile și modificatori e în `packages/ui/src/forum-v2.css` (în orice temă).

## 5. Un plugin

Manifestul (`plugin.json`, GCS ≥ 0.9.0) declară taburile și punctele:

```json
{
  "capabilities": ["hooks", "client-css"],
  "hooks": [{ "point": "forum.list" }, { "point": "forum.page" }, { "point": "topic.bar" }, { "point": "forum.edit" }],
  "forumTabs": [{
    "key": "aspect", "label": "forum.tab", "icon": "fa-solid fa-palette", "types": ["FORUM", "CATEGORY"],
    "fields": [
      { "type": "text", "key": "tag", "label": "forum.tag", "maxLength": 20, "slot": { "slot": "forum.row.title", "as": "chip" } },
      { "type": "color", "key": "title", "label": "forum.titleColor", "css": { "var": "--gcs-forum-title-color" } },
      { "type": "toggle", "key": "glow", "label": "forum.glow", "css": { "class": "gcs-forumRow--titleGlow" } },
      { "type": "select", "key": "look", "label": "forum.look", "options": [{ "value": "dark", "label": "forum.dark" }], "css": { "class": "gcsp-look-" } }
    ],
    "hook": true
  }]
}
```

Codul (`server.mjs`), cu tipurile din `@gcs/plugin-sdk`:

```ts
hooks: {
  // Un apel pe pagină: { surface, nodes: [{ id, type, parentId, name, slug, data }] } → { "<id>": { title?, meta?, header?, style? } }
  "forum.list": async (input) => ({ "12": { meta: "<span class=\"gcsp-x\">Live</span>", style: { classes: ["gcsp-x-row"], vars: { "--gcsp-x": "1" } } } }),
  "forum.page": async ({ forumId, data }) => "<div>…</div>",
  "topic.bar": async ({ topicId, forumId, data }) => "<div>…</div>",
  // Corpul tabului (cu `hook: true`): formulare spre rutele API ale pluginului, ca o pagină ACP.
  "forum.edit": async ({ tab, forumId, data }) => "<form method=\"post\" action=\"/api/plugins/vendor.name/forum\">…</form>",
}
```

- HTML-ul trece prin sanitizerul pluginurilor și stă în containerul lui (`gcsp--vendor--name`); un rând stilizat de
  plugin primește și clasa containerului, deci CSS-ul pluginului (`client.styles`) ajunge la elementele rândului.
- Foile de stil ale pluginului se adaugă singure în pagina unde apare.
- În modul sigur (`?safe=1`) pluginurile nu contribuie nimic.
- Punctele se pot opri din ACP → Sistem → Hook-uri, ca orice punct.

## 6. Nodul „Pagină / Anunț” (`ForumType.PAGE`)

Un nod al arborelui care apare în listă ca un forum (iconița implicită: megafon) și se deschide ca o pagină bogată:
conținutul scris cu editorul postărilor (cu blocurile sigure ale staff-ului), un buton CTA (text + link), grupurile care
o văd (gol = toți cei care văd forumul) și, opțional, topicuri dedesubt. Se editează în tabul „Pagină” al formularului
forumului; `GcsForumService.savePage` îl validează. Aplicația Recrutare îl poate refolosi: cardul ei de sus prin
`forum.page.top`, butonul „Aplică acum” ca CTA.

## 7. Testele

- `packages/core/src/modules/forumSlots.test.ts`: curățarea elementelor și a stilului, câmpurile, înregistrarea.
- `packages/modules/src/forums/slots.test.ts`: modulul demo de la tab la rând (o singură interogare pe listă), pagina
  forumului, bara topicului, aplicația oprită, erorile.
- `apps/web/e2e/forum-v2.spec.ts`: demo-ul în rând și în formular, pagina cu CTA.
