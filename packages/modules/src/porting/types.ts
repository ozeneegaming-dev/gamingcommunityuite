/**
 * Modelul comun al asistentului de portare: fiecare format de sursă (citit doar ca text) devine un `GcsPortSource`,
 * din care generatorul scrie pluginul GCS și raportul. Formatele se numesc după structura lor, nu după produs.
 */

/**
 * - `app-json`: aplicație exportată ca `.tar`, cu `data/application.json`, `data/settings.json`, `data/lang.xml`…;
 * - `plugin-xml`: plugin într-un singur fișier XML (rădăcina `<plugin>`), cu fișierele încorporate în base64;
 * - `addon-json`: add-on `.zip` cu `addon.json` și folderul `_data/`.
 */
export const GCS_PORT_FORMATS = ["app-json", "plugin-xml", "addon-json"] as const;
export type GcsPortFormat = (typeof GCS_PORT_FORMATS)[number];

/** Temeiul confirmării: e autorul, are acordul scris al autorului sau licența permite modificarea și folosirea. */
export const GCS_PORT_RIGHTS = ["author", "consent", "license"] as const;
export type GcsPortRightsBasis = (typeof GCS_PORT_RIGHTS)[number];

export type GcsPortMeta = {
  /** Identificatorul din sursă (folderul aplicației, id-ul add-on-ului, numele pluginului). */
  id: string;
  name: string;
  version: string;
  author: string;
  url: string | null;
  description: string;
  /** Iconița sugerată de sursă (`fa-star`), dacă există. */
  icon: string | null;
};

export type GcsPortSetting = {
  key: string;
  type: "toggle" | "number" | "text" | "textarea" | "select" | "unknown";
  default: string;
  /** Pentru `select`: valoarea și cheia frazei (sau textul) fiecărei opțiuni. */
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  /** Cheile frazelor sursei pentru etichetă și explicație (dacă există). */
  labelPhrase?: string;
  hintPhrase?: string;
  /** Grupul (tab-ul) din sursă. */
  group?: string;
};

export type GcsPortPermission = { key: string; type: "boolean" | "number"; labelPhrase?: string; group?: string };

export type GcsPortRoute = {
  area: "site" | "acp" | "api";
  /** Calea GCS propusă (`/`, `/view/:id`). */
  path: string;
  /** De unde vine (`furl.json: view`, `routes.xml: my-page`). */
  origin: string;
  /** Fișierul controllerului din sursă, dacă se cunoaște. */
  controller?: string;
  labelPhrase?: string;
};

export type GcsPortMenu = { area: "site"; key: string; route: string; labelPhrase?: string };

export type GcsPortColumn = {
  name: string;
  /** Tipul din sursă, cu litere mici (`int`, `varchar`, `mediumtext`, `enum`…). */
  type: string;
  length?: number;
  decimals?: number;
  unsigned?: boolean;
  nullable: boolean;
  /** `undefined` = fără valoare implicită; `null` = `DEFAULT NULL`. */
  default?: string | number | null;
  autoIncrement?: boolean;
  values?: string[];
};
export type GcsPortIndex = { kind: "primary" | "unique" | "key" | "fulltext"; name: string; columns: string[] };
export type GcsPortTable = { name: string; columns: GcsPortColumn[]; indexes: GcsPortIndex[]; origin: string };

/** Sintaxa șabloanelor: `brace` = `{{if}}`, `{lang="…"}`, `{$var}`; `tag` = taguri cu spațiu de nume (`<x:if is="…">`), `{{ phrase('…') }}`. */
export type GcsPortTemplateSyntax = "brace" | "tag";
export type GcsPortTemplate = {
  /** Numele unic în sursă (`front/browse/index`, `public:my_page`). */
  name: string;
  area: "site" | "acp" | "email" | "other";
  syntax: GcsPortTemplateSyntax;
  /** Parametrii declarați (`$items, $title`), fără `$`. */
  params: string[];
  body: string;
  origin: string;
};

export type GcsPortStyle = { name: string; body: string; origin: string; syntax: GcsPortTemplateSyntax | "css" };

export type GcsPortTask = { key: string; everyMinutes: number; origin: string };
export type GcsPortWidget = { key: string; labelPhrase?: string; origin: string };

export type GcsPortCodeKind =
  | "controller"
  | "acp_controller"
  | "api_controller"
  | "model"
  | "service"
  | "extension"
  | "hook"
  | "listener"
  | "setup"
  | "task"
  | "widget"
  | "settings_form"
  | "javascript"
  | "other";

export type GcsPortCodeFile = { path: string; kind: GcsPortCodeKind; lines: number };

/** Un avertisment al citirii sau conversiei; `code` e cheia de traducere (`porting.notes.<code>`). */
export type GcsPortNote = { code: string; params?: Record<string, string> };

export type GcsPortLicense = { spdx: string | null; gpl: boolean; files: string[] };

export type GcsPortSource = {
  format: GcsPortFormat;
  meta: GcsPortMeta;
  settings: GcsPortSetting[];
  permissions: GcsPortPermission[];
  routes: GcsPortRoute[];
  menus: GcsPortMenu[];
  /** Frazele sursei: cheie → text (în limba sursei, de obicei engleza). */
  phrases: Map<string, string>;
  tables: GcsPortTable[];
  templates: GcsPortTemplate[];
  styles: GcsPortStyle[];
  tasks: GcsPortTask[];
  widgets: GcsPortWidget[];
  code: GcsPortCodeFile[];
  /** Legătura controller → șablonul randat (găsită în PHP, ca text). */
  views: Map<string, string>;
  /** Toate fișierele sursei (calea din arhivă → conținut), copiate în `ORIGINAL/`. */
  files: Map<string, Buffer>;
  license: GcsPortLicense;
  notes: GcsPortNote[];
};

/** Analiza de dinaintea confirmării: doar metadatele și numerele, fără cod. */
export type GcsPortAnalysis = {
  format: GcsPortFormat;
  meta: GcsPortMeta;
  license: GcsPortLicense;
  suggestedKey: string;
  counts: {
    files: number;
    settings: number;
    permissions: number;
    routes: number;
    phrases: number;
    tables: number;
    templates: number;
    styles: number;
    tasks: number;
    widgets: number;
    php: number;
    javascript: number;
  };
  notes: GcsPortNote[];
};

export const GCS_PORT_AREAS = ["manifest", "settings", "permissions", "routes", "phrases", "schema", "templates", "styles", "tasks", "widgets", "code", "javascript"] as const;
export type GcsPortArea = (typeof GCS_PORT_AREAS)[number];

export type GcsPortManualItem = { path: string; kind: GcsPortCodeKind; lines: number; suggestion: string };

/** Raportul conversiei (păstrat ca JSON, afișat în ACP și scris în `PORTING.md`). */
export type GcsPortReport = {
  format: GcsPortFormat;
  source: GcsPortMeta;
  plugin: { key: string; name: string; version: string; fileName: string };
  rights: { basis: GcsPortRightsBasis; confirmedAt: string } | null;
  license: GcsPortLicense;
  /** Procentul estimat al muncii făcute automat (0–100). */
  automatedPercent: number;
  areas: { area: GcsPortArea; auto: number; manual: number }[];
  manual: GcsPortManualItem[];
  /** Locurile `TODO(portare)` din `server.mjs`. */
  todos: number;
  notes: GcsPortNote[];
  /** Verificările pachetului generat (aceleași ca la instalare). */
  validation: { ok: boolean; checks: { code: string; level: "ok" | "warn" | "error"; params?: Record<string, string> }[] };
};
