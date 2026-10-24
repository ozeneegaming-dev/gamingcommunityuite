import { isSafeHref, type GcsActor, type GcsModuleRegistry, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import { type PrismaClient, jsonInts } from "@gcs/db";
import { forumContainer } from "../forums/posting";
import type { GcsVipService } from "./vip";

/** Un beneficiu calculat: un drept de grup unde planul are mai mult decât un membru obișnuit. */
export type GcsVipBenefit = { key: string; labelKey: string; value: true | number };

/** Un plan VIP (un grup VIP), cu ce primești și unde duce butonul. */
export type GcsVipPlan = {
  groupId: number;
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  benefits: GcsVipBenefit[];
  /** Forumurile la care planul are acces în plus (doar cele pe care viewer-ul le vede). */
  forums: { id: number; name: string; slug: string }[];
  /** Stilurile de nume și ramele de avatar disponibile doar planului (nu tuturor grupurilor). */
  nameStyles: number;
  frames: number;
  /** `contact`: „Contactează staff-ul”; `checkout`: linkul de plată (când există magazinul). */
  action: { kind: "contact" | "checkout"; href: string };
};

export type GcsVipMine = { groupId: number; key: string; name: string; expiresAt: string | null };

/**
 * Cârligul pentru plăți: întoarce linkul de checkout al unui plan sau `null` (fără magazin, butonul rămâne
 * „Contactează staff-ul”). Magazinul (etapa lui) îl va furniza la crearea serviciilor.
 */
export type GcsVipCheckout = (plan: { groupId: number; key: string }, viewer: GcsActor) => Promise<string | null>;

export const VIP_CONTACT_SETTING = "vip.contact_url";
export const VIP_INTRO_SETTING = "vip.page_intro";
/** Linkul implicit al butonului: pagina staff-ului. */
export const VIP_DEFAULT_CONTACT = "/staff";
const BASE_GROUP = "member";

/**
 * Pagina publică VIP (`/vip`): planurile sunt grupurile VIP (ordinea din ACP); beneficiile se calculează din drepturile
 * de grup față de grupul Membru (booleene acordate, limite mai bune după regula de îmbinare: `-1` = nelimitat, `merge:
 * "min"` = mai puțin e mai bine), din forumurile citibile în plus și din cosmeticele exclusive.
 */
export class GcsVipPublic {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      registry: GcsModuleRegistry;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      vip: Pick<GcsVipService, "active">;
      checkout?: GcsVipCheckout | null;
    },
  ) {}

  /** Linkul butonului „Contactează staff-ul” (setarea din ACP → VIP → Pagina VIP; gol = pagina staff-ului). */
  async contactHref(): Promise<string> {
    const raw = await this.deps.settings.get<string>(VIP_CONTACT_SETTING);
    return raw && isSafeHref(raw) ? raw : VIP_DEFAULT_CONTACT;
  }

  async plans(viewer: GcsActor): Promise<GcsVipPlan[]> {
    const { db, registry, permissions, checkout } = this.deps;
    const [tiers, base] = await Promise.all([
      db.group.findMany({ where: { isVip: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, color: true, icon: true } }),
      db.group.findUnique({ where: { key: BASE_GROUP }, select: { id: true } }),
    ]);
    if (tiers.length === 0) return [];
    const groupIds = [...tiers.map((t) => t.id), ...(base ? [base.id] : [])];
    const [settings, styles, frames, forums, contact] = await Promise.all([
      db.groupSetting.findMany({ where: { groupId: { in: groupIds } }, select: { groupId: true, key: true, value: true } }),
      db.nameStyle.findMany({ where: { allGroups: false }, select: { groupIds: true } }),
      db.avatarFrame.findMany({ where: { allGroups: false }, select: { groupIds: true } }),
      db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, slug: true } }),
      this.contactHref(),
    ]);
    const value = (groupId: number | undefined, key: string) => settings.find((s) => s.groupId === groupId && s.key === key)?.value;
    const defs = registry.permissionDefs().filter((d) => d.scope === "group");
    const refs = forums.map((f) => forumContainer(f.id));
    const asGroup = (id: number): GcsActor => ({ userId: null, groupIds: [id], primaryGroupId: id, isBanned: false, ip: "" });
    const [baseReadable, viewable] = await Promise.all([
      base ? permissions.filterContainers(asGroup(base.id), "forums.read", refs) : Promise.resolve(new Set<string>()),
      permissions.filterContainers(viewer, "forums.view", refs),
    ]);

    return Promise.all(
      tiers.map(async (tier): Promise<GcsVipPlan> => {
        const benefits: GcsVipBenefit[] = [];
        for (const def of defs) {
          const mine = value(tier.id, def.key);
          const theirs = value(base?.id, def.key);
          if (mine === true && theirs !== true) benefits.push({ key: def.key, labelKey: def.labelKey, value: true });
          else if (typeof mine === "number" && isBetter(mine, typeof theirs === "number" ? theirs : null, def.merge)) benefits.push({ key: def.key, labelKey: def.labelKey, value: mine });
        }
        // Întâi drepturile noi (ce poți face în plus), apoi limitele mai bune; în rest, ordinea din module.
        benefits.sort((a, b) => Number(b.value === true) - Number(a.value === true));
        const readable = await permissions.filterContainers(asGroup(tier.id), "forums.read", refs);
        const href = checkout ? await checkout({ groupId: tier.id, key: tier.key }, viewer) : null;
        return {
          groupId: tier.id,
          key: tier.key,
          name: tier.name,
          color: tier.color,
          icon: tier.icon,
          benefits,
          forums: forums.filter((f) => readable.has(String(f.id)) && !baseReadable.has(String(f.id)) && viewable.has(String(f.id))),
          nameStyles: styles.filter((s) => jsonInts(s.groupIds).includes(tier.id)).length,
          frames: frames.filter((f) => jsonInts(f.groupIds).includes(tier.id)).length,
          action: href ? { kind: "checkout", href } : { kind: "contact", href: contact },
        };
      }),
    );
  }

  /** Planul activ al viewer-ului și expirarea lui (`null` = fără VIP sau vizitator). */
  async mine(viewer: GcsActor): Promise<GcsVipMine | null> {
    if (!viewer.userId) return null;
    const sub = await this.deps.vip.active(viewer.userId);
    if (!sub) return null;
    const group = await this.deps.db.group.findUnique({ where: { id: sub.groupId }, select: { id: true, key: true, name: true } });
    return group ? { groupId: group.id, key: group.key, name: group.name, expiresAt: sub.expiresAt?.toISOString() ?? null } : null;
  }
}

/** O limită numerică e mai bună decât a grupului de bază: `-1` = nelimitat; `merge: "min"` = mai puțin e mai bine. */
function isBetter(mine: number, theirs: number | null, merge: "max" | "min" | undefined): boolean {
  if (merge === "min") return theirs === null || mine < theirs;
  if (mine === -1) return theirs !== -1;
  if (theirs === -1) return false;
  return theirs === null ? mine > 0 : mine > theirs;
}
