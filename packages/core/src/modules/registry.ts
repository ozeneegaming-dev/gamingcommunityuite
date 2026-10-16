import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
import type { GcsRichFieldKey } from "../content/richFields";
import type { GcsEvent, GcsEventBus } from "../events";
import type { GcsSettingDef } from "../settings/registry";

/** Valorile `Group.key` (root_admin, member, vip_gold, custom_<id>…). */
export type GroupKey = string;

/**
 * O cheie de permisiune declarată de un modul (spec §6.2).
 * - `scope: "group"`: setare de grup globală (boolean sau număr);
 * - `scope: "container"`: acțiune în matricea pe container (`containerType` obligatoriu).
 *
 * `merge` spune care valoare numerică e cea mai permisivă când userul are mai multe grupuri:
 * `max` (implicit, ex. `upload.max_mb`) sau `min` (ex. `pm.flood_seconds`, unde mai puțin e mai permisiv).
 */
export interface GcsPermissionDef {
  key: string;
  scope: "group" | "container";
  containerType?: string;
  labelKey: string;
  default: Partial<Record<GroupKey, unknown>>;
  merge?: "max" | "min";
  /** Valoarea grupurilor fără o valoare implicită proprie în `default` (ex. grupurile create din ACP). */
  fallback?: unknown;
  /** Permisiunea de acces generată pentru aplicația cu această cheie de modul (`<app>.app_access`). */
  app?: string;
}

/** Cheia permisiunii de acces a unei aplicații („Poate accesa aplicația”), generată de registry. */
export const appAccessKey = (moduleKey: string) => `${moduleKey}.app_access`;

/**
 * Permisiunile unui modul, cu permisiunea de acces generată pentru aplicațiile care nu sunt blocate (specul
 * 2026-10-09-acp-navigatie-aplicatii §2.4): booleană, de grup, implicit `true` pentru orice grup.
 */
function modulePermissions(m: GcsModule): GcsPermissionDef[] {
  if (!m.app || m.app.locked) return m.permissions;
  const key = appAccessKey(m.key);
  if (m.permissions.some((p) => p.key === key)) return m.permissions;
  return [...m.permissions, { key, scope: "group", labelKey: "permissions.app_access", default: {}, fallback: true, app: m.key }];
}

export type GcsAcpApp = "system" | "community" | "members" | "vip" | "gaming" | "pages" | "stats" | "appearance";

/**
 * O zonă din bara de iconițe a ACP-ului (specul 2026-10-09-acp-navigatie-aplicatii §1.2). Dashboard-ul nu e o zonă: are
 * linkul lui, deasupra zonelor.
 */
export type GcsAcpArea = "system" | "community" | "members" | "appearance" | "gaming" | "vip" | "stats" | "apps";

/**
 * O intrare din meniul ACP. `section` e cheia folosită de rolurile ACP; `icon` e o iconiță Font Awesome Free
 * după nume (`fa-solid fa-users`), randată în submeniu, în căutare și în titlul paginii.
 *
 * `area` și `group` (opționale) mută intrarea în altă zonă sau sub alt titlu de grup decât ale secțiunii ei (ex.
 * statisticile unei aplicații, în zona Statistici). `alias`: o scurtătură spre o pagină care stă în altă zonă; nu
 * decide zona paginii curente.
 */
export interface GcsAcpMenuItem {
  key: string;
  labelKey: string;
  href: string;
  section: string;
  icon?: string;
  area?: GcsAcpArea;
  group?: string;
  alias?: boolean;
  /** Pagina unei aplicații opționale (cheia modulului): apare doar cu aplicația pornită și accesibilă adminului. */
  app?: string;
}

/**
 * O secțiune din meniul ACP (spec §12.1), cu iconița opțională a titlului. `title` (cheie de traducere) e titlul grupului
 * din coloana a doua a navigației; `group` îl înlocuiește, dacă e dat. `area` lipsă = zona aplicației (`app`).
 */
export interface GcsAcpMenuSection {
  app: GcsAcpApp;
  title: string;
  icon?: string;
  area?: GcsAcpArea;
  group?: string;
  items: GcsAcpMenuItem[];
}

/**
 * O secțiune de pe site a unei aplicații (ACP → Aplicații → ▸), cu permisiunea de grup care o controlează, dacă are una
 * (o permisiune booleană, de grup, a aplicației).
 */
export type GcsAppSection = { key: string; labelKey: string; icon: string; href: string; permission?: string };

/**
 * Pagina de pornire a site-ului pe care o poate da o aplicație (★ din ACP → Aplicații): `href` e pagina ei. `home`: aplicația
 * randează chiar `/` (Forumul), deci aleasă nu cere nicio rescriere; `href` e atunci adresa ei alternativă.
 */
export type GcsAppLanding = { href: string; home?: boolean };

/** Contextul primit de hook-ul `seed` al unui modul: tranzacția seed-ului și id-urile grupurilor implicite. */
export type GcsSeedContext = { tx: Prisma.TransactionClient; groupIds: ReadonlyMap<string, number> };

/** Contextul hook-ului `seedDemo`: datele alese în wizard (date demo sau site gol) și adminul creat. */
export type GcsDemoContext = {
  db: PrismaClient;
  cache: GcsCache;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  variant: "demo" | "empty";
  adminEmail: string;
};

/**
 * Un tip de notificare. `important` = emailul implicit e imediat (ex. mesaj privat). `countEach`: grupul numără fiecare
 * eveniment (mesaje, răspunsuri), nu doar actorii distincți (reacții, urmăritori).
 */
export type GcsNotificationTypeDef = {
  key: string;
  labelKey: string;
  important: boolean;
  defaultEmail: "OFF" | "INSTANT" | "DIGEST";
  countEach?: boolean;
};

/** Paginile cu zone de widget-uri și zonele lor (specul etapei 5). */
export const GCS_WIDGET_PAGES = ["index", "forum", "topic"] as const;
export type GcsWidgetPage = (typeof GCS_WIDGET_PAGES)[number];
export const GCS_WIDGET_ZONES = ["top", "bottom", "sidebar"] as const;
export type GcsWidgetZone = (typeof GCS_WIDGET_ZONES)[number];

/**
 * Un tip de widget declarat de un modul. Randarea e în web (după `key`); aici sunt doar metadatele și validarea
 * config-ului: `config(raw)` întoarce config-ul normalizat sau `null` dacă e invalid.
 */
export type GcsWidgetDef = {
  key: string;
  labelKey: string;
  /** O descriere scurtă (lista „Widget-uri disponibile” din „Editează pagina”). */
  descriptionKey?: string;
  icon: string;
  zones: readonly GcsWidgetZone[];
  pages?: readonly GcsWidgetPage[];
  defaultConfig: Record<string, unknown>;
  config: (raw: unknown) => Record<string, unknown> | null;
  /** Câmpurile formularului de configurare din „Editează pagina” (lipsă = widget fără setări). */
  fields?: readonly GcsWidgetField[];
};

/**
 * Un câmp de configurare al unui widget. `select` are opțiuni fixe sau, cu `optionsFrom`, opțiuni date de site
 * la editare (ex. `chat.channels`); valoarea goală înseamnă „implicit”.
 */
export type GcsWidgetField =
  | { key: string; labelKey: string; type: "number"; min: number; max: number }
  | { key: string; labelKey: string; type: "text" | "textarea"; maxLength: number }
  /**
   * Text formatat în editorul compact (specul `2026-10-07-editor-campuri`): valoarea e documentul editorului, validat
   * după profilul `profile` din `GCS_RICH_FIELDS`, sau un text vechi (afișat ca înainte); `maxLength` = caractere de text.
   */
  | { key: string; labelKey: string; type: "richtext"; maxLength: number; profile: GcsRichFieldKey }
  | { key: string; labelKey: string; type: "select"; options?: readonly { value: string; labelKey: string }[]; optionsFrom?: string };

/** Layout-ul implicit al paginilor, contribuit de module (seed; doar pe paginile fără widget-uri). */
export type GcsWidgetLayoutDefaults = Partial<Record<GcsWidgetPage, { zone: GcsWidgetZone; type: string; config?: Record<string, unknown> }[]>>;

/** O placă din panoul de statistici (ex. „Topicuri: 128”), contribuită de un modul. */
export type GcsStatTile = { key: string; labelKey: string; value: number; icon: string; href?: string; color?: string };
export type GcsStatsContext = { db: PrismaClient };

/**
 * Un subitem implicit (un singur nivel sub un item din meniul principal). `since` = marcajul versiunii de meniu care l-a
 * adus (ex. `nav:v6`); lipsă = a venit odată cu itemul părinte (vezi `GcsNavService.appendDefaultChildren`).
 */
export type GcsNavDefaultChild = { key: string; labelKey: string; icon: string; href: string; since?: string };
/** Un item implicit din meniul principal, declarat de un modul (cu subitemii lui, dacă are submeniu). */
export type GcsNavDefault = GcsNavDefaultChild & {
  position: number;
  children?: GcsNavDefaultChild[];
  /**
   * Marcajul versiunii de meniu care a adus itemul (ex. `nav:v3`); lipsă = în meniul implicit din `nav:v2`. Actualizarea
   * la marcajul respectiv recunoaște meniul nemodificat fără itemii lui (vezi `GcsNavService.upgradeDefaults`).
   */
  since?: string;
};

/**
 * Drepturile unui membru pe un container date de un modul, nu de grupuri (specul 2026-10-08-clanuri §5.2): ex. forumul
 * privat al unui clan, pentru membrii clanului. `actions` = cheile de permisiune pe container (ex. `forums.read`),
 * `powers` = puterile de moderare (ex. `hide`). Se adaugă la uniunea grupurilor; bannul și Root Admin rămân deasupra.
 */
export type GcsMemberGrant = { type: string; id: string; actions: string[]; powers: string[] };
export type GcsMemberGrantsContext = { db: PrismaClient; cache: GcsCache };

/** Un modul GamingCommunitySuite (spec §5). Restul câmpurilor din spec se adaugă în etapele care le folosesc. */
export interface GcsModule {
  key: string;
  /**
   * Permisiunile modulului. Pentru `scope: "container"`, `default` dă permisiunile unui container nou
   * creat la rădăcină (ex. un forum fără părinte): grupurile cu `true` primesc acțiunea.
   */
  permissions: GcsPermissionDef[];
  settings: GcsSettingDef[];
  acpMenu: GcsAcpMenuSection[];
  eventListeners: { event: string; handler: (e: GcsEvent) => Promise<void> }[];
  /** Datele implicite ale modulului, create la instalare. Trebuie să fie idempotent (rulat din nou, nu dublează nimic). */
  seed?: (ctx: GcsSeedContext) => Promise<void>;
  /** Tipurile de notificări ale modulului (etapa 4): cheie, etichetă, importanță și emailul implicit. */
  notificationTypes?: GcsNotificationTypeDef[];
  /** Conținutul de pornire ales în wizard (pasul „demo” al instalării). Idempotent. */
  seedDemo?: (ctx: GcsDemoContext) => Promise<void>;
  /**
   * O aplicație (ACP → Sistem → Aplicații). `optional`: se poate dezactiva de acolo (etapa 5); dezactivată, nu apare în
   * meniu, widget-uri sau statistici, iar paginile ei răspund cu 404. Pluginurile au `optional: false` (le pornește și
   * le oprește serviciul pluginurilor). Orice aplicație care nu e `locked` primește permisiunea de acces pe grup
   * (`appAccessKey`).
   */
  app?: {
    optional: boolean;
    labelKey: string;
    icon: string;
    /** Aplicațiile de bază (Nucleu, Forum): nu se opresc, nu se dezinstalează și nu au acces pe grup. */
    locked?: boolean;
    /** Descrierea scurtă (dialogul „Detalii” din ACP → Aplicații). */
    descriptionKey?: string;
    /** Prefixele căilor aplicației (pagini și API): grupurile fără acces primesc 404 (proxy-ul). */
    routes?: string[];
    /** Secțiunile de pe site (ACP → Aplicații → ▸). */
    sections?: GcsAppSection[];
    /** Pagina de pornire a site-ului pe care o poate da aplicația. */
    landing?: GcsAppLanding;
    /**
     * Aplicațiile de care depinde (cheile modulelor, ex. Chat Pro → `chat`): cu una dintre ele oprită, aplicația nu e
     * activă (meniu, widget-uri, pagini), iar pornirea ei cere întâi pornirea dependențelor.
     */
    requires?: string[];
    /** O aplicație premium (vândută separat; licențele vin în etapa 11). Doar o marcă în catalog, fără efect încă. */
    premium?: boolean;
    /** Pagina ACP cu setările aplicației (linkul „Setări” din ACP → Aplicații). */
    settingsHref?: string;
  };
  /** Tipurile de widget-uri ale modulului. */
  widgets?: GcsWidgetDef[];
  /** Widget-urile puse implicit pe pagini la instalare (în ordinea modulelor). */
  widgetLayout?: GcsWidgetLayoutDefaults;
  /** Plăcile modulului din panoul de statistici. */
  stats?: (ctx: GcsStatsContext) => Promise<GcsStatTile[]>;
  /** Itemii modulului din meniul principal implicit. */
  nav?: GcsNavDefault[];
  /**
   * Itemii modulului din meniul implicit anterior (lipsă = aceiași cu `nav`). Recunosc un meniu pe care adminul nu
   * l-a modificat, ca actualizarea meniului (marcajul `nav:v2`) să-l poată înlocui cu cel nou.
   */
  navPrevious?: GcsNavDefault[];
  /**
   * Drepturile date direct unui membru pe containere (vezi `GcsMemberGrant`). Rezultatul e cache-uit de
   * `GcsPermissionService` pe membru; modulul cheamă `invalidateMemberGrants` la orice schimbare care le afectează.
   */
  memberGrants?: (ctx: GcsMemberGrantsContext, userId: string) => Promise<GcsMemberGrant[]>;
}

export class GcsModuleRegistry {
  private readonly modules: GcsModule[] = [];
  private readonly settings = new Map<string, GcsSettingDef>();
  private readonly permissions = new Map<string, GcsPermissionDef>();
  private fingerprint: string | null = null;

  /** Înregistrează un modul. Aruncă eroare la o cheie duplicată de modul, setare sau permisiune. */
  register(m: GcsModule): void {
    if (this.modules.some((existing) => existing.key === m.key)) {
      throw new Error(`Modulul „${m.key}” e deja înregistrat`);
    }
    const permissions = modulePermissions(m);
    assertUnique(m.settings.map((s) => s.key), this.settings, "setarea");
    assertUnique(permissions.map((p) => p.key), this.permissions, "permisiunea");
    const widgetKeys = new Map(this.widgetDefs().map((w) => [w.def.key, w]));
    assertUnique((m.widgets ?? []).map((w) => w.key), widgetKeys, "widget-ul");

    this.modules.push(m);
    for (const s of m.settings) this.settings.set(s.key, s);
    for (const p of permissions) this.permissions.set(p.key, p);
    this.fingerprint = null;
  }

  /**
   * Scoate un modul înregistrat la rulare (pluginurile, etapa 6): setările, permisiunile, widget-urile și meniul lui
   * dispar din registry. Întoarce `false` dacă modulul nu era înregistrat.
   */
  unregister(key: string): boolean {
    const index = this.modules.findIndex((m) => m.key === key);
    if (index === -1) return false;
    const [m] = this.modules.splice(index, 1);
    for (const s of m!.settings) this.settings.delete(s.key);
    for (const p of modulePermissions(m!)) this.permissions.delete(p.key);
    this.fingerprint = null;
    return true;
  }

  /**
   * Amprenta permisiunilor declarate (chei + valori implicite). Intră în cheile de cache ale permisiunilor, ca procesele
   * cu alte module încărcate (ex. un plugin abia activat) să nu-și folosească una alteia valorile calculate.
   */
  permissionsFingerprint(): string {
    this.fingerprint ??= createHash("sha256")
      .update(JSON.stringify([...this.permissions.values()].map((p) => [p.key, p.scope, p.default, p.merge ?? null, p.fallback ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
      .digest("hex")
      .slice(0, 10);
    return this.fingerprint;
  }

  all(): GcsModule[] {
    return [...this.modules];
  }

  settingDefs(): GcsSettingDef[] {
    return [...this.settings.values()];
  }

  settingDef(key: string): GcsSettingDef | undefined {
    return this.settings.get(key);
  }

  permissionDefs(): GcsPermissionDef[] {
    return [...this.permissions.values()];
  }

  permissionDef(key: string): GcsPermissionDef | undefined {
    return this.permissions.get(key);
  }

  notificationTypes(): GcsNotificationTypeDef[] {
    return this.modules.flatMap((m) => m.notificationTypes ?? []);
  }

  notificationType(key: string): GcsNotificationTypeDef | undefined {
    return this.notificationTypes().find((t) => t.key === key);
  }

  acpMenu(): GcsAcpMenuSection[] {
    return this.modules.flatMap((m) => m.acpMenu);
  }

  /** Tipurile de widget-uri, cu modulul care le declară (cheile sunt unice). */
  widgetDefs(): { module: string; def: GcsWidgetDef }[] {
    return this.modules.flatMap((m) => (m.widgets ?? []).map((def) => ({ module: m.key, def })));
  }

  widgetDef(key: string): { module: string; def: GcsWidgetDef } | undefined {
    return this.widgetDefs().find((w) => w.def.key === key);
  }

  /** Modulul unei chei de aplicație (ex. `chat`). */
  module(key: string): GcsModule | undefined {
    return this.modules.find((m) => m.key === key);
  }
}

function assertUnique(keys: string[], existing: Map<string, unknown>, what: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (existing.has(key) || seen.has(key)) throw new Error(`Cheie duplicată: ${what} „${key}”`);
    seen.add(key);
  }
}
