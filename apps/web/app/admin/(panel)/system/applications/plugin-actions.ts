"use server";

import { GcsValidationError, HOOKS_ACP_SECTION, manifestSettingFields, PLUGINS_ACP_SECTION, type GcsResult } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { verifyTwoFactorCode } from "@/lib/acp";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const PATH = "/admin/system/applications";

/** Activează / dezactivează un plugin (comutatorul din listă). */
export async function setPluginEnabled(key: string, enabled: boolean): Promise<GcsResult<null>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "edit", async (actor) => {
    await services().pluginAdmin.setEnabled(actor, key, enabled);
    revalidatePath(PATH);
    return null;
  });
}

/** Dezactivează toate pluginurile (butonul de urgență din listă). */
export async function disableAllPlugins(): Promise<GcsResult<null>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "edit", async (actor) => {
    await services().pluginAdmin.disableAll(actor);
    revalidatePath(PATH);
    return null;
  });
}

/**
 * Confirmarea instalării de pe ecranul de confirmare. Pentru pachetele nesemnate: codul 2FA (verificat chiar acum) și
 * cheia pluginului tastată; serviciul verifică în plus că actorul e Root Admin.
 */
export async function confirmPluginInstall(uploadId: string, fd: FormData): Promise<GcsResult<{ key: string }>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "edit", async (actor) => {
    const code = field(fd, "code").replace(/\s/g, "");
    const twoFactorVerified = code !== "" && actor.userId !== null && (await verifyTwoFactorCode(actor.userId, code));
    if (code !== "" && !twoFactorVerified) throw new GcsValidationError({ code: "invalid_code" });
    const { key } = await services().pluginAdmin.install(actor, uploadId, { typedKey: field(fd, "confirmKey"), twoFactorVerified });
    revalidatePath(PATH);
    return { key };
  });
}

export async function discardPluginUpload(uploadId: string): Promise<GcsResult<null>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "edit", async (actor) => {
    await services().pluginAdmin.discard(actor, uploadId);
    return null;
  });
}

/**
 * Setările pluginului, din formularul generat din manifest (câmpurile `setting:<cheie>`, ca formularele de setări din
 * ACP): comutatoarele lipsă = oprit, „Nelimitat” (`none:<cheie>`) = 0, secretele goale = neschimbate.
 */
export async function savePluginSettings(key: string, tab: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "edit", async (actor) => {
    const { pluginAdmin } = services();
    const row = await pluginAdmin.get(key);
    const tabDef = row?.manifest.settings?.tabs.find((t) => t.key === tab);
    if (!row || !tabDef) throw new GcsValidationError({ tab: "invalid" });
    const known = new Set(manifestSettingFields(row.manifest).map((f) => f.key));
    const values: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const f of tabDef.fields) {
      if (!known.has(f.key)) continue;
      const name = `setting:${f.key}`;
      if (f.type === "toggle") values[f.key] = fd.get(name) === "on";
      else if (f.type === "number") {
        if (f.unlimited && fd.get(`none:${f.key}`) === "on") values[f.key] = 0;
        else {
          const raw = field(fd, name).trim();
          const n = raw === "" ? Number.NaN : Number(raw);
          if (!Number.isFinite(n)) errors[f.key] = "invalid_number";
          else values[f.key] = n;
        }
      } else values[f.key] = field(fd, name);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await pluginAdmin.saveSettings(actor, key, values);
    revalidatePath(`${PATH}/plugins/${key}`);
    return null;
  });
}

/** Dezinstalarea, cu sau fără păstrarea datelor (schema DB, rolul, setările). */
export async function uninstallPlugin(key: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PLUGINS_ACP_SECTION, "delete", async (actor) => {
    if (field(fd, "confirmKey").trim() !== key) throw new GcsValidationError({ confirmKey: "mismatch" });
    await services().pluginAdmin.uninstall(actor, key, { keepData: fd.get("keepData") === "on" });
    revalidatePath(PATH);
    return null;
  });
}

/** ACP → Sistem → Hook-uri: comutatorul și prioritatea unui hook al unui plugin. */
export async function savePluginHook(key: string, hook: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(HOOKS_ACP_SECTION, "edit", async (actor) => {
    const raw = field(fd, "priority").trim();
    const priority = raw === "" ? null : intField(fd, "priority");
    if (priority !== null && Number.isNaN(priority)) throw new GcsValidationError({ priority: "invalid_number" });
    await services().pluginAdmin.setHook(actor, key, hook, { enabled: fd.get("enabled") === "on", priority });
    revalidatePath("/admin/system/hooks");
    return null;
  });
}
