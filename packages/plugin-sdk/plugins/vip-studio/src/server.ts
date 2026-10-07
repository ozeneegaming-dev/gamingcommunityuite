/**
 * Pluginul `gcs.vip_studio` (Studio VIP). Se compilează (esbuild) într-un singur `server.mjs`, fără importuri la rulare:
 * `pnpm --filter @gcs/plugin-sdk build:vip-studio`.
 */
import { definePlugin, type GcsPluginApiRequest, type GcsPluginApiResponse, type GcsPluginContext, type GcsPluginUser } from "../../../src/index";
import { acpAction, acpDelete, saveItemAction } from "./acpActions";
import { checkLoadout, readLoadoutForm, type Group, type Loadout } from "./loadout";
import { KINDS, PLUGIN_KEY, type Kind } from "./model";
import { accessOf, loadCatalog, publishFor, republish, vipPlans } from "./publish";
import {
  countLoadouts,
  deleteLoadout,
  ensureSeeded,
  getItem,
  getLoadout,
  listCategories,
  listItems,
  listLoadouts,
  markMissingMedia,
  mediaInUse,
  recentAudit,
  saveLoadout,
  usersOfItem,
} from "./store";
import { renderCatalog, renderItemForm, renderMembers, renderOverview, ROUTE_KINDS, type AcpCommon } from "./views/acp";
import { renderBenefits, renderRoster } from "./views/public";
import { renderStudio, type StudioSettings } from "./views/studio";

const STUDIO = `/p/${PLUGIN_KEY}`;

/** Setările pluginului, cu valorile verificate (adresa paginii VIP doar internă sau https). */
function settingsOf(ctx: GcsPluginContext): StudioSettings {
  const s = ctx.settings.all();
  const url = typeof s.vipPageUrl === "string" ? s.vipPageUrl.trim() : "";
  const safeUrl = (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) || /^https:\/\/[^\s"'<>]+$/.test(url) ? url : "/vip";
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    vipPageUrl: safeUrl,
    newDays: num(s.newDays, 7),
    allowCustomLabel: s.allowCustomLabel !== false,
    allowYoutube: s.allowYoutube !== false,
    allowSongUpload: s.allowSongUpload === true,
    songMaxMb: num(s.songMaxMb, 8),
  };
}

async function viewerUser(ctx: GcsPluginContext): Promise<GcsPluginUser | null> {
  if (!ctx.viewer.userId) return null;
  const [user] = await ctx.api.users.get([ctx.viewer.userId]);
  return user ?? null;
}

async function counts(ctx: GcsPluginContext): Promise<Partial<Record<Kind, number>>> {
  const rows = await ctx.db.query<{ kind: Kind; n: number }>("SELECT kind, count(*)::int AS n FROM items GROUP BY kind");
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/** Tab-ul activ din formular (după salvare, studioul se redeschide acolo). */
function tabFrom(body: Record<string, unknown>): string {
  const mode = body.gcsp_mode === "full" ? "full" : "mini";
  const tab = mode === "full" ? body.gcsp_tab_full : body.gcsp_tab_mini;
  return typeof tab === "string" && /^[a-z]{2,12}$/.test(tab) ? tab : "name";
}

/** Un răspuns al studioului: JSON pentru JS, redirecționare pentru formularul fără JS. */
function studioReply(ok: boolean, tab: string, extra: Record<string, unknown> = {}, status = 200) {
  const params = new URLSearchParams({ ...(ok ? { saved: "1" } : { error: String(extra.error ?? "generic") }), tab });
  return { status, redirect: `${STUDIO}?${params}`, body: JSON.parse(JSON.stringify({ ok, tab, ...extra })) };
}

async function saveStudio(req: GcsPluginApiRequest, ctx: GcsPluginContext) {
  const userId = ctx.viewer.userId;
  const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  const tab = tabFrom(body);
  if (!userId) return studioReply(false, tab, { error: "guest" }, 403);
  await ensureSeeded(ctx);
  const settings = settingsOf(ctx);
  const saved = await getLoadout(ctx, userId);
  const { loadout, uploadError } = readLoadoutForm(body, saved?.loadout ?? {});
  const uploaded = loadout.customSong?.audioId && loadout.customSong.audioId !== saved?.loadout.customSong?.audioId ? loadout.customSong.audioId : null;
  const discard = async () => {
    if (uploaded) await ctx.media.delete([uploaded]);
  };
  const access = await accessOf(ctx, userId, { viewer: true });
  if (!access.vip && !access.testAll) {
    await discard();
    return studioReply(false, tab, { error: "vip_required" }, 403);
  }
  if (uploadError) {
    await discard();
    return studioReply(false, "song", { error: uploadError === "youtube_invalid" ? "youtube_invalid" : `upload_${uploadError}`.slice(0, 40) }, 422);
  }
  if (uploaded) {
    const [info] = await ctx.media.get([uploaded]);
    if (!info || info.size > settings.songMaxMb * 1024 * 1024) {
      await discard();
      return studioReply(false, "song", { error: "song_too_large" }, 422);
    }
  }
  const catalog = await loadCatalog(ctx);
  const { loadout: clean, problems } = checkLoadout(loadout, catalog, access, { allowCustomSong: { youtube: settings.allowYoutube, upload: settings.allowSongUpload } });
  const locked = problems.filter((p) => p.code === "locked");
  if (locked.length > 0) {
    await discard();
    const plans = await vipPlans(ctx);
    const planNames = (keys: string[] | undefined) => (keys && keys.length ? plans.filter((p) => keys.includes(p.key)).map((p) => p.name) : []);
    return studioReply(false, locked[0]!.group, { error: "locked", problems: locked.map((p) => ({ group: p.group, plans: planNames(p.plans) })) }, 422);
  }
  if (uploaded) await ctx.media.keep([uploaded]);
  await saveLoadout(ctx, userId, clean, access.testAll && !access.vip);
  // Melodia proprie înlocuită: fișierul vechi nu mai e al nimănui.
  const oldAudio = saved?.loadout.customSong?.audioId;
  if (oldAudio && oldAudio !== clean.customSong?.audioId && !(await mediaInUse(ctx, oldAudio))) await ctx.media.delete([oldAudio]);
  const published = await publishFor(ctx, userId, { catalog, access });
  const dropped: Group[] = problems.filter((p) => p.code !== "locked").map((p) => p.group);
  return studioReply(true, tab, { published, dropped });
}

async function resetStudio(ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const userId = ctx.viewer.userId;
  if (!userId) return { status: 403, body: { ok: false, error: "guest" } };
  const saved = await getLoadout(ctx, userId);
  await deleteLoadout(ctx, userId);
  const audio = saved?.loadout.customSong?.audioId;
  if (audio && !(await mediaInUse(ctx, audio))) await ctx.media.delete([audio]);
  await publishFor(ctx, userId);
  return { redirect: `${STUDIO}?reset=1`, body: { ok: true } };
}

async function acpCommon(ctx: GcsPluginContext, query: Record<string, string>): Promise<AcpCommon> {
  await ensureSeeded(ctx);
  return { ctx, plans: await vipPlans(ctx), query };
}

/** Ce useri au fost publicați de la un eveniment VIP (acordat, retras, expirat). */
async function onVipChange(ctx: GcsPluginContext, payload: Record<string, unknown>): Promise<void> {
  const userId = payload.userId;
  if (typeof userId !== "string") return;
  if (!(await getLoadout(ctx, userId))) return;
  await ensureSeeded(ctx);
  await publishFor(ctx, userId);
}

export default definePlugin({
  pages: {
    "/": async (input, ctx) => {
      await ensureSeeded(ctx);
      const user = await viewerUser(ctx);
      if (!user) return { status: 403 };
      const [catalog, categories, saved, access, plans] = await Promise.all([loadCatalog(ctx), listCategories(ctx), getLoadout(ctx, user.id), accessOf(ctx, user.id, { viewer: true }), vipPlans(ctx)]);
      return {
        title: ctx.t("studio.title"),
        html: renderStudio({ ctx, user, access, plans, catalog, categories, loadout: saved?.loadout ?? {}, settings: settingsOf(ctx), query: input.query }),
      };
    },
    "/benefits": async (_input, ctx) => {
      await ensureSeeded(ctx);
      const settings = settingsOf(ctx);
      const [catalog, plans] = await Promise.all([loadCatalog(ctx), vipPlans(ctx)]);
      return { title: ctx.t("benefits.title"), html: renderBenefits(ctx, { catalog, plans, vipPageUrl: settings.vipPageUrl, allowCustomLabel: settings.allowCustomLabel, allowSong: settings.allowYoutube || settings.allowSongUpload }) };
    },
  },

  acp: {
    "/": async (input, ctx) => {
      const c = await acpCommon(ctx, input.query);
      const [n, loadouts, usage, log] = await Promise.all([counts(ctx), countLoadouts(ctx), ctx.media.usage(), recentAudit(ctx, 15)]);
      const actorIds = [...new Set(log.map((a) => a.actor_id).filter((x): x is string => Boolean(x)))];
      const users = actorIds.length ? await ctx.api.users.get(actorIds) : [];
      return { title: ctx.t("acp.title"), html: renderOverview({ ...c, counts: n, loadouts, usage, audit: log, names: new Map(users.map((u) => [u.id, u.name])) }) };
    },
    ...Object.fromEntries(
      Object.entries(ROUTE_KINDS).map(([route, kind]) => [
        route,
        async (input: { query: Record<string, string> }, ctx: GcsPluginContext) => {
          const c = await acpCommon(ctx, input.query);
          const [items, categories, user, n] = await Promise.all([listItems(ctx, kind).then((list) => markMissingMedia(ctx, list)), listCategories(ctx, kind), viewerUser(ctx), counts(ctx)]);
          return { title: ctx.t(`acp.kinds.${kind}`), html: renderCatalog({ ...c, kind, items, categories, user, counts: n, newDays: settingsOf(ctx).newDays }) };
        },
      ]),
    ),
    "/item/:id": async (input, ctx) => {
      const c = await acpCommon(ctx, input.query);
      const id = /^\d{1,9}$/.test(input.params.id ?? "") ? Number(input.params.id) : null;
      const item = id === null ? null : await getItem(ctx, id);
      if (!item) return { status: 404 };
      const [categories, user, users] = await Promise.all([listCategories(ctx, item.kind), viewerUser(ctx), usersOfItem(ctx, item.kind, item.key)]);
      const [checked] = await markMissingMedia(ctx, [item]);
      return { title: `${ctx.t(`acp.kinds.${item.kind}`)}: ${item.name}`, html: renderItemForm({ ...c, kind: item.kind, item: checked ?? item, categories, user, usedBy: users.length }) };
    },
    "/new/:kind": async (input, ctx) => {
      const c = await acpCommon(ctx, input.query);
      const kind = input.params.kind as Kind;
      if (!(KINDS as readonly string[]).includes(kind)) return { status: 404 };
      const [categories, user] = await Promise.all([listCategories(ctx, kind), viewerUser(ctx)]);
      return { title: ctx.t(`acp.add.${kind}`), html: renderItemForm({ ...c, kind, item: null, categories, user, usedBy: 0 }) };
    },
    "/members": async (input, ctx) => {
      const c = await acpCommon(ctx, input.query);
      const perPage = 30;
      const page = Math.max(1, Number.parseInt(input.query.page ?? "1", 10) || 1);
      const [rows, total, n] = await Promise.all([listLoadouts(ctx, { limit: perPage, offset: (page - 1) * perPage }), countLoadouts(ctx), counts(ctx)]);
      const users = rows.length ? await ctx.api.users.get(rows.map((r) => r.userId)) : [];
      return { title: ctx.t("acp.members.title"), html: renderMembers({ ...c, rows, users: new Map(users.map((u) => [u.id, u])), total, page, perPage, counts: n }) };
    },
  },

  api: {
    "/save": (req, ctx) => saveStudio(req, ctx),
    "/reset": (_req, ctx) => resetStudio(ctx),
    "/acp/item": async (req, ctx) => saveItemAction(ctx, (req.body ?? {}) as Record<string, unknown>),
    "/acp/action": async (req, ctx) => acpAction(ctx, (req.body ?? {}) as Record<string, unknown>),
    "/acp/delete": async (req, ctx) => acpDelete(ctx, (req.body ?? {}) as Record<string, unknown>),
  },

  widgets: {
    roster: async (input, ctx) => {
      await ensureSeeded(ctx);
      const limit = typeof input.config.limit === "number" ? Math.min(Math.max(input.config.limit, 4), 48) : 16;
      const [members, catalog, plans] = await Promise.all([ctx.api.vip.members({ limit }), loadCatalog(ctx), vipPlans(ctx)]);
      const loadouts = new Map<string, { loadout: Loadout; testMode: boolean }>();
      if (members.length) {
        const rows = await ctx.db.query<{ user_id: string; data: Loadout; test_mode: boolean }>("SELECT user_id, data, test_mode FROM loadouts WHERE user_id = ANY($1::text[])", [members.map((m) => m.id)]);
        for (const r of rows) loadouts.set(r.user_id, { loadout: r.data ?? {}, testMode: r.test_mode });
      }
      return renderRoster(ctx, { members, loadouts, catalog, plans, vipPageUrl: settingsOf(ctx).vipPageUrl });
    },
  },

  events: {
    "vip.granted": (e, ctx) => onVipChange(ctx, e.payload),
    "vip.revoked": (e, ctx) => onVipChange(ctx, e.payload),
    "vip.expired": (e, ctx) => onVipChange(ctx, e.payload),
  },

  jobs: {
    /** Reconcilierea: republică toate echipamentele (planuri schimbate, elemente dezactivate sau șterse). */
    reconcile: async (_data, ctx) => {
      await ensureSeeded(ctx);
      const n = await republish(ctx);
      ctx.log.info(`reconcile: ${n} published`);
    },
  },
});

