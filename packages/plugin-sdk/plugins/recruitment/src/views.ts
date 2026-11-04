/**
 * HTML-ul pluginului Recrutare (trece oricum prin sanitizer-ul GCS și stă în containerul pluginului). Tot textul venit
 * de la admini sau membri e escapat; culorile vin din tokenurile temei (orice temă).
 */
import type { GcsPluginContext, GcsPluginUser } from "../../../src/index";
import { attrs, esc, formatText, icon, timeTag } from "./html";
import { ACP, API, APP_STATUSES, APPLY_MODES, isOpen, questionList, SITE, STATUSES, statusTone, type AppStatus, type Settings } from "./model";
import type { Application, Position } from "./store";

export type Group = { id: number; name: string; color: string | null };
export type Forum = { id: number; name: string; url: string };
export type Users = Map<string, GcsPluginUser>;

const DEFAULT_ICON = "fa-solid fa-user-plus";
const tag = (ctx: GcsPluginContext, p: Pick<Position, "status">) => `<span class="gcsp-rec__tag gcsp-rec__tag--${statusTone(p.status)}">${esc(ctx.t(`tag.${statusTone(p.status)}`))}</span>`;

function notice(ctx: GcsPluginContext, query: Record<string, string>): string {
  const done = query.done;
  const error = query.error;
  if (done && /^[a-z_]{2,24}$/.test(done)) return `<div class="gcsp-rec__notice gcsp-rec__notice--ok" role="status">${icon("fa-solid fa-circle-check")}<span>${esc(ctx.t(`done.${done}`))}</span></div>`;
  if (error && /^[a-z_]{2,24}$/.test(error)) return `<div class="gcsp-rec__notice gcsp-rec__notice--warn" role="alert">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(ctx.t(`error.${error}`))}</span></div>`;
  return "";
}

/** Unde duce „Aplică”: formularul pluginului, un topic nou în forumul ales sau linkul postului. */
export function applyHref(p: Position, forums: Map<number, Forum>): string | null {
  if (!isOpen(p.status)) return null;
  if (p.applyMode === "topic") {
    const f = p.applyForumId ? forums.get(p.applyForumId) : undefined;
    return f ? `${f.url.replace(/\/$/, "")}/new` : null;
  }
  if (p.applyMode === "link") return p.applyUrl || null;
  return `${SITE}/apply/${p.id}`;
}

const groupPill = (g: Group | undefined) => (g ? `<span class="gcsp-rec__group"${g.color && /^#[0-9a-fA-F]{6}$/.test(g.color) ? ` style="--gcsp-rec-group:${g.color}"` : ""}>${esc(g.name)}</span>` : "");

// ─── Pe site ───────────────────────────────────────────────────────────────

/**
 * Rândul „Recrutare” pe index (macheta HomeComplete): posturile, ca subforumurile, fiecare cu eticheta ON / OFF / NOU;
 * click = aplicarea (sau pagina posturilor, pentru unul închis).
 */
export function renderIndexMeta(ctx: GcsPluginContext, positions: Position[], forums: Map<number, Forum>): string {
  if (positions.length === 0) return "";
  const items = positions
    .map((p) => {
      const href = applyHref(p, forums) ?? SITE;
      return `<li><a class="gcsp-rec__sub" href="${esc(href)}">${esc(p.name)}</a>${tag(ctx, p)}</li>`;
    })
    .join("");
  return `<ul class="gcsp-rec__subs" aria-label="${esc(ctx.t("index.label"))}">${items}</ul>`;
}

/** Cardul de sus din pagina forumului „Recrutare”: câte posturi sunt deschise și linkul spre toate. */
export function renderForumCard(ctx: GcsPluginContext, positions: Position[]): string {
  const open = positions.filter((p) => isOpen(p.status));
  return `<section class="gcsp-rec__card">
    <span class="gcsp-rec__cardIcon">${icon(DEFAULT_ICON)}</span>
    <div class="gcsp-rec__cardText"><strong>${esc(open.length > 0 ? ctx.t("card.open", { count: open.length }) : ctx.t("card.none"))}</strong><span>${esc(open.map((p) => p.name).join(" · "))}</span></div>
    <a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${SITE}">${icon("fa-solid fa-arrow-right")}${esc(ctx.t("card.all"))}</a>
  </section>`;
}

/** Pagina publică a posturilor: fiecare post cu descrierea, grupul, starea și butonul „Aplică”. */
export function renderList(ctx: GcsPluginContext, v: { positions: Position[]; groups: Map<number, Group>; forums: Map<number, Forum>; settings: Settings; mine: Application[]; query: Record<string, string> }): string {
  const mine = v.mine.length
    ? `<section class="gcsp-rec__mine"><h2>${esc(ctx.t("list.mine"))}</h2><ul>${v.mine
        .map((a) => `<li><strong>${esc(a.positionName)}</strong><span class="gcsp-rec__app gcsp-rec__app--${a.status}">${esc(ctx.t(`app.${a.status}`))}</span>${timeTag(a.createdAt, ctx.locale)}</li>`)
        .join("")}</ul></section>`
    : "";
  const cards = v.positions.length
    ? v.positions
        .map((p) => {
          const href = applyHref(p, v.forums);
          const button = href
            ? `<a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${esc(href)}"${p.applyMode === "link" && href.startsWith("https://") ? ' rel="noopener nofollow"' : ""}>${icon("fa-solid fa-paper-plane")}${esc(ctx.t(`apply.${p.applyMode}`))}</a>`
            : `<span class="gcs-muted">${esc(ctx.t("list.closed"))}</span>`;
          return `<article class="gcsp-rec__post">
            <header><span class="gcsp-rec__postIcon">${icon(p.icon || DEFAULT_ICON)}</span><h2>${esc(p.name)}</h2>${tag(ctx, p)}${groupPill(p.groupId ? v.groups.get(p.groupId) : undefined)}</header>
            ${p.description ? `<div class="gcsp-rec__desc">${formatText(p.description)}</div>` : ""}
            <footer>${button}</footer>
          </article>`;
        })
        .join("")
    : `<p class="gcs-muted">${esc(ctx.t("list.empty"))}</p>`;
  return `<div class="gcsp-rec">
    ${notice(ctx, v.query)}
    ${v.settings.intro ? `<div class="gcsp-rec__intro">${formatText(v.settings.intro)}</div>` : ""}
    ${mine}
    <div class="gcsp-rec__posts">${cards}</div>
  </div>`;
}

/** Formularul de aplicare: întrebările postului (sau un singur câmp) și trimiterea. */
export function renderApply(ctx: GcsPluginContext, v: { position: Position; settings: Settings; query: Record<string, string>; guest: boolean; already: boolean }): string {
  const p = v.position;
  if (v.guest) return `<div class="gcsp-rec">${notice(ctx, { error: "guest" })}</div>`;
  if (v.already) return `<div class="gcsp-rec">${notice(ctx, { error: "pending" })}<p><a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${SITE}">${esc(ctx.t("apply.back"))}</a></p></div>`;
  const questions = questionList(p.questions);
  const fields = questions.length
    ? questions.map((q, i) => `<label class="gcsp-rec__field"><span>${esc(q)}</span><textarea class="gcsp-rec__input" name="q${i}" rows="3" maxlength="1500" required></textarea></label>`).join("")
    : `<label class="gcsp-rec__field"><span>${esc(ctx.t("apply.answers"))}</span><textarea class="gcsp-rec__input" name="answers" rows="8" maxlength="6000" required></textarea><small class="gcs-muted">${esc(ctx.t("apply.min", { count: v.settings.minLength }))}</small></label>`;
  return `<div class="gcsp-rec">
    ${notice(ctx, v.query)}
    <section class="gcsp-rec__post">
      <header><span class="gcsp-rec__postIcon">${icon(p.icon || DEFAULT_ICON)}</span><h2>${esc(p.name)}</h2>${tag(ctx, p)}</header>
      ${p.description ? `<div class="gcsp-rec__desc">${formatText(p.description)}</div>` : ""}
    </section>
    <form class="gcsp-rec__form" method="post" action="${API}/apply/${p.id}">
      ${fields}
      <div class="gcsp-rec__actions"><button class="gcs-btn gcs-btn--primary" type="submit">${icon("fa-solid fa-paper-plane")}${esc(ctx.t("apply.send"))}</button><a class="gcs-btn gcs-btn--ghost" href="${SITE}">${esc(ctx.t("apply.cancel"))}</a></div>
    </form>
  </div>`;
}

// ─── ACP ──────────────────────────────────────────────────────────────────

const option = (value: string, label: string, selected: boolean) => `<option${attrs({ value, selected })}>${esc(label)}</option>`;

/**
 * ACP › Recrutare: lista posturilor în stânga (stare, grup, aplicații în așteptare) și panoul de editare în dreapta
 * (nume, descriere, stare, grup, iconiță, modul de aplicare: formular / topic / link, întrebările, ordinea).
 */
export function renderAcp(ctx: GcsPluginContext, v: { positions: Position[]; selected: Position | null; creating: boolean; groups: Group[]; forums: Forum[]; pending: number; query: Record<string, string> }): string {
  const groupMap = new Map(v.groups.map((g) => [g.id, g]));
  const rows = v.positions
    .map((p) => {
      const on = v.selected?.id === p.id;
      return `<li><a class="gcsp-rec__item${on ? " gcsp-rec__item--on" : ""}" href="${ACP}?edit=${p.id}"${on ? ' aria-current="true"' : ""}>
        <span class="gcsp-rec__postIcon">${icon(p.icon || DEFAULT_ICON)}</span>
        <span class="gcsp-rec__itemText"><strong>${esc(p.name)}</strong><small>${groupPill(p.groupId ? groupMap.get(p.groupId) : undefined)} ${esc(ctx.t(`mode.${p.applyMode}`))}</small></span>
        ${p.pending > 0 ? `<span class="gcsp-rec__count" title="${esc(ctx.t("acp.pending"))}">${p.pending}</span>` : ""}
        ${tag(ctx, p)}
      </a></li>`;
    })
    .join("");
  const s = v.selected;
  const editing = s !== null || v.creating;
  const panel = editing
    ? `<form class="gcsp-rec__panel" method="post" action="${API}/positions/save">
        <h2>${esc(s ? ctx.t("acp.edit", { name: s.name }) : ctx.t("acp.new"))}</h2>
        ${s ? `<input type="hidden" name="id" value="${s.id}">` : ""}
        <label class="gcsp-rec__field"><span>${esc(ctx.t("field.name"))}</span><input class="gcsp-rec__input" name="name" maxlength="60" required${attrs({ value: s?.name ?? "", placeholder: ctx.t("field.namePh") })}></label>
        <label class="gcsp-rec__field"><span>${esc(ctx.t("field.description"))}</span><textarea class="gcsp-rec__input" name="description" rows="4" maxlength="600">${esc(s?.description ?? "")}</textarea></label>
        <div class="gcsp-rec__grid">
          <fieldset class="gcsp-rec__field"><legend>${esc(ctx.t("field.status"))}</legend><div class="gcsp-rec__seg">${STATUSES.map((st) => `<label><input type="radio" name="status"${attrs({ value: st, checked: (s?.status ?? "open") === st })}><span>${esc(ctx.t(`status.${st}`))}</span></label>`).join("")}</div></fieldset>
          <label class="gcsp-rec__field"><span>${esc(ctx.t("field.group"))}</span><select class="gcsp-rec__input" name="groupId">${option("", ctx.t("field.noGroup"), !s?.groupId)}${v.groups.map((g) => option(String(g.id), g.name, s?.groupId === g.id)).join("")}</select></label>
        </div>
        <fieldset class="gcsp-rec__field"><legend>${esc(ctx.t("field.applyMode"))}</legend><div class="gcsp-rec__seg">${APPLY_MODES.map((m) => `<label><input type="radio" name="applyMode"${attrs({ value: m, checked: (s?.applyMode ?? "form") === m })}><span>${esc(ctx.t(`mode.${m}`))}</span></label>`).join("")}</div><small class="gcs-muted">${esc(ctx.t("field.applyModeHint"))}</small></fieldset>
        <div class="gcsp-rec__grid">
          <label class="gcsp-rec__field"><span>${esc(ctx.t("field.forum"))}</span><select class="gcsp-rec__input" name="applyForumId">${option("", "—", !s?.applyForumId)}${v.forums.map((f) => option(String(f.id), f.name, s?.applyForumId === f.id)).join("")}</select><small class="gcs-muted">${esc(ctx.t("field.forumHint"))}</small></label>
          <label class="gcsp-rec__field"><span>${esc(ctx.t("field.url"))}</span><input class="gcsp-rec__input" name="applyUrl" maxlength="300"${attrs({ value: s?.applyUrl ?? "", placeholder: "https://" })}><small class="gcs-muted">${esc(ctx.t("field.urlHint"))}</small></label>
        </div>
        <label class="gcsp-rec__field"><span>${esc(ctx.t("field.questions"))}</span><textarea class="gcsp-rec__input" name="questions" rows="4" maxlength="1500"${attrs({ placeholder: ctx.t("field.questionsPh") })}>${esc(s?.questions ?? "")}</textarea><small class="gcs-muted">${esc(ctx.t("field.questionsHint"))}</small></label>
        <div class="gcsp-rec__grid">
          <label class="gcsp-rec__field"><span>${esc(ctx.t("field.icon"))}</span><input class="gcsp-rec__input" name="icon" maxlength="80"${attrs({ value: s?.icon ?? "", placeholder: DEFAULT_ICON })}></label>
          <label class="gcsp-rec__field"><span>${esc(ctx.t("field.sort"))}</span><input class="gcsp-rec__input" type="number" name="sort" min="-1000" max="1000"${attrs({ value: String(s?.sort ?? 0) })}></label>
        </div>
        <div class="gcsp-rec__actions">
          <button class="gcs-btn gcs-btn--primary" type="submit">${icon("fa-solid fa-floppy-disk")}${esc(ctx.t("acp.save"))}</button>
          <a class="gcs-btn gcs-btn--ghost" href="${ACP}">${esc(ctx.t("acp.cancel"))}</a>
        </div>
      </form>
      ${s ? `<form class="gcsp-rec__danger" method="post" action="${API}/positions/${s.id}/delete"><button class="gcs-btn gcs-btn--ghost gcs-btn--sm" type="submit">${icon("fa-solid fa-trash")}${esc(ctx.t("acp.delete"))}</button><small class="gcs-muted">${esc(ctx.t("acp.deleteHint"))}</small></form>` : ""}`
    : `<div class="gcsp-rec__panel gcsp-rec__panel--empty">${icon(DEFAULT_ICON)}<p>${esc(ctx.t("acp.pick"))}</p></div>`;
  return `<div class="gcsp-rec">
    ${notice(ctx, v.query)}
    <div class="gcsp-rec__toolbar">
      <a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${ACP}?new=1">${icon("fa-solid fa-plus")}${esc(ctx.t("acp.add"))}</a>
      <a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${ACP}/applications">${icon("fa-solid fa-inbox")}${esc(ctx.t("acp.applications"))}${v.pending > 0 ? ` <span class="gcsp-rec__count">${v.pending}</span>` : ""}</a>
      <a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${SITE}">${icon("fa-solid fa-arrow-up-right-from-square")}${esc(ctx.t("acp.view"))}</a>
    </div>
    <div class="gcsp-rec__split">
      <ul class="gcsp-rec__items" aria-label="${esc(ctx.t("acp.list"))}">${rows || `<li class="gcs-muted gcsp-rec__emptyList">${esc(ctx.t("acp.empty"))}</li>`}</ul>
      <div>${panel}</div>
    </div>
    <p class="gcs-muted gcsp-rec__hint">${esc(ctx.t("acp.indexHint"))}</p>
  </div>`;
}

/** ACP › Recrutare › Aplicații: filtrul după stare și fiecare aplicație cu răspunsurile și decizia. */
export function renderApplications(ctx: GcsPluginContext, v: { items: Application[]; users: Users; status: AppStatus | null; query: Record<string, string> }): string {
  const tabs = [null, ...APP_STATUSES]
    .map((st) => `<a class="gcsp-rec__tab${v.status === st ? " gcsp-rec__tab--on" : ""}" href="${ACP}/applications${st ? `?status=${st}` : ""}">${esc(ctx.t(st ? `app.${st}` : "app.all"))}</a>`)
    .join("");
  const items = v.items.length
    ? v.items
        .map((a) => {
          const u = v.users.get(a.userId);
          // Numele cu stilul lui și hover card-ul GCS (regula „numele peste tot”).
          const who = u ? `<a class="gcs-userLink"${attrs({ href: u.url, "data-user-id": u.id })}><span class="gcs-name--${esc(u.nameKey)}">${esc(u.name)}</span></a>` : `<span class="gcs-muted">${esc(ctx.t("app.deleted"))}</span>`;
          const decide =
            a.status === "pending"
              ? `<form class="gcsp-rec__decide" method="post" action="${API}/applications/${a.id}/status">
                  <input class="gcsp-rec__input" name="note" maxlength="500"${attrs({ placeholder: ctx.t("app.notePh") })}>
                  <button class="gcs-btn gcs-btn--primary gcs-btn--sm" type="submit" name="status" value="accepted">${icon("fa-solid fa-check")}${esc(ctx.t("app.accept"))}</button>
                  <button class="gcs-btn gcs-btn--ghost gcs-btn--sm" type="submit" name="status" value="rejected">${icon("fa-solid fa-xmark")}${esc(ctx.t("app.reject"))}</button>
                </form>`
              : a.note
                ? `<p class="gcs-muted">${esc(a.note)}</p>`
                : "";
          return `<article class="gcsp-rec__appCard">
            <header><strong>${esc(a.positionName)}</strong> · ${who} · ${timeTag(a.createdAt, ctx.locale)}<span class="gcsp-rec__app gcsp-rec__app--${a.status}">${esc(ctx.t(`app.${a.status}`))}</span></header>
            <div class="gcsp-rec__desc">${formatText(a.answers)}</div>
            ${decide}
          </article>`;
        })
        .join("")
    : `<p class="gcs-muted">${esc(ctx.t("app.empty"))}</p>`;
  return `<div class="gcsp-rec">
    ${notice(ctx, v.query)}
    <div class="gcsp-rec__toolbar"><a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${ACP}">${icon("fa-solid fa-arrow-left")}${esc(ctx.t("acp.back"))}</a><nav class="gcsp-rec__tabs">${tabs}</nav></div>
    <div class="gcsp-rec__apps">${items}</div>
  </div>`;
}
