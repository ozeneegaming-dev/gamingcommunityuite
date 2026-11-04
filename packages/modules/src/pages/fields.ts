/**
 * Câmpurile proprii ale unei baze de date (specul 2026-11-03-pagini §3.1): definițiile salvate în `PagesDatabase.fields`
 * și valorile unei înregistrări (`PagesRecord.fields`), validate aici, fără bază de date.
 */

export const PAGES_FIELD_TYPES = ["text", "textarea", "number", "select", "multiselect", "checkbox", "url", "date", "code", "image", "file", "server", "youtube", "member"] as const;
export type GcsPagesFieldType = (typeof PAGES_FIELD_TYPES)[number];

/** Tipurile cu opțiuni fixe (lista din definiție). */
const WITH_OPTIONS: readonly GcsPagesFieldType[] = ["select", "multiselect"];
/** Tipurile care pot fi filtre în lista înregistrărilor. */
export const FILTERABLE_FIELD_TYPES: readonly GcsPagesFieldType[] = ["select", "multiselect", "checkbox", "server", "member"];

export const MAX_FIELDS = 30;
const MAX_OPTIONS = 50;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
const LIMITS: Partial<Record<GcsPagesFieldType, number>> = { text: 200, textarea: 5000, url: 500, code: 20_000, youtube: 500 };

export type GcsPagesFieldDef = {
  key: string;
  label: string;
  type: GcsPagesFieldType;
  required: boolean;
  /** Textul de ajutor de sub câmp, în formular. */
  help: string;
  /** Opțiunile (`select`, `multiselect`). */
  options: string[];
  /** Apare pe cardul înregistrării din listă. */
  listed: boolean;
  /** Filtru în lista înregistrărilor (doar tipurile din `FILTERABLE_FIELD_TYPES`). */
  filter: boolean;
  /** Pe pagina înregistrării: deasupra sau sub conținut. */
  position: "top" | "bottom";
  /** Culoarea insignei de pe card (`#rrggbb`; `null` = culoarea temei). */
  badge: string | null;
};

/** Valoarea unui câmp: text, număr, boolean, listă de opțiuni, id de atașament (imagine / fișier) sau id de server. */
export type GcsPagesFieldValue = string | number | boolean | string[];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Definițiile câmpurilor trimise din ACP → lista curată, sau erorile (`fields.<index>.<proprietate>`). Cheile sunt unice,
 * un `select` are cel puțin o opțiune, filtrele doar pe tipurile care pot fi filtre.
 */
export function parseFieldDefs(raw: unknown): { defs: GcsPagesFieldDef[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_FIELDS) errors.fields = "too_many";
  const seen = new Set<string>();
  const defs: GcsPagesFieldDef[] = [];
  list.slice(0, MAX_FIELDS).forEach((item, i) => {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const type = PAGES_FIELD_TYPES.includes(o.type as GcsPagesFieldType) ? (o.type as GcsPagesFieldType) : null;
    const label = str(o.label, 60);
    if (!KEY_RE.test(key)) errors[`fields.${i}.key`] = "invalid_key";
    else if (seen.has(key)) errors[`fields.${i}.key`] = "duplicate";
    seen.add(key);
    if (!type) errors[`fields.${i}.type`] = "invalid_choice";
    if (!label) errors[`fields.${i}.label`] = "required";
    const options = WITH_OPTIONS.includes(type ?? "text")
      ? [...new Set((Array.isArray(o.options) ? o.options : typeof o.options === "string" ? o.options.split("\n") : []).map((x) => str(x, 60)).filter(Boolean))]
      : [];
    if (type && WITH_OPTIONS.includes(type) && options.length === 0) errors[`fields.${i}.options`] = "required";
    if (options.length > MAX_OPTIONS) errors[`fields.${i}.options`] = "too_many";
    defs.push({
      key,
      label,
      type: type ?? "text",
      required: o.required === true,
      help: str(o.help, 200),
      options: options.slice(0, MAX_OPTIONS),
      listed: o.listed === true,
      filter: o.filter === true && type !== null && FILTERABLE_FIELD_TYPES.includes(type),
      position: o.position === "top" ? "top" : "bottom",
      badge: typeof o.badge === "string" && /^#[0-9a-f]{6}$/i.test(o.badge) ? o.badge : null,
    });
  });
  return { defs, errors };
}

/** Definițiile salvate (citite din bază): doar intrările valide, fără erori. */
export function fieldDefsOf(raw: unknown): GcsPagesFieldDef[] {
  return parseFieldDefs(raw).defs.filter((d) => KEY_RE.test(d.key) && d.label);
}

const URL_RE = /^https?:\/\/[^\s<>"']{3,}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ATTACHMENT_RE = /^[a-z0-9]{8,40}$/i;

export type GcsFieldCheckContext = {
  /** Serverele de joc care pot fi alese (id-urile), dacă aplicația Servere e pornită. */
  servers?: ReadonlySet<number> | null;
  /** Membrii existenți dintre cei aleși în câmpurile „membru” (id-urile). */
  members?: ReadonlySet<string> | null;
};

/** Id-ul unui video YouTube dintr-o adresă (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`) sau chiar id-ul. */
export function youtubeId(input: string): string | null {
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#].*)?$/.exec(input);
  return m ? m[1]! : null;
}

/**
 * Valorile trimise pentru câmpurile unei baze de date → valorile curate (doar câmpurile definite) sau erorile
 * (`field.<cheie>`). Atașamentele (imagine, fișier) sunt id-uri; legarea lor o face serviciul.
 */
export function parseFieldValues(defs: readonly GcsPagesFieldDef[], raw: Record<string, unknown>, ctx: GcsFieldCheckContext = {}): { values: Record<string, GcsPagesFieldValue>; errors: Record<string, string> } {
  const values: Record<string, GcsPagesFieldValue> = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const v = raw[def.key];
    const name = `field.${def.key}`;
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (def.type === "checkbox") {
      values[def.key] = v === true || v === "on" || v === "true" || v === "1";
      if (def.required && values[def.key] !== true) errors[name] = "required";
      continue;
    }
    if (empty) {
      if (def.required) errors[name] = "required";
      continue;
    }
    switch (def.type) {
      case "text":
      case "textarea":
      case "code": {
        const max = LIMITS[def.type]!;
        const text = typeof v === "string" ? (def.type === "text" ? v.replace(/\s+/g, " ").trim() : v.replace(/\r\n/g, "\n").replace(/\s+$/, "")) : "";
        if (!text) {
          if (def.required) errors[name] = "required";
        } else if (text.length > max) errors[name] = "too_long";
        else values[def.key] = text;
        break;
      }
      case "url": {
        const text = typeof v === "string" ? v.trim() : "";
        if (!URL_RE.test(text) || text.length > LIMITS.url!) errors[name] = "invalid_url";
        else values[def.key] = text;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : Number.NaN;
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) errors[name] = "invalid_number";
        else values[def.key] = n;
        break;
      }
      case "date": {
        const text = typeof v === "string" ? v.trim() : "";
        if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) errors[name] = "invalid_date";
        else values[def.key] = text;
        break;
      }
      case "select": {
        const text = typeof v === "string" ? v : "";
        if (!def.options.includes(text)) errors[name] = "invalid_choice";
        else values[def.key] = text;
        break;
      }
      case "multiselect": {
        const list = [...new Set((Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x !== ""))];
        if (list.some((x) => !def.options.includes(x))) errors[name] = "invalid_choice";
        else if (list.length > 0) values[def.key] = list;
        else if (def.required) errors[name] = "required";
        break;
      }
      case "image":
      case "file": {
        const text = typeof v === "string" ? v.trim() : "";
        if (!ATTACHMENT_RE.test(text)) errors[name] = "invalid_file";
        else values[def.key] = text;
        break;
      }
      case "youtube": {
        const id = youtubeId(typeof v === "string" ? v.trim() : "");
        if (!id) errors[name] = "invalid_url";
        else values[def.key] = id;
        break;
      }
      case "member": {
        const text = typeof v === "string" ? v.trim() : "";
        if (!ATTACHMENT_RE.test(text) || (ctx.members && !ctx.members.has(text))) errors[name] = "invalid_member";
        else values[def.key] = text;
        break;
      }
      case "server": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isSafeInteger(n) || n <= 0 || (ctx.servers && !ctx.servers.has(n))) errors[name] = "invalid_choice";
        else values[def.key] = n;
        break;
      }
    }
  }
  return { values, errors };
}

/** Valorile salvate ale unei înregistrări (citite din bază), doar ale câmpurilor definite. */
export function fieldValuesOf(defs: readonly GcsPagesFieldDef[], raw: unknown): Record<string, GcsPagesFieldValue> {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, GcsPagesFieldValue> = {};
  for (const def of defs) {
    const v = obj[def.key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[def.key] = v;
    else if (Array.isArray(v)) out[def.key] = v.filter((x): x is string => typeof x === "string");
  }
  return out;
}

/** Id-urile atașamentelor din valori (câmpurile imagine și fișier). */
export function attachmentIdsOf(defs: readonly GcsPagesFieldDef[], values: Record<string, GcsPagesFieldValue>): string[] {
  return defs.filter((d) => (d.type === "image" || d.type === "file") && typeof values[d.key] === "string").map((d) => values[d.key] as string);
}

/** Textul căutabil al valorilor (titlul și conținutul se caută separat): textele, opțiunile alese, codul. */
export function fieldSearchText(defs: readonly GcsPagesFieldDef[], values: Record<string, GcsPagesFieldValue>): string {
  return defs
    .flatMap((d) => {
      const v = values[d.key];
      if (d.type === "image" || d.type === "file" || d.type === "server" || d.type === "checkbox" || d.type === "youtube" || d.type === "member") return [];
      return Array.isArray(v) ? v : v === undefined ? [] : [String(v)];
    })
    .join(" ")
    .slice(0, 4000);
}
