import type { GcsWidgetField } from "../modules/registry";

/**
 * Validatorul de config generat din câmpuri (`GcsWidgetDef.config`): fiecare câmp lipsă primește valoarea implicită,
 * orice valoare în afara câmpului (tip, interval, lungime, opțiune) face config-ul invalid (`null`). Cheile necunoscute
 * se ignoră. Pentru `select` cu `optionsFrom`, valoarea e o cheie scurtă (verificată la randare).
 */
export function fieldsConfig(fields: readonly GcsWidgetField[], defaults: Record<string, unknown>) {
  return (raw: unknown): Record<string, unknown> | null => {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = src[f.key] ?? defaults[f.key];
      if (f.type === "number") {
        if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) return null;
      } else if (f.type === "select") {
        if (typeof v !== "string") return null;
        if (f.options && !f.options.some((o) => o.value === v)) return null;
        if (!f.options && !/^[a-z0-9_-]{0,40}$/.test(v)) return null;
      } else if (typeof v !== "string" || v.length > f.maxLength) {
        return null;
      }
      out[f.key] = v;
    }
    return out;
  };
}
