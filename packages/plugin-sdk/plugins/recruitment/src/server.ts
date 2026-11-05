/**
 * Pluginul premium `gcs.recruitment` (Recrutare). Se compilează (esbuild) într-un singur `server.mjs`:
 * `pnpm --filter @gcs/plugin-sdk build:recruitment`. Rulează doar dacă licența site-ului include aplicația
 * „recruitment” (pachetul `gcs.<aplicație>`, ca Studio VIP).
 *
 * Drepturile: `apply` = poate aplica prin formular; posturile și aplicațiile = rolurile ACP (`acp: edit / delete` pe rute).
 */
import { definePlugin, type GcsPluginApiRequest, type GcsPluginApiResponse, type GcsPluginContext, type GcsPluginForumListInput, type GcsPluginForumListResult, type GcsPluginJson } from "../../../src/index";
import { ACP, field, idOf, isAppStatus, LIMITS, questionList, readApplication, readPosition, readSettings, SITE } from "./model";
import { countPositions, createApplication, deletePosition, getPosition, hasPending, listApplications, listPositions, pendingCount, savePosition, setApplicationStatus, type Position } from "./store";
import { renderAcp, renderApplications, renderApply, renderForumCard, renderIndexMeta, renderList, type Forum, type Group, type Users } from "./views";

const settingsOf = (ctx: GcsPluginContext) => readSettings(ctx.settings.all());

/** Posturile pentru rândul de pe index (pagina cea mai vizitată): cache de 5 minute, golit la orice schimbare. */
const POSITIONS_CACHE = "positions:v1";
async function cachedPositions(ctx: GcsPluginContext): Promise<Position[]> {
  const hit = await ctx.cache.get<Position[]>(POSITIONS_CACHE).catch(() => null);
  if (hit) return hit;
  const list = await listPositions(ctx);
  await ctx.cache.set(POSITIONS_CACHE, list as unknown as GcsPluginJson, 300).catch(() => undefined);
  return list;
}
const forgetPositions = (ctx: GcsPluginContext) => ctx.cache.delete(POSITIONS_CACHE).catch(() => undefined);

async function groups(ctx: GcsPluginContext): Promise<Group[]> {
  return (await ctx.api.groups.list().catch(() => [])).map((g) => ({ id: g.id, name: g.name, color: g.color }));
}

async function forums(ctx: GcsPluginContext): Promise<Forum[]> {
  return (await ctx.api.forums.list().catch(() => [])).map((f) => ({ id: f.id, name: f.name, url: f.url }));
}

async function usersOf(ctx: GcsPluginContext, ids: string[]): Promise<Users> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 200);
  const users = unique.length ? await ctx.api.users.get(unique) : [];
  return new Map(users.map((u) => [u.id, u]));
}

function reply(redirect: string, body: Record<string, string | number | boolean>, status = 200): GcsPluginApiResponse {
  return { status, redirect, body };
}
const fail = (where: string, error: string, status = 422) => reply(`${where}${where.includes("?") ? "&" : "?"}error=${error}`, { ok: false, error }, status);

// ─── Site ────────────────────────────────────────────────────────────────

async function listPage(query: Record<string, string>, ctx: GcsPluginContext) {
  const [positions, gs, fs] = await Promise.all([listPositions(ctx), groups(ctx), forums(ctx)]);
  const viewer = ctx.viewer.userId;
  const mine = viewer ? await listApplications(ctx, { userId: viewer }, 20) : [];
  return {
    title: ctx.t("page.list"),
    html: renderList(ctx, { positions, groups: new Map(gs.map((g) => [g.id, g])), forums: new Map(fs.map((f) => [f.id, f])), settings: settingsOf(ctx), mine, query }),
  };
}

async function applyPage(params: Record<string, string>, query: Record<string, string>, ctx: GcsPluginContext) {
  const id = idOf(params.id);
  const position = id ? await getPosition(ctx, id) : null;
  if (!position || position.status === "closed" || position.applyMode !== "form") return { status: 404 as const };
  const viewer = ctx.viewer.userId;
  const s = settingsOf(ctx);
  if (viewer && !(await ctx.permissions.can("apply"))) return { status: 403 as const };
  const already = viewer && s.oneOpen ? await hasPending(ctx, position.id, viewer) : false;
  return { title: ctx.t("page.applyTo", { name: position.name }), html: renderApply(ctx, { position, settings: s, query, guest: !viewer, already }) };
}

async function applyAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const viewer = ctx.viewer.userId;
  const id = idOf(req.params.id);
  const here = `${SITE}/apply/${id ?? ""}`;
  if (!viewer) return fail(here, "guest", 403);
  const position = id ? await getPosition(ctx, id) : null;
  if (!position || position.status === "closed" || position.applyMode !== "form") return { status: 404, body: { ok: false, error: "not_found" } };
  const s = settingsOf(ctx);
  if (s.oneOpen && (await hasPending(ctx, position.id, viewer))) return fail(here, "pending", 409);
  const parsed = readApplication(req.body, questionList(position.questions), s.minLength);
  if (!parsed.ok) return fail(here, `answers_${parsed.error}`);
  const appId = await createApplication(ctx, position.id, viewer, parsed.value);
  ctx.log.info("recruitment.applied", { id: appId, position: position.id });
  return reply(`${SITE}?done=applied`, { ok: true, id: appId });
}

// ─── ACP ─────────────────────────────────────────────────────────────────

async function acpPage(query: Record<string, string>, ctx: GcsPluginContext) {
  const [positions, gs, fs, pending] = await Promise.all([listPositions(ctx), groups(ctx), forums(ctx), pendingCount(ctx)]);
  const editId = idOf(query.edit);
  const selected = editId ? (positions.find((p) => p.id === editId) ?? null) : null;
  return { title: ctx.t("acp.title"), html: renderAcp(ctx, { positions, selected, creating: query.new === "1" && !selected, groups: gs, forums: fs, pending, query }) };
}

async function applicationsPage(query: Record<string, string>, ctx: GcsPluginContext) {
  const status = isAppStatus(query.status) ? query.status : null;
  const items = await listApplications(ctx, status ? { status } : {}, 100);
  const users = await usersOf(ctx, items.map((a) => a.userId));
  return { title: ctx.t("acp.applicationsTitle"), html: renderApplications(ctx, { items, users, status, query }) };
}

async function saveAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const [gs, fs] = await Promise.all([groups(ctx), forums(ctx)]);
  const editing = idOf(field(req.body, "id"));
  const back = editing ? `${ACP}?edit=${editing}` : `${ACP}?new=1`;
  const parsed = readPosition(req.body, { groups: gs.map((g) => g.id), forums: fs.map((f) => f.id) });
  if (!parsed.ok) return fail(back, `position_${parsed.error}`);
  if (parsed.value.id === null && (await countPositions(ctx)) >= LIMITS.positions) return fail(back, "too_many");
  const id = await savePosition(ctx, parsed.value);
  if (id === null) return { status: 404, body: { ok: false, error: "not_found" } };
  await forgetPositions(ctx);
  return reply(`${ACP}?edit=${id}&done=saved`, { ok: true, id });
}

async function deleteAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const id = idOf(req.params.id);
  if (!id || !(await deletePosition(ctx, id))) return { status: 404, body: { ok: false, error: "not_found" } };
  await forgetPositions(ctx);
  return reply(`${ACP}?done=deleted`, { ok: true });
}

async function decideAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const id = idOf(req.params.id);
  const status = field(req.body, "status");
  const note = field(req.body, "note").replace(/\s+/g, " ").trim().slice(0, LIMITS.note);
  const back = `${ACP}/applications`;
  if (!id || (status !== "accepted" && status !== "rejected")) return fail(back, "invalid_status");
  if (!(await setApplicationStatus(ctx, id, status, note, ctx.viewer.userId ?? ""))) return { status: 404, body: { ok: false, error: "not_found" } };
  return reply(`${back}?done=${status}`, { ok: true, status });
}

// ─── Forumul: rândul „Recrutare” și cardul paginii ─────────────────────────

async function forumList(data: Record<string, unknown>, ctx: GcsPluginContext): Promise<GcsPluginForumListResult> {
  const input = data as unknown as GcsPluginForumListInput;
  const shown = input.nodes.filter((n) => n.data.positions === true);
  if (shown.length === 0) return {};
  const [positions, fs] = await Promise.all([cachedPositions(ctx), forums(ctx)]);
  const forumMap = new Map(fs.map((f) => [f.id, f]));
  const out: GcsPluginForumListResult = {};
  for (const node of shown) {
    const list = node.data.closed === false ? positions.filter((p) => p.status !== "closed") : positions;
    const html = renderIndexMeta(ctx, list, forumMap);
    if (html) out[String(node.id)] = { meta: html, style: { classes: ["gcsp-rec-row"] } };
  }
  return out;
}

async function forumPage(data: Record<string, unknown>, ctx: GcsPluginContext): Promise<string | null> {
  const values = (data.data ?? {}) as Record<string, unknown>;
  if (values.positions !== true || values.card === false) return null;
  return renderForumCard(ctx, await cachedPositions(ctx));
}

export default definePlugin({
  pages: {
    "/": (input, ctx) => listPage(input.query, ctx),
    "/apply/:id": (input, ctx) => applyPage(input.params, input.query, ctx),
  },
  acp: {
    "/": (input, ctx) => acpPage(input.query, ctx),
    "/applications": (input, ctx) => applicationsPage(input.query, ctx),
  },
  api: {
    "/apply/:id": applyAction,
    "/positions/save": saveAction,
    "/positions/:id/delete": deleteAction,
    "/applications/:id/status": decideAction,
  },
  hooks: {
    "forum.list": (data, ctx) => forumList(data, ctx),
    "forum.page": (data, ctx) => forumPage(data, ctx),
  },
});
