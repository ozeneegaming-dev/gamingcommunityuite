/**
 * Pluginul `gcs.tickets` (Tickete suport). Se compilează (esbuild) într-un singur `server.mjs`, fără importuri la rulare:
 * `pnpm --filter @gcs/plugin-sdk build:tickets`.
 *
 * Drepturile: `create` = poate deschide tickete și le vede pe ale lui; `manage` = staff-ul (coada, toate ticketele,
 * notele interne, starea, prioritatea, categoria, responsabilul). Un ticket străin e „negăsit” pentru cine nu e staff.
 */
import { definePlugin, type GcsPluginApiRequest, type GcsPluginApiResponse, type GcsPluginContext, type GcsPluginUser } from "../../../src/index";
import { field, isPriority, isStatus, pageNumber, readBody, readNewTicket, readSettings, SITE, statusAfterReply, ticketId, type Priority, type Status } from "./model";
import {
  addReply,
  autoClose,
  countOpenOf,
  createTicket,
  getTicket,
  listEvents,
  listMessages,
  listTickets,
  markRead,
  overview,
  queueCounts,
  updateTicket,
  type ListFilter,
  type Ticket,
} from "./store";
import { renderAcp, renderGuest, renderList, renderNew, renderTicket, renderWidget, type Users } from "./views";

const settingsOf = (ctx: GcsPluginContext) => readSettings(ctx.settings.all());

async function usersOf(ctx: GcsPluginContext, ids: (string | null | undefined)[]): Promise<Users> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const users: GcsPluginUser[] = unique.length ? await ctx.api.users.get(unique.slice(0, 200)) : [];
  return new Map(users.map((u) => [u.id, u]));
}

async function rights(ctx: GcsPluginContext): Promise<{ create: boolean; manage: boolean }> {
  if (!ctx.viewer.userId) return { create: false, manage: false };
  const [create, manage] = await Promise.all([ctx.permissions.can("create"), ctx.permissions.can("manage")]);
  return { create, manage };
}

/** Răspunsul unei acțiuni: redirecționarea (formularele) și același rezultat ca JSON. */
function reply(redirect: string, body: Record<string, string | number | boolean>, status = 200): GcsPluginApiResponse {
  return { status, redirect, body };
}
const fail = (where: string, error: string, status = 422) => reply(`${where}${where.includes("?") ? "&" : "?"}error=${error}`, { ok: false, error }, status);

/** Ticketul unui apel, dacă vizitatorul are voie să-l vadă (al lui sau staff); altfel `null` (negăsit). */
async function visibleTicket(ctx: GcsPluginContext, rawId: string | undefined, canManage: boolean): Promise<Ticket | null> {
  const id = ticketId(rawId);
  const viewer = ctx.viewer.userId;
  if (!id || !viewer) return null;
  const ticket = await getTicket(ctx, id);
  return ticket && (ticket.userId === viewer || canManage) ? ticket : null;
}

// ─── Paginile ────────────────────────────────────────────────────────────────

async function listPage(query: Record<string, string>, ctx: GcsPluginContext) {
  const viewer = ctx.viewer.userId;
  if (!viewer) return { title: ctx.t("page.list"), html: renderGuest(ctx) };
  const r = await rights(ctx);
  if (!r.create && !r.manage) return { status: 403 as const };
  const s = settingsOf(ctx);
  const mode: "mine" | "queue" = r.manage && query.view !== "mine" ? "queue" : "mine";
  const rawStatus = query.status || "active";
  const filter: ListFilter = { status: rawStatus === "all" ? undefined : isStatus(rawStatus) ? rawStatus : "active" };
  let assigneeChoice = "";
  if (mode === "mine") filter.ownerId = viewer;
  else {
    const category = (query.category ?? "").trim();
    if (category && category.length <= 60) filter.category = category;
    if (query.assignee === "me" || query.assignee === "none") {
      assigneeChoice = query.assignee;
      filter.assignee = query.assignee === "me" ? viewer : "none";
    }
    const q = (query.q ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (q) filter.search = q;
  }
  const page = pageNumber(query.page);
  const { items, total } = await listTickets(ctx, filter, viewer, { limit: s.pageSize, offset: (page - 1) * s.pageSize, byPriority: mode === "queue" });
  const users = await usersOf(ctx, items.flatMap((t) => [t.userId, t.assigneeId]));
  const cleanQuery: Record<string, string> = { view: mode };
  for (const k of ["status", "category", "assignee", "q"] as const) if (query[k]) cleanQuery[k] = query[k]!.slice(0, 80);
  const queue = r.manage ? await queueCounts(ctx, viewer) : null;
  return {
    title: ctx.t(mode === "queue" ? "list.queueTitle" : "list.title"),
    html: renderList(ctx, {
      mode,
      canCreate: r.create,
      canManage: r.manage,
      filter,
      assigneeChoice,
      items,
      total,
      page,
      pageSize: s.pageSize,
      users,
      categories: s.categories,
      queue,
      query: { ...cleanQuery, ...(query.done ? { done: query.done } : {}), ...(query.error ? { error: query.error } : {}) },
    }),
  };
}

async function newPage(query: Record<string, string>, ctx: GcsPluginContext) {
  const viewer = ctx.viewer.userId;
  if (!viewer) return { status: 403 as const };
  const s = settingsOf(ctx);
  return { title: ctx.t("page.new"), html: renderNew(ctx, s, { openCount: await countOpenOf(ctx, viewer), query }) };
}

async function ticketPage(params: Record<string, string>, query: Record<string, string>, ctx: GcsPluginContext) {
  const viewer = ctx.viewer.userId;
  if (!viewer) return { status: 403 as const };
  const r = await rights(ctx);
  const ticket = await visibleTicket(ctx, params.id, r.manage);
  if (!ticket) return { status: 404 as const };
  const [messages, events] = await Promise.all([listMessages(ctx, ticket.id, r.manage), listEvents(ctx, ticket.id)]);
  await markRead(ctx, ticket.id, viewer);
  const users = await usersOf(ctx, [ticket.userId, ticket.assigneeId, ...messages.map((m) => m.userId), ...events.map((e) => e.actorId), ...events.filter((e) => e.action === "assign").map((e) => e.value)]);
  return {
    title: `#${ticket.id} ${ticket.subject}`,
    html: renderTicket(ctx, { ticket, messages, events, users, viewerId: viewer, canManage: r.manage, settings: settingsOf(ctx), query }),
  };
}

// ─── Acțiunile ───────────────────────────────────────────────────────────────

async function createAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const viewer = ctx.viewer.userId;
  if (!viewer) return fail(`${SITE}/new`, "guest", 403);
  const s = settingsOf(ctx);
  const parsed = readNewTicket(req.body, s);
  if (!parsed.ok) return fail(`${SITE}/new`, `invalid_${parsed.error}`);
  if (s.maxOpen > 0 && (await countOpenOf(ctx, viewer)) >= s.maxOpen) return fail(`${SITE}/new`, "limit");
  const id = await createTicket(ctx, viewer, parsed.value);
  ctx.log.info("ticket.created", { id, category: parsed.value.category });
  return reply(`${SITE}/t/${id}?done=created`, { ok: true, id });
}

async function replyAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const viewer = ctx.viewer.userId;
  const r = await rights(ctx);
  const ticket = await visibleTicket(ctx, req.params.id, r.manage);
  if (!viewer || !ticket) return { status: 404, body: { ok: false, error: "not_found" } };
  const here = `${SITE}/t/${ticket.id}`;
  const body = readBody(req.body);
  if (!body) return fail(here, "invalid_body");
  const asStaff = r.manage && ticket.userId !== viewer;
  const internal = r.manage && field(req.body, "internal") === "1";
  const s = settingsOf(ctx);
  if (ticket.status === "closed" && !r.manage && !s.allowReopen) return fail(here, "closed", 409);
  const chosen = field(req.body, "status");
  const status: Status = r.manage && isStatus(chosen) ? chosen : statusAfterReply(ticket.status === "closed" && !internal ? "open" : ticket.status, asStaff, internal);
  await addReply(ctx, ticket, { userId: viewer, body, staff: asStaff, internal, status });
  return reply(`${here}?done=${internal ? "noted" : "replied"}`, { ok: true, status });
}

async function statusAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const viewer = ctx.viewer.userId;
  const r = await rights(ctx);
  const ticket = await visibleTicket(ctx, req.params.id, r.manage);
  if (!viewer || !ticket) return { status: 404, body: { ok: false, error: "not_found" } };
  const here = `${SITE}/t/${ticket.id}`;
  const wanted = field(req.body, "status");
  if (wanted !== "closed" && wanted !== "open") return fail(here, "invalid_status");
  if (wanted === "open" && ticket.status === "closed" && !r.manage && !settingsOf(ctx).allowReopen) return fail(here, "closed", 409);
  await updateTicket(ctx, ticket, viewer, { status: wanted });
  return reply(`${here}?done=${wanted === "closed" ? "closed" : "reopened"}`, { ok: true, status: wanted });
}

async function manageAction(req: GcsPluginApiRequest, ctx: GcsPluginContext): Promise<GcsPluginApiResponse> {
  const viewer = ctx.viewer.userId;
  const ticket = await visibleTicket(ctx, req.params.id, true);
  if (!viewer || !ticket) return { status: 404, body: { ok: false, error: "not_found" } };
  const here = `${SITE}/t/${ticket.id}`;
  const status = field(req.body, "status");
  const priority = field(req.body, "priority");
  const category = field(req.body, "category").trim();
  const assignee = field(req.body, "assignee") || "keep";
  if (status && !isStatus(status)) return fail(here, "invalid_status");
  if (priority && !isPriority(priority)) return fail(here, "invalid_priority");
  if (category && category !== ticket.category && !settingsOf(ctx).categories.includes(category)) return fail(here, "invalid_category");
  if (!["keep", "me", "none"].includes(assignee)) return fail(here, "invalid_assignee");
  const changed = await updateTicket(ctx, ticket, viewer, {
    ...(status ? { status: status as Status } : {}),
    ...(priority ? { priority: priority as Priority } : {}),
    ...(category ? { category } : {}),
    ...(assignee === "me" ? { assigneeId: viewer } : assignee === "none" ? { assigneeId: null } : {}),
  });
  return reply(`${here}?done=${changed ? "updated" : "unchanged"}`, { ok: true, changed });
}

// ─── Pluginul ────────────────────────────────────────────────────────────────

export default definePlugin({
  pages: {
    "/": (input, ctx) => listPage(input.query, ctx),
    "/new": (input, ctx) => newPage(input.query, ctx),
    "/t/:id": (input, ctx) => ticketPage(input.params, input.query, ctx),
  },
  acp: {
    "/": async (_input, ctx) => {
      const [o, { items }] = await Promise.all([overview(ctx), listTickets(ctx, {}, ctx.viewer.userId ?? "", { limit: 10, offset: 0, byPriority: false })]);
      const users = await usersOf(ctx, [...o.byAssignee.map((a) => a.assigneeId), ...items.map((t) => t.userId)]);
      return { title: ctx.t("acp.title"), html: renderAcp(ctx, o, items, users) };
    },
  },
  api: {
    "/create": createAction,
    "/t/:id/reply": replyAction,
    "/t/:id/status": statusAction,
    "/t/:id/manage": manageAction,
  },
  widgets: {
    tickets: async (input, ctx) => {
      const viewer = ctx.viewer.userId;
      if (!viewer) return renderWidget(ctx, { staff: null, mine: null, canCreate: false });
      const limit = typeof input.config.limit === "number" ? Math.min(15, Math.max(1, Math.round(input.config.limit))) : 5;
      const r = await rights(ctx);
      if (r.manage) {
        const [counts, { items }] = await Promise.all([queueCounts(ctx, viewer), listTickets(ctx, { status: "active" }, viewer, { limit, offset: 0, byPriority: true })]);
        return renderWidget(ctx, { staff: { counts, items }, mine: null, canCreate: r.create });
      }
      if (!r.create) return "";
      const { items } = await listTickets(ctx, { ownerId: viewer, status: "active" }, viewer, { limit, offset: 0, byPriority: false });
      return renderWidget(ctx, { staff: null, mine: items, canCreate: true });
    },
  },
  jobs: {
    autoclose: async (_data, ctx) => {
      const days = settingsOf(ctx).autoCloseDays;
      if (days <= 0) return;
      const closed = await autoClose(ctx, days);
      if (closed > 0) ctx.log.info("tickets.autoclosed", { closed, days });
    },
  },
});
