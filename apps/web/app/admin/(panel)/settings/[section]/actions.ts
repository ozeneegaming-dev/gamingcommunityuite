"use server";

import { GcsValidationError, sendEmail, settingsAcpSection, type GcsResult } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import { field, runAcpAction } from "@/lib/acp-actions";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

/**
 * Salvează setările unei secțiuni (câmpurile `setting:<cheie>`). Un secret lăsat gol își păstrează valoarea,
 * iar valorile neschimbate nu se rescriu (fără intrări inutile în jurnal). Erorile vin pe câmpuri.
 */
export async function saveSettings(section: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(settingsAcpSection(section), "edit", async (actor) => {
    const { settings, registry } = services();
    const fields: Record<string, string> = {};
    for (const def of registry.settingDefs().filter((d) => d.section === section)) {
      const name = `setting:${def.key}`;
      let value: unknown;
      if (def.type === "boolean") {
        value = fd.get(name) === "on";
      } else if (def.type === "number") {
        const raw = field(fd, name).trim();
        value = raw === "" ? Number.NaN : Number(raw);
      } else if (def.type === "json") {
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
    return null;
  });
}

/** Trimite un email de test adminului curent, cu setările SMTP salvate. */
export async function sendTestEmail(): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const result = await runAcpAction("system.settings_email", "edit", async () => {
    const ctx = await getAcpContext();
    const { db, settings } = services();
    const user = await db.user.findUnique({ where: { id: ctx.actor.userId ?? "" }, select: { email: true, name: true } });
    if (!user) throw new GcsValidationError({ to: "required" });
    const t = await getTranslations("acp.settings.testEmail");
    const site = await settings.get<string>("site.name");
    try {
      await sendEmail({ to: user.email, subject: t("subject", { site }), html: t.raw("html").replace("{name}", user.name).replace("{site}", site) }, settings);
      return { ok: true as const, to: user.email };
    } catch (error) {
      if (error instanceof GcsValidationError) throw error;
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
  if (!result.ok) return { ok: false, error: Object.keys(result.error.fields ?? {}).join(", ") || result.error.code };
  return result.data;
}
