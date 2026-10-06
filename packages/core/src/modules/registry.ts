import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
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
}

export type GcsAcpApp = "system" | "community" | "members" | "vip" | "gaming" | "pages" | "stats" | "appearance";

/** O secțiune din meniul ACP (spec §12.1). `section` din fiecare item e cheia folosită de rolurile ACP. */
export interface GcsAcpMenuSection {
  app: GcsAcpApp;
  title: string;
  items: { key: string; labelKey: string; href: string; section: string }[];
}

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
  | { key: string; labelKey: string; type: "select"; options?: readonly { value: string; labelKey: string }[]; optionsFrom?: string };

/** Layout-ul implicit al paginilor, contribuit de module (seed; doar pe paginile fără widget-uri). */
export type GcsWidgetLayoutDefaults = Partial<Record<GcsWidgetPage, { zone: GcsWidgetZone; type: string; config?: Record<string, unknown> }[]>>;

/** O placă din panoul de statistici (ex. „Topicuri: 128”), contribuită de un modul. */
export type GcsStatTile = { key: string; labelKey: string; value: number; icon: string; href?: string; color?: string };
export type GcsStatsContext = { db: PrismaClient };

/** Un item implicit din meniul principal, declarat de un modul. */
export type GcsNavDefault = { key: string; labelKey: string; icon: string; href: string; position: number };

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
   * Etapa 5: o aplicație opțională (se poate dezactiva din ACP → Sistem → Aplicații). Dezactivată, nu apare în meniu,
   * widget-uri sau statistici, iar paginile ei răspund cu 404.
   */
  app?: { optional: boolean; labelKey: string; icon: string };
  /** Tipurile de widget-uri ale modulului. */
  widgets?: GcsWidgetDef[];
  /** Widget-urile puse implicit pe pagini la instalare (în ordinea modulelor). */
  widgetLayout?: GcsWidgetLayoutDefaults;
  /** Plăcile modulului din panoul de statistici. */
  stats?: (ctx: GcsStatsContext) => Promise<GcsStatTile[]>;
  /** Itemii modulului din meniul principal implicit. */
  nav?: GcsNavDefault[];
}

export class GcsModuleRegistry {
  private readonly modules: GcsModule[] = [];
  private readonly settings = new Map<string, GcsSettingDef>();
  private readonly permissions = new Map<string, GcsPermissionDef>();

  /** Înregistrează un modul. Aruncă eroare la o cheie duplicată de modul, setare sau permisiune. */
  register(m: GcsModule): void {
    if (this.modules.some((existing) => existing.key === m.key)) {
      throw new Error(`Modulul „${m.key}” e deja înregistrat`);
    }
    assertUnique(m.settings.map((s) => s.key), this.settings, "setarea");
    assertUnique(m.permissions.map((p) => p.key), this.permissions, "permisiunea");
    const widgetKeys = new Map(this.widgetDefs().map((w) => [w.def.key, w]));
    assertUnique((m.widgets ?? []).map((w) => w.key), widgetKeys, "widget-ul");

    this.modules.push(m);
    for (const s of m.settings) this.settings.set(s.key, s);
    for (const p of m.permissions) this.permissions.set(p.key, p);
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
