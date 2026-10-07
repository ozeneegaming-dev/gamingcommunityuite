/**
 * Accesul membrilor (planul VIP, modul de test) și publicarea aspectului în GCS. Aspectul se republică la salvare, la
 * acordarea / retragerea / expirarea VIP-ului, după schimbările din catalog și periodic (jobul `reconcile`).
 */
import type { GcsPluginContext, GcsPluginVipPlan } from "../../../src/index";
import { catalogOf, toAppearance, type Catalog } from "./loadout";
import type { Access } from "./model";
import { getLoadout, listItems, listLoadouts, markMissingMedia } from "./store";

/** Planurile VIP (cache scurt în fir: se schimbă rar). */
let plansCache: { at: number; plans: GcsPluginVipPlan[] } | null = null;
export async function vipPlans(ctx: GcsPluginContext): Promise<GcsPluginVipPlan[]> {
  if (plansCache && Date.now() - plansCache.at < 60_000) return plansCache.plans;
  const plans = await ctx.api.vip.plans();
  plansCache = { at: Date.now(), plans };
  return plans;
}

/** Accesul unui user: abonamentul VIP activ și, pentru vizitatorul curent, dreptul de test. */
export async function accessOf(ctx: GcsPluginContext, userId: string, opts: { viewer: boolean; testMode?: boolean }): Promise<Access> {
  const [status] = await ctx.api.vip.status([userId]);
  const testAll = opts.viewer ? await ctx.permissions.can("test_all") : opts.testMode === true;
  return { vip: Boolean(status?.plan), plan: status?.plan ?? null, planName: status?.planName ?? null, testAll };
}

/** Catalogul curent, cu fișierele lipsă marcate ca retrase. */
export async function loadCatalog(ctx: GcsPluginContext): Promise<Catalog> {
  return catalogOf(await markMissingMedia(ctx, await listItems(ctx)));
}

/** Publică (sau șterge) aspectul unui membru după echipamentul salvat, catalog și plan. */
export async function publishFor(ctx: GcsPluginContext, userId: string, opts: { catalog?: Catalog; access?: Access } = {}): Promise<boolean> {
  const saved = await getLoadout(ctx, userId);
  if (!saved) {
    await ctx.members.appearance.set(userId, null);
    return false;
  }
  const catalog = opts.catalog ?? (await loadCatalog(ctx));
  const access = opts.access ?? (await accessOf(ctx, userId, { viewer: false, testMode: saved.testMode }));
  const appearance = toAppearance(saved.loadout, catalog, access);
  try {
    await ctx.members.appearance.set(userId, appearance);
  } catch (error) {
    // Un user șters între timp: echipamentul lui nu mai are unde apărea.
    if (String((error as Error).message).includes("not_found")) return false;
    throw error;
  }
  return appearance !== null;
}

/** Republică echipamentele (toate sau ale unor useri), pe loturi. */
export async function republish(ctx: GcsPluginContext, userIds?: string[]): Promise<number> {
  const catalog = await loadCatalog(ctx);
  let count = 0;
  if (userIds) {
    for (const id of userIds) if (await publishFor(ctx, id, { catalog })) count++;
    return count;
  }
  for (let offset = 0; ; offset += 200) {
    const page = await listLoadouts(ctx, { limit: 200, offset });
    for (const l of page) if (await publishFor(ctx, l.userId, { catalog })) count++;
    if (page.length < 200) break;
  }
  return count;
}
