import type { GcsModule, GcsSeedContext } from "@gcs/core";
import { showField, widget } from "../widgets";

export const COMMUNITY_LIVE_APP = "community_live";
/** Widget-ul aplicației: „Acum în comunitate”. */
export const COMMUNITY_LIVE_WIDGET = "community_live.now";
/** Câte rânduri poate avea feed-ul (cât aduce consola). */
export const COMMUNITY_LIVE_MAX_ROWS = 8;

/**
 * Widget-ul „Acum în comunitate” (macheta HomeComplete): feed-ul cu tab-urile Tot / Forum / Servere / Mix, cardul
 * „Live acum / Recomandat” și, în antet, jucătorii de pe servere cu „Joacă acum”. Setările: ce tab-uri apar (Tot e
 * mereu primul), câte rânduri, dacă se vede „Live acum”. Zone: sus, coloana din stânga, jos (e un widget lat).
 */
export const communityLiveWidgets = [
  widget({
    key: COMMUNITY_LIVE_WIDGET,
    labelKey: "widgets.community_live.now",
    descriptionKey: "widgets.desc.community_live.now",
    icon: "fa-solid fa-satellite-dish",
    zones: ["top", "main", "bottom"],
    iconOverride: false,
    defaultConfig: { limit: COMMUNITY_LIVE_MAX_ROWS, live: "show", tabForum: "show", tabServers: "show", tabMix: "show" },
    fields: [
      { key: "limit", labelKey: "widgets.fields.feedRows", type: "number", min: 3, max: COMMUNITY_LIVE_MAX_ROWS },
      showField("live", "widgets.fields.liveNow"),
      showField("tabForum", "widgets.fields.tabForum"),
      showField("tabServers", "widgets.fields.tabServers"),
      showField("tabMix", "widgets.fields.tabMix"),
    ],
  }),
];

/** Seed-ul (idempotent): aplicația premium pornește oprită; o stare aleasă în ACP rămâne. */
async function seedCommunityLive({ tx }: GcsSeedContext): Promise<void> {
  await tx.app.upsert({ where: { key: COMMUNITY_LIVE_APP }, create: { key: COMMUNITY_LIVE_APP, enabled: false }, update: {} });
}

/**
 * Comunitate Live (aplicație premium, pachetul `gcs.community_live`, 2026-11-04): widget-ul „Acum în comunitate”, pe
 * care adminul îl pune unde vrea din „Editează pagina”. Merge cu licența care îl include (ca Chat Pro); oprită, widget-ul
 * nu apare nici pe pagini, nici în lista widget-urilor. Datele vin din fluxul de activitate, din serverele vizibile și
 * din meciurile mix live (aceleași reguli de acces ca restul site-ului).
 */
export const communityLiveModule: GcsModule = {
  key: COMMUNITY_LIVE_APP,
  app: {
    optional: true,
    labelKey: "apps.community_live",
    icon: "fa-solid fa-satellite-dish",
    descriptionKey: "apps.descriptions.community_live",
    premium: true,
  },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  widgets: communityLiveWidgets,
  seed: seedCommunityLive,
};
