"use server";

import { GcsValidationError, MFA_REQUIRED_GROUPS_SETTING, sendEmail, settingsAcpSection, type GcsResult } from "@gcs/core";
import { SECURITY_SECTION } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import { runAcpAction } from "@/lib/acp-actions";
import { getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";
import { saveSettingDefs } from "@/lib/settings-save";

/**
 * Salvează setările unei secțiuni (câmpurile `setting:<cheie>`). Un secret lăsat gol își păstrează valoarea,
 * iar valorile neschimbate nu se rescriu (fără intrări inutile în jurnal). Erorile vin pe câmpuri.
 */
export async function saveSettings(section: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(settingsAcpSection(section), "edit", async (actor) => {
    await saveSettingDefs(
      services().registry.settingDefs().filter((d) => d.section === section),
      fd,
      actor,
    );
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

/** Grupurile cu 2FA obligatoriu (ACP → Setări → Securitate): doar grupurile care există, fără vizitatori. */
export async function saveMfaGroups(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(settingsAcpSection(SECURITY_SECTION), "edit", async (actor) => {
    const { db, settings } = services();
    const ids = [...new Set(fd.getAll("group").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
    const existing = await db.group.findMany({ where: { id: { in: ids }, key: { not: "guest" } }, select: { id: true } });
    const valid = existing.map((g) => g.id).sort((a, b) => a - b);
    const current = await settings.get<unknown>(MFA_REQUIRED_GROUPS_SETTING);
    if (JSON.stringify(current) !== JSON.stringify(valid)) await settings.set(MFA_REQUIRED_GROUPS_SETTING, valid, actor);
    return null;
  });
}

/** Limbile active ale site-ului (cel puțin una); limba implicită rămâne în setările de mai sus. */
export async function saveActiveLocales(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(settingsAcpSection("languages"), "edit", async (actor) => {
    const locales = fd.getAll("locale").filter((v): v is string => typeof v === "string");
    await services().settings.set("i18n.locales", locales, actor);
    return null;
  });
}
