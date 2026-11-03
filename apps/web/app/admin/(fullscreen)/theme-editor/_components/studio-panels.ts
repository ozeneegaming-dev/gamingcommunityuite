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
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import { NOVA_ONLY_FIELDS, themeHasDesignDecor } from "@gcs/core/themes";

/**
 * Locurile fișierelor din temă: imaginile (același nume ca `kind` din `/api/themes/images`) și videoul antetului
 * (`headerVideo`, încărcat prin `/api/themes/video`).
 */
export type GcsStudioImageSlot = "logo" | "logoLight" | "logoMobile" | "logoMobileLight" | "favicon" | "headerImage" | "headerVideo" | "cockpitImage";

/** O culoare editabilă: un token al paletei (doar hex) sau o culoare de element (hex, token sau transparent). */
export type GcsStudioColorRef = { kind: "token"; token: GcsThemeToken } | { kind: "element"; key: GcsThemeElementColor };

/** Un rând din tab-ul „Setări”: o setare (calea ei), o imagine sau un subtitlu. */
export type GcsStudioSettingItem = string | { image: GcsStudioImageSlot } | { heading: string; decor?: true };

/**
 * Rândul apare pentru designul temei editate. Funcțiile (constructorul de antet, consola, bara de jos, efectele) sunt
 * ale sistemului și apar în orice temă; doar decorul designului GCS (`NOVA_ONLY_FIELDS`: benzile, grafica antetului,
 * subtitlurile marcate `decor`) apare doar pe el, altfel ar fi opțiuni fără efect.
 */
export function studioItemVisible(item: GcsStudioSettingItem, preset: string): boolean {
  if (themeHasDesignDecor(preset)) return true;
  if (typeof item === "string") return !NOVA_ONLY_FIELDS.includes(item);
  if ("image" in item) return true;
  return !item.decor;
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
  | "buttons"
  | "interface";

export type GcsStudioNavRow = { type: "nav"; panel: GcsStudioPanelId } | { type: "css" } | { type: "separator" };

export type GcsStudioPanel = {
  icon: IconDefinition;
  /** Panourile de navigare au rânduri spre alte panouri; celelalte au setări și/sau culori. */
  rows?: GcsStudioNavRow[];
  settings?: GcsStudioSettingItem[];
  colors?: GcsStudioColorRef[];
  /** Un editor propriu deasupra setărilor (constructorul de antet: grila cu drag & drop). */
  builder?: "header";
  /** Panoul are doar decor al designului GCS: rândul spre el apare doar pe acest design. */
  decor?: true;
};

/** Rândul spre un panou apare pentru designul temei editate (panourile de decor doar pe designul lor). */
export function studioPanelVisible(id: GcsStudioPanelId, preset: string): boolean {
  return themeHasDesignDecor(preset) || !STUDIO_PANELS[id].decor;
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
    settings: ["preset", { heading: "bands", decor: true }, "bands.style", "bands.icon", { heading: "effects" }, "effects.hover"],
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
  layouts: {
    icon: faTableColumns,
    settings: [
      "layout.forumIndex",
      "layout.topicView",
      "layout.featureFirstPost",
      "layout.topicSnippet",
      // Listele (sistemul, orice temă): carduri separate sau listă continuă; contoarele forumurilor.
      { heading: "lists" },
      "lists.layout",
      "lists.stats",
    ],
  },
  typography: {
    icon: faTextHeight,
    settings: ["fontDisplay", "typography.fontDisplayCustom", "fontText", "typography.fontTextCustom", "typography.baseSize", "typography.contentSize"],
    colors: [token("text"), token("muted"), element("heading"), element("link"), element("linkHover")],
  },
  header: { icon: faWindowMaximize, rows: [nav("headerBuilder"), nav("headerDesktop"), nav("headerMobile")] },
  // Constructorul de antet (sistemul, orice temă): grila pe dispozitive, presetările, rândurile și meniurile.
  headerBuilder: {
    icon: faTableCellsLarge,
    builder: "header",
    settings: [
      { heading: "builderRows" },
      "header.rowTop",
      "header.rowMain",
      "header.rowBottom",
      "header.sticky",
      "header.compact",
      "header.hideOnScroll",
      { heading: "builderMenus" },
      "header.navIcons",
      "header.dropdowns",
      "header.mega",
      "header.navAlign",
      { heading: "builderCustom" },
      "header.customHtml",
    ],
  },
  // Consola Hero Cockpit de sub antet (sistemul, orice temă): pornită, pe ce pagini, aspectul (complet / compact), ce
  // panou în fiecare loc (aspectul complet), imaginea.
  cockpit: {
    icon: faGauge,
    settings: ["cockpit.enabled", "cockpit.pages", "cockpit.layout", { heading: "cockpitPanels" }, "cockpit.left", "cockpit.center", "cockpit.right", { heading: "cockpitImage" }, { image: "cockpitImage" }],
  },
  headerDesktop: {
    icon: faDesktop,
    settings: [
      "header.height",
      "header.navIcons",
      "header.sticky",
      "header.crumbs",
      // Imaginea antetului (sistemul, orice temă): una inclusă în GCS sau una încărcată (are prioritate), videoul (peste
      // imagine, care rămâne cea de rezervă), apoi unde stau și cum se îmbină cu antetul. Stratul și modelul tehnic sunt
      // decorul graficii GCS (doar pe designul ei).
      { heading: "headerImage" },
      "header.art",
      { image: "headerImage" },
      { image: "headerVideo" },
      "header.imageArea",
      "header.imageDim",
      "header.imageTint",
      "header.imageFade",
      "header.imageMobile",
      "header.overlay",
      "header.pattern",
    ],
    colors: [element("headerBg"), element("headerText")],
  },
  headerMobile: { icon: faMobileScreen, settings: ["header.heightMobile", "logo.sizeMobile", "logo.textMobile", "logo.heightMobile"], colors: [element("headerBg"), element("headerText")] },
  footer: { icon: faGripLines, settings: ["scheme.toggle"], colors: [element("footerBg"), element("footerText")] },
  mobileNav: {
    icon: faMobileScreen,
    settings: ["mobileNav.side", "mobileNav.icons", { heading: "mobileBar" }, "mobileNav.placement", "mobileNav.labels", "mobileNav.items"],
    colors: [element("drawerBg"), element("drawerText")],
  },
  global: { icon: faRectangleList, rows: [nav("body"), nav("boxes"), nav("sidebar"), nav("avatars"), nav("buttons"), nav("interface")] },
  body: { icon: faTableList, settings: ["width", "layout.fullWidth"], colors: [element("bodyBg")] },
  boxes: {
    icon: faBorderAll,
    settings: ["radius", "boxes.borderWidth", "boxes.shadow", "boxes.clickableRows"],
    colors: [element("boxBg"), element("boxBorder"), element("boxHeaderBg"), element("boxHeaderText"), element("widgetTitle"), element("widgetIcon")],
  },
  sidebar: { icon: faTableCellsLarge, settings: ["sidebar.width", "sidebar.position", "sidebar.sticky"] },
  avatars: { icon: faCircleUser, settings: ["avatars.rounded"] },
  buttons: { icon: faHandPointer, settings: ["buttons.radius"], colors: [element("btnPrimaryBg"), element("btnPrimaryText"), element("btnSecondaryBg"), element("btnSecondaryText")] },
  // Interfața (sistemul, orice temă): stilul loader-ului, banda „Sus / Jos” și bara de derulare în culoarea accentului.
  interface: { icon: faSpinner, settings: [{ heading: "loader" }, "loader.style", { heading: "scroll" }, "scroll.rail", "scroll.bar"] },
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
