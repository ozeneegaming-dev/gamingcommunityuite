/**
 * Pagina studioului (`/p/gcs.vip_studio`): antetul cu identitatea live, cele două moduri (Profil mic / Profil complet)
 * cu tab-urile lor, grila de opțiuni, previzualizarea lipită și bara de salvare. Funcționează și fără JS (tab-urile sunt
 * radio-uri, previzualizarea din plăci, salvarea un formular obișnuit); JS-ul (pluginul semnat) adaugă previzualizarea
 * live, numărătoarea modificărilor, ferestrele, tragerea fundalului, player-ul și încărcarea pe loturi.
 */
import type { GcsPluginContext, GcsPluginUser, GcsPluginVipPlan } from "../../../../src/index";
import { attrs, bannerLook, DEFAULT_BANNER, esc, icon, nameLook, vars, type Look } from "../html";
import { bannerLabelFor, LABEL_MAX, QUOTE_MAX, type Catalog, type Loadout } from "../loadout";
import {
  inkFor,
  isAvailable,
  isNew,
  planAllows,
  PLUGIN_KEY,
  type Access,
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

export type StudioSettings = { vipPageUrl: string; newDays: number; allowCustomLabel: boolean; allowYoutube: boolean; allowSongUpload: boolean; songMaxMb: number };

export type StudioInput = {
  ctx: GcsPluginContext;
  user: GcsPluginUser;
  access: Access;
  plans: GcsPluginVipPlan[];
  catalog: Catalog;
  categories: Category[];
  loadout: Loadout;
  settings: StudioSettings;
  query: Record<string, string>;
};

const MINI_TABS = [
  { key: "name", icon: "fa-solid fa-signature" },
  { key: "frame", icon: "fa-solid fa-circle-user" },
  { key: "banner", icon: "fa-solid fa-ribbon" },
  { key: "card", icon: "fa-solid fa-image" },
  { key: "weapon", icon: "fa-solid fa-crosshairs" },
] as const;
const FULL_TABS = [
  { key: "background", icon: "fa-solid fa-film" },
  { key: "quote", icon: "fa-solid fa-quote-left" },
  { key: "theme", icon: "fa-solid fa-palette" },
  { key: "song", icon: "fa-solid fa-music" },
] as const;
/** Câte plăci apar din prima; restul se încarcă pe loturi (cu JS). */
const FIRST_BATCH = 20;
const API = `/api/plugins/${PLUGIN_KEY}`;

const sorted = <K extends Kind>(map: Map<string, Item<K>>) => [...map.values()].filter((i) => i.enabled).sort((a, b) => a.position - b.position || a.id - b.id);

/** Numele planurilor unui element („Gold, Legend” sau „VIP” pentru toți). */
function plansLabel(item: Item, plans: GcsPluginVipPlan[], t: GcsPluginContext["t"]): string {
  if (item.plans.length === 0) return t("studio.lock.vip");
  const names = plans.filter((p) => item.plans.includes(p.key)).map((p) => p.name);
  return names.length > 0 ? names.join(", ") : t("studio.lock.vip");
}

type TileOpts = {
  group: string;
  name: string;
  value: string;
  checked: boolean;
  label: string;
  art: string;
  item?: Item;
  extraClass?: string;
  data?: Record<string, string | number | null | undefined>;
  index: number;
};

/** O placă de opțiune: radio-ul (vizual ascuns), desenul, numele și insignele (blocat, nou, retras). */
function tile(input: StudioInput, o: TileOpts): string {
  const { ctx, access, plans, settings } = input;
  const item = o.item;
  const retired = item ? !isAvailable(item) : false;
  const locked = item ? !planAllows(item, access) : false;
  const chips = [
    retired ? `<span class="gcsp-chip gcsp-chip--retired">${esc(ctx.t("studio.retired"))}</span>` : "",
    !retired && item && isNew(item, settings.newDays) ? `<span class="gcsp-chip gcsp-chip--new">${esc(ctx.t("studio.new"))}</span>` : "",
    !retired && locked ? `<span class="gcsp-chip gcsp-chip--lock" title="${esc(ctx.t("studio.lock.title", { plans: plansLabel(item!, plans, ctx.t) }))}">${icon("fa-solid fa-lock")}${esc(plansLabel(item!, plans, ctx.t))}</span>` : "",
  ].join("");
  // Doar cu JS se ascund (și apoi se arată pe loturi); JS-ul arată din prima tot până la placa aleasă.
  const later = o.index >= FIRST_BATCH ? " gcsp-later" : "";
  return (
    `<label class="gcsp-tile gcsp-tile--${o.group}${o.extraClass ? ` ${o.extraClass}` : ""}${retired ? " gcsp-tile--retired" : ""}${locked ? " gcsp-tile--locked" : ""}${later}"` +
    `${attrs({ "data-gcsp-cat": item?.categoryId ?? null })}>` +
    `<input class="gcsp-sr" type="radio"${attrs({ name: o.name, value: o.value, checked: o.checked, disabled: retired, ...Object.fromEntries(Object.entries(o.data ?? {}).map(([k, v]) => [`data-gcsp-${k}`, v])) })}>` +
    `<span class="gcsp-tile__art">${o.art}</span>` +
    `<span class="gcsp-tile__label">${esc(o.label)}</span>` +
    (chips ? `<span class="gcsp-tile__chips">${chips}</span>` : "") +
    `</label>`
  );
}

const lookAttrs = (l: Look) => `class="${esc(l.cls)}" style="${esc(l.style)}"`;

/** Avatarul membrului (imaginea sau inițiala), cu rama aleasă peste el. */
function avatar(user: GcsPluginUser, size: "s" | "m" | "l" | "xl", frame: Item<"frame"> | null, pv = true): string {
  const initial = esc([...user.name.trim()][0]?.toUpperCase() ?? "?");
  const img = user.avatarUrl ? `<img class="gcsp-av__img" src="${esc(user.avatarUrl)}" alt="">` : `<span class="gcsp-av__initial">${initial}</span>`;
  const f = frame?.data as FrameData | undefined;
  const frameImg = `<img class="gcsp-av__frame${f ? "" : " gcsp-hide"}"${attrs({ src: f?.image ?? null, alt: "", "data-gcsp-pv": pv ? "frame" : null, style: vars({ fs: f?.scale ?? 130, fx: f?.x ?? 0, fy: f?.y ?? 0 }) })}>`;
  return `<span class="gcsp-av gcsp-av--${size}">${img}${frameImg}</span>`;
}

function chosen<K extends Kind>(map: Map<string, Item<K>>, key: string | undefined): Item<K> | null {
  const item = key ? map.get(key) : undefined;
  return item && isAvailable(item) ? item : null;
}

/** Datele previzualizării: alegerile salvate (sau implicite), ca HTML-ul inițial să arate starea reală. */
function current(input: StudioInput) {
  const { catalog, loadout } = input;
  const style = chosen(catalog.name_style, loadout.nameStyle);
  const variant = style ? ((style.data as NameStyleData).variants.find((v) => v.key === loadout.nameVariant) ?? (style.data as NameStyleData).variants[0]!) : null;
  return {
    style,
    variant,
    banner: chosen(catalog.banner, loadout.banner),
    frame: chosen(catalog.frame, loadout.frame),
    card: chosen(catalog.card, loadout.card),
    weapon: chosen(catalog.weapon, loadout.weapon),
    background: chosen(catalog.background, loadout.background),
    theme: chosen(catalog.theme, loadout.theme),
    song: loadout.song === "custom" ? null : chosen(catalog.song, loadout.song),
  };
}

/** Aspectul numelui fără stil ales: clasa grupului (GCS), ca pe site. */
const groupNameLook = (user: GcsPluginUser): Look => ({ cls: `gcsp-nsGroup gcs-name--${user.nameKey}`, style: "" });

function planColor(input: StudioInput): string {
  const plan = input.plans.find((p) => p.key === input.access.plan);
  return plan?.color && /^#[0-9a-fA-F]{6}$/.test(plan.color) ? plan.color.toUpperCase() : DEFAULT_BANNER.fill.colors[0]!;
}

/** Banner-ul implicit: culoarea planului (ca bara grupului din postbit). */
function defaultBannerLook(input: StudioInput): Look {
  const color = planColor(input);
  return bannerLook({ fill: { colors: [color], angle: 90, animation: "none", speed: "normal" }, text: inkFor(color) });
}

// ─── Panourile ───────────────────────────────────────────────────────────────

function namePanel(input: StudioInput): string {
  const { ctx, user, loadout } = input;
  const items = sorted(input.catalog.name_style);
  const parts: string[] = [];
  const defLook = groupNameLook(user);
  parts.push(
    tile(input, {
      group: "name",
      name: "nameStyle",
      value: "",
      checked: !loadout.nameStyle,
      label: ctx.t("studio.name.default"),
      art: `<span ${lookAttrs(defLook)}>${esc(user.name)}</span>`,
      index: 0,
    }),
  );
  items.forEach((item, i) => {
    const d = item.data as NameStyleData;
    const selected = loadout.nameStyle === item.key;
    const variant = (selected && d.variants.find((v) => v.key === loadout.nameVariant)) || d.variants[0]!;
    const look = nameLook(d, variant);
    const multi = d.variants.length > 1;
    parts.push(
      tile(input, {
        group: "name",
        name: "nameStyle",
        value: item.key,
        checked: selected,
        label: item.name,
        art: `<span ${lookAttrs(look)}>${esc(user.name)}</span>${multi ? `<span class="gcsp-tile__count">${esc(ctx.t("studio.name.variants", { count: d.variants.length }))}</span>` : ""}`,
        item,
        extraClass: multi ? "gcsp-tile--variants" : "",
        index: i + 1,
      }),
    );
    if (multi) {
      const swatches = d.variants
        .map((v) => {
          const vl = nameLook(d, v);
          const checked = selected ? v.key === variant.key : v === d.variants[0];
          return (
            `<label class="gcsp-swatch" title="${esc(ctx.t(`studio.colors.${v.key}`))}">` +
            `<input class="gcsp-sr" type="radio"${attrs({ name: "nameVariant", value: `${item.key}:${v.key}`, checked: selected && checked, "data-gcsp-cls": vl.cls, "data-gcsp-style": vl.style })}>` +
            `<span class="gcsp-swatch__dot gcsp-swatch__dot--n${Math.min(v.colors.length, 5)}" style="${esc(vars(Object.fromEntries(v.colors.slice(0, 5).map((c, j) => [`c${j + 1}`, c]))))}"></span>` +
            `<span class="gcsp-sr">${esc(ctx.t(`studio.colors.${v.key}`))}</span></label>`
          );
        })
        .join("");
      parts.push(`<div class="gcsp-variants" role="radiogroup" aria-label="${esc(ctx.t("studio.name.colorsOf", { name: item.name }))}"><span class="gcsp-variants__label">${esc(ctx.t("studio.name.pickColor"))}</span>${swatches}</div>`);
    }
  });
  return parts.join("");
}

function bannerPanel(input: StudioInput): string {
  const { ctx, loadout, access, settings } = input;
  const label = bannerLabelFor(loadout, access);
  const parts = [
    tile(input, {
      group: "banner",
      name: "banner",
      value: "",
      checked: !loadout.banner,
      label: ctx.t("studio.banner.default"),
      art: `<span ${lookAttrs(defaultBannerLook(input))} data-gcsp-label>${esc(label)}</span>`,
      index: 0,
    }),
  ];
  sorted(input.catalog.banner).forEach((item, i) => {
    const look = bannerLook(item.data as BannerData);
    parts.push(tile(input, { group: "banner", name: "banner", value: item.key, checked: loadout.banner === item.key, label: item.name, art: `<span ${lookAttrs(look)} data-gcsp-label>${esc(label)}</span>`, item, index: i + 1 }));
  });
  const custom = settings.allowCustomLabel
    ? `<label class="gcsp-field gcsp-field--inline"><span class="gcsp-field__label">${esc(ctx.t("studio.banner.label"))}</span>` +
      `<input type="text" name="bannerLabel" maxlength="${LABEL_MAX}"${attrs({ value: loadout.bannerLabel ?? "", placeholder: access.planName ?? "VIP", "data-gcsp-banner-label": true })}>` +
      `<span class="gcsp-field__hint">${esc(ctx.t("studio.banner.labelHint"))}</span></label>`
    : "";
  return `${custom}<div class="gcsp-grid gcsp-grid--banner">${parts.join("")}</div>`;
}

/** Filtrele pe categorii (cu JS): „Toate” + categoriile catalogului. */
function filters(input: StudioInput, kind: Kind): string {
  const cats = input.categories.filter((c) => c.kind === kind);
  if (cats.length === 0) return "";
  const pill = (id: string, label: string, active: boolean) => `<button type="button" class="gcsp-filter${active ? " gcsp-filter--on" : ""}"${attrs({ "data-gcsp-filter": id, "aria-pressed": active ? "true" : "false" })}>${esc(label)}</button>`;
  return `<div class="gcsp-filters" role="toolbar" aria-label="${esc(input.ctx.t("studio.filters"))}">${pill("all", input.ctx.t("studio.all"), true)}${cats.map((c) => pill(String(c.id), c.name, false)).join("")}</div>`;
}

function framePanel(input: StudioInput): string {
  const { ctx, user, loadout } = input;
  const parts = [tile(input, { group: "frame", name: "frame", value: "", checked: !loadout.frame, label: ctx.t("studio.frame.none"), art: avatar(user, "l", null, false), index: 0 })];
  sorted(input.catalog.frame).forEach((item, i) => {
    const d = item.data as FrameData;
    parts.push(
      tile(input, {
        group: "frame",
        name: "frame",
        value: item.key,
        checked: loadout.frame === item.key,
        label: item.name,
        art: avatar(user, "l", item, false),
        item,
        data: { src: d.image, fs: d.scale, fx: d.x, fy: d.y },
        index: i + 1,
      }),
    );
  });
  return `${filters(input, "frame")}<div class="gcsp-grid gcsp-grid--frame">${parts.join("")}</div>`;
}

function cardPanel(input: StudioInput): string {
  const { ctx, loadout } = input;
  const parts = [tile(input, { group: "card", name: "card", value: "", checked: !loadout.card, label: ctx.t("studio.card.none"), art: `<span class="gcsp-thumb gcsp-thumb--empty">${icon("fa-solid fa-ban")}</span>`, index: 0 })];
  sorted(input.catalog.card).forEach((item, i) => {
    const d = item.data as CardData;
    parts.push(
      tile(input, { group: "card", name: "card", value: item.key, checked: loadout.card === item.key, label: item.name, art: `<img class="gcsp-thumb" src="${esc(d.image)}" alt="">`, item, data: { src: d.image }, index: i + 1 }),
    );
  });
  const x = loadout.cardX ?? 50;
  const y = loadout.cardY ?? 50;
  const position =
    `<div class="gcsp-position"><span class="gcsp-field__label">${esc(ctx.t("studio.card.position"))}</span>` +
    `<label class="gcsp-range">${esc(ctx.t("studio.card.x"))}<input type="range" name="cardX" min="0" max="100" step="1"${attrs({ value: x, "data-gcsp-card-x": true })}></label>` +
    `<label class="gcsp-range">${esc(ctx.t("studio.card.y"))}<input type="range" name="cardY" min="0" max="100" step="1"${attrs({ value: y, "data-gcsp-card-y": true })}></label>` +
    `<span class="gcsp-field__hint gcsp-onlyjs">${esc(ctx.t("studio.card.dragHint"))}</span></div>`;
  return `${filters(input, "card")}<div class="gcsp-grid gcsp-grid--card">${parts.join("")}</div>${position}`;
}

function weaponPanel(input: StudioInput): string {
  const { ctx, loadout } = input;
  const parts = [tile(input, { group: "weapon", name: "weapon", value: "", checked: !loadout.weapon, label: ctx.t("studio.weapon.none"), art: `<span class="gcsp-weapon gcsp-weapon--none">${icon("fa-solid fa-ban")}</span>`, index: 0 })];
  sorted(input.catalog.weapon).forEach((item, i) => {
    const d = item.data as WeaponData;
    parts.push(tile(input, { group: "weapon", name: "weapon", value: item.key, checked: loadout.weapon === item.key, label: item.name, art: `<img class="gcsp-weapon" src="${esc(d.icon)}" alt="">`, item, data: { src: d.icon, label: item.name }, index: i + 1 }));
  });
  return `<div class="gcsp-grid gcsp-grid--weapon">${parts.join("")}</div>`;
}

function backgroundPanel(input: StudioInput): string {
  const { ctx, loadout } = input;
  const parts = [tile(input, { group: "background", name: "background", value: "", checked: !loadout.background, label: ctx.t("studio.background.none"), art: `<span class="gcsp-thumb gcsp-thumb--empty">${icon("fa-solid fa-ban")}</span>`, index: 0 })];
  sorted(input.catalog.background).forEach((item, i) => {
    const d = item.data as BackgroundData;
    const badge = d.video ? `<span class="gcsp-thumb__badge">${icon("fa-solid fa-play")}${esc(ctx.t("studio.background.video"))}</span>` : "";
    parts.push(
      tile(input, {
        group: "background",
        name: "background",
        value: item.key,
        checked: loadout.background === item.key,
        label: item.name,
        art: `<span class="gcsp-thumbWrap"><img class="gcsp-thumb" src="${esc(d.thumb ?? d.image)}" alt="">${badge}</span>`,
        item,
        data: { src: d.image, video: d.video ?? null },
        index: i + 1,
      }),
    );
  });
  return `${filters(input, "background")}<div class="gcsp-grid gcsp-grid--background">${parts.join("")}</div>`;
}

function quotePanel(input: StudioInput): string {
  const { ctx, loadout } = input;
  const len = [...(loadout.quote ?? "")].length;
  return (
    `<label class="gcsp-field"><span class="gcsp-field__label">${esc(ctx.t("studio.quote.label"))}</span>` +
    `<textarea name="quote" rows="4" maxlength="${QUOTE_MAX}"${attrs({ placeholder: ctx.t("studio.quote.placeholder"), "data-gcsp-quote": true })}>${esc(loadout.quote ?? "")}</textarea></label>` +
    `<div class="gcsp-quoteMeta"><span class="gcsp-field__hint">${esc(ctx.t("studio.quote.hint"))}</span><output class="gcsp-counter" data-gcsp-quote-count>${len}/${QUOTE_MAX}</output></div>`
  );
}

function themeSwatch(d: ThemeData | null): string {
  const style = d ? vars({ ta: d.accent, ta2: d.accent2 ?? d.accent, ts: d.surface ?? null }) : "";
  return `<span class="gcsp-themeSwatch${d ? "" : " gcsp-themeSwatch--default"}" style="${esc(style)}"><span></span><span></span><span></span></span>`;
}

function themePanel(input: StudioInput): string {
  const { ctx, loadout } = input;
  const parts = [tile(input, { group: "theme", name: "theme", value: "", checked: !loadout.theme, label: ctx.t("studio.theme.default"), art: themeSwatch(null), index: 0 })];
  sorted(input.catalog.theme).forEach((item, i) => {
    const d = item.data as ThemeData;
    parts.push(
      tile(input, {
        group: "theme",
        name: "theme",
        value: item.key,
        checked: loadout.theme === item.key,
        label: item.name,
        art: themeSwatch(d),
        item,
        data: { style: vars({ ta: d.accent, ta2: d.accent2 ?? d.accent, ts: d.surface ?? null, tg: d.glow ? 1 : 0 }) },
        index: i + 1,
      }),
    );
  });
  return `<div class="gcsp-grid gcsp-grid--theme">${parts.join("")}</div>`;
}

function songPanel(input: StudioInput): string {
  const { ctx, loadout, settings } = input;
  const parts = [tile(input, { group: "song", name: "song", value: "", checked: !loadout.song, label: ctx.t("studio.song.none"), art: `<span class="gcsp-disc gcsp-disc--off">${icon("fa-solid fa-volume-xmark")}</span>`, index: 0 })];
  sorted(input.catalog.song).forEach((item, i) => {
    const d = item.data as SongData;
    parts.push(
      tile(input, {
        group: "song",
        name: "song",
        value: item.key,
        checked: loadout.song === item.key,
        label: item.name,
        art: `<span class="gcsp-disc">${icon("fa-solid fa-music")}</span><span class="gcsp-tile__sub">${esc(d.artist)}</span>`,
        item,
        data: { title: d.title, artist: d.artist, audio: d.audio ?? null, yt: d.youtube ?? null },
        index: i + 1,
      }),
    );
  });
  const allowCustom = settings.allowYoutube || settings.allowSongUpload;
  if (allowCustom) {
    parts.push(
      tile(input, {
        group: "song",
        name: "song",
        value: "custom",
        checked: loadout.song === "custom",
        label: ctx.t("studio.song.custom"),
        art: `<span class="gcsp-disc gcsp-disc--custom">${icon("fa-solid fa-wand-magic-sparkles")}</span>`,
        index: parts.length,
      }),
    );
  }
  const c = loadout.customSong;
  const customFields = allowCustom
    ? `<fieldset class="gcsp-custom"><legend>${esc(ctx.t("studio.song.customTitle"))}</legend>` +
      `<label class="gcsp-field"><span class="gcsp-field__label">${esc(ctx.t("studio.song.title"))}</span><input type="text" name="songTitle" maxlength="80"${attrs({ value: c?.title ?? "", "data-gcsp-song-title": true })}></label>` +
      (settings.allowYoutube
        ? `<label class="gcsp-field"><span class="gcsp-field__label">${esc(ctx.t("studio.song.youtube"))}</span><input type="url" name="songYoutube" maxlength="200" inputmode="url"${attrs({ value: c?.youtube ? `https://youtu.be/${c.youtube}` : "", placeholder: "https://youtu.be/…", "data-gcsp-song-yt": true })}><span class="gcsp-field__hint">${esc(ctx.t("studio.song.youtubeHint"))}</span></label>`
        : "") +
      (settings.allowSongUpload
        ? `<label class="gcsp-field"><span class="gcsp-field__label">${esc(ctx.t("studio.song.file", { max: settings.songMaxMb }))}</span><input type="file" name="songFile" accept="audio/mpeg,audio/ogg,.mp3,.ogg" data-gcsp-song-file></label>` +
          (c?.audio ? `<label class="gcsp-check"><input type="checkbox" name="songKeepAudio" value="1" checked> ${esc(ctx.t("studio.song.keepFile"))}</label>` : "")
        : "") +
      `</fieldset>`
    : "";
  const autoplay = `<label class="gcsp-check"><input type="checkbox" name="songAutoplay" value="1"${attrs({ checked: loadout.songAutoplay === true })}> ${esc(ctx.t("studio.song.autoplay"))}</label><p class="gcsp-field__hint">${esc(ctx.t("studio.song.autoplayHint"))}</p>`;
  return `<div class="gcsp-grid gcsp-grid--song">${parts.join("")}</div>${customFields}${autoplay}`;
}

// ─── Previzualizarea ─────────────────────────────────────────────────────────

function preview(input: StudioInput): string {
  const { ctx, user, loadout, access } = input;
  const cur = current(input);
  const nl = cur.style && cur.variant ? nameLook(cur.style.data as NameStyleData, cur.variant) : groupNameLook(user);
  const bl = cur.banner ? bannerLook(cur.banner.data as BannerData) : defaultBannerLook(input);
  const label = bannerLabelFor(loadout, access);
  const name = `<span ${lookAttrs(nl)} data-gcsp-pv="name">${esc(user.name)}</span>`;
  const pill = `<span ${lookAttrs(bl)} data-gcsp-pv="banner">${esc(label)}</span>`;
  const weapon = cur.weapon?.data as WeaponData | undefined;
  const card = cur.card?.data as CardData | undefined;
  const year = new Date(user.joinedAt).getFullYear();
  const posts = new Intl.NumberFormat(ctx.locale).format(user.postsCount);
  const weaponStat = `<div class="gcsp-stat gcsp-stat--weapon"><img class="gcsp-stat__icon${weapon ? "" : " gcsp-hide"}"${attrs({ src: weapon?.icon ?? null, alt: "", "data-gcsp-pv": "weapon" })}><strong data-gcsp-pv="weapon-label">${esc(cur.weapon?.name ?? "—")}</strong><span>${esc(ctx.t("preview.weapon"))}</span></div>`;

  const header =
    `<div class="gcsp-hdr" aria-hidden="true"><span class="gcsp-hdr__brand"></span><span class="gcsp-hdr__nav"><i></i><i></i><i></i></span>` +
    `<span class="gcsp-hdr__user">${avatar(user, "s", cur.frame, true)}${name}</span></div>`;

  const miniCard =
    `<div class="gcsp-card">` +
    `<div class="gcsp-card__cover${card ? " gcsp-card__cover--image" : ""}" data-gcsp-drag>` +
    `<img class="gcsp-card__img${card ? "" : " gcsp-hide"}"${attrs({ src: card?.image ?? null, alt: "", "data-gcsp-pv": "card", style: vars({ cx: loadout.cardX ?? 50, cy: loadout.cardY ?? 50 }) })}>` +
    `<span class="gcsp-card__dragHint gcsp-onlyjs">${icon("fa-solid fa-up-down-left-right")}${esc(ctx.t("preview.drag"))}</span></div>` +
    `<div class="gcsp-card__body"><div class="gcsp-card__head">${avatar(user, "l", cur.frame, true)}<div class="gcsp-card__id">${name}` +
    `<div class="gcsp-card__pills">${pill}</div><span class="gcsp-online"><span class="gcsp-online__dot"></span>${esc(ctx.t("preview.online"))}</span></div></div>` +
    `<div class="gcsp-stats"><div class="gcsp-stat"><strong>${esc(posts)}</strong><span>${esc(ctx.t("preview.posts"))}</span></div>` +
    `<div class="gcsp-stat"><strong>${year}</strong><span>${esc(ctx.t("preview.joined"))}</span></div>${weaponStat}</div></div></div>`;

  const bg = cur.background?.data as BackgroundData | undefined;
  const theme = cur.theme?.data as ThemeData | undefined;
  const themeStyle = theme ? vars({ ta: theme.accent, ta2: theme.accent2 ?? theme.accent, ts: theme.surface ?? null, tg: theme.glow ? 1 : 0 }) : "";
  const quoteText = loadout.quote ?? "";
  const full =
    `<div class="gcsp-prof${theme ? " gcsp-prof--themed" : ""}" data-gcsp-pv="theme" style="${esc(themeStyle)}">` +
    `<div class="gcsp-prof__bg"><img class="gcsp-prof__bgImg${bg ? "" : " gcsp-hide"}"${attrs({ src: bg?.image ?? null, alt: "", "data-gcsp-pv": "bg" })}><video class="gcsp-prof__bgVideo gcsp-hide" muted loop playsinline preload="none" data-gcsp-pv="bg-video"></video></div>` +
    `<div class="gcsp-prof__cover"></div>` +
    `<div class="gcsp-prof__head">${avatar(user, "xl", cur.frame, true)}<div class="gcsp-prof__id">${name}<div class="gcsp-card__pills"><span class="gcsp-grp">${esc(ctx.t("preview.member"))}</span>${pill}</div></div></div>` +
    `<div class="gcsp-stats gcsp-stats--wide"><div class="gcsp-stat"><strong>${esc(posts)}</strong><span>${esc(ctx.t("preview.posts"))}</span></div><div class="gcsp-stat"><strong>${year}</strong><span>${esc(ctx.t("preview.joined"))}</span></div>${weaponStat}</div>` +
    `<div class="gcsp-prof__tabs" aria-hidden="true"><span class="gcsp-prof__tab gcsp-prof__tab--on">${esc(ctx.t("preview.tabs.activity"))}</span><span class="gcsp-prof__tab">${esc(ctx.t("preview.tabs.posts"))}</span><span class="gcsp-prof__tab">${esc(ctx.t("preview.tabs.about"))}</span></div>` +
    `<div class="gcsp-prof__cols"><div class="gcsp-prof__main">` +
    `<figure class="gcsp-quote${quoteText ? "" : " gcsp-hide"}" data-gcsp-pv="quote-box">${icon("fa-solid fa-quote-left")}<blockquote data-gcsp-pv="quote">${esc(quoteText)}</blockquote><figcaption>— ${esc(user.name)}</figcaption></figure>` +
    `<div class="gcsp-ghost"><i></i><i></i><i></i></div><div class="gcsp-ghost"><i></i><i></i></div></div>` +
    `<div class="gcsp-prof__side"><div class="gcsp-miniSong${loadout.song ? "" : " gcsp-hide"}" data-gcsp-pv="song-mini">${icon("fa-solid fa-music")}<span data-gcsp-pv="song-mini-title">${esc(songTitle(input) ?? "")}</span></div><div class="gcsp-ghost gcsp-ghost--side"><i></i><i></i></div></div>` +
    `</div></div>`;

  return (
    `<div class="gcsp-stage__panel gcsp-stage__panel--mini"><p class="gcsp-stage__caption">${esc(ctx.t("preview.miniCaption"))}</p>${header}${miniCard}</div>` +
    `<div class="gcsp-stage__panel gcsp-stage__panel--full"><p class="gcsp-stage__caption">${esc(ctx.t("preview.fullCaption"))}</p>${full}</div>` +
    `<div class="gcsp-stage__panel gcsp-stage__panel--song"><p class="gcsp-stage__caption">${esc(ctx.t("preview.songCaption"))}</p>${player(input)}</div>`
  );
}

function songTitle(input: StudioInput): string | null {
  const { loadout } = input;
  if (loadout.song === "custom") return loadout.customSong?.title || null;
  const s = current(input).song;
  return s ? (s.data as SongData).title : null;
}

function player(input: StudioInput): string {
  const { ctx, loadout } = input;
  const cur = current(input);
  const d = cur.song?.data as SongData | undefined;
  const audio = loadout.song === "custom" ? loadout.customSong?.audio : d?.audio;
  const yt = loadout.song === "custom" ? loadout.customSong?.youtube : d?.youtube;
  const title = songTitle(input);
  return (
    `<div class="gcsp-player${title ? "" : " gcsp-player--empty"}" data-gcsp-player>` +
    `<div class="gcsp-player__disc" aria-hidden="true"><span></span></div>` +
    `<div class="gcsp-player__meta"><strong data-gcsp-pv="song-title">${esc(title ?? ctx.t("preview.noSong"))}</strong><span data-gcsp-pv="song-artist">${esc(d?.artist ?? "")}</span></div>` +
    `<div class="gcsp-player__controls gcsp-onlyjs"><button type="button" class="gcsp-player__play" data-gcsp-play aria-label="${esc(ctx.t("preview.play"))}" data-gcsp-label-pause="${esc(ctx.t("preview.pause"))}">${icon("fa-solid fa-play")}</button>` +
    `<label class="gcsp-player__vol">${icon("fa-solid fa-volume-high")}<span class="gcsp-sr">${esc(ctx.t("preview.volume"))}</span><input type="range" min="0" max="100" value="70" data-gcsp-volume></label></div>` +
    `<audio class="gcsp-player__audio" controls preload="none"${attrs({ src: audio ?? null, "data-gcsp-pv": "audio" })}></audio>` +
    `<div class="gcsp-player__yt${yt ? "" : " gcsp-hide"}" data-gcsp-pv="yt"${attrs({ "data-gcsp-yt": yt ?? null })}><span class="gcsp-player__ytNote">${icon("fa-brands fa-youtube")}${esc(ctx.t("preview.youtube"))}</span></div>` +
    `<p class="gcsp-field__hint">${esc(ctx.t("preview.noAutoplay"))}</p></div>`
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

function notice(input: StudioInput): string {
  const { ctx, query, access, settings } = input;
  const out: string[] = [];
  if (query.saved === "1") out.push(`<p class="gcsp-notice gcsp-notice--ok" role="status">${icon("fa-solid fa-circle-check")}${esc(ctx.t("studio.saved"))}</p>`);
  if (query.reset === "1") out.push(`<p class="gcsp-notice gcsp-notice--ok" role="status">${icon("fa-solid fa-rotate-left")}${esc(ctx.t("studio.resetDone"))}</p>`);
  if (query.error && /^[a-z_]{1,40}$/.test(query.error)) {
    const key = `errors.${query.error}`;
    const text = ctx.t(key);
    out.push(`<p class="gcsp-notice gcsp-notice--error" role="alert">${icon("fa-solid fa-triangle-exclamation")}${esc(text === key ? ctx.t("errors.generic") : text)}</p>`);
  }
  if (!access.vip && !access.testAll) {
    out.push(
      `<p class="gcsp-notice gcsp-notice--vip">${icon("fa-solid fa-crown")}<span>${esc(ctx.t("studio.tryNotice"))}</span> <a class="gcs-btn gcs-btn--primary gcs-btn--sm" href="${esc(settings.vipPageUrl)}">${esc(ctx.t("studio.becomeVip"))}</a></p>`,
    );
  } else if (access.testAll && !access.vip) {
    out.push(`<p class="gcsp-notice gcsp-notice--test">${icon("fa-solid fa-flask")}${esc(ctx.t("studio.testNotice"))}</p>`);
  }
  return out.join("");
}

function tabs(input: StudioInput, group: "mini" | "full", list: readonly { key: string; icon: string }[], active: string): string {
  const { ctx } = input;
  return (
    `<fieldset class="gcsp-tabs gcsp-tabs--${group}"><legend class="gcsp-sr">${esc(ctx.t(`studio.modes.${group}`))}</legend>` +
    list
      .map((t) => `<label class="gcsp-tab"><input class="gcsp-sr" type="radio"${attrs({ name: `gcsp_tab_${group}`, value: t.key, checked: t.key === active })}>${icon(t.icon)}<span>${esc(ctx.t(`studio.tabs.${t.key}`))}</span></label>`)
      .join("") +
    `</fieldset>`
  );
}

const panel = (key: string, hint: string, body: string, wrap = true) =>
  `<section class="gcsp-panel gcsp-panel--${key}" data-gcsp-panel="${key}"><p class="gcsp-panel__hint">${esc(hint)}</p>${wrap ? `<div class="gcsp-grid gcsp-grid--${key}">${body}</div>` : body}</section>`;

/** Textele pentru JS (numărătoarea, ferestrele), ca atribute `data-gcsp-t-*` pe rădăcină. */
function clientTexts(ctx: GcsPluginContext): Record<string, string> {
  const keys = ["count.none", "count.one", "count.few", "count.many", "save.saving", "save.done", "save.failed", "save.locked", "save.unavailable", "save.invalid", "groups.name", "groups.frame", "groups.banner", "groups.card", "groups.weapon", "groups.background", "groups.quote", "groups.theme", "groups.song"];
  return Object.fromEntries(keys.map((k) => [`data-gcsp-t-${k.replace(".", "-")}`, ctx.t(`client.${k}`)]));
}

export function renderStudio(input: StudioInput): string {
  const { ctx, user, access, query, settings } = input;
  const cur = current(input);
  const miniActive = MINI_TABS.some((t) => t.key === query.tab) ? query.tab! : "name";
  const fullActive = FULL_TABS.some((t) => t.key === query.tab) ? query.tab! : "background";
  const mode = FULL_TABS.some((t) => t.key === query.tab) ? "full" : "mini";
  const nl = cur.style && cur.variant ? nameLook(cur.style.data as NameStyleData, cur.variant) : groupNameLook(user);
  const bl = cur.banner ? bannerLook(cur.banner.data as BannerData) : defaultBannerLook(input);
  const planBadge = access.vip
    ? `<span class="gcsp-plan">${icon("fa-solid fa-crown")}${esc(ctx.t("studio.planOf", { plan: access.planName ?? "VIP" }))}</span>`
    : `<span class="gcsp-plan gcsp-plan--none">${icon("fa-regular fa-gem")}${esc(ctx.t(access.testAll ? "studio.planTest" : "studio.planNone"))}</span>`;

  const hero =
    // Titlul paginii îl pune GCS deasupra (h1); aici, doar explicația și planul.
    `<header class="gcsp-hero"><div class="gcsp-hero__copy">` +
    `<p class="gcsp-hero__lede">${esc(ctx.t("studio.lede"))}</p>${planBadge}</div>` +
    `<div class="gcsp-plate" aria-live="polite"><span class="gcsp-plate__caption">${esc(ctx.t("studio.identity"))}</span>` +
    `<span ${lookAttrs(nl)} data-gcsp-pv="name">${esc(user.name)}</span><span ${lookAttrs(bl)} data-gcsp-pv="banner">${esc(bannerLabelFor(input.loadout, access))}</span></div></header>`;

  const modes =
    `<fieldset class="gcsp-modes"><legend class="gcsp-sr">${esc(ctx.t("studio.modes.legend"))}</legend>` +
    (["mini", "full"] as const)
      .map(
        (m) =>
          `<label class="gcsp-mode gcsp-mode--${m}"><input class="gcsp-sr" type="radio"${attrs({ name: "gcsp_mode", value: m, checked: m === mode })}>` +
          `${icon(m === "mini" ? "fa-solid fa-id-card" : "fa-solid fa-user-astronaut")}<span class="gcsp-mode__text"><strong>${esc(ctx.t(`studio.modes.${m}`))}</strong><small>${esc(ctx.t(`studio.modes.${m}Hint`))}</small></span></label>`,
      )
      .join("") +
    `</fieldset>`;

  const panels =
    panel("name", ctx.t("studio.hints.name"), namePanel(input)) +
    panel("frame", ctx.t("studio.hints.frame"), framePanel(input), false) +
    panel("banner", ctx.t("studio.hints.banner"), bannerPanel(input), false) +
    panel("card", ctx.t("studio.hints.card"), cardPanel(input), false) +
    panel("weapon", ctx.t("studio.hints.weapon"), weaponPanel(input), false) +
    panel("background", ctx.t("studio.hints.background"), backgroundPanel(input), false) +
    panel("quote", ctx.t("studio.hints.quote"), quotePanel(input), false) +
    panel("theme", ctx.t("studio.hints.theme"), themePanel(input), false) +
    panel("song", ctx.t("studio.hints.song"), songPanel(input), false);

  const dock =
    `<div class="gcsp-dock"><button type="button" class="gcs-btn gcs-btn--ghost gcs-btn--sm gcsp-onlyjs" data-gcsp-reset>${icon("fa-solid fa-rotate-left")}${esc(ctx.t("studio.reset"))}</button>` +
    `<output class="gcsp-dock__count gcsp-onlyjs" data-gcsp-count aria-live="polite">${esc(ctx.t("client.count.none"))}</output>` +
    `<button type="submit" class="gcs-btn gcs-btn--primary gcsp-save" data-gcsp-save>${icon("fa-solid fa-floppy-disk")}${esc(ctx.t("studio.save"))}</button></div>`;

  const form =
    `<form class="gcsp-form" method="post" action="${API}/save"${attrs({ enctype: settings.allowSongUpload ? "multipart/form-data" : null })} data-gcsp-form>` +
    `<input type="hidden" name="return" value="studio">${modes}` +
    `<div class="gcsp-bench"><div class="gcsp-options">${tabs(input, "mini", MINI_TABS, miniActive)}${tabs(input, "full", FULL_TABS, fullActive)}${panels}</div>` +
    `<aside class="gcsp-stage" aria-label="${esc(ctx.t("preview.label"))}">${preview(input)}</aside></div>${dock}</form>`;

  const resetForm =
    `<form class="gcsp-resetForm gcsp-nojs" method="post" action="${API}/reset"><button type="submit" class="gcs-btn gcs-btn--ghost gcs-btn--sm">${icon("fa-solid fa-rotate-left")}${esc(ctx.t("studio.resetSaved"))}</button></form>`;

  const sheets =
    `<div class="gcsp-veil" data-gcsp-veil></div>` +
    `<div class="gcsp-sheet" role="dialog" aria-modal="true"${attrs({ "aria-label": ctx.t("sheets.vip.title"), "data-gcsp-sheet": "vip" })}>${icon("fa-solid fa-crown")}<h3>${esc(ctx.t("sheets.vip.title"))}</h3><p>${esc(ctx.t("sheets.vip.body"))}</p>` +
    `<div class="gcsp-sheet__actions"><a class="gcs-btn gcs-btn--primary" href="${esc(settings.vipPageUrl)}">${esc(ctx.t("sheets.vip.cta"))}</a><button type="button" class="gcs-btn gcs-btn--ghost" data-gcsp-close>${esc(ctx.t("sheets.vip.keep"))}</button></div></div>` +
    `<div class="gcsp-sheet gcsp-sheet--saving" role="dialog" aria-modal="true"${attrs({ "aria-label": ctx.t("sheets.saving.title"), "data-gcsp-sheet": "saving" })}><span class="gcsp-loader" aria-hidden="true"><i></i><i></i><i></i></span><h3 data-gcsp-saving-title>${esc(ctx.t("sheets.saving.title"))}</h3><p data-gcsp-saving-text>${esc(ctx.t("sheets.saving.body"))}</p></div>` +
    `<div class="gcsp-sheet gcsp-sheet--error" role="alertdialog" aria-modal="true"${attrs({ "aria-label": ctx.t("sheets.error.title"), "data-gcsp-sheet": "error" })}>${icon("fa-solid fa-triangle-exclamation")}<h3>${esc(ctx.t("sheets.error.title"))}</h3><ul data-gcsp-errors></ul>` +
    `<div class="gcsp-sheet__actions"><a class="gcs-btn gcs-btn--primary" href="${esc(settings.vipPageUrl)}">${esc(ctx.t("sheets.vip.cta"))}</a><button type="button" class="gcs-btn gcs-btn--ghost" data-gcsp-close>${esc(ctx.t("sheets.error.close"))}</button></div></div>`;

  const root = attrs({
    "data-gcsp-studio": "1",
    "data-gcsp-vip": access.vip ? "1" : "0",
    "data-gcsp-test": access.testAll ? "1" : "0",
    "data-gcsp-name": user.name,
    ...clientTexts(ctx),
  });
  return `<div class="gcsp-studio"${root}>${hero}${notice(input)}${form}${resetForm}${sheets}</div>`;
}
