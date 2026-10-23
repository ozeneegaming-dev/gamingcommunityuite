import { fieldsConfig, type GcsWidgetDef, type GcsWidgetField } from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";

const ALL_ZONES = ["top", "bottom", "sidebar"] as const;
const limitField = (max = 20): GcsWidgetField => ({ key: "limit", labelKey: "widgets.fields.limit", type: "number", min: 1, max });
/** Iconița din titlul widget-ului, pe amplasare (gol = iconița widget-ului); validată cu registrul Font Awesome. */
const iconField: GcsWidgetField = { key: "icon", labelKey: "widgets.fields.icon", type: "text", maxLength: 80 };

/**
 * Un widget cu config validat din câmpuri (vezi `fieldsConfig`). Implicit primește și câmpul `icon` (iconița din
 * titlu, suprascrisă pe amplasare); `iconOverride: false` îl omite (widget-urile fără titlu de card).
 */
export function widget(def: Omit<GcsWidgetDef, "config" | "zones"> & { zones?: GcsWidgetDef["zones"]; iconOverride?: boolean }): GcsWidgetDef {
  const { iconOverride = true, ...rest } = def;
  const fields = [...(rest.fields ?? []), ...(iconOverride ? [iconField] : [])];
  const defaultConfig = iconOverride ? { ...rest.defaultConfig, icon: "" } : rest.defaultConfig;
  const base = fieldsConfig(fields, defaultConfig);
  const config = iconOverride
    ? (raw: unknown) => {
        const out = base(raw);
        if (!out) return null;
        const icon = typeof out.icon === "string" ? out.icon.trim() : "";
        if (icon && !isGcsIcon(icon)) return null;
        return { ...out, icon };
      }
    : base;
  return { zones: ALL_ZONES, ...rest, fields, defaultConfig, config };
}

/** Widget-urile de bază ale nucleului: anunțul, „Cine e online” și membrii noi. */
export const coreWidgets: GcsWidgetDef[] = [
  widget({
    key: "core.announcement",
    labelKey: "widgets.core.announcement",
    descriptionKey: "widgets.desc.core.announcement",
    icon: "fa-solid fa-bullhorn",
    // Titlul și textul goale = mesajul de bun venit implicit (tradus).
    defaultConfig: { title: "", body: "" },
    fields: [
      { key: "title", labelKey: "widgets.fields.title", type: "text", maxLength: 120 },
      // Textul: editorul compact (profilul `announcement`); textul vechi (HTML sau simplu) rămâne valabil.
      { key: "body", labelKey: "widgets.fields.body", type: "richtext", maxLength: 5000, profile: "announcement" },
    ],
  }),
  widget({ key: "core.online", labelKey: "widgets.core.online", descriptionKey: "widgets.desc.core.online", icon: "fa-solid fa-signal", defaultConfig: {} }),
  widget({ key: "core.statsPanel", labelKey: "widgets.core.statsPanel", descriptionKey: "widgets.desc.core.statsPanel", icon: "fa-solid fa-rocket", zones: ["top", "bottom"], defaultConfig: {} }),
  widget({ key: "core.onlineDay", labelKey: "widgets.core.onlineDay", descriptionKey: "widgets.desc.core.onlineDay", icon: "fa-solid fa-clock", defaultConfig: {} }),
  widget({ key: "core.groupLegend", labelKey: "widgets.core.groupLegend", descriptionKey: "widgets.desc.core.groupLegend", icon: "fa-solid fa-users-rectangle", defaultConfig: {} }),
  // Blocul pentru vizitatori (macheta GuestCta): înregistrare, autentificare și conectarea dintr-un click; membrii nu-l văd.
  widget({ key: "core.guestCta", labelKey: "widgets.core.guestCta", descriptionKey: "widgets.desc.core.guestCta", icon: "fa-solid fa-user-plus", iconOverride: false, defaultConfig: {} }),
  widget({ key: "core.newMembers", labelKey: "widgets.core.newMembers", descriptionKey: "widgets.desc.core.newMembers", icon: "fa-solid fa-user-plus", defaultConfig: { limit: 5 }, fields: [limitField()] }),
  // „Clasament” (specul 2026-10-10-hero-cockpit §4): un singur widget cu tab-urile măsurilor și perioada; amplasarea
  // alege doar ce se vede la început.
  widget({
    key: "core.ranking",
    labelKey: "widgets.core.ranking",
    descriptionKey: "widgets.desc.core.ranking",
    icon: "fa-solid fa-trophy",
    defaultConfig: { metric: "posts", period: "day" },
    fields: [
      {
        key: "metric",
        labelKey: "widgets.fields.metric",
        type: "select",
        options: [
          { value: "posts", labelKey: "widgets.metrics.posts" },
          { value: "topics", labelKey: "widgets.metrics.topics" },
          { value: "reputation", labelKey: "widgets.metrics.reputation" },
          { value: "online", labelKey: "widgets.metrics.online" },
        ],
      },
      {
        key: "period",
        labelKey: "widgets.fields.period",
        type: "select",
        options: [
          { value: "day", labelKey: "widgets.periods.day" },
          { value: "week", labelKey: "widgets.periods.week" },
          { value: "month", labelKey: "widgets.periods.month" },
          { value: "year", labelKey: "widgets.periods.year" },
          { value: "all", labelKey: "widgets.periods.all" },
        ],
      },
    ],
  }),
];

/** Widget-urile forumurilor. */
export const forumWidgets: GcsWidgetDef[] = [
  widget({ key: "forums.stats", labelKey: "widgets.forums.stats", descriptionKey: "widgets.desc.forums.stats", icon: "fa-solid fa-chart-simple", defaultConfig: {} }),
  widget({ key: "forums.recentTopics", labelKey: "widgets.forums.recentTopics", descriptionKey: "widgets.desc.forums.recentTopics", icon: "fa-solid fa-clock-rotate-left", defaultConfig: { limit: 6 }, fields: [limitField()] }),
  widget({ key: "forums.recentPosts", labelKey: "widgets.forums.recentPosts", descriptionKey: "widgets.desc.forums.recentPosts", icon: "fa-solid fa-comment", defaultConfig: { limit: 5 }, fields: [limitField()] }),
  widget({
    key: "forums.topPosters",
    labelKey: "widgets.forums.topPosters",
    descriptionKey: "widgets.desc.forums.topPosters",
    icon: "fa-solid fa-trophy",
    defaultConfig: { period: "month", limit: 5 },
    fields: [
      {
        key: "period",
        labelKey: "widgets.fields.period",
        type: "select",
        options: [
          { value: "week", labelKey: "widgets.periods.week" },
          { value: "month", labelKey: "widgets.periods.month" },
          { value: "all", labelKey: "widgets.periods.all" },
        ],
      },
      limitField(),
    ],
  }),
  widget({ key: "forums.featuredTopics", labelKey: "widgets.forums.featuredTopics", descriptionKey: "widgets.desc.forums.featuredTopics", icon: "fa-solid fa-star", defaultConfig: { limit: 5 }, fields: [limitField()] }),
  // Caruselul topicurilor recomandate (specul 2026-10-10-tema-nova §7): carduri cu imagine, pe lățimea paginii.
  widget({
    key: "forums.featuredCarousel",
    labelKey: "widgets.forums.featuredCarousel",
    descriptionKey: "widgets.desc.forums.featuredCarousel",
    icon: "fa-solid fa-images",
    zones: ["top", "bottom"],
    defaultConfig: { limit: 8 },
    fields: [limitField(12)],
  }),
];

/** Shoutbox-ul: o cameră de chat aleasă (gol = primul canal marcat „pe pagina principală”). */
export const chatWidgets: GcsWidgetDef[] = [
  widget({
    key: "chat.shoutbox",
    labelKey: "widgets.chat.shoutbox",
    descriptionKey: "widgets.desc.chat.shoutbox",
    icon: "fa-solid fa-comment-dots",
    // Shoutbox-ul își randează singur antetul (camera de chat), fără titlul comun al widget-urilor.
    iconOverride: false,
    defaultConfig: { channel: "" },
    fields: [{ key: "channel", labelKey: "widgets.fields.channel", type: "select", optionsFrom: "chat.channels" }],
  }),
];

/**
 * Widget-ul aplicației Servere (specul 2026-10-07-servere §7): lista compactă a serverelor vizibile, cu statusul live.
 * Câmpurile: câte servere și jocul (gol = toate familiile).
 */
export const serverWidgets: GcsWidgetDef[] = [
  widget({
    key: "servers.list",
    labelKey: "widgets.servers.list",
    descriptionKey: "widgets.desc.servers.list",
    icon: "fa-solid fa-server",
    defaultConfig: { limit: 5, game: "" },
    fields: [
      limitField(),
      {
        key: "game",
        labelKey: "widgets.fields.game",
        type: "select",
        options: [
          { value: "", labelKey: "widgets.games.all" },
          { value: "cs16", labelKey: "widgets.games.cs16" },
          { value: "cs2", labelKey: "widgets.games.cs2" },
          { value: "minecraft", labelKey: "widgets.games.minecraft" },
        ],
      },
    ],
  }),
  // Puntea (specul 2026-10-08-servere-pagini §6): adminii online acum pe serverele vizibile viewer-ului.
  widget({
    key: "servers.adminsOnline",
    labelKey: "widgets.servers.adminsOnline",
    descriptionKey: "widgets.desc.servers.adminsOnline",
    icon: "fa-solid fa-user-shield",
    defaultConfig: { limit: 8 },
    fields: [limitField()],
  }),
];

const showField = (key: string, labelKey: string): GcsWidgetField => ({
  key,
  labelKey,
  type: "select",
  options: [
    { value: "show", labelKey: "widgets.choices.show" },
    { value: "hide", labelKey: "widgets.choices.hide" },
  ],
});

/**
 * „Obiectivul lunii” (VIP clasic › Donații): titlul obiectivului, bara de progres în culoarea accentului, „640 / 1.000
 * lei”, donatorii și ultimul donator, butonul „Susține comunitatea”. Câmpurile: obiectivul (gol = primul activ vizibil),
 * ultimul donator și numărul donatorilor (afișate sau ascunse).
 */
export const donationWidgets: GcsWidgetDef[] = [
  widget({
    key: "vip.donationGoal",
    labelKey: "widgets.vip.donationGoal",
    descriptionKey: "widgets.desc.vip.donationGoal",
    icon: "fa-solid fa-hand-holding-heart",
    defaultConfig: { goal: "", lastDonor: "show", donorCount: "show" },
    fields: [
      { key: "goal", labelKey: "widgets.fields.goal", type: "select", optionsFrom: "donations.goals" },
      showField("lastDonor", "widgets.fields.lastDonor"),
      showField("donorCount", "widgets.fields.donorCount"),
    ],
  }),
];

/**
 * Widget-ul aplicației Clanuri (specul 2026-10-08-clanuri §12): primele clanuri din clasament (locul, logo-ul, tagul,
 * numele, membrii, punctele). Câmpul: câte clanuri.
 */
export const clanWidgets: GcsWidgetDef[] = [
  widget({
    key: "clans.top",
    labelKey: "widgets.clans.top",
    descriptionKey: "widgets.desc.clans.top",
    icon: "fa-solid fa-people-group",
    defaultConfig: { limit: 5 },
    fields: [limitField()],
  }),
];

/**
 * Widget-urile profilului (Realizări v2): „Ultimele realizări”, badge-urile primite recent (medalionul, numele stilizat,
 * „a primit …”, timpul), cu actualizare live. Setări: câte, doar cele rare, un grup.
 */
export const profileWidgets: GcsWidgetDef[] = [
  widget({
    key: "profile.recentBadges",
    labelKey: "widgets.profile.recentBadges",
    descriptionKey: "widgets.desc.profile.recentBadges",
    icon: "fa-solid fa-award",
    defaultConfig: { limit: 5, rare: "", group: "" },
    fields: [
      limitField(),
      { key: "rare", labelKey: "widgets.fields.rare", type: "select", options: [{ value: "", labelKey: "widgets.rare.all" }, { value: "1", labelKey: "widgets.rare.only" }] },
      { key: "group", labelKey: "widgets.fields.group", type: "select", optionsFrom: "groups" },
    ],
  }),
];
