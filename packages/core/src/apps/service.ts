import type { PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsNotFound } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export const APPS_ACP_SECTION = "system.applications";
const CACHE_KEY = "apps:enabled";
const CACHE_TAG = "apps";
const CACHE_TTL = 3600;

export type GcsAppView = { key: string; labelKey: string; icon: string; enabled: boolean };

/**
 * Aplicațiile opționale (specul etapei 5): modulele marcate `app.optional` se pot dezactiva din ACP. O aplicație
 * dezactivată nu apare în meniu, widget-uri sau statistici; paginile ei răspund cu 404 (`requireApp` în web).
 * Modulele care nu sunt aplicații opționale sunt mereu active.
 */
export class GcsAppService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; registry: GcsModuleRegistry; acp: GcsAcpRoleService }) {}

  private async disabled(): Promise<Set<string>> {
    const cached = await this.deps.cache.get<string[]>(CACHE_KEY);
    if (cached) return new Set(cached);
    const rows = await this.deps.db.app.findMany({ where: { enabled: false }, select: { key: true } });
    const keys = rows.map((r) => r.key);
    await this.deps.cache.set(CACHE_KEY, keys, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return new Set(keys);
  }

  /** O cheie de modul e activă dacă nu e o aplicație opțională dezactivată (un modul necunoscut e inactiv). */
  async enabled(key: string): Promise<boolean> {
    const m = this.deps.registry.module(key);
    if (!m) return false;
    if (!m.app?.optional) return true;
    return !(await this.disabled()).has(key);
  }

  /** Funcția de filtrare pentru mai multe chei (o singură citire). */
  async enabledFilter(): Promise<(key: string) => boolean> {
    const off = await this.disabled();
    return (key) => {
      const m = this.deps.registry.module(key);
      return Boolean(m) && (!m!.app?.optional || !off.has(key));
    };
  }

  async list(): Promise<GcsAppView[]> {
    const off = await this.disabled();
    return this.deps.registry
      .all()
      .filter((m) => m.app?.optional)
      .map((m) => ({ key: m.key, labelKey: m.app!.labelKey, icon: m.app!.icon, enabled: !off.has(m.key) }));
  }

  async setEnabled(actor: GcsActor, key: string, enabled: boolean): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, APPS_ACP_SECTION, "edit");
    const m = this.deps.registry.module(key);
    if (!m?.app?.optional) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.app.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
      await writeAudit(tx, { actorId: actor.userId, action: "app.toggle", targetType: "app", targetId: key, after: { enabled }, ip: actor.ip });
    });
    // Meniul, layout-urile și statisticile depind de aplicațiile active.
    await bus.emit({ name: "app.toggled", payload: { key, enabled }, tags: [CACHE_TAG, "nav", "layout", "stats"] });
  }
}
