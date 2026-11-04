import "server-only";
import {
  downloadMarketPackage,
  fetchMarketCatalog,
  fetchMarketOrderStatus,
  installDomain,
  placeMarketOrder,
  type GcsMarketCatalog,
  type GcsMarketError,
  type GcsMarketResult,
} from "@gcs/core";
import { installState } from "./install";
import { services } from "./services";

/** Secțiunea ACP a Marketplace-ului (ACP › Sistem › Marketplace). */
export const MARKETPLACE_SECTION = "system.marketplace";

/** Tokenul licenței și domeniul instalării, pentru cererile către Data Center. */
async function licence(): Promise<{ token: string; domain: string } | null> {
  const token = await installState().readLicense();
  return token ? { token, domain: installDomain() } : null;
}

/**
 * Un token mai nou trimis de Data Center (o aplicație premium cumpărată): păstrat după verificarea offline. Întoarce
 * `true` dacă licența s-a schimbat (aplicațiile se pot porni acum).
 */
async function adopt(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const changed = await services().licenseOnline.adopt(token).catch(() => false);
  if (changed) services().resetLicensedApps();
  return changed;
}

const missing = { ok: false as const, error: "licence_missing" as GcsMarketError };

/** Catalogul pentru licența acestei instalări. */
export async function marketCatalog(): Promise<GcsMarketResult<GcsMarketCatalog>> {
  const opts = await licence();
  if (!opts) return missing;
  const res = await fetchMarketCatalog(opts);
  if (res.ok) await adopt(res.token);
  return res;
}

export async function marketOrder(itemId: number) {
  const opts = await licence();
  if (!opts) return missing;
  const res = await placeMarketOrder(itemId, opts);
  if (res.ok) await adopt(res.token);
  return res;
}

export async function marketOrderStatus(orderId: string) {
  const opts = await licence();
  if (!opts) return missing;
  const res = await fetchMarketOrderStatus(orderId, opts);
  if (res.ok) await adopt(res.token);
  return res;
}

/** Pachetul unui element, cu amprenta luată din catalogul proaspăt (nu din browser). */
export async function marketPackage(itemId: number): Promise<GcsMarketResult<{ data: Buffer; slug: string }>> {
  const opts = await licence();
  if (!opts) return missing;
  const catalog = await fetchMarketCatalog(opts);
  if (!catalog.ok) return catalog;
  const item = catalog.items.find((i) => i.id === itemId);
  if (!item || !item.package) return { ok: false, error: "no_package" };
  if (!item.owned && item.price.cents > 0) return { ok: false, error: "not_owned" };
  const res = await downloadMarketPackage(itemId, item.package.sha256, opts);
  return res.ok ? { ok: true, data: res.data, slug: item.slug } : res;
}
