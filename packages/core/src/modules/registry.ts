import type { Prisma } from "@gcs/db";
import type { GcsEvent } from "../events";
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

/** Un modul RED-LINE (spec §5). Restul câmpurilor din spec se adaugă în etapele care le folosesc. */
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

  acpMenu(): GcsAcpMenuSection[] {
    return this.modules.flatMap((m) => m.acpMenu);
  }
}

function assertUnique(keys: string[], existing: Map<string, unknown>, what: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (existing.has(key) || seen.has(key)) throw new Error(`Cheie duplicată: ${what} „${key}”`);
    seen.add(key);
  }
}
