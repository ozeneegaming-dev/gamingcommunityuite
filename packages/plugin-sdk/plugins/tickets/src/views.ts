/**
 * Paginile pluginului ca HTML (trece apoi prin sanitizer-ul GCS): lista ticketelor (a membrului și coada staff-ului),
 * formularul de ticket nou, pagina ticketului (firul, răspunsul, controalele staff-ului), widget-ul și pagina din ACP.
 * Toate clasele proprii încep cu `gcsp-`; culorile vin din tokenurile temei (`assets/tickets.css`).
 */
import type { GcsPluginContext, GcsPluginUser } from "../../../src/index";
import { attrs, esc, formatDate, formatDuration, formatText, icon, timeTag } from "./html";
import { API, PRIORITIES, SITE, STATUSES, SUBJECT_MAX, SUBJECT_MIN, BODY_MAX, type Priority, type Status, type TicketSettings } from "./model";
import type { ListFilter, Message, Overview, Ticket, TicketEvent } from "./store";

export type Users = Map<string, GcsPluginUser>;

const STATUS_ICON: Record<Status, string> = {
  open: "fa-solid fa-envelope-open",
  in_progress: "fa-solid fa-spinner",
  answered: "fa-solid fa-reply",
  closed: "fa-solid fa-lock",
};
const PRIORITY_ICON: Record<Priority, string> = {
  low: "fa-solid fa-angle-down",
  normal: "fa-solid fa-minus",
  high: "fa-solid fa-angle-up",
  urgent: "fa-solid fa-fire",
};

export const statusBadge = (ctx: GcsPluginContext, s: Status) => `<span class="gcsp-status gcsp-status--${s}">${icon(STATUS_ICON[s])}${esc(ctx.t(`status.${s}`))}</span>`;
export const priorityBadge = (ctx: GcsPluginContext, p: Priority) => `<span class="gcsp-prio gcsp-prio--${p}">${icon(PRIORITY_ICON[p])}${esc(ctx.t(`priority.${p}`))}</span>`;
const categoryTag = (c: string) => `<span class="gcsp-cat">${icon("fa-solid fa-folder")}${esc(c)}</span>`;

/** Numele unui membru (stilul numelui și hover card-ul GCS), sau „membru șters”. */
export function userName(ctx: GcsPluginContext, users: Users, id: string | null): string {
  const u = id ? users.get(id) : undefined;
  if (!u) return `<span class="gcs-muted">${esc(ctx.t(id ? "user.deleted" : "user.system"))}</span>`;
  return `<a class="gcs-userLink"${attrs({ href: u.url, "data-user-id": u.id })}><span class="gcs-name--${esc(u.nameKey)}">${esc(u.name)}</span></a>`;
}

/** Avatarul (imaginea sau inițiala). */
function avatar(users: Users, id: string | null, size: "sm" | "md" = "md"): string {
  const u = id ? users.get(id) : undefined;
  const letter = esc((u?.name ?? "?").slice(0, 1).toUpperCase());
  return u?.avatarUrl
    ? `<span class="gcsp-av gcsp-av--${size}"><img${attrs({ src: u.avatarUrl, alt: "" })}></span>`
    : `<span class="gcsp-av gcsp-av--${size} gcsp-av--letter">${letter}</span>`;
}

function notice(kind: "ok" | "warn" | "info", text: string): string {
  const ic = kind === "ok" ? "fa-solid fa-circle-check" : kind === "warn" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-info";
  return `<div class="gcsp-notice gcsp-notice--${kind}" role="status">${icon(ic)}<span>${esc(text)}</span></div>`;
}

/** Mesajul de după o acțiune (`?done=…` / `?error=…` din redirecționarea formularului). */
export function flash(ctx: GcsPluginContext, query: Record<string, string>): string {
  const done = query.done;
  if (done && /^[a-z_]{2,24}$/.test(done)) return notice("ok", ctx.t(`done.${done}`));
  const error = query.error;
  if (error && /^[a-z_]{2,24}$/.test(error)) return notice("warn", ctx.t(`error.${error}`));
  return "";
}

/** Bara de sus a paginii: descrierea și acțiunea (titlul paginii îl afișează GCS, în banda lui). */
function pageHead(desc: string, action = ""): string {
  return `<header class="gcsp-head">
    <p class="gcsp-head__desc">${esc(desc)}</p>
    ${action}
  </header>`;
}

const newButton = (ctx: GcsPluginContext) => `<a class="gcs-btn gcs-btn--primary" href="${SITE}/new">${icon("fa-solid fa-plus")}${esc(ctx.t("list.new"))}</a>`;

// ─── Lista ───────────────────────────────────────────────────────────────────

export type ListView = {
  mode: "mine" | "queue";
  canCreate: boolean;
  canManage: boolean;
  filter: ListFilter;
  /** Valoarea filtrului de responsabil din formular (`""`, `"me"`, `"none"`). */
  assigneeChoice: string;
  items: Ticket[];
  total: number;
  page: number;
  pageSize: number;
  users: Users;
  categories: string[];
  queue: { mine: number; unassigned: number; waiting: number } | null;
  query: Record<string, string>;
};

function tabs(ctx: GcsPluginContext, v: ListView): string {
  if (!v.canManage) return "";
  const tab = (mode: "mine" | "queue", label: string, count: number | null) =>
    `<a class="gcsp-tab${v.mode === mode ? " gcsp-tab--active" : ""}" href="${SITE}${mode === "queue" ? "?view=queue" : "?view=mine"}">${esc(label)}${count ? `<span class="gcsp-count">${count}</span>` : ""}</a>`;
  return `<nav class="gcsp-tabs" aria-label="${esc(ctx.t("list.tabs"))}">${tab("queue", ctx.t("list.queue"), v.queue?.waiting ?? null)}${tab("mine", ctx.t("list.mine"), null)}</nav>`;
}

function filters(ctx: GcsPluginContext, v: ListView): string {
  const statusOptions = [["active", ctx.t("filter.active")], ...STATUSES.map((s) => [s, ctx.t(`status.${s}`)]), ["all", ctx.t("filter.all")]]
    .map(([value, label]) => `<option${attrs({ value, selected: (v.query.status || "active") === value })}>${esc(label)}</option>`)
    .join("");
  if (v.mode === "mine") {
    return `<form class="gcsp-filters" method="get" action="${SITE}">
      <input type="hidden" name="view" value="mine">
      <label class="gcsp-field gcsp-field--inline"><span>${esc(ctx.t("filter.status"))}</span><select class="gcsp-input" name="status">${statusOptions}</select></label>
      <button class="gcs-btn gcs-btn--ghost gcs-btn--sm" type="submit">${icon("fa-solid fa-filter")}${esc(ctx.t("filter.apply"))}</button>
    </form>`;
  }
  const categoryOptions = [`<option value="">${esc(ctx.t("filter.anyCategory"))}</option>`, ...v.categories.map((c) => `<option${attrs({ value: c, selected: v.query.category === c })}>${esc(c)}</option>`)].join("");
  const assigneeOptions = [
    ["", ctx.t("filter.anyone")],
    ["me", ctx.t("filter.me")],
    ["none", ctx.t("filter.unassigned")],
  ]
    .map(([value, label]) => `<option${attrs({ value, selected: v.assigneeChoice === value })}>${esc(label)}</option>`)
    .join("");
  return `<form class="gcsp-filters" method="get" action="${SITE}">
    <input type="hidden" name="view" value="queue">
    <label class="gcsp-field gcsp-field--inline"><span>${esc(ctx.t("filter.status"))}</span><select class="gcsp-input" name="status">${statusOptions}</select></label>
    <label class="gcsp-field gcsp-field--inline"><span>${esc(ctx.t("filter.category"))}</span><select class="gcsp-input" name="category">${categoryOptions}</select></label>
    <label class="gcsp-field gcsp-field--inline"><span>${esc(ctx.t("filter.assignee"))}</span><select class="gcsp-input" name="assignee">${assigneeOptions}</select></label>
    <label class="gcsp-field gcsp-field--inline gcsp-field--grow"><span>${esc(ctx.t("filter.search"))}</span><input class="gcsp-input" type="search" name="q" maxlength="80"${attrs({ value: v.query.q ?? "", placeholder: ctx.t("filter.searchHint") })}></label>
    <button class="gcs-btn gcs-btn--ghost gcs-btn--sm" type="submit">${icon("fa-solid fa-filter")}${esc(ctx.t("filter.apply"))}</button>
  </form>`;
}

function ticketRow(ctx: GcsPluginContext, t: Ticket, v: ListView): string {
  const owner = v.mode === "queue" ? `<span class="gcsp-row__owner">${avatar(v.users, t.userId, "sm")}${userName(ctx, v.users, t.userId)}</span>` : "";
  const assignee = t.assigneeId
    ? `<span class="gcsp-row__assignee" title="${esc(ctx.t("ticket.assignee"))}">${icon("fa-solid fa-user-shield")}${userName(ctx, v.users, t.assigneeId)}</span>`
    : v.mode === "queue"
      ? `<span class="gcsp-row__assignee gcs-muted">${icon("fa-solid fa-user-slash")}${esc(ctx.t("ticket.unassigned"))}</span>`
      : "";
  return `<li class="gcsp-row gcsp-row--${t.status}${t.unread ? " gcsp-row--unread" : ""}">
    <div class="gcsp-row__main">
      <a class="gcsp-row__title" href="${SITE}/t/${t.id}">${t.unread ? `<span class="gcsp-dot" title="${esc(ctx.t("list.unread"))}"></span>` : ""}<span class="gcsp-row__id">#${t.id}</span>${esc(t.subject)}</a>
      <div class="gcsp-row__meta">${categoryTag(t.category)}${owner}${assignee}</div>
    </div>
    <div class="gcsp-row__side">
      <div class="gcsp-row__badges">${priorityBadge(ctx, t.priority)}${statusBadge(ctx, t.status)}</div>
      <div class="gcsp-row__time">${icon("fa-regular fa-comments")}${t.replies} · ${timeTag(t.lastReplyAt, ctx.locale)}</div>
    </div>
  </li>`;
}

function pagination(ctx: GcsPluginContext, v: ListView): string {
  const pages = Math.ceil(v.total / v.pageSize);
  if (pages <= 1) return "";
  const link = (p: number) => {
    const q = new URLSearchParams({ ...v.query, page: String(p) });
    return `${SITE}?${q.toString()}`;
  };
  const prev = v.page > 1 ? `<a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${esc(link(v.page - 1))}">${icon("fa-solid fa-chevron-left")}${esc(ctx.t("list.prev"))}</a>` : "";
  const next = v.page < pages ? `<a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${esc(link(v.page + 1))}">${esc(ctx.t("list.next"))}${icon("fa-solid fa-chevron-right")}</a>` : "";
  return `<nav class="gcsp-pages" aria-label="${esc(ctx.t("list.pages"))}">${prev}<span class="gcs-muted">${esc(ctx.t("list.pageOf", { page: v.page, pages }))}</span>${next}</nav>`;
}

export function renderList(ctx: GcsPluginContext, v: ListView): string {
  const desc = v.mode === "queue" ? ctx.t("list.queueDesc") : ctx.t("list.desc");
  const queueStats =
    v.mode === "queue" && v.queue
      ? `<div class="gcsp-stats">
          <a class="gcsp-stat" href="${SITE}?view=queue&amp;status=open">${icon("fa-solid fa-hourglass-half")}<strong>${v.queue.waiting}</strong><span>${esc(ctx.t("stats.waiting"))}</span></a>
          <a class="gcsp-stat" href="${SITE}?view=queue&amp;assignee=none">${icon("fa-solid fa-user-slash")}<strong>${v.queue.unassigned}</strong><span>${esc(ctx.t("stats.unassigned"))}</span></a>
          <a class="gcsp-stat" href="${SITE}?view=queue&amp;assignee=me">${icon("fa-solid fa-user-shield")}<strong>${v.queue.mine}</strong><span>${esc(ctx.t("stats.mine"))}</span></a>
        </div>`
      : "";
  const empty = `<div class="gcsp-empty">${icon("fa-regular fa-folder-open")}<p>${esc(ctx.t(v.mode === "queue" ? "list.emptyQueue" : "list.empty"))}</p>${v.mode === "mine" && v.canCreate ? newButton(ctx) : ""}</div>`;
  return `<div class="gcsp-tk">
    ${pageHead(desc, v.canCreate ? newButton(ctx) : "")}
    ${flash(ctx, v.query)}
    ${tabs(ctx, v)}
    ${queueStats}
    <section class="gcsp-card">
      ${filters(ctx, v)}
      ${v.items.length ? `<ul class="gcsp-list">${v.items.map((t) => ticketRow(ctx, t, v)).join("")}</ul>` : empty}
      ${pagination(ctx, v)}
    </section>
  </div>`;
}

export function renderGuest(ctx: GcsPluginContext): string {
  return `<div class="gcsp-tk">
    ${pageHead(ctx.t("list.desc"))}
    <section class="gcsp-card gcsp-empty">${icon("fa-solid fa-right-to-bracket")}<p>${esc(ctx.t("list.guest"))}</p></section>
  </div>`;
}

// ─── Ticket nou ──────────────────────────────────────────────────────────────

export function renderNew(ctx: GcsPluginContext, s: TicketSettings, opts: { openCount: number; query: Record<string, string> }): string {
  const limitReached = s.maxOpen > 0 && opts.openCount >= s.maxOpen;
  const intro = s.intro ? `<div class="gcsp-intro">${formatText(s.intro)}</div>` : "";
  const priorities = PRIORITIES.filter((p) => p !== "urgent")
    .map((p) => `<option${attrs({ value: p, selected: p === "normal" })}>${esc(ctx.t(`priority.${p}`))}</option>`)
    .join("");
  const form = limitReached
    ? notice("warn", ctx.t("new.limit", { max: s.maxOpen }))
    : `<form class="gcsp-form" method="post" action="${API}/create">
        <div class="gcsp-grid2">
          <label class="gcsp-field"><span>${esc(ctx.t("new.category"))}</span>
            <select class="gcsp-input" name="category" required>${s.categories.map((c) => `<option${attrs({ value: c })}>${esc(c)}</option>`).join("")}</select>
          </label>
          ${
            s.memberPriority
              ? `<label class="gcsp-field"><span>${esc(ctx.t("new.priority"))}</span><select class="gcsp-input" name="priority">${priorities}</select></label>`
              : ""
          }
        </div>
        <label class="gcsp-field"><span>${esc(ctx.t("new.subject"))}</span>
          <input class="gcsp-input" type="text" name="subject" required${attrs({ minlength: SUBJECT_MIN, maxlength: SUBJECT_MAX, placeholder: ctx.t("new.subjectHint") })}>
        </label>
        <label class="gcsp-field"><span>${esc(ctx.t("new.body"))}</span>
          <textarea class="gcsp-input gcsp-textarea" name="body" rows="8" required${attrs({ maxlength: BODY_MAX, placeholder: ctx.t("new.bodyHint") })}></textarea>
        </label>
        <div class="gcsp-actions">
          <a class="gcs-btn gcs-btn--ghost" href="${SITE}">${esc(ctx.t("new.cancel"))}</a>
          <button class="gcs-btn gcs-btn--primary" type="submit">${icon("fa-solid fa-paper-plane")}${esc(ctx.t("new.submit"))}</button>
        </div>
      </form>`;
  return `<div class="gcsp-tk">
    ${pageHead(ctx.t("new.desc"))}
    ${flash(ctx, opts.query)}
    <section class="gcsp-card gcsp-card--pad">
      ${intro}
      ${s.maxOpen > 0 && !limitReached ? `<p class="gcsp-hint">${icon("fa-solid fa-circle-info")}${esc(ctx.t("new.limitHint", { open: opts.openCount, max: s.maxOpen }))}</p>` : ""}
      ${form}
    </section>
  </div>`;
}

// ─── Ticketul ────────────────────────────────────────────────────────────────

export type TicketView = {
  ticket: Ticket;
  messages: Message[];
  events: TicketEvent[];
  users: Users;
  viewerId: string;
  canManage: boolean;
  settings: TicketSettings;
  query: Record<string, string>;
};

/** Textul unui eveniment din fir: textul tradus e escapat, apoi numele (HTML) intră în locul semnelor `@@who@@` / `@@to@@`. */
function eventText(ctx: GcsPluginContext, e: TicketEvent, users: Users): string {
  const WHO = "@@who@@";
  const TO = "@@to@@";
  const fill = (text: string) => esc(text).replace(WHO, userName(ctx, users, e.actorId)).replace(TO, userName(ctx, users, e.value || null));
  switch (e.action) {
    case "status":
      return fill(ctx.t("event.status", { who: WHO, value: ctx.t(`status.${e.value}`) }));
    case "priority":
      return fill(ctx.t("event.priority", { who: WHO, value: ctx.t(`priority.${e.value}`) }));
    case "category":
      return fill(ctx.t("event.category", { who: WHO, value: e.value }));
    case "assign":
      return fill(ctx.t("event.assign", { who: WHO, value: TO }));
    case "unassign":
      return fill(ctx.t("event.unassign", { who: WHO }));
    case "autoclose":
      return esc(ctx.t("event.autoclose"));
    default:
      return esc(e.action);
  }
}

function messageItem(ctx: GcsPluginContext, m: Message, v: TicketView): string {
  const own = m.userId === v.ticket.userId;
  const cls = ["gcsp-msg", m.staff ? "gcsp-msg--staff" : "", m.internal ? "gcsp-msg--internal" : "", own ? "gcsp-msg--owner" : ""].filter(Boolean).join(" ");
  const tags = [
    m.staff && !m.internal ? `<span class="gcs-badge gcs-badge--accent">${esc(ctx.t("ticket.staff"))}</span>` : "",
    m.internal ? `<span class="gcs-badge gcs-badge--warn">${icon("fa-solid fa-eye-slash")}${esc(ctx.t("ticket.internal"))}</span>` : "",
  ].join("");
  return `<article class="${cls}">
    ${avatar(v.users, m.userId)}
    <div class="gcsp-msg__box">
      <header class="gcsp-msg__head">${userName(ctx, v.users, m.userId)}${tags}<span class="gcsp-msg__time">${timeTag(m.createdAt, ctx.locale)}</span></header>
      <div class="gcsp-msg__body gcs-prose">${formatText(m.body)}</div>
    </div>
  </article>`;
}

function thread(ctx: GcsPluginContext, v: TicketView): string {
  type Item = { at: string; order: number; html: string };
  const items: Item[] = [
    ...v.messages.map((m) => ({ at: m.createdAt, order: m.id * 2, html: messageItem(ctx, m, v) })),
    ...v.events.map((e) => ({ at: e.createdAt, order: e.id * 2 + 1, html: `<div class="gcsp-event">${icon("fa-solid fa-clock-rotate-left")}<span>${eventText(ctx, e, v.users)}</span>${timeTag(e.createdAt, ctx.locale)}</div>` })),
  ];
  items.sort((a, b) => (a.at === b.at ? a.order - b.order : a.at < b.at ? -1 : 1));
  return `<div class="gcsp-thread">${items.map((i) => i.html).join("")}</div>`;
}

function replyForm(ctx: GcsPluginContext, v: TicketView): string {
  const t = v.ticket;
  const closed = t.status === "closed";
  if (closed && !v.canManage && !v.settings.allowReopen) return notice("info", ctx.t("ticket.closedFinal"));
  const staffOptions = v.canManage
    ? `<div class="gcsp-replyOpts">
        <label class="gcsp-check"><input type="checkbox" name="internal" value="1"><span>${icon("fa-solid fa-eye-slash")}${esc(ctx.t("reply.internal"))}</span></label>
        <label class="gcsp-field gcsp-field--inline"><span>${esc(ctx.t("reply.then"))}</span>
          <select class="gcsp-input" name="status">
            <option value="">${esc(ctx.t("reply.auto"))}</option>
            ${STATUSES.map((s) => `<option${attrs({ value: s })}>${esc(ctx.t(`status.${s}`))}</option>`).join("")}
          </select>
        </label>
      </div>`
    : "";
  return `<section class="gcsp-card gcsp-card--pad gcsp-reply">
    <h3 class="gcsp-sub">${icon("fa-solid fa-reply")}${esc(ctx.t(closed ? "reply.reopenTitle" : "reply.title"))}</h3>
    ${closed && !v.canManage ? `<p class="gcsp-hint">${icon("fa-solid fa-circle-info")}${esc(ctx.t("reply.reopenHint"))}</p>` : ""}
    <form class="gcsp-form" method="post" action="${API}/t/${t.id}/reply">
      <label class="gcsp-field"><span class="gcsp-sr">${esc(ctx.t("reply.title"))}</span>
        <textarea class="gcsp-input gcsp-textarea" name="body" rows="6" required${attrs({ maxlength: BODY_MAX, placeholder: ctx.t("reply.placeholder") })}></textarea>
      </label>
      ${staffOptions}
      <div class="gcsp-actions"><button class="gcs-btn gcs-btn--primary" type="submit">${icon("fa-solid fa-paper-plane")}${esc(ctx.t("reply.submit"))}</button></div>
    </form>
  </section>`;
}

function details(ctx: GcsPluginContext, v: TicketView): string {
  const t = v.ticket;
  const row = (label: string, value: string) => `<div class="gcsp-dl__row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  return `<section class="gcsp-card gcsp-card--pad">
    <h3 class="gcsp-sub">${icon("fa-solid fa-circle-info")}${esc(ctx.t("ticket.details"))}</h3>
    <dl class="gcsp-dl">
      ${row(ctx.t("ticket.status"), statusBadge(ctx, t.status))}
      ${row(ctx.t("ticket.priority"), priorityBadge(ctx, t.priority))}
      ${row(ctx.t("ticket.category"), categoryTag(t.category))}
      ${row(ctx.t("ticket.owner"), `<span class="gcsp-inline">${avatar(v.users, t.userId, "sm")}${userName(ctx, v.users, t.userId)}</span>`)}
      ${row(ctx.t("ticket.assignee"), t.assigneeId ? `<span class="gcsp-inline">${avatar(v.users, t.assigneeId, "sm")}${userName(ctx, v.users, t.assigneeId)}</span>` : `<span class="gcs-muted">${esc(ctx.t("ticket.unassigned"))}</span>`)}
      ${row(ctx.t("ticket.created"), esc(formatDate(t.createdAt, ctx.locale)))}
      ${row(ctx.t("ticket.updated"), timeTag(t.updatedAt, ctx.locale))}
      ${t.closedAt ? row(ctx.t("ticket.closedAt"), esc(formatDate(t.closedAt, ctx.locale))) : ""}
    </dl>
  </section>`;
}

function ownerActions(ctx: GcsPluginContext, v: TicketView): string {
  const t = v.ticket;
  if (t.userId !== v.viewerId) return "";
  if (t.status === "closed") {
    if (!v.settings.allowReopen) return "";
    return `<form class="gcsp-card gcsp-card--pad gcsp-form" method="post" action="${API}/t/${t.id}/status">
      <input type="hidden" name="status" value="open">
      <button class="gcs-btn gcs-btn--ghost" type="submit">${icon("fa-solid fa-lock-open")}${esc(ctx.t("ticket.reopen"))}</button>
    </form>`;
  }
  return `<form class="gcsp-card gcsp-card--pad gcsp-form" method="post" action="${API}/t/${t.id}/status">
    <input type="hidden" name="status" value="closed">
    <p class="gcsp-hint">${esc(ctx.t("ticket.closeHint"))}</p>
    <button class="gcs-btn gcs-btn--ghost" type="submit">${icon("fa-solid fa-lock")}${esc(ctx.t("ticket.close"))}</button>
  </form>`;
}

function manageForm(ctx: GcsPluginContext, v: TicketView): string {
  if (!v.canManage) return "";
  const t = v.ticket;
  const opt = (value: string, label: string, selected: boolean) => `<option${attrs({ value, selected })}>${esc(label)}</option>`;
  const categories = v.settings.categories.includes(t.category) ? v.settings.categories : [t.category, ...v.settings.categories];
  const assignee = [
    opt("keep", t.assigneeId ? ctx.t("manage.keep", { name: v.users.get(t.assigneeId)?.name ?? "—" }) : ctx.t("ticket.unassigned"), true),
    t.assigneeId !== v.viewerId ? opt("me", ctx.t("manage.takeMe"), false) : "",
    t.assigneeId ? opt("none", ctx.t("manage.unassign"), false) : "",
  ].join("");
  return `<form class="gcsp-card gcsp-card--pad gcsp-form gcsp-manage" method="post" action="${API}/t/${t.id}/manage">
    <h3 class="gcsp-sub">${icon("fa-solid fa-user-shield")}${esc(ctx.t("manage.title"))}</h3>
    <label class="gcsp-field"><span>${esc(ctx.t("ticket.status"))}</span><select class="gcsp-input" name="status">${STATUSES.map((s) => opt(s, ctx.t(`status.${s}`), s === t.status)).join("")}</select></label>
    <label class="gcsp-field"><span>${esc(ctx.t("ticket.priority"))}</span><select class="gcsp-input" name="priority">${PRIORITIES.map((p) => opt(p, ctx.t(`priority.${p}`), p === t.priority)).join("")}</select></label>
    <label class="gcsp-field"><span>${esc(ctx.t("ticket.category"))}</span><select class="gcsp-input" name="category">${categories.map((c) => opt(c, c, c === t.category)).join("")}</select></label>
    <label class="gcsp-field"><span>${esc(ctx.t("ticket.assignee"))}</span><select class="gcsp-input" name="assignee">${assignee}</select></label>
    <button class="gcs-btn gcs-btn--primary gcs-btn--sm" type="submit">${icon("fa-solid fa-floppy-disk")}${esc(ctx.t("manage.save"))}</button>
  </form>`;
}

export function renderTicket(ctx: GcsPluginContext, v: TicketView): string {
  const t = v.ticket;
  const back = `<a class="gcsp-back" href="${SITE}${v.canManage && t.userId !== v.viewerId ? "?view=queue" : ""}">${icon("fa-solid fa-arrow-left")}${esc(ctx.t("ticket.back"))}</a>`;
  return `<div class="gcsp-tk">
    ${back}
    <div class="gcsp-head__meta">${statusBadge(ctx, t.status)}${priorityBadge(ctx, t.priority)}${categoryTag(t.category)}<span class="gcs-muted">${esc(ctx.t("ticket.openedBy"))} ${userName(ctx, v.users, t.userId)} · ${timeTag(t.createdAt, ctx.locale)}</span></div>
    ${flash(ctx, v.query)}
    <div class="gcsp-layout">
      <div class="gcsp-layout__main">
        ${thread(ctx, v)}
        ${replyForm(ctx, v)}
      </div>
      <aside class="gcsp-layout__side">
        ${details(ctx, v)}
        ${manageForm(ctx, v)}
        ${ownerActions(ctx, v)}
      </aside>
    </div>
  </div>`;
}

// ─── Widget-ul ───────────────────────────────────────────────────────────────

export function renderWidget(ctx: GcsPluginContext, input: { staff: { counts: { mine: number; unassigned: number; waiting: number }; items: Ticket[] } | null; mine: Ticket[] | null; canCreate: boolean }): string {
  const row = (t: Ticket) => `<li class="gcs-widgetRow gcsp-wrow">
    <div class="gcs-widgetRow__body">
      <a class="gcs-widgetRow__title" href="${SITE}/t/${t.id}">${t.unread ? `<span class="gcsp-dot"></span>` : ""}#${t.id} ${esc(t.subject)}</a>
      <div class="gcs-widgetRow__meta">${statusBadge(ctx, t.status)} ${timeTag(t.lastReplyAt, ctx.locale)}</div>
    </div>
  </li>`;
  if (input.staff) {
    const c = input.staff.counts;
    return `<div class="gcsp-tk gcsp-widget">
      <div class="gcsp-wstats">
        <a href="${SITE}?view=queue&amp;status=open"><strong>${c.waiting}</strong><span>${esc(ctx.t("stats.waiting"))}</span></a>
        <a href="${SITE}?view=queue&amp;assignee=none"><strong>${c.unassigned}</strong><span>${esc(ctx.t("stats.unassigned"))}</span></a>
        <a href="${SITE}?view=queue&amp;assignee=me"><strong>${c.mine}</strong><span>${esc(ctx.t("stats.mine"))}</span></a>
      </div>
      ${input.staff.items.length ? `<ul class="gcs-widgetList">${input.staff.items.map(row).join("")}</ul>` : `<p class="gcs-muted gcsp-wempty">${esc(ctx.t("widget.queueEmpty"))}</p>`}
      <a class="gcs-btn gcs-btn--ghost gcs-btn--sm gcsp-wbtn" href="${SITE}?view=queue">${icon("fa-solid fa-inbox")}${esc(ctx.t("widget.openQueue"))}</a>
    </div>`;
  }
  if (input.mine) {
    return `<div class="gcsp-tk gcsp-widget">
      ${input.mine.length ? `<ul class="gcs-widgetList">${input.mine.map(row).join("")}</ul>` : `<p class="gcs-muted gcsp-wempty">${esc(ctx.t("widget.mineEmpty"))}</p>`}
      ${input.canCreate ? `<a class="gcs-btn gcs-btn--primary gcs-btn--sm gcsp-wbtn" href="${SITE}/new">${icon("fa-solid fa-plus")}${esc(ctx.t("list.new"))}</a>` : ""}
    </div>`;
  }
  return `<div class="gcsp-tk gcsp-widget"><p class="gcs-muted gcsp-wempty">${esc(ctx.t("widget.guest"))}</p></div>`;
}

// ─── ACP ─────────────────────────────────────────────────────────────────────

export function renderAcp(ctx: GcsPluginContext, o: Overview, recent: Ticket[], users: Users): string {
  const total = STATUSES.reduce((n, s) => n + o.byStatus[s], 0);
  const tile = (ic: string, value: string | number, label: string, tone = "") => `<div class="gcsp-tile${tone ? ` gcsp-tile--${tone}` : ""}">${icon(ic)}<strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
  const units = { min: ctx.t("unit.min"), h: ctx.t("unit.h"), d: ctx.t("unit.d") };
  const categories = o.byCategory.length
    ? `<table class="gcs-table__table gcsp-table"><thead><tr><th class="gcs-table__th">${esc(ctx.t("acp.category"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.active"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.total"))}</th></tr></thead><tbody>${o.byCategory
        .map((c) => `<tr class="gcs-table__row"><td class="gcs-table__td">${esc(c.category)}</td><td class="gcs-table__td">${c.active}</td><td class="gcs-table__td">${c.total}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="gcs-muted">${esc(ctx.t("acp.none"))}</p>`;
  const staff = o.byAssignee.length
    ? `<table class="gcs-table__table gcsp-table"><thead><tr><th class="gcs-table__th">${esc(ctx.t("acp.staff"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.active"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.closed"))}</th></tr></thead><tbody>${o.byAssignee
        .map((a) => `<tr class="gcs-table__row"><td class="gcs-table__td">${userName(ctx, users, a.assigneeId)}</td><td class="gcs-table__td">${a.active}</td><td class="gcs-table__td">${a.closed}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="gcs-muted">${esc(ctx.t("acp.none"))}</p>`;
  const latest = recent.length
    ? `<ul class="gcsp-list">${recent
        .map(
          (t) => `<li class="gcsp-row"><div class="gcsp-row__main"><a class="gcsp-row__title" href="${SITE}/t/${t.id}"><span class="gcsp-row__id">#${t.id}</span>${esc(t.subject)}</a><div class="gcsp-row__meta">${categoryTag(t.category)}<span class="gcsp-row__owner">${userName(ctx, users, t.userId)}</span></div></div><div class="gcsp-row__side"><div class="gcsp-row__badges">${priorityBadge(ctx, t.priority)}${statusBadge(ctx, t.status)}</div><div class="gcsp-row__time">${timeTag(t.lastReplyAt, ctx.locale)}</div></div></li>`,
        )
        .join("")}</ul>`
    : `<p class="gcs-muted">${esc(ctx.t("acp.none"))}</p>`;
  return `<div class="gcsp-tk gcsp-acp">
    <p class="gcsp-hint">${icon("fa-solid fa-circle-info")}${esc(ctx.t("acp.hint"))}</p>
    <div class="gcsp-tiles">
      ${tile("fa-solid fa-ticket", total, ctx.t("acp.totalTickets"))}
      ${tile("fa-solid fa-hourglass-half", o.byStatus.open, ctx.t("status.open"), "open")}
      ${tile("fa-solid fa-spinner", o.byStatus.in_progress, ctx.t("status.in_progress"), "in_progress")}
      ${tile("fa-solid fa-reply", o.byStatus.answered, ctx.t("status.answered"), "answered")}
      ${tile("fa-solid fa-lock", o.byStatus.closed, ctx.t("status.closed"), "closed")}
      ${tile("fa-solid fa-stopwatch", o.avgFirstResponseSec === null ? "—" : formatDuration(o.avgFirstResponseSec, units), ctx.t("acp.firstResponse"))}
      ${tile("fa-solid fa-calendar-plus", o.last7, ctx.t("acp.last7"))}
      ${tile("fa-solid fa-calendar-check", o.closed7, ctx.t("acp.closed7"))}
    </div>
    <div class="gcsp-acpGrid">
      <section class="gcsp-card gcsp-card--pad"><h3 class="gcsp-sub">${icon("fa-solid fa-folder")}${esc(ctx.t("acp.byCategory"))}</h3>${categories}</section>
      <section class="gcsp-card gcsp-card--pad"><h3 class="gcsp-sub">${icon("fa-solid fa-user-shield")}${esc(ctx.t("acp.byStaff"))}</h3>${staff}</section>
    </div>
    <section class="gcsp-card gcsp-card--pad">
      <h3 class="gcsp-sub">${icon("fa-solid fa-clock-rotate-left")}${esc(ctx.t("acp.recent"))}</h3>
      ${latest}
      <div class="gcsp-actions">
        <a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${SITE}?view=queue">${icon("fa-solid fa-inbox")}${esc(ctx.t("acp.openQueue"))}</a>
        <a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="/admin/system/applications/plugins/gcs.tickets">${icon("fa-solid fa-sliders")}${esc(ctx.t("acp.settings"))}</a>
      </div>
    </section>
  </div>`;
}

