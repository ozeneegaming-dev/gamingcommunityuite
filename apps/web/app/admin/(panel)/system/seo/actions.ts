"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { SEO_ACP_SECTION, SEO_GROUPS, SEO_SETTINGS, type GcsSeoGroup } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { saveSettingDefs } from "@/lib/settings-save";

/**
 * Un card al paginii ACP → Promovare → SEO (formularul generic de setări, doar cheile cardului). La pornirea IndexNow,
 * cheia se generează (dacă lipsește) și istoricul de dinainte nu se mai trimite.
 */
export async function saveSeoGroup(group: GcsSeoGroup, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SEO_ACP_SECTION, "edit", async (actor) => {
    const keys: readonly string[] = SEO_GROUPS[group];
    if (!keys) throw new GcsValidationError({ group: "invalid_choice" });
    const { registry, settings, indexNow } = services();
    const wasOn = await indexNow.enabled();
    await saveSettingDefs(registry.settingDefs().filter((d) => keys.includes(d.key)), fd, actor);
    if (group === "indexNow" && !wasOn && (await settings.get<boolean>(SEO_SETTINGS.indexNowEnabled))) {
      await indexNow.key();
      await indexNow.markStart();
    }
    return null;
  });
}

/** O cheie IndexNow nouă (cea veche nu mai e servită la `/<cheie>.txt`). */
export async function regenerateIndexNowKey(): Promise<GcsResult<null>> {
  return runAcpAction(SEO_ACP_SECTION, "edit", async (actor) => {
    await services().indexNow.regenerateKey(actor);
    return null;
  });
}

/** Scoate imaginea de distribuire (paginile rămân cu imaginile lor, ori fără). */
export async function clearShareImage(): Promise<GcsResult<null>> {
  return runAcpAction(SEO_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    if ((await settings.get<string>(SEO_SETTINGS.shareImage)) !== "") await settings.set(SEO_SETTINGS.shareImage, "", actor);
    return null;
  });
}
