import { compileCustomStyle, CUSTOM_STYLE_KEY, customStyleClass, customStylePrefix, type GcsParsedCustomStyle } from "./customStyle";
import { NAME_SCOPE } from "./memberName";
import { compileNameEffectsCss, NAME_EFFECTS, nameVars, styledNameSelectors, type GcsNameEffect, type GcsStyledName } from "./nameEffects";

export { NAME_EFFECTS, type GcsNameEffect } from "./nameEffects";

/**
 * Aspectul membrilor publicat de pluginuri (capabilitatea `appearance`, specul Studio VIP §2.1): stilul numelui, rama,
 * banner-ul, fundalul cardului, insigna și extra-urile profilului.
 *
 * Pluginul nu trimite CSS sau HTML: doar culori `#RRGGBB`, numere în intervale, chei din liste albe (efectele numelui),
 * texte simple, căi spre fișierele lui și, opțional, cheia unui stil CSS scris de un admin în ACP (`style`), verificat
 * și închis separat de nucleu (`customStyle.ts`). CSS-ul se compilează aici, din valorile validate.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const THEME_KEY = /^[a-z0-9_]{1,30}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Fișierele pluginului: imagini (din pachet sau încărcate) și, pentru video/audio, doar fișierele încărcate. */
const ASSET_IMAGE = /^assets\/[A-Za-z0-9_-][A-Za-z0-9._/-]{0,180}\.(?:png|jpe?g|gif|webp)$/;
const MEDIA_FILE = /^media\/[a-z0-9]{10,40}\.(webp|png|jpg|gif|mp4|webm|mp3|ogg)$/;

export const FILL_ANIMATIONS = ["none", "flow", "pulse", "shine", "aurora"] as const;
export type GcsFillAnimation = (typeof FILL_ANIMATIONS)[number];
export const FX_SPEEDS = ["slow", "normal", "fast"] as const;
export type GcsFxSpeed = (typeof FX_SPEEDS)[number];

export type GcsAppearanceFill = { colors: string[]; angle?: number; animation?: GcsFillAnimation; speed?: GcsFxSpeed };

export type GcsMemberAppearance = {
  /**
   * `style`: cheia unui stil CSS al pluginului (`styles.set("name", …)`), peste culorile de bază. `styleClass` îl pune
   * doar nucleul, la combinarea pluginurilor (nu se acceptă de la plugin).
   */
  name?: { fill: GcsAppearanceFill; effect?: GcsNameEffect; glow?: string; bold?: boolean; italic?: boolean; style?: string; styleClass?: string };
  banner?: { fill: GcsAppearanceFill; text?: string; label?: string; style?: string; styleClass?: string };
  frame?: { image: string; scale?: number; x?: number; y?: number };
  card?: { image: string; x?: number; y?: number; dim?: number };
  flair?: { icon: string; label: string };
  profile?: {
    background?: { image?: string; video?: string; x?: number; y?: number; dim?: number };
    quote?: { text: string };
    theme?: { key: string; accent: string; accent2?: string; surface?: string; glow?: boolean };
    song?: { title: string; artist?: string; audio?: string; youtube?: string; autoplayMuted?: boolean };
  };
};

export type GcsAppearanceParse = { ok: true; value: GcsMemberAppearance } | { ok: false; errors: Record<string, string> };

/** Un text simplu: fără caractere de control, cu spațiile strânse; `null` dacă e gol sau prea lung. */
export function appearanceText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 && [...text].length <= max ? text : null;
}

/**
 * Calea unui fișier al pluginului (`/plugins/<cheie>/assets/…` sau `/plugins/<cheie>/media/<id>.<ext>`), doar a
 * pluginului care publică. `kinds` limitează tipul: imagini, video sau audio.
 */
export function appearanceMediaRef(value: unknown, pluginKey: string, kind: "image" | "video" | "audio"): string | null {
  if (typeof value !== "string" || value.length > 260) return null;
  const prefix = `/plugins/${pluginKey}/`;
  if (!value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  if (rest.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  if (kind === "image") {
    if (ASSET_IMAGE.test(rest)) return value;
    const m = MEDIA_FILE.exec(rest);
    return m && ["webp", "png", "jpg", "gif"].includes(m[1]!) ? value : null;
  }
  const m = MEDIA_FILE.exec(rest);
  if (!m) return null;
  return (kind === "video" ? ["mp4", "webm"] : ["mp3", "ogg"]).includes(m[1]!) ? value : null;
}

type Ctx = { pluginKey: string; errors: Record<string, string> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function num(ctx: Ctx, path: string, value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    ctx.errors[path] = "invalid_range";
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

function hex(ctx: Ctx, path: string, value: unknown, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !HEX.test(value)) {
    ctx.errors[path] = "invalid_color";
    return undefined;
  }
  return value.toUpperCase();
}

function oneOf<T extends string>(ctx: Ctx, path: string, value: unknown, list: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) {
    ctx.errors[path] = "invalid_choice";
    return undefined;
  }
  return value as T;
}

function bool(ctx: Ctx, path: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    ctx.errors[path] = "invalid_type";
    return undefined;
  }
  return value;
}

function text(ctx: Ctx, path: string, value: unknown, max: number, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  const t = appearanceText(value, max);
  if (t === null) {
    ctx.errors[path] = value === undefined || value === "" ? "required" : "invalid_text";
    return undefined;
  }
  return t;
}

function media(ctx: Ctx, path: string, value: unknown, kind: "image" | "video" | "audio", required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  const ref = appearanceMediaRef(value, ctx.pluginKey, kind);
  if (!ref) {
    ctx.errors[path] = "invalid_media";
    return undefined;
  }
  return ref;
}

/** Ia doar cheile cunoscute: orice altă cheie e o eroare (nu trece nimic neverificat). */
function known(ctx: Ctx, path: string, value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    ctx.errors[path] = "invalid_type";
    return null;
  }
  for (const k of Object.keys(value)) if (!keys.includes(k)) ctx.errors[`${path}.${k}`] = "unknown_key";
  return value;
}

function fill(ctx: Ctx, path: string, value: unknown): GcsAppearanceFill | undefined {
  const f = known(ctx, path, value, ["colors", "angle", "animation", "speed"]);
  if (!f) return undefined;
  if (!Array.isArray(f.colors) || f.colors.length < 1 || f.colors.length > 5) {
    ctx.errors[`${path}.colors`] = "invalid_color";
    return undefined;
  }
  const colors = f.colors.map((c, i) => hex(ctx, `${path}.colors.${i}`, c, true)).filter((c): c is string => c !== undefined);
  const out: GcsAppearanceFill = { colors };
  const angle = num(ctx, `${path}.angle`, f.angle, 0, 360);
  if (angle !== undefined) out.angle = Math.round(angle);
  const animation = oneOf(ctx, `${path}.animation`, f.animation, FILL_ANIMATIONS);
  if (animation && animation !== "none") out.animation = animation;
  const speed = oneOf(ctx, `${path}.speed`, f.speed, FX_SPEEDS);
  if (speed && speed !== "normal") out.speed = speed;
  return out;
}

/** Cheia unui stil CSS al pluginului (existența lui se verifică la compilare: un stil șters nu mai apare). */
function styleKey(ctx: Ctx, path: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CUSTOM_STYLE_KEY.test(value)) {
    ctx.errors[path] = "invalid_key";
    return undefined;
  }
  return value;
}

/** Copiază doar câmpurile definite (fără `undefined`, ca JSON-ul salvat să fie curat). */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Validează aspectul publicat de un plugin. Întoarce forma normalizată (culori cu majuscule, numere rotunjite, texte
 * curățate) sau erorile pe câmpuri (`name.fill.colors.0: invalid_color`).
 */
export function parseMemberAppearance(raw: unknown, opts: { pluginKey: string }): GcsAppearanceParse {
  const ctx: Ctx = { pluginKey: opts.pluginKey, errors: {} };
  const root = known(ctx, "(root)", raw, ["name", "banner", "frame", "card", "flair", "profile"]);
  if (!root) return { ok: false, errors: ctx.errors };
  const out: GcsMemberAppearance = {};

  if (root.name !== undefined) {
    const n = known(ctx, "name", root.name, ["fill", "effect", "glow", "bold", "italic", "style"]);
    const f = n ? fill(ctx, "name.fill", n.fill) : undefined;
    if (n && f) {
      const effect = oneOf(ctx, "name.effect", n.effect, NAME_EFFECTS);
      out.name = compact({
        fill: f,
        effect: effect && effect !== "none" ? effect : undefined,
        glow: hex(ctx, "name.glow", n.glow),
        bold: bool(ctx, "name.bold", n.bold),
        italic: bool(ctx, "name.italic", n.italic),
        style: styleKey(ctx, "name.style", n.style),
      });
    }
  }
  if (root.banner !== undefined) {
    const b = known(ctx, "banner", root.banner, ["fill", "text", "label", "style"]);
    const f = b ? fill(ctx, "banner.fill", b.fill) : undefined;
    if (b && f) out.banner = compact({ fill: f, text: hex(ctx, "banner.text", b.text), label: text(ctx, "banner.label", b.label, 32, false), style: styleKey(ctx, "banner.style", b.style) });
  }
  if (root.frame !== undefined) {
    const fr = known(ctx, "frame", root.frame, ["image", "scale", "x", "y"]);
    const image = fr ? media(ctx, "frame.image", fr.image, "image", true) : undefined;
    if (fr && image) out.frame = compact({ image, scale: num(ctx, "frame.scale", fr.scale, 100, 160), x: num(ctx, "frame.x", fr.x, -20, 20), y: num(ctx, "frame.y", fr.y, -20, 20) });
  }
  if (root.card !== undefined) {
    const c = known(ctx, "card", root.card, ["image", "x", "y", "dim"]);
    const image = c ? media(ctx, "card.image", c.image, "image", true) : undefined;
    if (c && image) out.card = compact({ image, x: num(ctx, "card.x", c.x, 0, 100), y: num(ctx, "card.y", c.y, 0, 100), dim: num(ctx, "card.dim", c.dim, 0, 80) });
  }
  if (root.flair !== undefined) {
    const fl = known(ctx, "flair", root.flair, ["icon", "label"]);
    if (fl) {
      const icon = media(ctx, "flair.icon", fl.icon, "image", true);
      const label = text(ctx, "flair.label", fl.label, 40, true);
      if (icon && label) out.flair = { icon, label };
    }
  }
  if (root.profile !== undefined) {
    const p = known(ctx, "profile", root.profile, ["background", "quote", "theme", "song"]);
    if (p) {
      const profile: NonNullable<GcsMemberAppearance["profile"]> = {};
      if (p.background !== undefined) {
        const bg = known(ctx, "profile.background", p.background, ["image", "video", "x", "y", "dim"]);
        if (bg) {
          const image = media(ctx, "profile.background.image", bg.image, "image", bg.video !== undefined);
          const video = media(ctx, "profile.background.video", bg.video, "video", false);
          if (!image && !video && !ctx.errors["profile.background.image"]) ctx.errors["profile.background"] = "required";
          if (image) {
            profile.background = compact({
              image,
              video,
              x: num(ctx, "profile.background.x", bg.x, 0, 100),
              y: num(ctx, "profile.background.y", bg.y, 0, 100),
              dim: num(ctx, "profile.background.dim", bg.dim, 0, 80),
            });
          }
        }
      }
      if (p.quote !== undefined) {
        const q = known(ctx, "profile.quote", p.quote, ["text"]);
        const t = q ? text(ctx, "profile.quote.text", q.text, 200, true) : undefined;
        if (t) profile.quote = { text: t };
      }
      if (p.theme !== undefined) {
        const th = known(ctx, "profile.theme", p.theme, ["key", "accent", "accent2", "surface", "glow"]);
        if (th) {
          if (typeof th.key !== "string" || !THEME_KEY.test(th.key)) ctx.errors["profile.theme.key"] = "invalid_key";
          const accent = hex(ctx, "profile.theme.accent", th.accent, true);
          if (accent && typeof th.key === "string" && THEME_KEY.test(th.key)) {
            profile.theme = compact({
              key: th.key,
              accent,
              accent2: hex(ctx, "profile.theme.accent2", th.accent2),
              surface: hex(ctx, "profile.theme.surface", th.surface),
              glow: bool(ctx, "profile.theme.glow", th.glow),
            });
          }
        }
      }
      if (p.song !== undefined) {
        const s = known(ctx, "profile.song", p.song, ["title", "artist", "audio", "youtube", "autoplayMuted"]);
        if (s) {
          const title = text(ctx, "profile.song.title", s.title, 80, true);
          const audio = media(ctx, "profile.song.audio", s.audio, "audio", false);
          let youtube: string | undefined;
          if (s.youtube !== undefined) {
            if (typeof s.youtube === "string" && YOUTUBE_ID.test(s.youtube)) youtube = s.youtube;
            else ctx.errors["profile.song.youtube"] = "invalid_id";
          }
          if (!audio && !youtube && !ctx.errors["profile.song.audio"] && !ctx.errors["profile.song.youtube"]) ctx.errors["profile.song"] = "required";
          if (title && (audio || youtube)) {
            profile.song = compact({ title, artist: text(ctx, "profile.song.artist", s.artist, 80, false), audio, youtube, autoplayMuted: bool(ctx, "profile.song.autoplayMuted", s.autoplayMuted) });
          }
        }
      }
      if (Object.keys(profile).length > 0) out.profile = profile;
    }
  }
  return Object.keys(ctx.errors).length > 0 ? { ok: false, errors: ctx.errors } : { ok: true, value: out };
}

/**
 * Aspectul final al unui membru din rândurile mai multor pluginuri, în ordinea priorității: fiecare câmp de pe primul
 * nivel (iar la profil, fiecare sub-câmp) vine de la primul plugin care îl are. Cu `pluginKeys` (aliniate cu lista),
 * stilurile CSS ale numelui și banner-ului primesc clasa lor (`styleClass`), a pluginului care le-a publicat.
 */
export function mergeAppearances(list: GcsMemberAppearance[], pluginKeys?: string[]): GcsMemberAppearance {
  const out: GcsMemberAppearance = {};
  list.forEach((a, index) => {
    for (const key of ["name", "banner", "frame", "card", "flair"] as const) {
      if (a[key] && !out[key]) (out as Record<string, unknown>)[key] = a[key];
    }
    const pluginKey = pluginKeys?.[index];
    if (pluginKey) {
      if (a.name?.style && out.name === a.name) out.name = { ...a.name, styleClass: customStyleClass(pluginKey, "name", a.name.style) };
      if (a.banner?.style && out.banner === a.banner) out.banner = { ...a.banner, styleClass: customStyleClass(pluginKey, "banner", a.banner.style) };
    }
    if (a.profile) {
      const p = (out.profile ??= {});
      for (const key of ["background", "quote", "theme", "song"] as const) {
        if (a.profile[key] && !p[key]) (p as Record<string, unknown>)[key] = a.profile[key];
      }
    }
  });
  return out;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const SPEED: Record<GcsFxSpeed, number> = { slow: 1.6, normal: 1, fast: 0.55 };

function rgba(hexColor: string, alpha: number): string {
  const n = Number.parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** O nuanță mai deschisă a unei culori (pentru gradientele construite dintr-o singură culoare). */
function lighten(hexColor: string, amount: number): string {
  const n = Number.parseInt(hexColor.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

const seconds = (base: number, speed: GcsFxSpeed | undefined) => `${Math.round(base * SPEED[speed ?? "normal"] * 100) / 100}s`;

/** Gradientul unei umpleri (cu prima culoare repetată la final, ca animația să se reia fără salt). */
export function fillGradient(f: GcsAppearanceFill, opts: { loop?: boolean; minStops?: number } = {}): string {
  let colors = f.colors.filter((c) => HEX.test(c));
  if (colors.length === 0) colors = ["#FFFFFF"];
  if (colors.length === 1 && (opts.minStops ?? 1) > 1) colors = [colors[0]!, lighten(colors[0]!, 0.45), colors[0]!];
  if (colors.length === 1) return colors[0]!;
  const stops = opts.loop ? [...colors, colors[0]!] : colors;
  return `linear-gradient(${Math.round(f.angle ?? 90)}deg,${stops.join(",")})`;
}

/**
 * Efectul compilat al unui nume: efectul ales; fără efect, animația veche a umplerii (curgere, puls, sclipire) devine
 * efectul echivalent, iar mai multe culori fără efect devin gradientul fix.
 */
export function nameEffectOf(name: NonNullable<GcsMemberAppearance["name"]>): GcsNameEffect {
  const effect = name.effect ?? "none";
  if (effect !== "none") return effect;
  const anim = name.fill.animation;
  if (anim === "flow") return "shimmer";
  if (anim === "aurora") return "holo";
  if (anim === "pulse") return "pulse";
  if (anim === "shine") return "chrome";
  return name.fill.colors.length > 1 ? "gradient" : "none";
}

/** Stilurile CSS ale pluginurilor (verificate), pentru compilare. */
export type GcsCompiledStyleInput = { pluginKey: string; kind: "name" | "banner"; key: string; style: GcsParsedCustomStyle };

/**
 * Selectorul numelui unui membru: linkurile spre profil (`a.gcs-userLink[data-user-id]`, ca hover card-ul) și numele
 * care nu sunt linkuri (titlul profilului, meniul userului), marcate cu `data-name-user` (fără hover card).
 */
export function nameSelector(userId: string): string {
  return `${NAME_SCOPE} :is(.gcs-userLink[data-user-id="${userId}"],[data-name-user="${userId}"])`;
}

/** Atributul avatarelor unui membru (rama pluginului); nu e `data-user-id`, ca avatarul să nu deschidă hover card-ul. */
export const AVATAR_USER_ATTR = "data-avatar-user";

/**
 * CSS-ul aspectului, adăugat la `/gcs-names.css`: efectele numelor (`nameEffects.ts`), stilurile CSS ale pluginurilor
 * (pe clasele lor și pe numele membrilor care le-au ales) și ramele, per user. Doar din forma validată; userii cu id
 * nesigur sunt ignorați. Cu `previews`, și clasele de previzualizare (`.gcs-nfx--<efect>`, clasele stilurilor), pentru
 * paginile pluginurilor. Animațiile se opresc sub `prefers-reduced-motion`.
 */
export function compileAppearanceCss(entries: { userId: string; appearance: GcsMemberAppearance }[], opts: { previews?: boolean; styles?: GcsCompiledStyleInput[] } = {}): string {
  const styled: GcsStyledName[] = [];
  const styleUsers = new Map<string, string[]>();
  const frames: string[] = [];
  for (const { userId, appearance } of entries) {
    const sels = styledNameSelectors(userId);
    if (!sels) continue;
    const name = appearance.name;
    if (name) {
      const f = name.fill;
      styled.push({
        ...sels,
        effect: nameEffectOf(name),
        vars: nameVars({ colors: f.colors, glow: name.glow, speed: SPEED[f.speed ?? "normal"], angle: f.angle ?? 90, bold: name.bold, italic: name.italic }),
      });
      if (name.styleClass) styleUsers.set(name.styleClass, [...(styleUsers.get(name.styleClass) ?? []), sels.all]);
    }
    const frame = appearance.frame;
    if (frame && /^\/plugins\/[a-z0-9_.]+\/[A-Za-z0-9._/-]+$/.test(frame.image)) {
      const sel = `.gcs-avatar[${AVATAR_USER_ATTR}="${userId}"]`;
      const inset = -((frame.scale ?? 130) - 100) / 2;
      frames.push(`${sel}{overflow:visible}`, `${sel}>.gcs-avatar__img{border-radius:inherit}`);
      // Imaginea ramei așa cum e (inclusiv WebP animat): `contain`, fără repetare sau decupare; animația o redă browserul.
      frames.push(
        `${sel}::after{content:"";position:absolute;inset:${inset}%;background:url("${frame.image}") center/contain no-repeat;transform:translate(${frame.x ?? 0}%,${frame.y ?? 0}%);pointer-events:none;z-index:2}`,
      );
      // Rama clasică a nucleului (conic-gradient) nu se mai vede sub rama pluginului.
      frames.push(`.gcs-avatarFrame:has(>${sel}){padding:0}`, `.gcs-avatarFrame:has(>${sel})::before{display:none}`);
      frames.push(`.gcs-avatar--xs${sel}::after{display:none}`);
    }
  }
  const parts: string[] = [];
  const effects = compileNameEffectsCss(styled, { previews: opts.previews === true });
  if (effects) parts.push(effects);
  for (const st of opts.styles ?? []) {
    const cls = customStyleClass(st.pluginKey, st.kind, st.key);
    const selectors = [...(opts.previews ? [`${NAME_SCOPE} .${cls}`] : []), ...(st.kind === "name" ? (styleUsers.get(cls) ?? []) : [`${NAME_SCOPE} .${cls}`])];
    const css = compileCustomStyle(st.style, { selectors: [...new Set(selectors)], prefix: customStylePrefix(st.pluginKey, st.kind, st.key) });
    if (css) parts.push(css);
  }
  parts.push(...frames);
  if (parts.length === 0) return "";
  parts.push(
    `@media (prefers-reduced-motion: reduce){${NAME_SCOPE} :is(.gcs-userLink[data-user-id],[data-name-user]),${NAME_SCOPE} :is(.gcs-userLink[data-user-id],[data-name-user])::after{animation:none}}`,
  );
  return parts.join("\n");
}

/**
 * Stilul inline al unui banner (pastila sau bara de sub nume): fundalul, culoarea textului, animația. Un banner cu stil
 * CSS al pluginului (`styleClass`) nu are stil inline: îl desenează clasa lui (stilul inline ar câștiga în fața ei).
 */
export function appearanceBannerStyle(banner: NonNullable<GcsMemberAppearance["banner"]>): Record<string, string> {
  if (banner.styleClass) return {};
  const f = banner.fill;
  const style: Record<string, string> = {};
  const animated = f.animation === "flow" || f.animation === "aurora";
  const gradient = fillGradient(f, { loop: animated, minStops: animated || f.animation === "shine" ? 2 : 1 });
  if (f.animation === "shine") {
    style.backgroundImage = `linear-gradient(100deg,transparent 30%,rgba(255,255,255,.42) 50%,transparent 70%),${gradient.startsWith("#") ? `linear-gradient(${gradient},${gradient})` : gradient}`;
    style.backgroundSize = "250% 100%,100% 100%";
  } else if (gradient.startsWith("#")) style.backgroundColor = gradient;
  else {
    style.backgroundImage = gradient;
    if (animated) style.backgroundSize = "200% 100%";
  }
  style.color = banner.text && HEX.test(banner.text) ? banner.text : "#FFFFFF";
  const first = f.colors[0] && HEX.test(f.colors[0]) ? f.colors[0] : "#FFFFFF";
  style["--gcs-fx-glow"] = rgba(first, 0.6);
  const anim: string[] = [];
  if (animated) anim.push(`gcsFxFlow ${seconds(4, f.speed)} linear infinite`);
  if (f.animation === "aurora") anim.push(`gcsFxHue ${seconds(10, f.speed)} linear infinite`);
  if (f.animation === "shine") anim.push(`gcsFxShine ${seconds(3, f.speed)} ease-in-out infinite`);
  if (f.animation === "pulse") anim.push(`gcsFxGlowBox ${seconds(2.4, f.speed)} ease-in-out infinite`);
  if (anim.length > 0) style.animation = anim.join(",");
  return style;
}

/** Stilul inline al unui fundal de card (imaginea, poziția și întunecarea, din valori validate). */
export function appearanceCardStyle(card: { image: string; x?: number; y?: number; dim?: number }): Record<string, string> {
  const dim = (card.dim ?? 35) / 100;
  return {
    backgroundImage: `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url("${card.image}")`,
    backgroundSize: "cover",
    backgroundPosition: `${card.x ?? 50}% ${card.y ?? 50}%`,
  };
}

/** Variabilele temei de profil (doar culori validate), puse pe pagina profilului existentă. */
export function appearanceThemeVars(theme: NonNullable<NonNullable<GcsMemberAppearance["profile"]>["theme"]>): Record<string, string> {
  const vars: Record<string, string> = { "--gcs-accent": theme.accent, "--gcs-profile-accent": theme.accent, "--gcs-profile-accent-soft": rgba(theme.accent, 0.16) };
  if (theme.accent2) vars["--gcs-profile-accent2"] = theme.accent2;
  if (theme.surface) {
    vars["--gcs-profile-surface"] = rgba(theme.surface, 0.82);
    vars["--gcs-surface"] = rgba(theme.surface, 0.9);
  }
  if (theme.glow) vars["--gcs-profile-glow"] = `0 0 0 1px ${rgba(theme.accent, 0.35)},0 10px 40px ${rgba(theme.accent, 0.22)}`;
  return vars;
}
