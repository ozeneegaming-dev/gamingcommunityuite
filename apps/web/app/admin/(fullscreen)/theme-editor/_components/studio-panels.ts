import type { GcsThemeElementColor, GcsThemeToken } from "@gcs/core/themes";
import {
  type IconDefinition,
  faBorderAll,
  faCircleHalfStroke,
  faCircleUser,
  faCode,
  faDesktop,
  faGripLines,
  faHandPointer,
  faImage,
  faMobileScreen,
  faPalette,
  faRectangleList,
  faTableColumns,
  faTextHeight,
  faWindowMaximize,
  faTableCellsLarge,
  faTableList,
  faWandMagicSparkles,
  faGauge,
} from "@fortawesome/free-solid-svg-icons";
import { NOVA_ONLY_FIELDS } from "@gcs/core/themes";

/** Locurile imaginilor din temă (același nume ca `kind` din `/api/themes/images`). */
export type GcsStudioImageSlot = "logo" | "logoLight" | "logoMobile" | "logoMobileLight" | "favicon" | "headerImage" | "cockpitImage";

/** O culoare editabilă: un token al paletei (doar hex) sau o culoare de element (hex, token sau transparent). */
export type GcsStudioColorRef = { kind: "token"; token: GcsThemeToken } | { kind: "element"; key: GcsThemeElementColor };

/** Un rând din tab-ul „Setări”: o setare (calea ei), o imagine sau un subtitlu. */
export type GcsStudioSettingItem = string | { image: GcsStudioImageSlot } | { heading: string; nova?: true };

/**
 * Rândul apare pentru designul temei editate: setările, imaginile și subtitlurile designului Nova (`NOVA_ONLY_FIELDS`,
 * imaginea antetului, subtitlurile marcate `nova`) doar când tema e Nova; altfel ar fi opțiuni fără efect.
 */
export function studioItemVisible(item: GcsStudioSettingItem, preset: string): boolean {
  if (preset === "nova") return true;
  if (typeof item === "string") return !NOVA_ONLY_FIELDS.includes(item);
  if ("image" in item) return item.image !== "headerImage" && item.image !== "cockpitImage";
  return !item.nova;
}

export type GcsStudioPanelId =
  | "start"
  | "design"
  | "palette"
  | "scheme"
  | "logos"
  | "layouts"
  | "typography"
  | "header"
  | "headerBuilder"
  | "cockpit"
  | "headerDesktop"
  | "headerMobile"
  | "footer"
  | "mobileNav"
  | "global"
  | "body"
  | "boxes"
  | "sidebar"
  | "avatars"
  | "buttons";

export type GcsStudioNavRow = { type: "nav"; panel: GcsStudioPanelId } | { type: "css" } | { type: "separator" };

export type GcsStudioPanel = {
  icon: IconDefinition;
  /** Panourile de navigare au rânduri spre alte panouri; celelalte au setări și/sau culori. */
  rows?: GcsStudioNavRow[];
  settings?: GcsStudioSettingItem[];
  colors?: GcsStudioColorRef[];
  /** Un editor propriu deasupra setărilor (constructorul de antet: grila cu drag & drop). */
  builder?: "header";
  /** Panoul are doar setări Nova: rândul spre el apare doar pe temele Nova. */
  nova?: true;
};

/** Rândul spre un panou apare pentru designul temei editate (panourile Nova doar pe Nova). */
export function studioPanelVisible(id: GcsStudioPanelId, preset: string): boolean {
  return preset === "nova" || !STUDIO_PANELS[id].nova;
}

const token = (t: GcsThemeToken): GcsStudioColorRef => ({ kind: "token", token: t });
const element = (key: GcsThemeElementColor): GcsStudioColorRef => ({ kind: "element", key });
const nav = (panel: GcsStudioPanelId): GcsStudioNavRow => ({ type: "nav", panel });

/**
 * Panourile editorului vizual. Fiecare setare de aici schimbă ceva real pe site (vezi specul
 * `docs/superpowers/specs/2026-10-06-editor-tema.md`); nu există opțiuni „moarte”.
 */
export const STUDIO_PANELS: Record<GcsStudioPanelId, GcsStudioPanel> = {
  start: {
    icon: faPalette,
    rows: [
      { type: "css" },
      { type: "separator" },
      nav("design"),
      nav("palette"),
      nav("scheme"),
      nav("logos"),
      nav("layouts"),
      nav("typography"),
      nav("header"),
      nav("cockpit"),
      nav("footer"),
      nav("mobileNav"),
      nav("global"),
    ],
  },
  design: {
    icon: faWandMagicSparkles,
    settings: ["preset", { heading: "bands", nova: true }, "bands.style", "bands.icon", { heading: "effects", nova: true }, "effects.hover"],
  },
  palette: {
    icon: faPalette,
    colors: [token("accent"), token("accentInk"), token("bg"), token("surface"), token("surface2"), token("border"), token("text"), token("muted"), token("chrome"), token("chrome2"), token("ok"), token("warn")],
  },
  scheme: { icon: faCircleHalfStroke, settings: ["scheme.default", "scheme.toggle"] },
  logos: {
    icon: faImage,
    settings: [
      { heading: "textLogo" },
      "logo.text",
      "logo.slogan",
      "logo.font",
      "logo.weight",
      "logo.size",
      "logo.sizeMobile",
      "logo.textMobile",
      { heading: "imageDesktop" },
      { image: "logo" },
      { image: "logoLight" },
      "logo.height",
      { heading: "imageMobile" },
      { image: "logoMobile" },
      { image: "logoMobileLight" },
      "logo.heightMobile",
      { heading: "favicon" },
      { image: "favicon" },
    ],
  },
  layouts: { icon: faTableColumns, settings: ["layout.forumIndex", "layout.topicView", "layout.featureFirstPost"] },
  typography: {
    icon: faTextHeight,
    settings: ["fontDisplay", "typography.fontDisplayCustom", "fontText", "typography.fontTextCustom", "typography.baseSize", "typography.contentSize"],
    colors: [token("text"), token("muted"), element("heading"), element("link"), element("linkHover")],
  },
  header: { icon: faWindowMaximize, rows: [nav("headerBuilder"), nav("headerDesktop"), nav("headerMobile")] },
  // Constructorul de antet (Nova): grila pe dispozitive, presetările și opțiunile rândurilor și ale meniurilor.
  headerBuilder: {
    icon: faTableCellsLarge,
    nova: true,
    builder: "header",
    settings: [
      { heading: "builderRows", nova: true },
      "header.rowTop",
      "header.rowMain",
      "header.rowBottom",
      "header.sticky",
      "header.compact",
      "header.hideOnScroll",
      { heading: "builderMenus", nova: true },
      "header.navIcons",
      "header.dropdowns",
      "header.mega",
      "header.navAlign",
      { heading: "builderCustom", nova: true },
      "header.customHtml",
    ],
  },
  // Consola Hero Cockpit de sub antet (Nova): pornită, pe ce pagini, ce panou în fiecare loc, imaginea de fundal.
  cockpit: {
    icon: faGauge,
    nova: true,
    settings: ["cockpit.enabled", "cockpit.pages", { heading: "cockpitPanels", nova: true }, "cockpit.left", "cockpit.center", "cockpit.right", { heading: "cockpitImage", nova: true }, { image: "cockpitImage" }],
  },
  headerDesktop: {
    icon: faDesktop,
    settings: [
      "header.height",
      "header.navIcons",
      "header.sticky",
      "header.crumbs",
      { heading: "headerImage", nova: true },
      { image: "headerImage" },
      "header.overlay",
      "header.pattern",
    ],
    colors: [element("headerBg"), element("headerText")],
  },
  headerMobile: { icon: faMobileScreen, settings: ["header.heightMobile", "logo.sizeMobile", "logo.textMobile", "logo.heightMobile"], colors: [element("headerBg"), element("headerText")] },
  footer: { icon: faGripLines, settings: ["scheme.toggle"], colors: [element("footerBg"), element("footerText")] },
  mobileNav: {
    icon: faMobileScreen,
    settings: ["mobileNav.side", "mobileNav.icons", { heading: "mobileBar", nova: true }, "mobileNav.placement", "mobileNav.labels", "mobileNav.items"],
    colors: [element("drawerBg"), element("drawerText")],
  },
  global: { icon: faRectangleList, rows: [nav("body"), nav("boxes"), nav("sidebar"), nav("avatars"), nav("buttons")] },
  body: { icon: faTableList, settings: ["width"], colors: [element("bodyBg")] },
  boxes: {
    icon: faBorderAll,
    settings: ["radius", "boxes.borderWidth", "boxes.shadow", "boxes.clickableRows"],
    colors: [element("boxBg"), element("boxBorder"), element("boxHeaderBg"), element("boxHeaderText"), element("widgetTitle"), element("widgetIcon")],
  },
  sidebar: { icon: faTableCellsLarge, settings: ["sidebar.width", "sidebar.position", "sidebar.sticky"] },
  avatars: { icon: faCircleUser, settings: ["avatars.rounded"] },
  buttons: { icon: faHandPointer, settings: ["buttons.radius"], colors: [element("btnPrimaryBg"), element("btnPrimaryText"), element("btnSecondaryBg"), element("btnSecondaryText")] },
};

/** Iconița rândului „CSS personalizat”. */
export const CSS_ROW_ICON = faCode;

/** Panoul părinte (pentru „Înapoi”). */
export function parentPanel(id: GcsStudioPanelId): GcsStudioPanelId | null {
  if (id === "start") return null;
  for (const [pid, p] of Object.entries(STUDIO_PANELS) as [GcsStudioPanelId, GcsStudioPanel][]) {
    if (p.rows?.some((r) => r.type === "nav" && r.panel === id)) return pid;
  }
  return "start";
}

/** Calea în setări a unei culori, pentru modul editat. */
export const colorPath = (ref: GcsStudioColorRef, mode: "dark" | "light") => (ref.kind === "token" ? `${mode}.${ref.token}` : `elements.${mode}.${ref.key}`);

/** Cheia de traducere a unei setări (`header.height` → `header_height`). */
export const fieldKey = (path: string) => path.replace(/\./g, "_");
