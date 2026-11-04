import { createHash } from "node:crypto";
import { licenseActivationServer } from "./license";

/**
 * Marketplace-ul GCS (ACP › Sistem › Marketplace): catalogul vine de la Data Center (aplicații premium, pluginuri, teme,
 * widget-uri…), cumpărarea se face pe pagina de plată a Data Center-ului (Stripe sau confirmare manuală), iar ce a
 * cumpărat licența se activează de aici:
 *
 * - o **aplicație premium** intră în tokenul GCS1 al licenței: Data Center-ul trimite tokenul nou, verificat offline
 *   înainte de păstrare (vezi `GcsLicenseOnline`), apoi aplicația se pornește din ACP › Aplicații;
 * - un **pachet** (.zip semnat) se descarcă de la Data Center și trece prin instalatorul de pluginuri (semnătura,
 *   permisiunile, confirmarea).
 *
 * Toate cererile pleacă de pe server (`POST <server>/api/marketplace/*`) cu tokenul licenței și domeniul instalării;
 * browserul adminului vede doar datele publice ale catalogului (imaginile vin direct de la Data Center).
 */

export type GcsMarketKind = "app" | "package";

export type GcsMarketOrder = { id: string; status: "pending" | "paid" | "cancelled" | "refunded"; checkoutUrl: string };

export type GcsMarketItem = {
  id: number;
  slug: string;
  category: string;
  kind: GcsMarketKind;
  /** Cheia aplicației premium (`servers`, `chat_pro`…) sau a pachetului (`gcs.vip_studio`). */
  key: string | null;
  name: string;
  short: string;
  description: string;
  changelog: string;
  vendor: string;
  official: boolean;
  version: string | null;
  minGcs: string | null;
  price: { cents: number; currency: string };
  icon: string | null;
  cover: string | null;
  screenshots: string[];
  package: { size: number; sha256: string } | null;
  featured: boolean;
  updatedAt: string | null;
  /** Licența îl are (cumpărat, gratuit, dat de mână sau, pentru o aplicație, inclus în plan). */
  owned: boolean;
  /** Aplicație premium inclusă în planul licenței. */
  included: boolean;
  /** O comandă neplătită (pagina de plată). */
  order: GcsMarketOrder | null;
};

export type GcsMarketError =
  | "licence_missing"
  | "licence_unmanaged"
  | "licence_invalid"
  | "licence_inactive"
  | "domain"
  | "not_found"
  | "not_owned"
  | "no_package"
  | "rate_limited"
  | "bad_package"
  | "unreachable"
  | "disabled";

const ERRORS: readonly string[] = ["licence_unmanaged", "licence_invalid", "licence_inactive", "domain", "not_found", "not_owned", "no_package", "rate_limited"];

export type GcsMarketCatalog = {
  items: GcsMarketItem[];
  categories: Record<string, string>;
  /** Plata cu cardul (Stripe) e deschisă la Data Center; altfel comenzile se confirmă de mână. */
  card: boolean;
  /** Un token mai nou al licenței (ex. o aplicație cumpărată între timp), de verificat offline înainte de păstrare. */
  token?: string;
};

export type GcsMarketResult<T> = ({ ok: true } & T) | { ok: false; error: GcsMarketError };

type Opts = { token: string; domain: string; server?: string; fetch?: typeof fetch; timeoutMs?: number };

const str = (v: unknown, max = 20_000): string => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown, max = 200): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
/** Doar adrese https (imaginile catalogului): nimic `javascript:`, `data:` sau http în pagina ACP. */
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const url = new URL(v);
    // Forma normalizată (ghilimelele și spațiile codate): sigură și în `url("…")` din CSS.
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

function parseOrder(v: unknown): GcsMarketOrder | null {
  const o = v as Partial<GcsMarketOrder> | null;
  if (!o || typeof o.id !== "string" || !/^[a-f0-9]{32}$/.test(o.id)) return null;
  const checkoutUrl = httpsUrl(o.checkoutUrl);
  if (!checkoutUrl) return null;
  const status = (["pending", "paid", "cancelled", "refunded"] as const).find((s) => s === o.status) ?? "pending";
  return { id: o.id, status, checkoutUrl };
}

/** Un element din răspunsul Data Center-ului, cu tipurile verificate (câmpurile greșite cad pe valori sigure). */
export function parseMarketItem(v: unknown): GcsMarketItem | null {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m.id !== "number" || !Number.isInteger(m.id) || typeof m.name !== "string") return null;
  const kind: GcsMarketKind = m.kind === "app" ? "app" : "package";
  const price = m.price as { cents?: unknown; currency?: unknown } | null;
  const cents = typeof price?.cents === "number" && Number.isInteger(price.cents) && price.cents >= 0 ? price.cents : 0;
  const currency = typeof price?.currency === "string" && /^[A-Z]{3}$/.test(price.currency) ? price.currency : "EUR";
  const pkg = m.package as { size?: unknown; sha256?: unknown } | null;
  return {
    id: m.id,
    slug: str(m.slug, 64),
    category: str(m.category, 32) || "plugin",
    kind,
    key: strOrNull(m.key, 64),
    name: str(m.name, 128),
    short: str(m.short, 255),
    description: str(m.description),
    changelog: str(m.changelog),
    vendor: str(m.vendor, 128),
    official: m.official === true,
    version: strOrNull(m.version, 32),
    minGcs: strOrNull(m.minGcs, 32),
    price: { cents, currency },
    icon: httpsUrl(m.icon),
    cover: httpsUrl(m.cover),
    screenshots: Array.isArray(m.screenshots) ? m.screenshots.map(httpsUrl).filter((u): u is string => u !== null).slice(0, 8) : [],
    package: pkg && typeof pkg.size === "number" && typeof pkg.sha256 === "string" && /^[a-f0-9]{64}$/.test(pkg.sha256) ? { size: pkg.size, sha256: pkg.sha256 } : null,
    featured: m.featured === true,
    updatedAt: strOrNull(m.updatedAt, 40),
    owned: m.owned === true,
    included: m.included === true,
    order: parseOrder(m.order),
  };
}

async function post(path: string, body: Record<string, unknown>, opts: Opts): Promise<{ res: Response } | { error: GcsMarketError }> {
  const server = (opts.server ?? licenseActivationServer()).trim();
  if (!server) return { error: "disabled" };
  try {
    const res = await (opts.fetch ?? fetch)(new URL(path, server), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: opts.token, domain: opts.domain, ...body }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      redirect: "error",
    });
    return { res };
  } catch {
    return { error: "unreachable" };
  }
}

async function json(path: string, body: Record<string, unknown>, opts: Opts): Promise<Record<string, unknown> | { error: GcsMarketError }> {
  const sent = await post(path, body, opts);
  if ("error" in sent) return sent;
  if (!sent.res.ok) return { error: "unreachable" };
  const data = (await sent.res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return { error: "unreachable" };
  if (data.ok === false) return { error: typeof data.error === "string" && ERRORS.includes(data.error) ? (data.error as GcsMarketError) : "unreachable" };
  if (data.ok !== true) return { error: "unreachable" };
  return data;
}

const freshToken = (data: Record<string, unknown>) => (typeof data.token === "string" && data.token.startsWith("GCS1.") ? { token: data.token } : {});

/** Catalogul pentru licența instalării. */
export async function fetchMarketCatalog(opts: Opts): Promise<GcsMarketResult<GcsMarketCatalog>> {
  const data = await json("/api/marketplace/catalog", {}, opts);
  if ("error" in data) return { ok: false, error: data.error as GcsMarketError };
  const items = Array.isArray(data.items) ? data.items.map(parseMarketItem).filter((i): i is GcsMarketItem => i !== null) : [];
  const categories: Record<string, string> = {};
  if (data.categories && typeof data.categories === "object") {
    for (const [k, v] of Object.entries(data.categories as Record<string, unknown>)) if (/^[a-z_]{1,32}$/.test(k) && typeof v === "string") categories[k] = v.slice(0, 64);
  }
  const payments = data.payments as { card?: unknown } | null;
  return { ok: true, items, categories, card: payments?.card === true, ...freshToken(data) };
}

export type GcsMarketOrderResult = { status: "owned" | "paid" | "pending"; order?: GcsMarketOrder; token?: string };

/** O comandă: `owned` (o are deja), `paid` (gratuit, dat pe loc) sau `pending` cu pagina de plată. */
export async function placeMarketOrder(itemId: number, opts: Opts): Promise<GcsMarketResult<GcsMarketOrderResult>> {
  const data = await json("/api/marketplace/order", { item: itemId }, opts);
  if ("error" in data) return { ok: false, error: data.error as GcsMarketError };
  const status = data.status === "owned" || data.status === "paid" ? data.status : "pending";
  const order = parseOrder(data.order);
  if (status === "pending" && !order) return { ok: false, error: "unreachable" };
  return { ok: true, status, ...(order ? { order } : {}), ...freshToken(data) };
}

/** Starea unei comenzi (după plată, cu tokenul nou al licenței pentru o aplicație premium). */
export async function fetchMarketOrderStatus(orderId: string, opts: Opts): Promise<GcsMarketResult<{ status: GcsMarketOrder["status"]; token?: string }>> {
  if (!/^[a-f0-9]{32}$/.test(orderId)) return { ok: false, error: "not_found" };
  const data = await json("/api/marketplace/order-status", { order: orderId }, opts);
  if ("error" in data) return { ok: false, error: data.error as GcsMarketError };
  const status = (["pending", "paid", "cancelled", "refunded"] as const).find((s) => s === data.status) ?? "pending";
  return { ok: true, status, ...freshToken(data) };
}

/** Cel mai mare pachet primit (Data Center-ul primește cel mult 64 MB). */
export const GCS_MARKET_MAX_PACKAGE = 64 * 1024 * 1024;

/**
 * Pachetul unui element (.zip). Amprenta sha256 trebuie să fie cea din catalog (`expectedSha256`): un fișier schimbat pe
 * drum nu ajunge la instalator. Semnătura pachetului o verifică apoi instalatorul de pluginuri.
 */
export async function downloadMarketPackage(itemId: number, expectedSha256: string, opts: Opts): Promise<GcsMarketResult<{ data: Buffer }>> {
  const sent = await post("/api/marketplace/download", { item: itemId }, { ...opts, timeoutMs: opts.timeoutMs ?? 120_000 });
  if ("error" in sent) return { ok: false, error: sent.error };
  const { res } = sent;
  if (!res.ok) return { ok: false, error: "unreachable" };
  if (!(res.headers.get("content-type") ?? "").startsWith("application/zip")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, error: typeof data?.error === "string" && ERRORS.includes(data.error) ? (data.error as GcsMarketError) : "unreachable" };
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > GCS_MARKET_MAX_PACKAGE) return { ok: false, error: "bad_package" };
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > GCS_MARKET_MAX_PACKAGE) return { ok: false, error: "bad_package" };
  if (createHash("sha256").update(data).digest("hex") !== expectedSha256) return { ok: false, error: "bad_package" };
  return { ok: true, data };
}
