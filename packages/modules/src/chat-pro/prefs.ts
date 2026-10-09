/**
 * Preferințele de chat ale unui membru (Chat Pro, specul 2026-10-10-chat-pro §6): valorile implicite, normalizarea și
 * validarea. Fără importuri: fișierul e folosit și de clientul web (modalul de setări, previzualizarea culorilor).
 */

/** Cele 7 aranjamente ale mesajelor. */
export const CHAT_PRO_LAYOUTS = ["cards", "stream", "columns", "bubbles", "timeline", "discord", "accent"] as const;
export type GcsChatProLayout = (typeof CHAT_PRO_LAYOUTS)[number];

/** Elementele cu culoare proprie (doar în vederea membrului), în ordinea din setări. */
export const CHAT_PRO_COLOR_ELEMENTS = ["messageBg", "messageBorder", "messageText", "chatBg", "header", "ranking", "input", "buttons", "accent", "uiBorder", "uiText"] as const;
export type GcsChatProColorElement = (typeof CHAT_PRO_COLOR_ELEMENTS)[number];

/** Comenzile botului (registrul din `commands.ts`); fiecare membru alege ale cui rezultate le vede. */
export const CHAT_PRO_COMMANDS = ["roll", "rps", "birthday", "iq"] as const;
export type GcsChatProCommand = (typeof CHAT_PRO_COMMANDS)[number];

export type GcsChatProPrefs = {
  // ─── Preferințe ─────────────────────────────────────────────
  sound: boolean;
  /** Volumul mesajelor vocale, 0–100. */
  voiceVolume: number;
  autoplayGifs: boolean;
  linkPreviews: boolean;
  /** Arată cine scrie. */
  showTyping: boolean;
  /** Ceilalți văd când scriu. */
  shareTyping: boolean;
  /** În locul mesajelor membrilor ignorați: o mențiune „mesaj ascuns” (altfel nimic). */
  ignoredPlaceholder: boolean;
  mentionAlerts: boolean;
  autoscroll: boolean;
  hideBar: boolean;
  showRanking: boolean;
  /** Pe ecranele mici, imaginile și GIF-urile stau ascunse după un buton „Arată media”. */
  mobileMediaButtons: boolean;
  // ─── Bot ────────────────────────────────────────────────────
  voteReminders: boolean;
  commandResults: Record<GcsChatProCommand, boolean>;
  // ─── Aranjament ─────────────────────────────────────────────
  /**
   * Unde stă chat-ul pe pagina principală: `auto` = unde l-a pus adminul; `top` = primul în zona de sus; `bottom` =
   * ultimul în zona de jos (doar când widget-ul e sus sau jos, nu în coloana laterală).
   */
  position: "auto" | "top" | "bottom";
  layout: GcsChatProLayout;
  /** Accentul propriu (`#RRGGBB`) sau `null` = accentul temei. */
  accent: string | null;
  /** Culorile proprii (`#RRGGBBAA`, cu opacitate) pe element; lipsă = culoarea temei. */
  colors: Partial<Record<GcsChatProColorElement, string>>;
  /** Înălțimea listei de mesaje (px). */
  height: number;
  /** Mărimea emoticoanelor (px). */
  emojiSize: number;
  // ─── Cont ───────────────────────────────────────────────────
  /** Membrul a oprit chat-ul pentru el (nu-l mai vede deloc). */
  disabled: boolean;
};

export const CHAT_PRO_HEIGHT = { min: 280, max: 900, default: 460 } as const;
export const CHAT_PRO_EMOJI = { min: 16, max: 48, default: 24 } as const;

export const DEFAULT_CHAT_PRO_PREFS: GcsChatProPrefs = {
  sound: true,
  voiceVolume: 100,
  autoplayGifs: true,
  linkPreviews: true,
  showTyping: true,
  shareTyping: true,
  ignoredPlaceholder: true,
  mentionAlerts: true,
  autoscroll: true,
  hideBar: false,
  showRanking: true,
  mobileMediaButtons: true,
  voteReminders: true,
  commandResults: { roll: true, rps: true, birthday: true, iq: true },
  position: "auto",
  layout: "cards",
  accent: null,
  colors: {},
  height: CHAT_PRO_HEIGHT.default,
  emojiSize: CHAT_PRO_EMOJI.default,
  disabled: false,
};

const BOOLEAN_KEYS = [
  "sound",
  "autoplayGifs",
  "linkPreviews",
  "showTyping",
  "shareTyping",
  "ignoredPlaceholder",
  "mentionAlerts",
  "autoscroll",
  "hideBar",
  "showRanking",
  "mobileMediaButtons",
  "voteReminders",
  "disabled",
] as const satisfies readonly (keyof GcsChatProPrefs)[];

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Preferințele salvate (orice formă), completate cu valorile implicite; valorile invalide revin la implicit. */
export function normalizeChatProPrefs(raw: unknown): GcsChatProPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CHAT_PRO_PREFS;
  const out: GcsChatProPrefs = { ...d, commandResults: { ...d.commandResults }, colors: {} };
  for (const key of BOOLEAN_KEYS) if (typeof r[key] === "boolean") out[key] = r[key];
  if (isInt(r.voiceVolume, 0, 100)) out.voiceVolume = r.voiceVolume;
  const commands = r.commandResults && typeof r.commandResults === "object" ? (r.commandResults as Record<string, unknown>) : {};
  for (const c of CHAT_PRO_COMMANDS) if (typeof commands[c] === "boolean") out.commandResults[c] = commands[c];
  if (r.position === "auto" || r.position === "top" || r.position === "bottom") out.position = r.position;
  if (CHAT_PRO_LAYOUTS.includes(r.layout as GcsChatProLayout)) out.layout = r.layout as GcsChatProLayout;
  if (typeof r.accent === "string" && HEX6.test(r.accent)) out.accent = r.accent.toUpperCase();
  const colors = r.colors && typeof r.colors === "object" ? (r.colors as Record<string, unknown>) : {};
  for (const el of CHAT_PRO_COLOR_ELEMENTS) {
    const v = colors[el];
    if (typeof v === "string" && HEX8.test(v)) out.colors[el] = v.toUpperCase();
  }
  if (isInt(r.height, CHAT_PRO_HEIGHT.min, CHAT_PRO_HEIGHT.max)) out.height = r.height;
  if (isInt(r.emojiSize, CHAT_PRO_EMOJI.min, CHAT_PRO_EMOJI.max)) out.emojiSize = r.emojiSize;
  return out;
}

/**
 * Validarea unei modificări venite din formular (doar cheile trimise): `null` dacă e validă, altfel cheia greșită.
 * Cheile necunoscute sunt o eroare (nu se salvează nimic în plus în profil).
 */
export function chatProPrefsError(patch: unknown): string | null {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return "prefs";
  for (const [key, v] of Object.entries(patch as Record<string, unknown>)) {
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof v !== "boolean") return key;
    } else if (key === "voiceVolume") {
      if (!isInt(v, 0, 100)) return key;
    } else if (key === "commandResults") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return key;
      for (const [c, on] of Object.entries(v)) if (!CHAT_PRO_COMMANDS.includes(c as GcsChatProCommand) || typeof on !== "boolean") return key;
    } else if (key === "position") {
      if (v !== "auto" && v !== "top" && v !== "bottom") return key;
    } else if (key === "layout") {
      if (!CHAT_PRO_LAYOUTS.includes(v as GcsChatProLayout)) return key;
    } else if (key === "accent") {
      if (v !== null && !(typeof v === "string" && HEX6.test(v))) return key;
    } else if (key === "colors") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return key;
      for (const [el, c] of Object.entries(v)) {
        if (!CHAT_PRO_COLOR_ELEMENTS.includes(el as GcsChatProColorElement)) return key;
        if (c !== null && !(typeof c === "string" && HEX8.test(c))) return key;
      }
    } else if (key === "height") {
      if (!isInt(v, CHAT_PRO_HEIGHT.min, CHAT_PRO_HEIGHT.max)) return key;
    } else if (key === "emojiSize") {
      if (!isInt(v, CHAT_PRO_EMOJI.min, CHAT_PRO_EMOJI.max)) return key;
    } else return key;
  }
  return null;
}

/** Aplică o modificare validă peste preferințele curente (culorile `null` revin la tema). */
export function mergeChatProPrefs(current: GcsChatProPrefs, patch: Record<string, unknown>): GcsChatProPrefs {
  const next: Record<string, unknown> = { ...current, commandResults: { ...current.commandResults }, colors: { ...current.colors } };
  for (const [key, v] of Object.entries(patch)) {
    if (key === "commandResults") Object.assign(next.commandResults as object, v);
    else if (key === "colors") {
      const colors = next.colors as Record<string, string>;
      for (const [el, c] of Object.entries(v as Record<string, string | null>)) {
        if (c === null) delete colors[el];
        else colors[el] = c;
      }
    } else next[key] = v;
  }
  return normalizeChatProPrefs(next);
}

// ─── Culorile: HEX ↔ HSV, opacitatea (selectorul de culoare din setări) ─────────────────────────

export type GcsHsva = { h: number; s: number; v: number; a: number };

/** `#RRGGBB` sau `#RRGGBBAA` → nuanță (0–360), saturație și valoare (0–1), opacitate (0–1). */
export function hexToHsva(hex: string): GcsHsva | null {
  if (!HEX6.test(hex) && !HEX8.test(hex)) return null;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  const [r, g, b] = [n(1), n(3), n(5)];
  const a = hex.length === 9 ? n(7) : 1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

/** Nuanță, saturație, valoare, opacitate → `#RRGGBBAA` (majuscule). */
export function hsvaToHex({ h, s, v, a }: GcsHsva): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  const hex = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}${hex(a)}`.toUpperCase();
}

/** O culoare `#RRGGBBAA` ca valoare CSS (`rgb(r g b / a)`). */
export function cssColor(hex8: string): string {
  const n = (i: number) => parseInt(hex8.slice(i, i + 2), 16);
  const alpha = hex8.length === 9 ? Math.round((n(7) / 255) * 1000) / 1000 : 1;
  return `rgb(${n(1)} ${n(3)} ${n(5)} / ${alpha})`;
}

/** Variabila CSS a fiecărui element colorabil (folosită de `chatpro.css`). */
export const CHAT_PRO_COLOR_VARS: Record<GcsChatProColorElement, string> = {
  messageBg: "--cp-msg-bg",
  messageBorder: "--cp-msg-border",
  messageText: "--cp-msg-text",
  chatBg: "--cp-chat-bg",
  header: "--cp-head-bg",
  ranking: "--cp-rank-bg",
  input: "--cp-input-bg",
  buttons: "--cp-btn-bg",
  accent: "--cp-accent",
  uiBorder: "--cp-border",
  uiText: "--cp-text",
};

/**
 * Variabilele CSS ale vederii membrului: înălțimea listei, mărimea emoticoanelor, accentul propriu și culorile proprii
 * (cu opacitate). Se pun pe rădăcina chat-ului, deci schimbă doar ce vede el. Culoarea elementului „Accent” câștigă
 * peste accentul ales din listă.
 */
export function chatProStyleVars(prefs: GcsChatProPrefs): Record<string, string> {
  const vars: Record<string, string> = { "--cp-height": `${prefs.height}px`, "--cp-emoji": `${prefs.emojiSize}px` };
  if (prefs.accent) vars["--cp-accent"] = prefs.accent;
  for (const el of CHAT_PRO_COLOR_ELEMENTS) {
    const c = prefs.colors[el];
    if (c) vars[CHAT_PRO_COLOR_VARS[el]] = cssColor(c);
  }
  return vars;
}
