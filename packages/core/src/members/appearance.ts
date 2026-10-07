/**
 * Aspectul membrilor publicat de pluginuri (capabilitatea `appearance`, specul Studio VIP §2.1): stilul numelui, rama,
 * banner-ul, fundalul cardului, insigna și extra-urile profilului.
 *
 * Nimic nu e CSS sau HTML brut: doar culori `#RRGGBB`, numere în intervale, chei din liste albe, texte simple și căi
 * spre fișierele pluginului care publică. CSS-ul se compilează aici, din valorile validate.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const THEME_KEY = /^[a-z0-9_]{1,30}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Fișierele pluginului: imagini (din pachet sau încărcate) și, pentru video/audio, doar fișierele încărcate. */
const ASSET_IMAGE = /^assets\/[A-Za-z0-9_-][A-Za-z0-9._/-]{0,180}\.(?:png|jpe?g|gif|webp)$/;
const MEDIA_FILE = /^media\/[a-z0-9]{10,40}\.(webp|png|jpg|gif|mp4|webm|mp3|ogg)$/;

export const NAME_EFFECTS = ["none", "shimmer", "pulse", "neon", "glitch", "scan", "chrome", "fire", "holo", "caret"] as const;
export type GcsNameEffect = (typeof NAME_EFFECTS)[number];
export const FILL_ANIMATIONS = ["none", "flow", "pulse", "shine", "aurora"] as const;
export type GcsFillAnimation = (typeof FILL_ANIMATIONS)[number];
export const FX_SPEEDS = ["slow", "normal", "fast"] as const;
export type GcsFxSpeed = (typeof FX_SPEEDS)[number];

export type GcsAppearanceFill = { colors: string[]; angle?: number; animation?: GcsFillAnimation; speed?: GcsFxSpeed };

export type GcsMemberAppearance = {
  name?: { fill: GcsAppearanceFill; effect?: GcsNameEffect; glow?: string; bold?: boolean; italic?: boolean };
  banner?: { fill: GcsAppearanceFill; text?: string; label?: string };
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
    const n = known(ctx, "name", root.name, ["fill", "effect", "glow", "bold", "italic"]);
    const f = n ? fill(ctx, "name.fill", n.fill) : undefined;
    if (n && f) {
      const effect = oneOf(ctx, "name.effect", n.effect, NAME_EFFECTS);
      out.name = compact({ fill: f, effect: effect && effect !== "none" ? effect : undefined, glow: hex(ctx, "name.glow", n.glow), bold: bool(ctx, "name.bold", n.bold), italic: bool(ctx, "name.italic", n.italic) });
    }
  }
  if (root.banner !== undefined) {
    const b = known(ctx, "banner", root.banner, ["fill", "text", "label"]);
    const f = b ? fill(ctx, "banner.fill", b.fill) : undefined;
    if (b && f) out.banner = compact({ fill: f, text: hex(ctx, "banner.text", b.text), label: text(ctx, "banner.label", b.label, 32, false) });
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
 * nivel (iar la profil, fiecare sub-câmp) vine de la primul plugin care îl are.
 */
export function mergeAppearances(list: GcsMemberAppearance[]): GcsMemberAppearance {
  const out: GcsMemberAppearance = {};
  for (const a of list) {
    for (const key of ["name", "banner", "frame", "card", "flair"] as const) {
      if (a[key] && !out[key]) (out as Record<string, unknown>)[key] = a[key];
    }
    if (a.profile) {
      const p = (out.profile ??= {});
      for (const key of ["background", "quote", "theme", "song"] as const) {
        if (a.profile[key] && !p[key]) (p as Record<string, unknown>)[key] = a.profile[key];
      }
    }
  }
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

/** Declarațiile CSS ale stilului de nume (pentru un selector dat). */
function nameDecls(name: NonNullable<GcsMemberAppearance["name"]>): { main: string[]; after: string[] | null } {
  const f = name.fill;
  const effect = name.effect ?? "none";
  const main: string[] = [];
  let after: string[] | null = null;
  const first = HEX.test(f.colors[0] ?? "") ? f.colors[0]! : "#FFFFFF";
  const glow = name.glow && HEX.test(name.glow) ? name.glow : null;
  const needsGradient = f.colors.length > 1 || ["shimmer", "chrome", "scan", "holo", "fire"].includes(effect) || (f.animation !== undefined && f.animation !== "pulse");
  const animations: string[] = [];

  if (needsGradient) {
    const gradient = fillGradient({ ...f, angle: f.angle ?? (effect === "fire" ? 0 : 90) }, { loop: true, minStops: 2 });
    const layers: string[] = [];
    const sizes: string[] = [];
    if (effect === "chrome") {
      layers.push("linear-gradient(100deg,transparent 35%,rgba(255,255,255,.9) 50%,transparent 65%)");
      sizes.push("250% 100%");
    }
    if (effect === "scan") {
      layers.push("repeating-linear-gradient(0deg,rgba(0,0,0,.38) 0 1px,transparent 1px 3px)");
      sizes.push("100% 6px");
    }
    layers.push(gradient);
    sizes.push("200% auto");
    main.push(
      `background-image:${layers.join(",")}`,
      `background-size:${sizes.join(",")}`,
      "-webkit-background-clip:text",
      "background-clip:text",
      "color:transparent",
      "-webkit-text-fill-color:transparent",
    );
    if (effect === "shimmer" || f.animation === "flow" || f.animation === "aurora") animations.push(`gcsFxFlow ${seconds(3.5, f.speed)} linear infinite`);
    if (effect === "chrome" || f.animation === "shine") animations.push(`gcsFxShine ${seconds(3, f.speed)} ease-in-out infinite`);
    if (effect === "scan") animations.push(`gcsFxScan ${seconds(1.4, f.speed)} linear infinite`);
    if (effect === "holo" || f.animation === "aurora") animations.push(`gcsFxHue ${seconds(8, f.speed)} linear infinite`);
  } else {
    main.push(`color:${first}`, "background:none", "-webkit-text-fill-color:currentColor");
  }

  const glowColor = glow ?? (effect === "neon" || effect === "pulse" || effect === "fire" ? first : null);
  main.push(`--gcs-fx-glow:${glowColor ? rgba(glowColor, 0.75) : "transparent"}`);
  if (effect === "neon") {
    main.push(`text-shadow:0 0 4px ${rgba(glowColor!, 0.9)},0 0 12px ${rgba(glowColor!, 0.7)},0 0 24px ${rgba(glowColor!, 0.45)}`);
    animations.push(`gcsFxFlicker ${seconds(4, f.speed)} linear infinite`);
  } else if (effect === "glitch") {
    const a = f.colors[1] && HEX.test(f.colors[1]) ? f.colors[1] : "#FF2E63";
    const b = f.colors[2] && HEX.test(f.colors[2]) ? f.colors[2] : "#08D9D6";
    main.push(`--gcs-fx-a:${rgba(a, 0.8)}`, `--gcs-fx-b:${rgba(b, 0.8)}`, "text-shadow:2px 0 var(--gcs-fx-a),-2px 0 var(--gcs-fx-b)");
    animations.push(`gcsFxGlitch ${seconds(2.6, f.speed)} steps(1) infinite`);
  } else if (needsGradient && glowColor) {
    // Textul transparent (gradient) nu poate avea text-shadow vizibil peste el; strălucirea vine din `filter`.
    main.push(`filter:drop-shadow(0 0 6px ${rgba(glowColor, 0.55)})`);
  } else if (glowColor) {
    main.push(`text-shadow:0 0 10px ${rgba(glowColor, 0.6)}`);
  }
  if (effect === "pulse" || f.animation === "pulse") animations.push(`gcsFxPulse ${seconds(2.4, f.speed)} ease-in-out infinite`);
  if (effect === "fire") animations.push(`gcsFxFire ${seconds(1.8, f.speed)} ease-in-out infinite`);
  if (effect === "caret") {
    after = [
      'content:""',
      "display:inline-block",
      "width:.09em",
      "height:.95em",
      "margin-left:.14em",
      "vertical-align:-.1em",
      `background:${first}`,
      "-webkit-text-fill-color:initial",
      `animation:gcsFxCaret 1s steps(1) infinite`,
    ];
  }
  main.push(`animation:${animations.length > 0 ? animations.join(",") : "none"}`);
  main.push(`font-weight:${name.bold === false ? 600 : 700}`);
  if (name.italic) main.push("font-style:italic");
  return { main, after };
}

/**
 * Selectorul numelui unui membru: linkurile spre profil (`a.gcs-userLink[data-user-id]`, ca hover card-ul) și numele
 * care nu sunt linkuri (titlul profilului, meniul userului), marcate cu `data-name-user` (fără hover card).
 */
export function nameSelector(userId: string): string {
  return `.gcs-root :is(a.gcs-userLink[data-user-id="${userId}"],[data-name-user="${userId}"])`;
}

/** Atributul avatarelor unui membru (rama pluginului); nu e `data-user-id`, ca avatarul să nu deschidă hover card-ul. */
export const AVATAR_USER_ATTR = "data-avatar-user";

/**
 * CSS-ul aspectului: stilul numelui și rama, per user (`data-user-id`), adăugat la `/gcs-names.css`. Doar din forma
 * validată; userii cu id nesigur sunt ignorați. Animațiile se opresc sub `prefers-reduced-motion`.
 */
export function compileAppearanceCss(entries: { userId: string; appearance: GcsMemberAppearance }[]): string {
  const parts: string[] = [];
  for (const { userId, appearance } of entries) {
    if (!USER_ID.test(userId)) continue;
    if (appearance.name) {
      const sel = nameSelector(userId);
      const { main, after } = nameDecls(appearance.name);
      parts.push(`${sel},${sel}:hover{${main.join(";")}}`);
      if (after) parts.push(`${sel}::after{${after.join(";")}}`);
    }
    const frame = appearance.frame;
    if (frame && /^\/plugins\/[a-z0-9_.]+\/[A-Za-z0-9._/-]+$/.test(frame.image)) {
      const sel = `.gcs-avatar[${AVATAR_USER_ATTR}="${userId}"]`;
      const inset = -((frame.scale ?? 130) - 100) / 2;
      parts.push(`${sel}{overflow:visible}`, `${sel}>.gcs-avatar__img{border-radius:inherit}`);
      parts.push(
        `${sel}::after{content:"";position:absolute;inset:${inset}%;background:url("${frame.image}") center/contain no-repeat;transform:translate(${frame.x ?? 0}%,${frame.y ?? 0}%);pointer-events:none;z-index:2}`,
      );
      // Rama clasică a nucleului (conic-gradient) nu se mai vede sub rama pluginului.
      parts.push(`.gcs-avatarFrame:has(>${sel}){padding:0}`, `.gcs-avatarFrame:has(>${sel})::before{display:none}`);
      parts.push(`.gcs-avatar--xs${sel}::after{display:none}`);
    }
  }
  if (parts.length === 0) return "";
  parts.push(
    "@media (prefers-reduced-motion: reduce){.gcs-root :is(a.gcs-userLink[data-user-id],[data-name-user]),.gcs-root :is(a.gcs-userLink[data-user-id],[data-name-user])::after{animation:none}}",
  );
  return parts.join("\n");
}

/** Stilul inline al unui banner (pastila sau bara de sub nume): fundalul, culoarea textului, animația. */
export function appearanceBannerStyle(banner: NonNullable<GcsMemberAppearance["banner"]>): Record<string, string> {
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
