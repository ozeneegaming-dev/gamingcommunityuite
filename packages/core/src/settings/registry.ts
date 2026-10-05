/** O setare declarată de un modul. Apare automat în ACP, în secțiunea `section` (spec §5). */
export interface GcsSettingDef {
  key: string;
  type: "string" | "number" | "boolean" | "json" | "secret";
  default: unknown;
  section: string;
  labelKey: string;
  /** Întoarce un cod de eroare (cheie de traducere) sau `null` dacă valoarea e validă. */
  validate?: (v: unknown) => string | null;
}

/** Codul de eroare pentru o valoare care nu se potrivește cu tipul sau validarea setării, sau `null`. */
export function settingValueError(def: GcsSettingDef, value: unknown): string | null {
  switch (def.type) {
    case "string":
    case "secret":
      if (typeof value !== "string") return "invalid_type";
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "invalid_type";
      break;
    case "boolean":
      if (typeof value !== "boolean") return "invalid_type";
      break;
    case "json":
      if (value === undefined || !isJson(value)) return "invalid_type";
      break;
  }
  return def.validate?.(value) ?? null;
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}
