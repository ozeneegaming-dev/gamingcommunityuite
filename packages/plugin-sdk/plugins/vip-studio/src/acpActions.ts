/**
 * Acțiunile din ACP (rutele API marcate `acp`): salvarea unui element (cu fișierele încărcate), ordinea, activ /
 * retras, categoriile, presetările, resetarea echipamentelor și ștergerile. După fiecare schimbare care atinge membri,
 * aspectul lor se republică (pe loc pentru puțini, prin jobul `reconcile` pentru mulți).
 */
import type { GcsPluginApiResponse, GcsPluginContext, GcsPluginMediaInfo } from "../../../src/index";
import { ACP_BASE, KIND_ROUTES } from "./views/acp";
import { itemKeyFrom, KINDS, parseItemData, plainText, PLAN_KEY, VARIANT_KEYS, youtubeId, type Item, type Kind } from "./model";
import { publishFor, republish, vipPlans } from "./publish";
import {
  audit,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  deleteLoadout,
  getItem,
  getLoadout,
  insertPresets,
  listCategories,
  mediaInUse,
  moveItem,
  renameCategory,
  saveLoadout,
  setItemFlags,
  updateItem,
  usersOfItem,
} from "./store";

export type Body = Record<string, unknown>;
export const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
export const str = (v: unknown) => (typeof first(v) === "string" ? (first(v) as string) : "");
export const checked = (v: unknown) => ["1", "on", "true"].includes(str(v));
export const intOf = (v: unknown) => (/^-?\d{1,9}$/.test(str(v)) ? Number(str(v)) : null);

/** Răspunsul unui formular ACP: înapoi la pagină, cu mesajul (sau eroarea) în adresă. */
export const back = (path: string, params: Record<string, string>): GcsPluginApiResponse => {
  const q = new URLSearchParams(params).toString();
  return { redirect: `${ACP_BASE}${path}${q ? `?${q}` : ""}`, body: params.error ? { ok: false, error: params.error } : { ok: true }, status: params.error ? 422 : 200 };
};

/** Un fișier din formular: info-ul verificat de GCS sau eroarea lui. */
export function fileOf(v: unknown): { info: GcsPluginMediaInfo | null; error: string | null } {
  const f = first(v);
  if (!f || typeof f !== "object") return { info: null, error: null };
  const o = f as Record<string, unknown>;
  if (typeof o.error === "string") return { info: null, error: o.error };
  return typeof o.id === "string" && typeof o.url === "string" && typeof o.kind === "string" ? { info: o as unknown as GcsPluginMediaInfo, error: null } : { info: null, error: "unsupported_type" };
}

/** Șterge fișierele încărcate pe care nu le mai folosește nimic. */
export async function dropUnused(ctx: GcsPluginContext, ids: string[]): Promise<void> {
  const unused: string[] = [];
  for (const id of ids) if (!(await mediaInUse(ctx, id))) unused.push(id);
  if (unused.length) await ctx.media.delete(unused);
}

/** Republică echipamentele care folosesc un element (pe loc până la 40 de membri, altfel prin job). */
export async function republishUsersOf(ctx: GcsPluginContext, kind: Kind, key: string): Promise<void> {
  const users = await usersOfItem(ctx, kind, key);
  if (users.length === 0) return;
  if (users.length <= 40) await republish(ctx, users);
  else await ctx.jobs.enqueue("reconcile", {});
}

/** Datele unui element din câmpurile formularului (după tip), plus fișierele încărcate. */
function dataFromForm(kind: Kind, body: Body, previous: Item | null, files: { image?: GcsPluginMediaInfo | null; video?: GcsPluginMediaInfo | null }): Record<string, unknown> {
  const prev = (previous?.data ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "name_style": {
      const variants: { key: string; colors: string[]; glow?: string }[] = [];
      for (let i = 0; i < 10; i++) {
        const key = str(body[`variantKey${i}`]);
        const colors = str(body[`variantColors${i}`]).split(/[\s,]+/).filter(Boolean);
        if (!key || colors.length === 0) continue;
        const glow = str(body[`variantGlow${i}`]);
        variants.push({ key, colors, ...(glow ? { glow } : {}) });
      }
      return { effect: str(body.effect), variants, angle: str(body.angle), animation: "none", speed: str(body.speed), bold: checked(body.bold), italic: checked(body.italic) };
    }
    case "banner":
      return { fill: { colors: str(body.colors), angle: str(body.angle), animation: str(body.animation), speed: str(body.speed) }, text: str(body.text) };
    case "frame":
      return { image: files.image?.url ?? prev.image, scale: str(body.scale), x: str(body.x), y: str(body.y), hash: files.image ? files.image.sha256 : prev.hash };
    case "card":
      return { image: files.image?.url ?? prev.image, hash: files.image ? files.image.sha256 : prev.hash };
    case "weapon":
      return { icon: files.image?.url ?? prev.icon, hash: files.image ? files.image.sha256 : prev.hash };
    case "background": {
      const video = files.video?.url ?? (checked(body.removeVideo) ? undefined : prev.video);
      // Un poster nou înlocuiește și miniatura (cea din pachet era generată pentru imaginea veche).
      return { image: files.image?.url ?? prev.image, ...(files.image ? {} : prev.thumb ? { thumb: prev.thumb } : {}), ...(video ? { video } : {}) };
    }
    case "theme":
      return { accent: str(body.accent), accent2: str(body.accent2), surface: str(body.surface), glow: checked(body.glow) };
    case "song": {
      const yt = str(body.youtube).trim();
      return { title: str(body.title), artist: str(body.artist), audio: files.image?.kind === "audio" ? files.image.url : prev.audio, youtube: yt ? (youtubeId(yt) ?? yt) : "" };
    }
  }
}

/**
 * Verificările fișierelor după tipul elementului: tipul media, proporțiile ramei (aproape pătrată, ≥ 128 px), iconițele
 * armelor (și cele late, de linie: 110×30 merge, cel mult 8:1, latura lungă ≥ 24 px, cea scurtă ≥ 12 px), lățimea
 * fundalurilor (≥ 320 px).
 */
export function checkUpload(kind: Kind, image: GcsPluginMediaInfo | null, video: GcsPluginMediaInfo | null): string | null {
  if (image) {
    if (kind === "song") {
      if (image.kind !== "audio") return "unsupported_type";
    } else if (image.kind !== "image") return "unsupported_type";
    if (kind === "frame" && image.width && image.height) {
      const ratio = image.width / image.height;
      if (ratio < 0.8 || ratio > 1.25) return "frame_ratio";
      if (Math.min(image.width, image.height) < 128) return "frame_small";
    }
    if (kind === "weapon" && image.width && image.height) {
      const long = Math.max(image.width, image.height);
      const short = Math.min(image.width, image.height);
      if (long < 24 || short < 12) return "image_small";
      if (long / short > 8) return "weapon_ratio";
    }
    if ((kind === "card" || kind === "background") && image.width && image.width < 320) return "image_small";
  }
  if (video && video.kind !== "video") return "unsupported_type";
  return null;
}

/** Salvarea unui element (nou sau existent), din formularul ACP. */
export async function saveItemAction(ctx: GcsPluginContext, body: Body): Promise<GcsPluginApiResponse> {
  const kind = str(body.kind) as Kind;
  if (!(KINDS as readonly string[]).includes(kind)) return back("", { error: "invalid" });
  const id = intOf(body.id);
  const previous = id !== null ? await getItem(ctx, id) : null;
  if (id !== null && (!previous || previous.kind !== kind)) return back(KIND_ROUTES[kind], { error: "not_found" });
  const formPath = previous ? `/item/${previous.id}` : `/new/${kind}`;
  const image = fileOf(body.file);
  const video = fileOf(body.video);
  const uploaded = [image.info?.id, video.info?.id].filter((x): x is string => Boolean(x));
  const fail = async (error: string, field?: string) => {
    if (uploaded.length) await ctx.media.delete(uploaded);
    return back(formPath, { error, ...(field ? { field } : {}) });
  };
  if (image.error) return fail(`upload_${image.error}`.slice(0, 40));
  if (video.error) return fail(`upload_${video.error}`.slice(0, 40));
  const uploadProblem = checkUpload(kind, image.info, video.info);
  if (uploadProblem) return fail(uploadProblem);

  const name = plainText(first(body.name), 40);
  if (!name) return fail("name_required");
  const plans = (Array.isArray(body.plans) ? body.plans : body.plans ? [body.plans] : []).filter((p): p is string => typeof p === "string" && PLAN_KEY.test(p));
  const known = new Set((await vipPlans(ctx)).map((p) => p.key));
  const categoryId = intOf(body.categoryId);
  const categories = await listCategories(ctx, kind);
  const parsed = parseItemData(kind, dataFromForm(kind, body, previous, { image: image.info, video: video.info }));
  if (!parsed.ok) return fail("invalid_field", parsed.field);
  if (kind === "name_style" && (parsed.data as { variants: { key: string }[] }).variants.some((v) => v.key !== "default" && !VARIANT_KEYS.includes(v.key))) return fail("invalid_field", "variants");

  const input = {
    name,
    categoryId: categoryId !== null && categories.some((c) => c.id === categoryId) ? categoryId : null,
    data: parsed.data,
    plans: plans.filter((p) => known.has(p)),
    enabled: checked(body.enabled),
    retired: checked(body.retired),
  };
  if (uploaded.length) await ctx.media.keep(uploaded);
  if (previous) {
    await updateItem(ctx, previous.id, input, kind);
    // Fișierele înlocuite nu mai sunt folosite de nimeni: se șterg.
    await dropUnused(ctx, previous.mediaIds);
    await audit(ctx, "item_update", `${kind}/${previous.key}`);
    await republishUsersOf(ctx, kind, previous.key);
    return back(formPath, { saved: "1" });
  }
  const key = itemKeyFrom(name, Math.random().toString(36).slice(2, 7));
  const newId = await createItem(ctx, { kind, key, ...input });
  await audit(ctx, "item_create", `${kind}/${key}`);
  return back(`/item/${newId}`, { saved: "1" });
}

/** Ordinea, activ / retras, categoriile, presetările și resetările din ACP. */
export async function acpAction(ctx: GcsPluginContext, body: Body): Promise<GcsPluginApiResponse> {
  const op = str(body.op);
  const id = intOf(body.id);
  const item = id !== null && ["move", "toggle", "retire"].includes(op) ? await getItem(ctx, id) : null;
  const listPath = item ? KIND_ROUTES[item.kind] : "";
  switch (op) {
    case "move":
      if (!item) return back("", { error: "not_found" });
      await moveItem(ctx, item, intOf(body.dir) === -1 ? -1 : 1);
      return back(listPath, { saved: "1" });
    case "toggle":
      if (!item) return back("", { error: "not_found" });
      await setItemFlags(ctx, item.id, { enabled: !item.enabled });
      await audit(ctx, item.enabled ? "item_disable" : "item_enable", `${item.kind}/${item.key}`);
      await republishUsersOf(ctx, item.kind, item.key);
      return back(listPath, { saved: "1" });
    case "retire":
      if (!item) return back("", { error: "not_found" });
      await setItemFlags(ctx, item.id, { retired: !item.retired });
      await audit(ctx, item.retired ? "item_restore" : "item_retire", `${item.kind}/${item.key}`);
      await republishUsersOf(ctx, item.kind, item.key);
      return back(listPath, { saved: "1" });
    case "category_add": {
      const kind = str(body.kind) as Kind;
      const name = plainText(first(body.name), 40);
      if (!(KINDS as readonly string[]).includes(kind) || !name) return back("", { error: "name_required" });
      await createCategory(ctx, kind, name);
      return back(KIND_ROUTES[kind], { saved: "1" });
    }
    case "category_rename": {
      const name = plainText(first(body.name), 40);
      const cat = (await listCategories(ctx)).find((c) => c.id === id);
      if (!cat || !name) return back("", { error: "name_required" });
      await renameCategory(ctx, cat.id, name);
      return back(KIND_ROUTES[cat.kind], { saved: "1" });
    }
    case "presets_missing":
    case "presets_restore": {
      const n = await insertPresets(ctx, op === "presets_restore");
      await audit(ctx, op, String(n));
      await ctx.jobs.enqueue("reconcile", {});
      return back("", { saved: "1" });
    }
    case "reset_member":
    case "reset_quote": {
      const userId = str(body.userId);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return back("/members", { error: "not_found" });
      const saved = await getLoadout(ctx, userId);
      if (!saved) return back("/members", { error: "not_found" });
      if (op === "reset_member") {
        await deleteLoadout(ctx, userId);
        if (saved.loadout.customSong?.audioId) await dropUnused(ctx, [saved.loadout.customSong.audioId]);
      } else {
        const { quote: _quote, ...rest } = saved.loadout;
        await saveLoadout(ctx, userId, rest, saved.testMode);
      }
      await publishFor(ctx, userId);
      await audit(ctx, op, userId);
      return back("/members", { saved: "1" });
    }
    default:
      return back("", { error: "invalid" });
  }
}

/** Ștergerile (dreptul ACP „delete”): un element (membrii revin la implicit) sau o categorie. */
export async function acpDelete(ctx: GcsPluginContext, body: Body): Promise<GcsPluginApiResponse> {
  const op = str(body.op);
  const id = intOf(body.id);
  if (id === null) return back("", { error: "not_found" });
  if (op === "category") {
    const cat = (await listCategories(ctx)).find((c) => c.id === id);
    if (!cat) return back("", { error: "not_found" });
    await deleteCategory(ctx, id);
    await audit(ctx, "category_delete", `${cat.kind}/${cat.name}`);
    return back(KIND_ROUTES[cat.kind], { deleted: "1" });
  }
  const item = await getItem(ctx, id);
  if (!item) return back("", { error: "not_found" });
  const users = await usersOfItem(ctx, item.kind, item.key);
  await deleteItem(ctx, id);
  await dropUnused(ctx, item.mediaIds);
  // Un stil CSS scris de admin: și stilul păstrat de GCS.
  if ((item.kind === "name_style" || item.kind === "banner") && (item.data as { custom?: true }).custom) {
    await ctx.members.appearance.styles.set(item.kind === "name_style" ? "name" : "banner", item.key, null);
  }
  await audit(ctx, "item_delete", `${item.kind}/${item.key}`);
  // Echipamentele care îl foloseau: alegerea rămâne salvată, dar nu mai apare (implicit), până la o nouă alegere.
  if (users.length <= 40) await republish(ctx, users);
  else await ctx.jobs.enqueue("reconcile", {});
  return back(KIND_ROUTES[item.kind], { deleted: "1" });
}
