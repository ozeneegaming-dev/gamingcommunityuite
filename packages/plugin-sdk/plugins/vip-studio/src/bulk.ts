/**
 * Încărcarea în bloc din ACP („Încarcă de pe calculator”): mai multe rame, arme sau fundaluri de card odată, într-un
 * formular obișnuit (`multiple`, fără JS). GCS verifică și recodează fiecare fișier (APNG / GIF rămân animate), iar
 * pluginul: aplică regulile tipului (proporții, mărimi), sare peste duplicate (același SHA-256 ca un element existent
 * sau ca alt fișier din lot), creează elementele cu categoria, planurile și setările comune și păstrează raportul
 * (adăugate / omise / respinse, cu motivul) pentru pagina de rezultat.
 */
import type { GcsPluginApiResponse, GcsPluginContext } from "../../../src/index";
import { back, checked, checkUpload, fileOf, intOf, str, type Body } from "./acpActions";
import { BULK_KINDS, itemKeyFrom, nameFromFile, numberIn, parseItemData, PLAN_KEY, type BulkKind, type FrameData, type Kind } from "./model";
import { vipPlans } from "./publish";
import { audit, createItem, listCategories, listItems } from "./store";
import { ACP_BASE, KIND_ROUTES } from "./views/acp";

/** Câte fișiere primește un lot (limita GCS pentru formularele ACP). */
export const BULK_MAX_FILES = 50;
/** Cât ține raportul unui lot (pagina de rezultat). */
const REPORT_TTL = 86_400;

export type BulkReport = {
  kind: BulkKind;
  added: { id: number; name: string; file: string; frames: number; width: number | null; height: number | null }[];
  skipped: { file: string; duplicateOf: string }[];
  rejected: { file: string; reason: string; params?: Record<string, string> }[];
  at: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const fileName = (o: Record<string, unknown> | null) => (o && typeof o.originalName === "string" && o.originalName.trim() ? o.originalName.slice(0, 120) : "—");

/** Raportul unui lot, după id-ul din adresă (`null` = expirat sau inexistent). */
export async function bulkReport(ctx: GcsPluginContext, token: string): Promise<BulkReport | null> {
  if (!/^[a-z0-9]{12,40}$/.test(token)) return null;
  return ctx.cache.get<BulkReport>(`bulk:${token}`);
}

/** Datele unui element nou din fișierul lui și setările comune ale lotului. */
function dataFor(kind: BulkKind, url: string, hash: string | undefined, body: Body): Record<string, unknown> {
  if (kind === "frame") {
    const d: Partial<FrameData> = { image: url, scale: numberIn(str(body.scale), 100, 160, 130), x: numberIn(str(body.x), -20, 20, 0), y: numberIn(str(body.y), -20, 20, 0) };
    return { ...d, hash };
  }
  if (kind === "weapon") return { icon: url, hash };
  return { image: url, hash };
}

/** POST `/acp/bulk`: lotul de fișiere al unui catalog. Răspunsul duce la pagina de rezultat. */
export async function bulkUpload(ctx: GcsPluginContext, body: Body): Promise<GcsPluginApiResponse> {
  const kind = str(body.kind) as BulkKind;
  if (!(BULK_KINDS as readonly string[]).includes(kind)) return back("", { error: "invalid" });
  const listPath = KIND_ROUTES[kind as Kind];
  const files = (Array.isArray(body.files) ? body.files : body.files ? [body.files] : []).filter((f) => f && typeof f === "object") as Record<string, unknown>[];
  if (files.length === 0) return back(listPath, { error: "no_files" });

  const known = new Set((await vipPlans(ctx)).map((p) => p.key));
  const plans = (Array.isArray(body.plans) ? body.plans : body.plans ? [body.plans] : []).filter((p): p is string => typeof p === "string" && PLAN_KEY.test(p) && known.has(p));
  const categoryId = intOf(body.categoryId);
  const category = categoryId !== null && (await listCategories(ctx, kind)).some((c) => c.id === categoryId) ? categoryId : null;
  const enabled = body.enabled === undefined ? true : checked(body.enabled);

  const existing = await listItems(ctx, kind);
  const hashes = new Map<string, string>();
  for (const item of existing) {
    const h = (item.data as { hash?: string }).hash;
    if (h) hashes.set(h, item.name);
  }
  const report: BulkReport = { kind, added: [], skipped: [], rejected: [], at: new Date().toISOString() };
  const drop: string[] = [];
  let counter = existing.length;

  for (const f of files.slice(0, BULK_MAX_FILES + 5)) {
    const file = fileName(f);
    const { info, error } = fileOf(f);
    if (error || !info) {
      const params = Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "error" && k !== "originalName" && typeof v === "string")) as Record<string, string>;
      report.rejected.push({ file, reason: error ?? "unsupported_type", ...(Object.keys(params).length ? { params } : {}) });
      continue;
    }
    const problem = checkUpload(kind, info, null);
    if (problem) {
      report.rejected.push({ file, reason: problem });
      drop.push(info.id);
      continue;
    }
    const hash = typeof info.sha256 === "string" && SHA256.test(info.sha256) ? info.sha256 : undefined;
    const duplicate = hash ? hashes.get(hash) : undefined;
    if (duplicate) {
      report.skipped.push({ file, duplicateOf: duplicate });
      drop.push(info.id);
      continue;
    }
    const name = nameFromFile(info.originalName ?? (file === "—" ? undefined : file), `${ctx.t(`acp.bulk.defaultName.${kind}`)} ${++counter}`);
    const parsed = parseItemData(kind, dataFor(kind, info.url, hash, body));
    if (!parsed.ok) {
      report.rejected.push({ file, reason: "invalid_field" });
      drop.push(info.id);
      continue;
    }
    await ctx.media.keep([info.id]);
    const id = await createItem(ctx, { kind, key: itemKeyFrom(name, Math.random().toString(36).slice(2, 7)), name, categoryId: category, data: parsed.data, plans, enabled, retired: false });
    if (hash) hashes.set(hash, name);
    report.added.push({ id, name, file, frames: info.frames ?? 1, width: info.width, height: info.height });
  }
  if (drop.length) await ctx.media.delete(drop);
  await audit(ctx, "bulk_upload", `${kind}: +${report.added.length} =${report.skipped.length} ×${report.rejected.length}`);
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await ctx.cache.set(`bulk:${token}`, report, REPORT_TTL);
  return { redirect: `${ACP_BASE}/upload/${token}`, body: { ok: true, added: report.added.length, skipped: report.skipped.length, rejected: report.rejected.length } };
}
