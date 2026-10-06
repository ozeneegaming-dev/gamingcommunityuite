import "server-only";
import { GcsValidationError, type GcsActor, type GcsSettingDef } from "@gcs/core";
import { field } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * Salvează setările din formularul generic (câmpurile `setting:<cheie>`). Un secret lăsat gol își păstrează valoarea,
 * câmpurile JSON absente din formular (cele cu formular propriu) se sar, iar valorile neschimbate nu se rescriu
 * (fără intrări inutile în jurnal). Erorile vin pe câmpuri, toate odată.
 */
export async function saveSettingDefs(defs: GcsSettingDef[], fd: FormData, actor: GcsActor): Promise<void> {
  const { settings } = services();
  const fields: Record<string, string> = {};
  for (const def of defs) {
    const name = `setting:${def.key}`;
    let value: unknown;
    if (def.type === "boolean") {
      value = fd.get(name) === "on";
    } else if (def.type === "number") {
      const raw = field(fd, name).trim();
      value = raw === "" ? Number.NaN : Number(raw);
    } else if (def.type === "json") {
      if (!fd.has(name)) continue;
      try {
        value = JSON.parse(field(fd, name));
      } catch {
        fields[def.key] = "invalid_type";
        continue;
      }
    } else {
      value = field(fd, name).trim();
      if (def.type === "secret" && value === "") continue;
    }
    const current = await settings.get(def.key);
    if (JSON.stringify(current) === JSON.stringify(value)) continue;
    try {
      await settings.set(def.key, value, actor);
    } catch (error) {
      if (error instanceof GcsValidationError) Object.assign(fields, error.fields);
      else throw error;
    }
  }
  if (Object.keys(fields).length > 0) throw new GcsValidationError(fields);
}
