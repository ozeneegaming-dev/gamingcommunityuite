import { GCS_BRAND, type GcsBrandScheme } from "./brand";
import {
  COCKPIT_PANELS,
  DEFAULT_MOBILE_BAR,
  headerBuilderError,
  headerPreset,
  mobileBarError,
  type GcsCockpitPanel,
  type GcsHeaderBuilder,
  type GcsMobileBarItem,
} from "./headerBuilder";

/**
 * Setările unei teme: tipurile, valorile implicite, câmpurile (cu intervale și enumerări), completarea cu valorile
 * implicite și validarea. Modul e „pur” (fără Prisma sau Node): îl folosește și editorul vizual din browser
 * (`@gcs/core/themes`), ca previzualizarea să fie compilată exact ca pe server.
 */

/** Tokenurile de culoare ale unei teme (aceleași nume ca în `tokens.css`, fără prefixul `--gcs-`). */
export const THEME_TOKENS = ["bg", "surface", "surface2", "border", "text", "muted", "accent", "accentInk", "chrome", "chrome2", "ok", "warn"] as const;
export type GcsThemeToken = (typeof THEME_TOKENS)[number];
export type GcsThemePalette = Record<GcsThemeToken, string>;

/**
 * Fonturile din care se alege (Google Fonts, toate cu licență OFL / Apache). Chakra Petch, Manrope și DM Sans vin deja cu
 * aplicația (next/font); restul se încarcă din Google Fonts doar când tema le folosește.
 */
export const THEME_FONTS = ["Chakra Petch", "Manrope", "DM Sans", "Inter", "Rajdhani", "Orbitron", "Oxanium", "Exo 2", "Montserrat", "Poppins", "Roboto"] as const;

/**
 * Designul temei (specul 2026-10-10-tema-nova): `classic` = aspectul de până acum, `nova` = designul gaming bleumarin +
 * portocaliu (antetul înalt cu imagine, benzile cu iconița în cerc, subsolul bogat, sistemul de hover). Designul alege
 * și valorile implicite ale celorlalte setări (`themeDefaults`).
 */
export const THEME_PRESETS = ["classic", "nova"] as const;
export type GcsThemePreset = (typeof THEME_PRESETS)[number];

/**
 * Culorile elementelor (antet, subsol, casete, butoane…), separat pentru modul întunecat și cel luminos. Valoarea e un
 * hex (`#RRGGBB`), o referință la un token al paletei (`@accent` → `var(--gcs-accent)`) sau `transparent` (în afară de
 * elementele din `THEME_OPAQUE_ELEMENTS`).
 */
export const THEME_ELEMENT_COLORS = [
  "bodyBg",
  "heading",
  "link",
  "linkHover",
  "headerBg",
  "headerText",
  "footerBg",
  "footerText",
  "drawerBg",
  "drawerText",
  "boxBg",
  "boxBorder",
  "boxHeaderBg",
  "boxHeaderText",
  "widgetTitle",
  "widgetIcon",
  "btnPrimaryBg",
  "btnPrimaryText",
  "btnSecondaryBg",
  "btnSecondaryText",
] as const;
export type GcsThemeElementColor = (typeof THEME_ELEMENT_COLORS)[number];
export type GcsThemeElements = Record<GcsThemeElementColor, string>;

/** Modul implicit: `site` = setarea `site.theme` din ACP (comportamentul de până acum). */
export const THEME_SCHEMES = ["site", "auto", "light", "dark"] as const;
export const THEME_FORUM_INDEX_LAYOUTS = ["list", "grid"] as const;
export const THEME_TOPIC_VIEWS = ["normal", "compact"] as const;
export const THEME_BOX_SHADOWS = ["none", "subtle", "soft", "strong"] as const;
/** Stilul benzii titlurilor (Nova): fundal plin, gradient de accent din stânga sau bară de accent. */
export const THEME_BAND_STYLES = ["solid", "gradient", "accent"] as const;
/** Forma iconiței din bandă (Nova): cerc, pătrat rotunjit sau fără chenar. */
export const THEME_BAND_ICONS = ["circle", "rounded", "none"] as const;
/** Constructorul de antet (Nova): cum se deschid meniurile și unde se aliniază meniul. */
export const THEME_DROPDOWN_MODES = ["click", "hover"] as const;
export const THEME_NAV_ALIGNS = ["left", "center", "right"] as const;
/** Navigarea pe mobil: iconițele în antet sau într-o bară jos. */
export const THEME_MOBILE_PLACEMENTS = ["header", "bottom"] as const;
/** Consola de sub antet (Hero Cockpit): doar pe pagina principală sau pe toate paginile. */
export const THEME_COCKPIT_PAGES = ["home", "all"] as const;
/**
 * Aspectul consolei: `full` = banda personală, cutia cu cele 3 panouri și benzile serverelor (aspectul de până acum);
 * `compact` = un singur rând cu salutul, pastilele de stare și butoanele rapide, apoi banda serverelor (prima pagină
 * nouă, varianta A aprobată de proprietar, 2026-11-03).
 */
export const THEME_COCKPIT_LAYOUTS = ["full", "compact"] as const;
/** „Aspectul listelor” (sistemul): fiecare rând e un card separat sau rândurile lipite, despărțite de o linie. */
export const THEME_LIST_LAYOUTS = ["cards", "list"] as const;
/** „Statistici forum” (sistemul): contoarele în rând, într-o bulă la hover / focus, sau ascunse. */
export const THEME_FORUM_STATS = ["visible", "hover", "hidden"] as const;
/**
 * „Stil loader” (sistemul): loaderele CSS (`GcsSpinner`), CSS-ul nostru din `loaders.css`. Prima cheie e cea implicită
 * a temelor clasice.
 */
export const THEME_LOADERS = [
  "ring",
  "dualRing",
  "arc",
  "dots",
  "pulse",
  "bars",
  "wave",
  "orbit",
  "square",
  "ripple",
  "flip",
  "chase",
  "grid",
  "hourglass",
  "dash",
  "comet",
  "bounce",
  "slash",
] as const;
export type GcsThemeLoader = (typeof THEME_LOADERS)[number];

export type GcsThemeSettings = {
  /** Designul (vezi `THEME_PRESETS`). */
  preset: GcsThemePreset;
  dark: GcsThemePalette;
  light: GcsThemePalette;
  fontDisplay: string;
  fontText: string;
  /** Raza colțurilor casetelor (px). */
  radius: number;
  /** Lățimea maximă a paginii (px). */
  width: number;
  elements: { dark: GcsThemeElements; light: GcsThemeElements };
  scheme: { default: (typeof THEME_SCHEMES)[number]; toggle: boolean };
  logo: {
    /** Textul logo-ului; gol = numele site-ului. */
    text: string;
    slogan: string;
    font: "display" | "text";
    weight: number;
    size: number;
    sizeMobile: number;
    /** Textul logo-ului rămâne vizibil pe ecranele mici (implicit apare doar marcajul). */
    textMobile: boolean;
    /** Logo-ul imagine pentru modul luminos (cel pentru modul întunecat e `logoUrl` al temei). */
    imageLight: string | null;
    imageMobile: string | null;
    imageMobileLight: string | null;
    /** Înălțimea maximă a imaginii, în procente din înălțimea antetului. */
    height: number;
    heightMobile: number;
  };
  layout: {
    forumIndex: (typeof THEME_FORUM_INDEX_LAYOUTS)[number];
    topicView: (typeof THEME_TOPIC_VIEWS)[number];
    featureFirstPost: boolean;
    /** Pagina pe toată lățimea ecranului (fără lățimea maximă `width`). */
    fullWidth: boolean;
    /** Lista topicurilor arată începutul primei postări sub titlu. */
    topicSnippet: boolean;
  };
  /** Listele (forumurile, elementele widget-urilor): carduri separate sau listă continuă; contoarele forumurilor. */
  lists: { layout: (typeof THEME_LIST_LAYOUTS)[number]; stats: (typeof THEME_FORUM_STATS)[number] };
  /** Loaderul site-ului (butoane, liste, modale, chat). */
  loader: { style: GcsThemeLoader };
  /** Banda „Sus / Jos” din stânga și bara de derulare în culoarea accentului (progresul paginii). */
  scroll: { rail: boolean; bar: boolean };
  typography: {
    /** Mărimea textului de bază (px, raportată la 16 px = mărimea aleasă de browser). */
    baseSize: number;
    /** Mărimea textului din postări și semnături (%). */
    contentSize: number;
    /** Un alt font Google pentru titluri / text (gol = cel din listă). */
    fontDisplayCustom: string;
    fontTextCustom: string;
  };
  header: {
    height: number;
    heightMobile: number;
    navIcons: boolean;
    sticky: boolean;
    /** Nova: imaginea de fundal a antetului (`/files/<id>`); `null` = grafica GCS (gradient cu model tehnic). */
    image: string | null;
    /** Nova: cât de închis e stratul peste imagine (%). */
    overlay: number;
    /** Nova: modelul tehnic (grila de circuite) peste grafica implicită. */
    pattern: boolean;
    /** Nova: rândul cu breadcrumb-ul și căutarea, sub meniu. */
    crumbs: boolean;
    /** Nova: constructorul de antet (rândurile, zonele și elementele, pe dispozitive; vezi `headerBuilder.ts`). */
    layout: GcsHeaderBuilder;
    /** Nova: înălțimile rândurilor constructorului (bara de sus, rândul principal, rândul secundar). */
    rowTop: number;
    rowMain: number;
    rowBottom: number;
    /** Nova: la derulare, antetul se strânge într-o bară compactă, lipită sus. */
    compact: boolean;
    /** Nova: antetul se ascunde la derularea în jos și revine la derularea în sus. */
    hideOnScroll: boolean;
    /** Nova: meniurile se deschid la click sau la hover (și cu tastatura, oricum). */
    dropdowns: (typeof THEME_DROPDOWN_MODES)[number];
    /** Nova: submeniurile ca mega meniuri (2 coloane, descrieri, insigne live, rândul de jos). */
    mega: boolean;
    navAlign: (typeof THEME_NAV_ALIGNS)[number];
    /** Nova: elementul „Text/HTML personalizat” (HTML sanitizat la afișare). */
    customHtml: string;
  };
  mobileNav: {
    side: "left" | "right";
    icons: boolean;
    /** Nova: iconițele (meniu, cont, căutare, notificări) în antet sau într-o bară jos. */
    placement: (typeof THEME_MOBILE_PLACEMENTS)[number];
    /** Nova: textul sub iconițele barei de jos. */
    labels: boolean;
    /** Nova: elementele barei de jos (1–5). */
    items: GcsMobileBarItem[];
  };
  boxes: { borderWidth: number; shadow: (typeof THEME_BOX_SHADOWS)[number]; clickableRows: boolean };
  sidebar: { width: number; position: "right" | "left"; sticky: boolean };
  avatars: { rounded: boolean };
  buttons: { radius: number };
  /** Nova: benzile titlurilor (stilul) și iconița din ele (forma). */
  bands: { style: (typeof THEME_BAND_STYLES)[number]; icon: (typeof THEME_BAND_ICONS)[number] };
  /** Nova: efectele de hover (tranziții, mărirea pastilelor); fără ele, doar schimbările de culoare. */
  effects: { hover: boolean };
  /**
   * Nova: consola de sub antet (Hero Cockpit): banda personală, cele 3 panouri (ce widget în fiecare), benzile
   * serverelor și imaginea de fundal (`null` = grafica GCS).
   */
  cockpit: {
    enabled: boolean;
    pages: (typeof THEME_COCKPIT_PAGES)[number];
    /** Aspectul (vezi `THEME_COCKPIT_LAYOUTS`); în aspectul compact panourile nu se afișează. */
    layout: (typeof THEME_COCKPIT_LAYOUTS)[number];
    left: GcsCockpitPanel;
    center: GcsCockpitPanel;
    right: GcsCockpitPanel;
    image: string | null;
  };
};

export type GcsDeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, unknown> ? GcsDeepPartial<T[K]> : T[K] };

/**
 * Culorile implicite ale elementelor: regulile din `layout.css` / `base.css`. Antetul casetelor (banda titlurilor) are
 * fundalul `@surface2`, diferit și de pagină (`@bg`), și de conținutul casetei (`@surface`), în ambele moduri.
 */
const DEFAULT_ELEMENTS: GcsThemeElements = {
  bodyBg: "@bg",
  heading: "@text",
  link: "@accentInk",
  linkHover: "@accentInk",
  headerBg: "@chrome",
  headerText: "@muted",
  footerBg: "@chrome",
  footerText: "@muted",
  drawerBg: "@surface",
  drawerText: "@accentInk",
  boxBg: "@surface",
  boxBorder: "@border",
  boxHeaderBg: "@surface2",
  boxHeaderText: "@text",
  widgetTitle: "@text",
  widgetIcon: "@accentInk",
  btnPrimaryBg: "@accent",
  btnPrimaryText: "#FFFFFF",
  btnSecondaryBg: "@surface2",
  btnSecondaryText: "@text",
};

/** Valorile implicite: exact paleta și aspectul din machete (`tokens.css` / `themes.css` / `layout.css`). */
export const DEFAULT_THEME_SETTINGS: GcsThemeSettings = {
  preset: "classic",
  dark: {
    bg: "#0B0C10",
    surface: "#14161C",
    surface2: "#1B1E26",
    border: "#262A34",
    text: "#ECEDF1",
    muted: "#A1A7B4",
    accent: "#D62839",
    accentInk: "#FF6B74",
    chrome: "#0F1116",
    chrome2: "#111319",
    ok: "#3DDC97",
    warn: "#F4B740",
  },
  light: {
    bg: "#F4F5F7",
    surface: "#FFFFFF",
    surface2: "#EEF0F3",
    border: "#D9DCE2",
    text: "#14161C",
    muted: "#5B6170",
    accent: "#D62839",
    accentInk: "#C21F31",
    chrome: "#FFFFFF",
    chrome2: "#F8F9FB",
    ok: "#1F9D63",
    warn: "#B7791F",
  },
  fontDisplay: "Chakra Petch",
  fontText: "Manrope",
  radius: 12,
  width: 1320,
  elements: { dark: { ...DEFAULT_ELEMENTS }, light: { ...DEFAULT_ELEMENTS } },
  scheme: { default: "site", toggle: true },
  logo: {
    text: "",
    slogan: "",
    font: "display",
    weight: 700,
    size: 22,
    sizeMobile: 18,
    textMobile: false,
    imageLight: null,
    imageMobile: null,
    imageMobileLight: null,
    height: 66,
    heightMobile: 66,
  },
  layout: { forumIndex: "list", topicView: "normal", featureFirstPost: false, fullWidth: false, topicSnippet: false },
  lists: { layout: "list", stats: "visible" },
  loader: { style: "ring" },
  scroll: { rail: true, bar: true },
  typography: { baseSize: 16, contentSize: 100, fontDisplayCustom: "", fontTextCustom: "" },
  header: {
    height: 64,
    heightMobile: 64,
    navIcons: true,
    sticky: true,
    image: null,
    overlay: 70,
    pattern: true,
    crumbs: true,
    // Antetul sistemului (constructorul) în aspectul „Clasic”: un rând, ca antetul temelor clasice de până acum.
    layout: headerPreset("basic"),
    rowTop: 44,
    // Rândul principal al antetului clasic de până acum (64 px).
    rowMain: 64,
    rowBottom: 56,
    compact: false,
    hideOnScroll: false,
    dropdowns: "click",
    mega: true,
    navAlign: "left",
    customHtml: "",
  },
  mobileNav: { side: "left", icons: true, placement: "header", labels: true, items: [...DEFAULT_MOBILE_BAR] },
  boxes: { borderWidth: 1, shadow: "none", clickableRows: false },
  sidebar: { width: 320, position: "right", sticky: false },
  avatars: { rounded: true },
  buttons: { radius: 10 },
  bands: { style: "solid", icon: "circle" },
  effects: { hover: true },
  // Aspectul complet rămâne implicit: temele salvate înainte de setarea `layout` arată consola ca până acum.
  cockpit: { enabled: false, pages: "home", layout: "full", left: "feed", center: "live", right: "top", image: null },
};

/**
 * Culorile elementelor în designul Nova: titlurile și linkurile albe (accentul la hover), antetul închis peste imagine
 * în ambele moduri, butonul secundar gri-albăstrui. Banda titlurilor rămâne `@surface2` (diferită de casetă și pagină).
 */
const NOVA_ELEMENTS_DARK: GcsThemeElements = {
  ...DEFAULT_ELEMENTS,
  heading: GCS_BRAND.color.dark.heading,
  link: GCS_BRAND.color.dark.heading,
  linkHover: "@accent",
  headerBg: "@chrome",
  headerText: "#D3D9E2",
  footerBg: "@chrome",
  footerText: "@text",
  drawerBg: "@surface",
  drawerText: "@text",
  widgetTitle: "#FFFFFF",
  widgetIcon: "@accentInk",
  btnSecondaryBg: GCS_BRAND.color.dark.secondary,
  btnSecondaryText: GCS_BRAND.color.dark.secondaryText,
};

const NOVA_ELEMENTS_LIGHT: GcsThemeElements = {
  ...DEFAULT_ELEMENTS,
  heading: GCS_BRAND.color.light.heading,
  link: "@text",
  linkHover: "@accent",
  // Antetul rămâne închis și în modul luminos (imaginea cu stratul întunecat).
  headerBg: GCS_BRAND.color.dark.chrome,
  headerText: "#D3D9E2",
  footerBg: "@chrome",
  footerText: "@text",
  drawerBg: "@surface",
  drawerText: "@text",
  widgetTitle: "@text",
  widgetIcon: "@accent",
  btnSecondaryBg: GCS_BRAND.color.light.secondary,
  btnSecondaryText: "@text",
};

/** Tokenurile de culoare ale unei teme, luate din brand. */
function brandPalette(b: GcsBrandScheme): GcsThemePalette {
  return Object.fromEntries(THEME_TOKENS.map((k) => [k, b[k]])) as GcsThemePalette;
}

/**
 * Designul Nova (specul 2026-10-10-tema-nova): bleumarin închis + portocaliu-roșu, DM Sans 13 px, casete de 12 px cu
 * umbră fină, butoane de 4 px, antetul înalt cu imagine. Varianta luminoasă: suprafețe deschise, același accent.
 * `muted` e puțin mai deschis decât în referință, ca textul secundar să aibă contrast ≥ 4.5:1 pe casete.
 */
export const NOVA_THEME_SETTINGS: GcsThemeSettings = {
  ...DEFAULT_THEME_SETTINGS,
  preset: "nova",
  // Paleta vine din brandul GCS (`brand.ts`, direcția „Forja”): tema implicită e brandul.
  dark: brandPalette(GCS_BRAND.color.dark),
  light: brandPalette(GCS_BRAND.color.light),
  fontDisplay: "DM Sans",
  fontText: "DM Sans",
  radius: 12,
  width: 1400,
  elements: { dark: NOVA_ELEMENTS_DARK, light: NOVA_ELEMENTS_LIGHT },
  scheme: { default: "dark", toggle: true },
  logo: { ...DEFAULT_THEME_SETTINGS.logo, font: "text", weight: 800, size: 24, textMobile: true, height: 70, heightMobile: 70 },
  typography: { ...DEFAULT_THEME_SETTINGS.typography, baseSize: 13 },
  header: {
    ...DEFAULT_THEME_SETTINGS.header,
    height: 76,
    heightMobile: 60,
    navIcons: false,
    sticky: false,
    // Rândurile constructorului: valorile machetei Esports (bara de sus 76, meniul 94); compact la derulare.
    rowTop: 76,
    rowMain: 94,
    rowBottom: 58,
    compact: true,
    // Aspectul „Standard”: logo + meniu + iconițele, apoi breadcrumb-ul și câmpul de căutare.
    layout: headerPreset("classic"),
  },
  boxes: { borderWidth: 1, shadow: "subtle", clickableRows: true },
  sidebar: { width: 340, position: "right", sticky: false },
  buttons: { radius: 4 },
  bands: { style: "solid", icon: "circle" },
  effects: { hover: true },
  // Designul GCS livrează rândurile ca și carduri separate (macheta CardRows) și loaderul cu bare. Contoarele
  // forumurilor (topicuri, postări) apar doar la hover, în bula butonului de statistici (proprietarul, 2026-11-02).
  lists: { layout: "cards", stats: "hover" },
  loader: { style: "bars" },
};

/** Valorile implicite ale unui design (completarea setărilor, „Revino la implicit” din editorul vizual). */
export function themeDefaults(preset: GcsThemePreset | undefined | null): GcsThemeSettings {
  return preset === "nova" ? NOVA_THEME_SETTINGS : DEFAULT_THEME_SETTINGS;
}

/**
 * Setările care sunt DOAR decor al designului GCS (`preset: "nova"`): stilul benzilor, iconița din bandă și grafica
 * antetului (imaginea, stratul, modelul tehnic, rândul vechi cu breadcrumb). Editorul vizual le arată doar pe acest
 * design (în rest ar fi opțiuni „moarte”). Tot ce e funcție (constructorul de antet, consola, bara de jos, modul
 * meniurilor, efectele de hover, modurile listelor) ține de sistem și merge în orice temă.
 */
export const NOVA_ONLY_FIELDS: readonly string[] = ["header.image", "header.overlay", "header.pattern", "header.crumbs", "bands.style", "bands.icon"];

/** Designul are decor propriu (benzile, grafica antetului): editorul îi arată setările din `NOVA_ONLY_FIELDS`. */
export const themeHasDesignDecor = (preset: string | undefined | null): boolean => preset === "nova";

/**
 * Temele incluse (specul system-ui, 2026-10-16): „GCS Dark” (doar întunecată, implicită la instalare) și „GCS White”
 * (doar luminoasă), același design (`preset: "nova"`), fiecare cu paleta ei, editată separat. Comutatorul lună / soare
 * trece de la una la alta (perechea din ACP → Aspect → Teme).
 */
/**
 * Antetul temelor incluse: cel de pe preview, ales de proprietar (2026-11-02). Presetarea Esports (rețelele sociale și
 * contul sus, meniul împărțit în jurul logo-ului, căutarea în dreapta), plus butonul chatului și limba pe rândul
 * principal, breadcrumb-ul și serverele live dedesubt; 120 px, compact și ascuns la derularea în jos. Imaginea de fundal
 * a preview-ului e un fișier al acelei instalări, deci rămâne grafica GCS; meniul se împarte jumătate-jumătate.
 */
function gcsHeaderLayout(): GcsHeaderBuilder {
  const layout = headerPreset("esports");
  layout.desktop.main.left = ["chat.button", "nav"];
  layout.desktop.main.center = ["logo", "language"];
  layout.desktop.bottom = { left: ["breadcrumb"], center: [], right: ["serversLive"] };
  return layout;
}
const GCS_HEADER: GcsThemeSettings["header"] = {
  ...NOVA_THEME_SETTINGS.header,
  height: 120,
  heightMobile: 60,
  navIcons: true,
  overlay: 95,
  layout: gcsHeaderLayout(),
  rowTop: 101,
  rowMain: 48,
  rowBottom: 58,
  compact: true,
  hideOnScroll: true,
  dropdowns: "click",
  mega: true,
  navAlign: "center",
};
/** Logo-ul text al antetului de pe preview (numele site-ului, 40 px; 32 px pe mobil). */
const GCS_LOGO: GcsThemeSettings["logo"] = { ...NOVA_THEME_SETTINGS.logo, size: 40, sizeMobile: 32 };
/**
 * Consola temelor incluse: aspectul compact (prima pagină nouă, varianta A, 2026-11-03): salutul cu pastilele de stare
 * și banda serverelor, fără cutia cu panouri. Pornirea consolei rămâne alegerea adminului (din editorul vizual).
 */
/** Consola temelor incluse: pornită, compactă (salutul, starea și serverele; prima pagină aleasă de proprietar, varianta A). */
const GCS_COCKPIT: GcsThemeSettings["cockpit"] = { ...NOVA_THEME_SETTINGS.cockpit, enabled: true, layout: "compact" };
export const GCS_DARK_THEME_SETTINGS: GcsThemeSettings = { ...NOVA_THEME_SETTINGS, header: GCS_HEADER, logo: GCS_LOGO, cockpit: GCS_COCKPIT, scheme: { default: "dark", toggle: false } };
/** „GCS White”: paleta luminoasă a designului (modul e mereu „light”, deci paleta `light` e cea afișată). */
export const GCS_WHITE_THEME_SETTINGS: GcsThemeSettings = { ...NOVA_THEME_SETTINGS, header: GCS_HEADER, logo: GCS_LOGO, cockpit: GCS_COCKPIT, scheme: { default: "light", toggle: false } };

/** Modul unei teme cu un singur mod (fără comutatorul întunecat / luminos al aceleiași teme); altfel `null`. */
export const themeSingleScheme = (s: Pick<GcsThemeSettings, "scheme">): "dark" | "light" | null =>
  !s.scheme.toggle && (s.scheme.default === "dark" || s.scheme.default === "light") ? s.scheme.default : null;

/**
 * Elementele care au mereu un fundal propriu (specul `2026-10-07-antete-titluri.md`: fiecare titlu pe banda lui).
 * Pentru ele, `transparent` sau o valoare goală înseamnă valoarea implicită, iar editorul nu oferă mostra „Transparent”.
 */
export const THEME_OPAQUE_ELEMENTS: readonly GcsThemeElementColor[] = ["boxHeaderBg"];

/** Elementul poate fi `transparent` (în editorul vizual apare mostra „Transparent”). */
export const themeElementAllowsTransparent = (key: GcsThemeElementColor): boolean => !THEME_OPAQUE_ELEMENTS.includes(key);

/** Culoarea efectivă a unui element: la elementele opace, `transparent` sau gol devine valoarea implicită. */
export function themeElementColor(key: GcsThemeElementColor, value: string): string {
  return !themeElementAllowsTransparent(key) && (value === "transparent" || value.trim() === "") ? DEFAULT_ELEMENTS[key] : value;
}

// ─── Câmpurile ────────────────────────────────────────────────────────────────

export type GcsThemeField =
  /** Culoare a paletei: doar hex (tokenurile nu se referă unele la altele). */
  | { kind: "palette" }
  /** Culoare de element: hex, `@token` sau `transparent` (la elementele opace, `transparent` se normalizează). */
  | { kind: "color" }
  | { kind: "int"; min: number; max: number; step?: number; unit?: "px" | "%" }
  | { kind: "enum"; options: readonly string[] }
  | { kind: "bool" }
  | { kind: "text"; max: number }
  /** Un font din listă. */
  | { kind: "font" }
  /** Numele unui font Google (litere, cifre, spații) sau gol. */
  | { kind: "fontName" }
  /** Un fișier public al site-ului (`/files/<id>`) sau `null`. */
  | { kind: "file" }
  /** Aspectul constructorului de antet (vezi `headerBuilderError`). */
  | { kind: "headerLayout" }
  /** Elementele barei de jos de pe mobil (vezi `mobileBarError`). */
  | { kind: "barItems" };

const int = (min: number, max: number, unit?: "px" | "%", step?: number): GcsThemeField => ({ kind: "int", min, max, ...(unit ? { unit } : {}), ...(step ? { step } : {}) });
const choice = (options: readonly string[]): GcsThemeField => ({ kind: "enum", options });
const BOOL: GcsThemeField = { kind: "bool" };

function buildFields(): Record<string, GcsThemeField> {
  const fields: Record<string, GcsThemeField> = {};
  for (const mode of ["dark", "light"] as const) {
    for (const t of THEME_TOKENS) fields[`${mode}.${t}`] = { kind: "palette" };
    for (const e of THEME_ELEMENT_COLORS) fields[`elements.${mode}.${e}`] = { kind: "color" };
  }
  return {
    preset: choice(THEME_PRESETS),
    ...fields,
    fontDisplay: { kind: "font" },
    fontText: { kind: "font" },
    radius: int(0, 24, "px"),
    width: int(1000, 1920, "px", 10),
    "scheme.default": choice(THEME_SCHEMES),
    "scheme.toggle": BOOL,
    "logo.text": { kind: "text", max: 40 },
    "logo.slogan": { kind: "text", max: 80 },
    "logo.font": choice(["display", "text"]),
    "logo.weight": int(400, 800, undefined, 100),
    "logo.size": int(14, 40, "px"),
    "logo.sizeMobile": int(12, 32, "px"),
    "logo.textMobile": BOOL,
    "logo.imageLight": { kind: "file" },
    "logo.imageMobile": { kind: "file" },
    "logo.imageMobileLight": { kind: "file" },
    "logo.height": int(30, 100, "%"),
    "logo.heightMobile": int(30, 100, "%"),
    "layout.forumIndex": choice(THEME_FORUM_INDEX_LAYOUTS),
    "layout.topicView": choice(THEME_TOPIC_VIEWS),
    "layout.featureFirstPost": BOOL,
    "layout.fullWidth": BOOL,
    "layout.topicSnippet": BOOL,
    "lists.layout": choice(THEME_LIST_LAYOUTS),
    "lists.stats": choice(THEME_FORUM_STATS),
    "loader.style": choice(THEME_LOADERS),
    "scroll.rail": BOOL,
    "scroll.bar": BOOL,
    "typography.baseSize": int(12, 20, "px"),
    "typography.contentSize": int(80, 150, "%", 5),
    "typography.fontDisplayCustom": { kind: "fontName" },
    "typography.fontTextCustom": { kind: "fontName" },
    "header.height": int(48, 120, "px"),
    "header.heightMobile": int(48, 96, "px"),
    "header.navIcons": BOOL,
    "header.sticky": BOOL,
    "header.image": { kind: "file" },
    "header.overlay": int(0, 95, "%", 5),
    "header.pattern": BOOL,
    "header.crumbs": BOOL,
    "mobileNav.side": choice(["left", "right"]),
    "mobileNav.icons": BOOL,
    "boxes.borderWidth": int(0, 4, "px"),
    "boxes.shadow": choice(THEME_BOX_SHADOWS),
    "boxes.clickableRows": BOOL,
    "sidebar.width": int(240, 480, "px", 10),
    "sidebar.position": choice(["right", "left"]),
    "sidebar.sticky": BOOL,
    "avatars.rounded": BOOL,
    "buttons.radius": int(0, 24, "px"),
    "bands.style": choice(THEME_BAND_STYLES),
    "bands.icon": choice(THEME_BAND_ICONS),
    "effects.hover": BOOL,
    "header.layout": { kind: "headerLayout" },
    "header.rowTop": int(32, 120, "px"),
    "header.rowMain": int(48, 160, "px"),
    "header.rowBottom": int(32, 120, "px"),
    "header.compact": BOOL,
    "header.hideOnScroll": BOOL,
    "header.dropdowns": choice(THEME_DROPDOWN_MODES),
    "header.mega": BOOL,
    "header.navAlign": choice(THEME_NAV_ALIGNS),
    "header.customHtml": { kind: "text", max: 2000 },
    "mobileNav.placement": choice(THEME_MOBILE_PLACEMENTS),
    "mobileNav.labels": BOOL,
    "mobileNav.items": { kind: "barItems" },
    "cockpit.enabled": BOOL,
    "cockpit.pages": choice(THEME_COCKPIT_PAGES),
    "cockpit.layout": choice(THEME_COCKPIT_LAYOUTS),
    "cockpit.left": choice(COCKPIT_PANELS),
    "cockpit.center": choice(COCKPIT_PANELS),
    "cockpit.right": choice(COCKPIT_PANELS),
    "cockpit.image": { kind: "file" },
  };
}

/** Toate setările unei teme, după calea lor (`header.height`, `elements.dark.headerBg`, `light.accent`…). */
export const THEME_FIELDS: Readonly<Record<string, GcsThemeField>> = buildFields();

const HEX_RE = /^#[0-9a-f]{6}$/i;
const TOKEN_REF_RE = new RegExp(`^@(${THEME_TOKENS.join("|")})$`);
const FONT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
const FILE_RE = /^\/files\/[A-Za-z0-9_-]{1,40}$/;
const hasControlChars = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export const isThemeHex = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v);
/** O culoare de element validă: hex, `@token` sau `transparent`. */
export const isThemeColor = (v: unknown): v is string => typeof v === "string" && (HEX_RE.test(v) || TOKEN_REF_RE.test(v) || v === "transparent");
/** `null` sau un fișier public al site-ului (`/files/<id>`). */
export const isThemeFileUrl = (v: unknown): v is string | null => v === null || (typeof v === "string" && FILE_RE.test(v));

/** Codul erorii pentru o valoare a unui câmp (cheile din `errors.fields`); `null` = validă. */
export function themeFieldError(field: GcsThemeField, value: unknown): string | null {
  switch (field.kind) {
    case "palette":
      return isThemeHex(value) ? null : "invalid_color";
    case "color":
      return isThemeColor(value) ? null : "invalid_color";
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value) || value < field.min || value > field.max) return "invalid_range";
      return field.step && (value - field.min) % field.step !== 0 ? "invalid_range" : null;
    case "enum":
      return typeof value === "string" && field.options.includes(value) ? null : "invalid_choice";
    case "bool":
      return typeof value === "boolean" ? null : "invalid_type";
    case "text":
      if (typeof value !== "string") return "invalid_type";
      if (value.length > field.max) return "too_long";
      return hasControlChars(value) ? "invalid" : null;
    case "font":
      return typeof value === "string" && (THEME_FONTS as readonly string[]).includes(value) ? null : "invalid_choice";
    case "fontName":
      return value === "" || (typeof value === "string" && FONT_NAME_RE.test(value)) ? null : "invalid";
    case "file":
      return isThemeFileUrl(value) ? null : "invalid";
    case "headerLayout":
      return headerBuilderError(value);
    case "barItems":
      return mobileBarError(value);
  }
}

// ─── Obiecte: căi, completare, îmbinare ───────────────────────────────────────

export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Valoarea de la o cale (`a.b.c`) dintr-un obiect, sau `undefined`. */
export function themePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** O copie a obiectului cu valoarea pusă la cale (creează obiectele intermediare). */
export function withThemePath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const src = (isPlainObject(obj) ? obj : {}) as Record<string, unknown>;
  return { ...src, [head!]: rest.length === 0 ? value : withThemePath(src[head!], rest.join("."), value) } as T;
}

/** Îmbină în adâncime un patch peste o bază (obiectele se îmbină, restul valorilor înlocuiesc). */
export function mergeThemeObjects<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeThemeObjects(out[k], v) : v;
  }
  return out as T;
}

/**
 * Setările salvate, completate cu valorile implicite (o temă veche, incompletă sau stricată rămâne validă). Elementele
 * opace (`THEME_OPAQUE_ELEMENTS`) salvate `transparent` primesc valoarea implicită.
 */
export function normalizeThemeSettings(raw: unknown): GcsThemeSettings {
  // Valorile care lipsesc vin din designul temei (o temă fără `preset` e una veche, deci clasică).
  const preset = themePath(raw, "preset");
  let out = structuredClone(themeDefaults(themeFieldError(THEME_FIELDS.preset!, preset) === null ? (preset as GcsThemePreset) : "classic"));
  for (const [path, field] of Object.entries(THEME_FIELDS)) {
    const value = themePath(raw, path);
    if (value !== undefined && themeFieldError(field, value) === null) out = withThemePath(out, path, value);
  }
  for (const mode of ["dark", "light"] as const) {
    for (const key of THEME_OPAQUE_ELEMENTS) out = withThemePath(out, `elements.${mode}.${key}`, themeElementColor(key, out.elements[mode][key]));
  }
  return out;
}

/** Căile frunzelor unui patch (`{ header: { height: 70 } }` → `header.height`). */
function leaves(obj: Record<string, unknown>, prefix = ""): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]): [string, unknown][] => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && !(path in THEME_FIELDS)) return leaves(v, path);
    return [[path, v]];
  });
}

/** Validează (strict) un patch de setări; întoarce erorile pe căi (gol = valid). */
export function themeSettingsErrors(patch: unknown): Record<string, string> {
  if (!isPlainObject(patch)) return { _: "invalid_type" };
  const errors: Record<string, string> = {};
  for (const [path, value] of leaves(patch)) {
    const field = THEME_FIELDS[path];
    if (!field) errors[path] = "unknown_setting";
    else {
      const err = themeFieldError(field, value);
      if (err) errors[path] = err;
    }
  }
  return errors;
}

/** CSS-ul unei culori de element: `@accent` → `var(--gcs-accent)`; hex și `transparent` rămân la fel. */
export function themeColorCss(value: string): string {
  return value.startsWith("@") ? `var(--gcs-${value.slice(1)})` : value;
}

/** Fonturile efective (cel personalizat, dacă e completat, altfel cel din listă). */
export function themeFonts(s: GcsThemeSettings): { display: string; text: string } {
  return { display: s.typography.fontDisplayCustom || s.fontDisplay, text: s.typography.fontTextCustom || s.fontText };
}
