import type { GcsForumExtension, GcsModule, GcsSlotItem } from "@gcs/core";

/** Cheia extensiei demo (spațiul de nume al valorilor salvate). */
export const FORUM_SLOTS_DEMO_EXTENSION = "slotsdemo";

const on = (data: Record<string, unknown>) => data.enabled === true;

/**
 * Extensia demo a sloturilor forumului (Forum v2): un exemplu complet, folosit de testele unitare, de E2E (cu
 * `GCS_TEST_ROUTES=1`) și ca model pentru aplicațiile care extind forumul (Servere, „Aspect forumuri”, Recrutare).
 *
 * Arată toate punctele: un tab în formularul ACP (câmpuri salvate de nucleu), o etichetă lângă titlu și un rând sub
 * descriere declarate pe câmpuri, stilul rândului (o variabilă și o clasă a nucleului din câmpuri + o clasă proprie din
 * `style`), conținut calculat pentru toată lista dintr-o singură interogare (`list`), cardul de sus al paginii
 * forumului și bara topicului. Nimic nu apare pe un forum până nu bifează adminul „Arată demo-ul”.
 */
export const forumSlotsDemoExtension: GcsForumExtension = {
  key: FORUM_SLOTS_DEMO_EXTENSION,
  position: 500,
  tabs: [
    {
      key: "demo",
      labelKey: "forum.slotsDemo.tab",
      icon: "fa-solid fa-flask",
      descriptionKey: "forum.slotsDemo.description",
      position: 900,
      fields: [
        { key: "enabled", type: "toggle", labelKey: "forum.slotsDemo.enabled", default: false },
        { key: "badge", type: "text", labelKey: "forum.slotsDemo.badge", maxLength: 24, slot: { slot: "forum.row.title", as: "chip", icon: "fa-solid fa-flask", tone: "accent" } },
        { key: "note", type: "text", labelKey: "forum.slotsDemo.note", maxLength: 120, slot: { slot: "forum.row.meta", as: "text", icon: "fa-solid fa-circle-info" } },
        { key: "accent", type: "color", labelKey: "forum.slotsDemo.accent", style: { var: "--gcs-forum-color" } },
        { key: "caps", type: "toggle", labelKey: "forum.slotsDemo.caps", style: { class: "gcs-forumRow--titleCaps" } },
      ],
    },
  ],
  // Eticheta are nevoie de un text; un rând de notă de cel mult 120 de caractere (verificat și de câmp).
  validate: (values) => (values.enabled === true && typeof values.badge === "string" && values.badge.trim() === "" ? { badge: "required" } : null),
  style: (node) => (on(node.data) ? { classes: ["gcsx-slotsdemo"], vars: { "--gcsx-slotsdemo-id": String(node.id) } } : null),
  // Toată lista o dată: câte topicuri vizibile are fiecare forum demo (o singură interogare, oricâte rânduri).
  list: async (ctx, nodes) => {
    const shown = nodes.filter((n) => on(n.data));
    if (shown.length === 0) return {};
    const counts = await ctx.db.topic.groupBy({ by: ["forumId"], where: { forumId: { in: shown.map((n) => n.id) }, visibility: "VISIBLE" }, _count: { _all: true } });
    const byForum = new Map(counts.map((c) => [c.forumId, c._count._all]));
    const out: Record<number, { meta?: GcsSlotItem[]; header?: GcsSlotItem[] }> = {};
    for (const n of shown) {
      out[n.id] =
        n.type === "CATEGORY"
          ? { header: [{ kind: "chip", label: { key: "forum.slotsDemo.headerChip" }, icon: "fa-solid fa-flask", tone: "info", id: "slotsdemo-header" }] }
          : { meta: [{ kind: "stat", label: { key: "forum.slotsDemo.visibleTopics" }, value: byForum.get(n.id) ?? 0, icon: "fa-regular fa-comments", id: "slotsdemo-count" }] };
    }
    return out;
  },
  forumPage: async (_ctx, node) =>
    on(node.data)
      ? [
          {
            kind: "card",
            id: "slotsdemo-card",
            icon: "fa-solid fa-flask",
            title: { key: "forum.slotsDemo.cardTitle" },
            body: { key: "forum.slotsDemo.cardBody", params: { name: node.name } },
            tone: "accent",
            items: [{ kind: "chip", label: String(node.data.badge ?? ""), tone: "accent" }],
            actions: [{ label: { key: "forum.slotsDemo.cardAction" }, href: `/forum/${node.id}-${node.slug}`, icon: "fa-solid fa-arrow-right" }],
          },
        ]
      : null,
  topicBar: async (_ctx, { node, topic }) =>
    on(node.data)
      ? [
          { kind: "chip", label: String(node.data.badge ?? ""), icon: "fa-solid fa-flask", tone: "accent", id: "slotsdemo-bar-chip" },
          { kind: "text", text: { key: "forum.slotsDemo.barText", params: { id: topic.id } }, icon: "fa-solid fa-circle-info", id: "slotsdemo-bar-text" },
        ]
      : null,
};

/** Modulul demo (fără aplicație proprie): se înregistrează doar în teste și în E2E (`GCS_TEST_ROUTES=1`). */
export const forumSlotsDemoModule: GcsModule = {
  key: "slotsdemo",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  forumExtensions: [forumSlotsDemoExtension],
};
