/**
 * Widget-ul „VIP online” (caruselul membrilor VIP) și pagina publică a beneficiilor. Ambele arată membrii exact ca pe
 * site: numele cu stilul ales (și clasa GCS a grupului), rama, banner-ul planului.
 */
import type { GcsPluginContext, GcsPluginVipMember, GcsPluginVipPlan } from "../../../../src/index";
import { attrs, bannerLook, esc, icon, nameLook, vars } from "../html";
import { bannerLabelFor, type Catalog, type Loadout } from "../loadout";
import { inkFor, isAvailable, planAllows, PLUGIN_KEY, type Access, type BannerData, type FrameData, type Item, type Kind, type NameStyleData } from "../model";

const allowedFor = <K extends Kind>(catalog: Catalog, kind: K, key: string | undefined, access: Access): Item<K> | null => {
  const item = key ? (catalog[kind].get(key) as Item<K> | undefined) : undefined;
  return item && isAvailable(item) && planAllows(item, access) ? item : null;
};

/** Un card din carusel: avatarul cu ramă, numele stilizat (link cu hover card), banner-ul și starea. */
function rosterCard(ctx: GcsPluginContext, m: GcsPluginVipMember, loadout: Loadout | null, catalog: Catalog, plan: GcsPluginVipPlan | undefined, testMode: boolean): string {
  const access: Access = { vip: true, plan: m.plan, planName: m.planName, testAll: testMode };
  const l = loadout ?? {};
  const style = allowedFor(catalog, "name_style", l.nameStyle, access);
  const variant = style ? ((style.data as NameStyleData).variants.find((v) => v.key === l.nameVariant) ?? (style.data as NameStyleData).variants[0]!) : null;
  const look = style && variant ? nameLook(style.data as NameStyleData, variant) : { cls: "", style: "" };
  const banner = allowedFor(catalog, "banner", l.banner, access);
  const color = plan?.color && /^#[0-9a-fA-F]{6}$/.test(plan.color) ? plan.color.toUpperCase() : "#D62839";
  const bl = bannerLook((banner?.data as BannerData | undefined) ?? { fill: { colors: [color], angle: 90, animation: "none", speed: "normal" }, text: inkFor(color) });
  const frame = allowedFor(catalog, "frame", l.frame, access);
  const f = frame?.data as FrameData | undefined;
  const initial = esc([...m.name.trim()][0]?.toUpperCase() ?? "?");
  const img = m.avatarUrl ? `<img class="gcsp-av__img" src="${esc(m.avatarUrl)}" alt="">` : `<span class="gcsp-av__initial">${initial}</span>`;
  const frameImg = f ? `<img class="gcsp-av__frame"${attrs({ src: f.image, alt: "", style: vars({ fs: f.scale, fx: f.x, fy: f.y }) })}>` : "";
  const status = m.online
    ? `<span class="gcsp-online"><span class="gcsp-online__dot"></span>${esc(ctx.t("roster.online"))}</span>`
    : `<span class="gcsp-roster__seen">${esc(m.lastActiveAt ? ctx.t("roster.seen", { date: new Date(m.lastActiveAt).toLocaleDateString(ctx.locale, { day: "numeric", month: "short" }) }) : ctx.t("roster.offline"))}</span>`;
  return (
    `<li class="gcsp-roster__item" style="${esc(vars({ plan: color }))}">` +
    `<div class="gcsp-roster__card"><span class="gcsp-av gcsp-av--l">${img}${frameImg}</span>` +
    `<a class="gcs-userLink gcs-name--${esc(m.nameKey)} gcsp-roster__name ${look.cls}"${attrs({ href: m.url, "data-user-id": m.id, style: look.style || null })}>${esc(m.name)}</a>` +
    `<span class="${esc(bl.cls)}" style="${esc(bl.style)}">${esc(bannerLabelFor(l, access))}</span>${status}</div></li>`
  );
}

export function renderRoster(
  ctx: GcsPluginContext,
  input: { members: GcsPluginVipMember[]; loadouts: Map<string, { loadout: Loadout; testMode: boolean }>; catalog: Catalog; plans: GcsPluginVipPlan[]; vipPageUrl: string },
): string {
  if (input.members.length === 0) {
    return (
      `<div class="gcsp-roster gcsp-roster--empty">${icon("fa-solid fa-crown")}<p>${esc(ctx.t("roster.empty"))}</p>` +
      `<a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${esc(input.vipPageUrl)}">${esc(ctx.t("roster.cta"))}</a></div>`
    );
  }
  const cards = input.members.map((m) => {
    const saved = input.loadouts.get(m.id);
    return rosterCard(ctx, m, saved?.loadout ?? null, input.catalog, input.plans.find((p) => p.key === m.plan), saved?.testMode === true);
  });
  const online = input.members.filter((m) => m.online).length;
  return (
    `<div class="gcsp-roster"${attrs({ "data-gcsp-roster": "1", "data-gcsp-prev": ctx.t("roster.prev"), "data-gcsp-next": ctx.t("roster.next") })}>` +
    `<p class="gcsp-roster__summary">${esc(ctx.t("roster.summary", { online, total: input.members.length }))}</p>` +
    `<ul class="gcsp-roster__track" role="list"${attrs({ "aria-label": ctx.t("roster.label") })}>${cards.join("")}</ul>` +
    `<a class="gcsp-roster__more" href="/p/${PLUGIN_KEY}/benefits">${esc(ctx.t("roster.more"))}</a></div>`
  );
}

/** Pagina beneficiilor: ce aduce pluginul (doar ce e activ în ACP), pe planuri. */
export function renderBenefits(ctx: GcsPluginContext, input: { catalog: Catalog; plans: GcsPluginVipPlan[]; vipPageUrl: string; allowCustomLabel: boolean; allowSong: boolean }): string {
  const { catalog, plans } = input;
  const count = (kind: Kind, plan: string | null) =>
    [...catalog[kind].values()].filter((i) => isAvailable(i) && (plan === null ? true : i.plans.length === 0 || i.plans.includes(plan))).length;
  const variants = [...catalog.name_style.values()].filter((i) => isAvailable(i) && (i.data as NameStyleData).variants.length > 1).length;
  const rows: { icon: string; title: string; body: string; kind: Kind | null }[] = [
    { icon: "fa-solid fa-signature", title: ctx.t("benefits.name.title", { count: count("name_style", null) }), body: ctx.t("benefits.name.body", { variants }), kind: "name_style" },
    { icon: "fa-solid fa-circle-user", title: ctx.t("benefits.frame.title", { count: count("frame", null) }), body: ctx.t("benefits.frame.body"), kind: "frame" },
    { icon: "fa-solid fa-ribbon", title: ctx.t("benefits.banner.title", { count: count("banner", null) }), body: ctx.t(input.allowCustomLabel ? "benefits.banner.bodyCustom" : "benefits.banner.body"), kind: "banner" },
    { icon: "fa-solid fa-image", title: ctx.t("benefits.card.title", { count: count("card", null) }), body: ctx.t("benefits.card.body"), kind: "card" },
    { icon: "fa-solid fa-crosshairs", title: ctx.t("benefits.weapon.title", { count: count("weapon", null) }), body: ctx.t("benefits.weapon.body"), kind: "weapon" },
    { icon: "fa-solid fa-film", title: ctx.t("benefits.background.title", { count: count("background", null) }), body: ctx.t("benefits.background.body"), kind: "background" },
    { icon: "fa-solid fa-quote-left", title: ctx.t("benefits.quote.title"), body: ctx.t("benefits.quote.body"), kind: null },
    { icon: "fa-solid fa-palette", title: ctx.t("benefits.theme.title", { count: count("theme", null) }), body: ctx.t("benefits.theme.body"), kind: "theme" },
    { icon: "fa-solid fa-users", title: ctx.t("benefits.roster.title"), body: ctx.t("benefits.roster.body"), kind: null },
  ];
  if (input.allowSong || count("song", null) > 0) rows.splice(8, 0, { icon: "fa-solid fa-music", title: ctx.t("benefits.song.title"), body: ctx.t("benefits.song.body"), kind: null });
  const visible = rows.filter((r) => r.kind === null || count(r.kind, null) > 0);
  const list = visible.map((r) => `<li class="gcsp-benefit">${icon(r.icon)}<div><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p></div></li>`).join("");
  const kinds = visible.filter((r) => r.kind !== null);
  const table =
    plans.length > 0
      ? `<div class="gcs-table gcsp-plansTable"><table class="gcs-table__table"><caption class="gcsp-sr">${esc(ctx.t("benefits.byPlan"))}</caption><thead><tr><th class="gcs-table__th" scope="col"></th>${plans
          .map((p) => `<th class="gcs-table__th" scope="col"><span class="gcsp-planDot" style="${esc(vars({ plan: p.color && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#D62839" }))}"></span>${esc(p.name)}</th>`)
          .join("")}</tr></thead><tbody>${kinds
          .map((r) => `<tr class="gcs-table__row"><th class="gcs-table__td" scope="row">${esc(ctx.t(`benefits.kinds.${r.kind}`))}</th>${plans.map((p) => `<td class="gcs-table__td">${count(r.kind!, p.key)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      : "";
  return (
    `<div class="gcsp-benefits"><header class="gcsp-hero gcsp-hero--benefits"><div class="gcsp-hero__copy"><p class="gcsp-hero__lede">${esc(ctx.t("benefits.lede"))}</p>` +
    `<p class="gcsp-hero__actions"><a class="gcs-btn gcs-btn--primary" href="${esc(input.vipPageUrl)}">${esc(ctx.t("benefits.cta"))}</a><a class="gcs-btn gcs-btn--ghost" href="/p/${PLUGIN_KEY}">${esc(ctx.t("benefits.tryStudio"))}</a></p></div></header>` +
    `<ul class="gcsp-benefitList">${list}</ul>${table}</div>`
  );
}
