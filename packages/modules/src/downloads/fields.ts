import { GcsValidationError } from "@gcs/core";

/**
 * Câmpurile suplimentare ale fișierelor (ACP → Descărcări → Câmpuri): definite o dată, activate pe categorii. Tipurile,
 * locul pe pagină și validarea valorilor trimise. `member` = membri aleși (co-autori), salvați după id.
 */
export const DOWNLOAD_FIELD_TYPES = ["text", "textarea", "url", "number", "select", "checkbox", "member", "date"] as const;
export type GcsDownloadFieldType = (typeof DOWNLOAD_FIELD_TYPES)[number];
export const DOWNLOAD_FIELD_LOCATIONS = ["sidebar", "below", "tab"] as const;
export type GcsDownloadFieldLocation = (typeof DOWNLOAD_FIELD_LOCATIONS)[number];

export type GcsDownloadFieldDef = {
  id: number;
  name: string;
  description: string;
  type: string;
  options: string[];
  multiple: boolean;
  required: boolean;
  location: string;
  inTopic: boolean;
  topicFormat: string;
  viewGroups: number[];
  editGroups: number[];
  position: number;
};

const TEXT_MAX = 255;
const TEXTAREA_MAX = 5000;
const MAX_MEMBERS = 10;

/** Grupurile actorului pot vedea / completa câmpul (lista goală = toate grupurile). */
export const fieldAllows = (groups: number[], allowed: number[]) => allowed.length === 0 || groups.some((g) => allowed.includes(g));

function empty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || v === false;
}

/** O valoare trimisă, normalizată după tipul câmpului, sau eroarea ei. */
export function fieldValue(def: GcsDownloadFieldDef, raw: unknown): { value: unknown } | { error: string } {
  const type = def.type as GcsDownloadFieldType;
  if (empty(raw)) return def.required ? { error: "required" } : { value: null };
  switch (type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { error: "invalid" };
      const v = type === "text" ? raw.replace(/\s+/g, " ").trim() : raw.replace(/\r\n/g, "\n").trim();
      if (!v) return def.required ? { error: "required" } : { value: null };
      return v.length > (type === "text" ? TEXT_MAX : TEXTAREA_MAX) ? { error: "too_long" } : { value: v };
    }
    case "url": {
      if (typeof raw !== "string") return { error: "invalid" };
      try {
        const u = new URL(raw.trim());
        return u.protocol === "https:" || u.protocol === "http:" ? { value: u.toString().slice(0, 2000) } : { error: "invalid_url" };
      } catch {
        return { error: "invalid_url" };
      }
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : Number.NaN;
      return Number.isFinite(n) && Math.abs(n) < 1e12 ? { value: n } : { error: "invalid_number" };
    }
    case "checkbox":
      return { value: raw === true || raw === "1" || raw === "on" || raw === "true" };
    case "date": {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) return { error: "invalid_date" };
      return { value: raw };
    }
    case "select": {
      const values = Array.isArray(raw) ? raw : [raw];
      if (!values.every((v) => typeof v === "string" && def.options.includes(v))) return { error: "invalid_choice" };
      if (!def.multiple && values.length > 1) return { error: "invalid_choice" };
      return { value: def.multiple ? [...new Set(values as string[])] : values[0] };
    }
    case "member": {
      const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && /^[a-z0-9]{8,40}$/i.test(v)) as string[];
      if (values.length === 0) return def.required ? { error: "required" } : { value: null };
      const unique = [...new Set(values)];
      if (!def.multiple && unique.length > 1) return { error: "invalid_choice" };
      return unique.length > MAX_MEMBERS ? { error: "too_many" } : { value: def.multiple ? unique : unique[0] };
    }
    default:
      return { error: "invalid" };
  }
}

/**
 * Valorile câmpurilor unei trimiteri, după id (`{ "3": "1.2", "5": ["a"] }`). Câmpurile pe care grupurile actorului nu
 * le pot completa își păstrează valoarea anterioară (`previous`). Orice eroare → `GcsValidationError` pe `field_<id>`.
 */
export function validateFieldValues(defs: GcsDownloadFieldDef[], input: Record<string, unknown>, groups: number[], previous: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const key = String(def.id);
    if (!fieldAllows(groups, def.editGroups)) {
      if (previous[key] !== undefined && previous[key] !== null) out[key] = previous[key];
      continue;
    }
    const result = fieldValue(def, input[key]);
    if ("error" in result) errors[`field_${def.id}`] = result.error;
    else if (result.value !== null) out[key] = result.value;
  }
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  return out;
}

/** Definiția unui câmp trimisă din ACP, validată (`GcsValidationError` pe câmpurile formularului). */
export function fieldDefInput(raw: {
  name: string;
  description?: string;
  type: string;
  options?: string[];
  multiple?: boolean;
  required?: boolean;
  location?: string;
  inTopic?: boolean;
  topicFormat?: string;
  viewGroups?: number[];
  editGroups?: number[];
}): Omit<GcsDownloadFieldDef, "id" | "position"> {
  const errors: Record<string, string> = {};
  const name = raw.name.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) errors.name = name.length < 2 ? "too_short" : "too_long";
  if (!DOWNLOAD_FIELD_TYPES.includes(raw.type as GcsDownloadFieldType)) errors.type = "invalid_choice";
  const options = [...new Set((raw.options ?? []).map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 50);
  if (raw.type === "select" && options.length === 0) errors.options = "required";
  if (options.some((o) => o.length > 80)) errors.options = "too_long";
  const location = raw.location ?? "sidebar";
  if (!DOWNLOAD_FIELD_LOCATIONS.includes(location as GcsDownloadFieldLocation)) errors.location = "invalid_choice";
  const ids = (list: number[] | undefined) => [...new Set((list ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  return {
    name,
    description: (raw.description ?? "").trim().slice(0, 300),
    type: raw.type,
    options: raw.type === "select" ? options : [],
    multiple: (raw.type === "select" || raw.type === "member") && Boolean(raw.multiple),
    required: Boolean(raw.required),
    location,
    inTopic: Boolean(raw.inTopic),
    topicFormat: (raw.topicFormat ?? "").slice(0, 500),
    viewGroups: ids(raw.viewGroups),
    editGroups: ids(raw.editGroups),
  };
}

/** Textul unei valori pentru topicul din forum (formatul câmpului cu `{title}` și `{content}`, implicit „titlu: valoare”). */
export function fieldTopicLine(def: Pick<GcsDownloadFieldDef, "name" | "topicFormat">, text: string): string {
  const format = def.topicFormat.trim() || "{title}: {content}";
  return format.replaceAll("{title}", def.name).replaceAll("{content}", text);
}
