/**
 * Paginile ACP ale Studioului VIP (`/admin/plugins/gcs.vip_studio/…`): prezentarea, cataloagele (listă, filtre,
 * adăugare cu încărcare, editare, ordine, activ / retras, ștergere), categoriile și echipamentele membrilor. Doar HTML
 * și formulare (fără JS în ACP); formularele trimit spre rutele API ale pluginului marcate `acp`.
 */
import type { GcsPluginContext, GcsPluginUser, GcsPluginVipPlan } from "../../../../src/index";
import { attrs, bannerLook, esc, icon, nameLook, vars } from "../html";
import type { Loadout } from "../loadout";
import {
  ANIMATIONS,
  EFFECTS,
  isNew,
  PLUGIN_KEY,
  SPEEDS,
  VARIANT_KEYS,
  type BackgroundData,
  type BannerData,
  type CardData,
  type Category,
  type FrameData,
  type Item,
  type Kind,
  type NameStyleData,
  type SongData,
  type ThemeData,
  type WeaponData,
} from "../model";

export const ACP_BASE = `/admin/plugins/${PLUGIN_KEY}`;
const API = `/api/plugins/${PLUGIN_KEY}/acp`;

/** Ruta ACP a fiecărui catalog. */
export const KIND_ROUTES: Record<Kind, string> = {
  name_style: "/name-styles",
  banner: "/banners",
  frame: "/frames",
  card: "/cards",
  weapon: "/weapons",
  background: "/backgrounds",
  theme: "/themes",
  song: "/songs",
};
export const ROUTE_KINDS = Object.fromEntries(Object.entries(KIND_ROUTES).map(([k, r]) => [r, k as Kind])) as Record<string, Kind>;
const UPLOAD_KINDS: Kind[] = ["frame", "card", "weapon", "background", "song"];
const CATEGORY_KINDS: Kind[] = ["frame", "card", "background"];

export type AcpCommon = { ctx: GcsPluginContext; plans: GcsPluginVipPlan[]; query: Record<string, string> };

function notice(c: AcpCommon): string {
  const { ctx, query } = c;
  if (query.saved === "1") return `<p class="gcsp-notice gcsp-notice--ok" role="status">${icon("fa-solid fa-circle-check")}${esc(ctx.t("acp.saved"))}</p>`;
  if (query.deleted === "1") return `<p class="gcsp-notice gcsp-notice--ok" role="status">${icon("fa-solid fa-trash")}${esc(ctx.t("acp.deleted"))}</p>`;
  if (query.error && /^[a-z_]{1,40}$/.test(query.error)) {
    const key = `errors.${query.error}`;
    const text = ctx.t(key);
    return `<p class="gcsp-notice gcsp-notice--error" role="alert">${icon("fa-solid fa-triangle-exclamation")}${esc(text === key ? ctx.t("errors.generic") : text)}${query.field ? ` (${esc(query.field.slice(0, 30))})` : ""}</p>`;
  }
  return "";
}

/** Navigarea între cataloage (cu numărul de elemente). */
function tabsNav(c: AcpCommon, active: string, counts: Partial<Record<Kind, number>>): string {
  const { ctx } = c;
  const link = (href: string, label: string, n?: number) =>
    `<a class="gcsp-acpTab${href === active ? " gcsp-acpTab--on" : ""}" href="${ACP_BASE}${href === "/" ? "" : href}"${attrs({ "aria-current": href === active ? "page" : null })}>${esc(label)}${n === undefined ? "" : `<span class="gcsp-acpTab__n">${n}</span>`}</a>`;
  return `<nav class="gcsp-acpTabs" aria-label="${esc(ctx.t("acp.nav"))}">${link("/", ctx.t("acp.overview"))}${(Object.keys(KIND_ROUTES) as Kind[])
    .map((k) => link(KIND_ROUTES[k], ctx.t(`acp.kinds.${k}`), counts[k]))
    .join("")}${link("/members", ctx.t("acp.members.title"))}</nav>`;
}

const hidden = (name: string, value: string | number) => `<input type="hidden"${attrs({ name, value })}>`;
const actionForm = (action: string, fields: Record<string, string | number>, label: string, iconName: string, opts: { danger?: boolean; route?: string; title?: string } = {}) =>
  `<form class="gcsp-inline" method="post" action="${API}${opts.route ?? "/action"}">${Object.entries(fields)
    .map(([k, v]) => hidden(k, v))
    .join("")}${hidden("op", action)}<button type="submit" class="gcsp-iconBtn${opts.danger ? " gcsp-iconBtn--danger" : ""}"${attrs({ title: opts.title ?? label, "aria-label": opts.title ?? label })}>${icon(iconName)}</button></form>`;

/** Avatarul de probă (inițiala) cu rama peste el, la mărimea dată (previzualizarea ramelor). */
function sampleAvatar(f: FrameData | null, size: "s" | "m" | "l" | "xl", user: GcsPluginUser | null): string {
  const img = user?.avatarUrl ? `<img class="gcsp-av__img" src="${esc(user.avatarUrl)}" alt="">` : `<span class="gcsp-av__initial">${esc(([...(user?.name ?? "A")][0] ?? "A").toUpperCase())}</span>`;
  const frame = f ? `<img class="gcsp-av__frame"${attrs({ src: f.image, alt: "", style: vars({ fs: f.scale, fx: f.x, fy: f.y }) })}>` : "";
  return `<span class="gcsp-av gcsp-av--${size}">${img}${frame}</span>`;
}

/** Desenul unui element în listă (miniatura sau previzualizarea lui). */
export function itemArt(item: Item, user: GcsPluginUser | null): string {
  switch (item.kind) {
    case "name_style": {
      const d = item.data as NameStyleData;
      const l = nameLook(d, d.variants[0]!);
      const dots = d.variants.length > 1 ? `<span class="gcsp-dots">${d.variants.map((v) => `<span class="gcsp-swatch__dot gcsp-swatch__dot--n${Math.min(v.colors.length, 5)}" style="${esc(vars(Object.fromEntries(v.colors.slice(0, 5).map((c, i) => [`c${i + 1}`, c]))))}"></span>`).join("")}</span>` : "";
      return `<span class="${esc(l.cls)}" style="${esc(l.style)}">${esc(user?.name ?? item.name)}</span>${dots}`;
    }
    case "banner": {
      const l = bannerLook(item.data as BannerData);
      return `<span class="${esc(l.cls)}" style="${esc(l.style)}">VIP</span>`;
    }
    case "frame":
      return sampleAvatar(item.data as FrameData, "m", user);
    case "card":
      return `<img class="gcsp-acpThumb" src="${esc((item.data as CardData).image)}" alt="">`;
    case "weapon":
      return `<img class="gcsp-weapon" src="${esc((item.data as WeaponData).icon)}" alt="">`;
    case "background": {
      const d = item.data as BackgroundData;
      return `<span class="gcsp-thumbWrap"><img class="gcsp-acpThumb" src="${esc(d.thumb ?? d.image)}" alt="">${d.video ? `<span class="gcsp-thumb__badge">${icon("fa-solid fa-play")}</span>` : ""}</span>`;
    }
    case "theme": {
      const d = item.data as ThemeData;
      return `<span class="gcsp-themeSwatch" style="${esc(vars({ ta: d.accent, ta2: d.accent2 ?? d.accent, ts: d.surface ?? null }))}"><span></span><span></span><span></span></span>`;
    }
    case "song": {
      const d = item.data as SongData;
      return `<span class="gcsp-disc">${icon(d.youtube ? "fa-brands fa-youtube" : "fa-solid fa-music")}</span>`;
    }
  }
}

function planNames(item: Item, plans: GcsPluginVipPlan[], ctx: GcsPluginContext): string {
  if (item.plans.length === 0) return ctx.t("acp.allPlans");
  return plans.filter((p) => item.plans.includes(p.key)).map((p) => p.name).join(", ") || ctx.t("acp.allPlans");
}

/** Lista unui catalog: filtrul pe categorii, tabelul cu acțiunile și formularul de adăugare. */
export function renderCatalog(c: AcpCommon & { kind: Kind; items: Item[]; categories: Category[]; user: GcsPluginUser | null; counts: Partial<Record<Kind, number>>; newDays: number }): string {
  const { ctx, kind, items, categories, plans } = c;
  const route = KIND_ROUTES[kind];
  const catFilter = c.query.category && /^\d{1,9}$/.test(c.query.category) ? Number(c.query.category) : null;
  const shown = catFilter === null ? items : items.filter((i) => i.categoryId === catFilter);
  const catName = (id: number | null) => categories.find((x) => x.id === id)?.name ?? "—";
  const rows = shown
    .map((item, i) => {
      const status = item.retired
        ? `<span class="gcs-badge gcs-badge--warn">${esc(ctx.t("acp.status.retired"))}</span>`
        : item.enabled
          ? `<span class="gcs-badge gcs-badge--ok">${esc(ctx.t("acp.status.active"))}</span>`
          : `<span class="gcs-badge gcs-badge--neutral">${esc(ctx.t("acp.status.disabled"))}</span>`;
      const fresh = isNew(item, c.newDays) ? ` <span class="gcsp-chip gcsp-chip--new">${esc(ctx.t("studio.new"))}</span>` : "";
      const actions = [
        actionForm("move", { id: item.id, dir: -1 }, ctx.t("acp.actions.up"), "fa-solid fa-arrow-up"),
        actionForm("move", { id: item.id, dir: 1 }, ctx.t("acp.actions.down"), "fa-solid fa-arrow-down"),
        actionForm("toggle", { id: item.id }, ctx.t(item.enabled ? "acp.actions.disable" : "acp.actions.enable"), item.enabled ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"),
        actionForm("retire", { id: item.id }, ctx.t(item.retired ? "acp.actions.restore" : "acp.actions.retire"), item.retired ? "fa-solid fa-box-open" : "fa-solid fa-box-archive"),
        `<a class="gcsp-iconBtn" href="${ACP_BASE}/item/${item.id}"${attrs({ title: ctx.t("acp.actions.edit"), "aria-label": ctx.t("acp.actions.edit") })}>${icon("fa-solid fa-pen")}</a>`,
        actionForm("item", { id: item.id }, ctx.t("acp.actions.delete"), "fa-solid fa-trash", { danger: true, route: "/delete" }),
      ].join("");
      return (
        `<tr class="gcs-table__row${item.enabled && !item.retired ? "" : " gcsp-row--muted"}" data-gcsp-item="${esc(item.key)}">` +
        `<td class="gcs-table__td gcsp-acpArt">${itemArt(item, c.user)}</td>` +
        `<td class="gcs-table__td"><a href="${ACP_BASE}/item/${item.id}"><strong>${esc(item.name)}</strong></a>${fresh}<br><code class="gcs-muted">${esc(item.key)}</code></td>` +
        (CATEGORY_KINDS.includes(kind) ? `<td class="gcs-table__td">${esc(catName(item.categoryId))}</td>` : "") +
        `<td class="gcs-table__td">${esc(planNames(item, plans, ctx))}</td><td class="gcs-table__td">${status}</td>` +
        `<td class="gcs-table__td"><span class="gcsp-actions">${actions}</span></td></tr>` +
        (i === shown.length - 1 ? "" : "")
      );
    })
    .join("");
  const catTabs =
    CATEGORY_KINDS.includes(kind) && categories.length > 0
      ? `<div class="gcsp-filters gcsp-filters--acp">${[`<a class="gcsp-filter${catFilter === null ? " gcsp-filter--on" : ""}" href="${ACP_BASE}${route}">${esc(ctx.t("studio.all"))}</a>`, ...categories.map((cat) => `<a class="gcsp-filter${catFilter === cat.id ? " gcsp-filter--on" : ""}" href="${ACP_BASE}${route}?category=${cat.id}">${esc(cat.name)}</a>`)].join("")}</div>`
      : "";
  const head =
    `<thead><tr><th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.preview"))}</th><th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.name"))}</th>` +
    (CATEGORY_KINDS.includes(kind) ? `<th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.category"))}</th>` : "") +
    `<th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.plans"))}</th><th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.status"))}</th><th class="gcs-table__th" scope="col">${esc(ctx.t("acp.cols.actions"))}</th></tr></thead>`;
  const table = shown.length > 0 ? `<div class="gcs-table"><table class="gcs-table__table">${head}<tbody>${rows}</tbody></table></div>` : `<p class="gcs-muted">${esc(ctx.t("acp.empty"))}</p>`;
  return (
    `<div class="gcsp-acp">${tabsNav(c, route, c.counts)}${notice(c)}` +
    `<div class="gcsp-acpHead"><p class="gcsp-panel__hint">${esc(ctx.t(`acp.hints.${kind}`))}</p><a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${ACP_BASE}/new/${kind}">${icon("fa-solid fa-plus")}${esc(ctx.t(`acp.add.${kind}`))}</a></div>` +
    `${catTabs}${table}${CATEGORY_KINDS.includes(kind) ? categoriesBox(c, kind, categories) : ""}</div>`
  );
}

function categoriesBox(c: AcpCommon, kind: Kind, categories: Category[]): string {
  const { ctx } = c;
  const list = categories
    .map(
      (cat) =>
        `<li class="gcsp-catRow"><form class="gcsp-inline gcsp-inline--grow" method="post" action="${API}/action">${hidden("op", "category_rename")}${hidden("id", cat.id)}` +
        `<input type="text" name="name" maxlength="40" required${attrs({ value: cat.name, "aria-label": ctx.t("acp.categories.name") })}><button type="submit" class="gcs-btn gcs-btn--ghost gcs-btn--sm">${esc(ctx.t("acp.categories.rename"))}</button></form>` +
        actionForm("category", { id: cat.id }, ctx.t("acp.categories.delete"), "fa-solid fa-trash", { danger: true, route: "/delete" }) +
        `</li>`,
    )
    .join("");
  return (
    `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.categories.title"))}</h3><p class="gcs-muted">${esc(ctx.t("acp.categories.hint"))}</p><ul class="gcsp-catList">${list}</ul>` +
    `<form class="gcsp-inline" method="post" action="${API}/action">${hidden("op", "category_add")}${hidden("kind", kind)}<input type="text" name="name" maxlength="40" required${attrs({ placeholder: ctx.t("acp.categories.new"), "aria-label": ctx.t("acp.categories.new") })}><button type="submit" class="gcs-btn gcs-btn--sm">${icon("fa-solid fa-plus")}${esc(ctx.t("acp.categories.add"))}</button></form></section>`
  );
}

// ─── Formularul unui element ─────────────────────────────────────────────────

const field = (label: string, control: string, hint?: string) => `<label class="gcsp-field"><span class="gcsp-field__label">${esc(label)}</span>${control}${hint ? `<span class="gcsp-field__hint">${esc(hint)}</span>` : ""}</label>`;
const select = (name: string, options: { value: string; label: string }[], value: string) =>
  `<select${attrs({ name })}>${options.map((o) => `<option${attrs({ value: o.value, selected: o.value === value })}>${esc(o.label)}</option>`).join("")}</select>`;
const color = (name: string, value: string | undefined, fallback: string) => `<input type="color"${attrs({ name, value: value ?? fallback })}>`;

/** Formularul de adăugare / editare, cu câmpurile tipului și previzualizarea (rama peste avatar la trei mărimi). */
export function renderItemForm(c: AcpCommon & { kind: Kind; item: Item | null; categories: Category[]; user: GcsPluginUser | null; usedBy: number }): string {
  const { ctx, kind, item, plans } = c;
  const d = item?.data as Record<string, unknown> | undefined;
  const fields: string[] = [];
  fields.push(field(ctx.t("acp.fields.name"), `<input type="text" name="name" maxlength="40" required${attrs({ value: item?.name ?? "" })}>`));
  if (CATEGORY_KINDS.includes(kind)) {
    fields.push(field(ctx.t("acp.fields.category"), select("categoryId", [{ value: "", label: "—" }, ...c.categories.map((cat) => ({ value: String(cat.id), label: cat.name }))], item?.categoryId ? String(item.categoryId) : "")));
  }
  switch (kind) {
    case "name_style": {
      const s = d as NameStyleData | undefined;
      fields.push(field(ctx.t("acp.fields.effect"), select("effect", EFFECTS.map((e) => ({ value: e, label: ctx.t(`effects.${e}`) })), s?.effect ?? "none")));
      fields.push(field(ctx.t("acp.fields.angle"), `<input type="number" name="angle" min="0" max="360" step="1"${attrs({ value: s?.angle ?? 90 })}>`));
      fields.push(field(ctx.t("acp.fields.speed"), select("speed", SPEEDS.map((v) => ({ value: v, label: ctx.t(`speeds.${v}`) })), s?.speed ?? "normal")));
      fields.push(`<label class="gcsp-check"><input type="checkbox" name="bold" value="1"${attrs({ checked: s ? s.bold : true })}> ${esc(ctx.t("acp.fields.bold"))}</label>`);
      fields.push(`<label class="gcsp-check"><input type="checkbox" name="italic" value="1"${attrs({ checked: s?.italic === true })}> ${esc(ctx.t("acp.fields.italic"))}</label>`);
      const variants = s?.variants ?? [{ key: "default", colors: ["#D62839"] }];
      const rows = Array.from({ length: 10 }, (_, i) => {
        const v = variants[i];
        return (
          `<tr class="gcs-table__row"><td class="gcs-table__td">${select(`variantKey${i}`, [{ value: "", label: "—" }, { value: "default", label: ctx.t("colors.default") }, ...VARIANT_KEYS.map((k) => ({ value: k, label: ctx.t(`studio.colors.${k}`) }))], v?.key ?? "")}</td>` +
          `<td class="gcs-table__td"><input type="text" maxlength="60" pattern="^(#[0-9a-fA-F]{6}[ ,]*){1,5}$"${attrs({ name: `variantColors${i}`, value: v?.colors.join(" ") ?? "", placeholder: "#FF0044 #7A5CFF", "aria-label": ctx.t("acp.fields.colors") })}></td>` +
          `<td class="gcs-table__td"><input type="text" maxlength="7" pattern="^#[0-9a-fA-F]{6}$"${attrs({ name: `variantGlow${i}`, value: v?.glow ?? "", placeholder: "#FFFFFF", "aria-label": ctx.t("acp.fields.glow") })}></td></tr>`
        );
      }).join("");
      fields.push(
        `<fieldset class="gcsp-acpBox"><legend>${esc(ctx.t("acp.fields.variants"))}</legend><p class="gcs-muted">${esc(ctx.t("acp.fields.variantsHint"))}</p>` +
          `<div class="gcs-table"><table class="gcs-table__table"><thead><tr><th class="gcs-table__th">${esc(ctx.t("acp.fields.variant"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.fields.colors"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.fields.glow"))}</th></tr></thead><tbody>${rows}</tbody></table></div></fieldset>`,
      );
      break;
    }
    case "banner": {
      const b = d as BannerData | undefined;
      fields.push(field(ctx.t("acp.fields.colors"), `<input type="text" name="colors" maxlength="60" required pattern="^(#[0-9a-fA-F]{6}[ ,]*){1,5}$"${attrs({ value: b?.fill.colors.join(" ") ?? "", placeholder: "#F59E0B #B45309" })}>`, ctx.t("acp.fields.colorsHint")));
      fields.push(field(ctx.t("acp.fields.angle"), `<input type="number" name="angle" min="0" max="360"${attrs({ value: b?.fill.angle ?? 90 })}>`));
      fields.push(field(ctx.t("acp.fields.animation"), select("animation", ANIMATIONS.map((a) => ({ value: a, label: ctx.t(`animations.${a}`) })), b?.fill.animation ?? "none")));
      fields.push(field(ctx.t("acp.fields.speed"), select("speed", SPEEDS.map((v) => ({ value: v, label: ctx.t(`speeds.${v}`) })), b?.fill.speed ?? "normal")));
      fields.push(field(ctx.t("acp.fields.text"), color("text", b?.text, "#FFFFFF")));
      break;
    }
    case "frame": {
      const f = d as FrameData | undefined;
      fields.push(field(ctx.t("acp.fields.frameFile"), `<input type="file" name="file" accept="image/png,image/webp,image/gif"${attrs({ required: !item })}>`, ctx.t("acp.fields.frameFileHint")));
      fields.push(field(ctx.t("acp.fields.scale"), `<input type="number" name="scale" min="100" max="160" step="1"${attrs({ value: f?.scale ?? 130 })}>`, ctx.t("acp.fields.scaleHint")));
      fields.push(field(ctx.t("acp.fields.offsetX"), `<input type="number" name="x" min="-20" max="20" step="1"${attrs({ value: f?.x ?? 0 })}>`));
      fields.push(field(ctx.t("acp.fields.offsetY"), `<input type="number" name="y" min="-20" max="20" step="1"${attrs({ value: f?.y ?? 0 })}>`));
      break;
    }
    case "card":
    case "weapon":
      fields.push(field(ctx.t(kind === "card" ? "acp.fields.cardFile" : "acp.fields.weaponFile"), `<input type="file" name="file" accept="image/png,image/webp,image/jpeg,image/gif"${attrs({ required: !item })}>`, ctx.t(kind === "card" ? "acp.fields.cardFileHint" : "acp.fields.weaponFileHint")));
      break;
    case "background": {
      const b = d as BackgroundData | undefined;
      fields.push(field(ctx.t("acp.fields.posterFile"), `<input type="file" name="file" accept="image/png,image/webp,image/jpeg"${attrs({ required: !item })}>`, ctx.t("acp.fields.posterHint")));
      fields.push(field(ctx.t("acp.fields.videoFile"), `<input type="file" name="video" accept="video/mp4,video/webm">`, ctx.t("acp.fields.videoHint")));
      if (b?.video) fields.push(`<label class="gcsp-check"><input type="checkbox" name="removeVideo" value="1"> ${esc(ctx.t("acp.fields.removeVideo"))}</label>`);
      break;
    }
    case "theme": {
      const t = d as ThemeData | undefined;
      fields.push(field(ctx.t("acp.fields.accent"), color("accent", t?.accent, "#22D3EE")));
      fields.push(field(ctx.t("acp.fields.accent2"), color("accent2", t?.accent2, "#38BDF8")));
      fields.push(field(ctx.t("acp.fields.surface"), color("surface", t?.surface, "#0B1220")));
      fields.push(`<label class="gcsp-check"><input type="checkbox" name="glow" value="1"${attrs({ checked: t?.glow === true })}> ${esc(ctx.t("acp.fields.glowPanels"))}</label>`);
      break;
    }
    case "song": {
      const s = d as SongData | undefined;
      fields.push(field(ctx.t("acp.fields.songTitle"), `<input type="text" name="title" maxlength="80" required${attrs({ value: s?.title ?? "" })}>`));
      fields.push(field(ctx.t("acp.fields.artist"), `<input type="text" name="artist" maxlength="80"${attrs({ value: s?.artist ?? "" })}>`));
      fields.push(field(ctx.t("acp.fields.audioFile"), `<input type="file" name="file" accept="audio/mpeg,audio/ogg">`, ctx.t("acp.fields.audioHint")));
      fields.push(field(ctx.t("acp.fields.youtube"), `<input type="url" name="youtube" maxlength="200"${attrs({ value: s?.youtube ? `https://youtu.be/${s.youtube}` : "", placeholder: "https://youtu.be/…" })}>`, ctx.t("acp.fields.youtubeHint")));
      break;
    }
  }
  const planBoxes = plans.length
    ? `<fieldset class="gcsp-acpBox"><legend>${esc(ctx.t("acp.fields.plans"))}</legend><p class="gcs-muted">${esc(ctx.t("acp.fields.plansHint"))}</p><div class="gcsp-checks">${plans
        .map((p) => `<label class="gcsp-check"><input type="checkbox" name="plans"${attrs({ value: p.key, checked: item?.plans.includes(p.key) === true })}> ${esc(p.name)}</label>`)
        .join("")}</div></fieldset>`
    : "";
  const flags =
    `<label class="gcsp-check"><input type="checkbox" name="enabled" value="1"${attrs({ checked: item ? item.enabled : true })}> ${esc(ctx.t("acp.fields.enabled"))}</label>` +
    `<label class="gcsp-check"><input type="checkbox" name="retired" value="1"${attrs({ checked: item?.retired === true })}> ${esc(ctx.t("acp.fields.retired"))}</label>`;
  const upload = UPLOAD_KINDS.includes(kind);
  const previewBox = item ? itemPreview(c, item) : "";
  const used = item ? `<p class="gcs-muted">${esc(ctx.t("acp.usedBy", { count: c.usedBy }))}</p>` : "";
  return (
    `<div class="gcsp-acp">${tabsNav(c, KIND_ROUTES[kind], {})}${notice(c)}` +
    `<p><a href="${ACP_BASE}${KIND_ROUTES[kind]}">${icon("fa-solid fa-arrow-left")} ${esc(ctx.t(`acp.kinds.${kind}`))}</a></p>${previewBox}${used}` +
    `<form class="gcsp-acpForm" method="post" action="${API}/item"${attrs({ enctype: upload ? "multipart/form-data" : null })}>` +
    `${hidden("kind", kind)}${item ? hidden("id", item.id) : ""}<div class="gcsp-acpFields">${fields.join("")}</div>${planBoxes}<div class="gcsp-checks">${flags}</div>` +
    `<div class="gcsp-acpActions"><button type="submit" class="gcs-btn gcs-btn--primary">${icon("fa-solid fa-floppy-disk")}${esc(ctx.t(item ? "acp.actions.save" : "acp.actions.create"))}</button>` +
    `<a class="gcs-btn gcs-btn--ghost" href="${ACP_BASE}${KIND_ROUTES[kind]}">${esc(ctx.t("acp.actions.cancel"))}</a></div></form></div>`
  );
}

/** Previzualizarea unui element în pagina de editare (ramele: peste un avatar la trei mărimi). */
function itemPreview(c: AcpCommon & { user: GcsPluginUser | null }, item: Item): string {
  const { ctx } = c;
  if (item.kind === "frame") {
    const f = item.data as FrameData;
    return `<section class="gcsp-acpBox gcsp-framePreview"><h3>${esc(ctx.t("acp.preview"))}</h3><div class="gcsp-framePreview__row">${(["s", "m", "l", "xl"] as const)
      .map((s) => `<figure>${sampleAvatar(f, s, c.user)}<figcaption>${esc(ctx.t(`acp.sizes.${s}`))}</figcaption></figure>`)
      .join("")}</div><p class="gcs-muted">${esc(ctx.t("acp.framePreviewHint"))}</p></section>`;
  }
  if (item.kind === "background") {
    const d = item.data as BackgroundData;
    return `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.preview"))}</h3>${d.video ? `<video class="gcsp-acpVideo" src="${esc(d.video)}" poster="${esc(d.image)}" controls preload="none"></video>` : `<img class="gcsp-acpWide" src="${esc(d.image)}" alt="">`}</section>`;
  }
  if (item.kind === "song") {
    const d = item.data as SongData;
    return `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.preview"))}</h3><p><strong>${esc(d.title)}</strong> ${esc(d.artist)}</p>${d.audio ? `<audio src="${esc(d.audio)}" controls preload="none"></audio>` : ""}${d.youtube ? `<p class="gcs-muted">YouTube: ${esc(d.youtube)}</p>` : ""}</section>`;
  }
  return `<section class="gcsp-acpBox gcsp-acpPreview"><h3>${esc(ctx.t("acp.preview"))}</h3>${itemArt(item, c.user)}</section>`;
}

// ─── Prezentarea și membrii ──────────────────────────────────────────────────

export function renderOverview(
  c: AcpCommon & { counts: Partial<Record<Kind, number>>; loadouts: number; usage: { files: number; bytes: number }; audit: { actor_id: string | null; action: string; detail: string; created_at: string }[]; names: Map<string, string> },
): string {
  const { ctx } = c;
  const card = (k: Kind) =>
    `<a class="gcsp-acpStat" href="${ACP_BASE}${KIND_ROUTES[k]}"><strong>${c.counts[k] ?? 0}</strong><span>${esc(ctx.t(`acp.kinds.${k}`))}</span></a>`;
  const mb = (c.usage.bytes / 1024 / 1024).toFixed(1);
  const log = c.audit.length
    ? `<ul class="gcsp-audit">${c.audit
        .map((a) => `<li><time datetime="${esc(a.created_at)}">${esc(new Date(a.created_at).toLocaleString(ctx.locale))}</time> <strong>${esc(c.names.get(a.actor_id ?? "") ?? "—")}</strong> ${esc(ctx.t(`acp.audit.${a.action}`))} <span class="gcs-muted">${esc(a.detail)}</span></li>`)
        .join("")}</ul>`
    : `<p class="gcs-muted">${esc(ctx.t("acp.audit.empty"))}</p>`;
  return (
    `<div class="gcsp-acp">${tabsNav(c, "/", c.counts)}${notice(c)}<p class="gcsp-panel__hint">${esc(ctx.t("acp.intro"))}</p>` +
    `<div class="gcsp-acpStats">${(Object.keys(KIND_ROUTES) as Kind[]).map(card).join("")}<a class="gcsp-acpStat" href="${ACP_BASE}/members"><strong>${c.loadouts}</strong><span>${esc(ctx.t("acp.members.title"))}</span></a></div>` +
    `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.media.title"))}</h3><p>${esc(ctx.t("acp.media.usage", { files: c.usage.files, mb }))}</p></section>` +
    `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.links.title"))}</h3><ul class="gcsp-links"><li><a href="/p/${PLUGIN_KEY}">${esc(ctx.t("acp.links.studio"))}</a></li><li><a href="/p/${PLUGIN_KEY}/benefits">${esc(ctx.t("acp.links.benefits"))}</a></li><li><a href="/admin/system/applications/plugins/${PLUGIN_KEY}">${esc(ctx.t("acp.links.settings"))}</a></li></ul></section>` +
    `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.restore.title"))}</h3><p class="gcs-muted">${esc(ctx.t("acp.restore.hint"))}</p>` +
    `<form class="gcsp-inline" method="post" action="${API}/action">${hidden("op", "presets_missing")}<button type="submit" class="gcs-btn gcs-btn--sm">${icon("fa-solid fa-plus")}${esc(ctx.t("acp.restore.missing"))}</button></form> ` +
    `<form class="gcsp-inline" method="post" action="${API}/action">${hidden("op", "presets_restore")}<button type="submit" class="gcs-btn gcs-btn--ghost gcs-btn--sm">${icon("fa-solid fa-rotate-left")}${esc(ctx.t("acp.restore.all"))}</button></form></section>` +
    `<section class="gcsp-acpBox"><h3>${esc(ctx.t("acp.audit.title"))}</h3>${log}</section></div>`
  );
}

export function renderMembers(c: AcpCommon & { rows: { userId: string; loadout: Loadout; testMode: boolean; updatedAt: string }[]; users: Map<string, GcsPluginUser>; total: number; page: number; perPage: number; counts: Partial<Record<Kind, number>> }): string {
  const { ctx } = c;
  const chosen = (l: Loadout) =>
    [l.nameStyle && ctx.t("groups.name"), l.frame && ctx.t("groups.frame"), l.banner && ctx.t("groups.banner"), l.card && ctx.t("groups.card"), l.weapon && ctx.t("groups.weapon"), l.background && ctx.t("groups.background"), l.quote && ctx.t("groups.quote"), l.theme && ctx.t("groups.theme"), l.song && ctx.t("groups.song")]
      .filter(Boolean)
      .join(", ");
  const rows = c.rows
    .map((r) => {
      const u = c.users.get(r.userId);
      const name = u ? `<a class="gcs-userLink gcs-name--${esc(u.nameKey)}"${attrs({ href: u.url, "data-user-id": u.id })}>${esc(u.name)}</a>` : `<code>${esc(r.userId)}</code>`;
      return (
        `<tr class="gcs-table__row"><td class="gcs-table__td">${name}${r.testMode ? ` <span class="gcs-badge gcs-badge--neutral">${esc(ctx.t("acp.members.test"))}</span>` : ""}</td>` +
        `<td class="gcs-table__td">${esc(chosen(r.loadout) || "—")}</td>` +
        `<td class="gcs-table__td">${r.loadout.quote ? `<q>${esc(r.loadout.quote)}</q>` : "—"}</td>` +
        `<td class="gcs-table__td"><time datetime="${esc(r.updatedAt)}">${esc(new Date(r.updatedAt).toLocaleString(ctx.locale))}</time></td>` +
        `<td class="gcs-table__td"><span class="gcsp-actions">${r.loadout.quote ? actionForm("reset_quote", { userId: r.userId }, ctx.t("acp.members.resetQuote"), "fa-solid fa-quote-left") : ""}${actionForm("reset_member", { userId: r.userId }, ctx.t("acp.members.reset"), "fa-solid fa-rotate-left", { danger: true })}</span></td></tr>`
      );
    })
    .join("");
  const pages = Math.max(1, Math.ceil(c.total / c.perPage));
  const pager =
    pages > 1
      ? `<nav class="gcsp-pager">${c.page > 1 ? `<a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${ACP_BASE}/members?page=${c.page - 1}">${esc(ctx.t("acp.prev"))}</a>` : ""}<span>${c.page} / ${pages}</span>${c.page < pages ? `<a class="gcs-btn gcs-btn--ghost gcs-btn--sm" href="${ACP_BASE}/members?page=${c.page + 1}">${esc(ctx.t("acp.next"))}</a>` : ""}</nav>`
      : "";
  return (
    `<div class="gcsp-acp">${tabsNav(c, "/members", c.counts)}${notice(c)}<p class="gcsp-panel__hint">${esc(ctx.t("acp.members.hint"))}</p>` +
    (c.rows.length
      ? `<div class="gcs-table"><table class="gcs-table__table"><thead><tr><th class="gcs-table__th">${esc(ctx.t("acp.members.member"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.members.chosen"))}</th><th class="gcs-table__th">${esc(ctx.t("groups.quote"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.members.updated"))}</th><th class="gcs-table__th">${esc(ctx.t("acp.cols.actions"))}</th></tr></thead><tbody>${rows}</tbody></table></div>${pager}`
      : `<p class="gcs-muted">${esc(ctx.t("acp.members.empty"))}</p>`) +
    `</div>`
  );
}
