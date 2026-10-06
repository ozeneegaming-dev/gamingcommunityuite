"use server";

import { GcsValidationError, isPlainObject, THEMES_ACP_SECTION, type GcsResult, type GcsThemeDraft } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { THEME_KEY_RE } from "@/lib/theme-preview";

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !THEME_KEY_RE.test(key)) throw new GcsValidationError({ key: "invalid" });
}

/**
 * Salvarea automată a editorului vizual: starea completă (setările, CSS-ul extra, logo-ul și favicon-ul) intră în
 * draft. Validarea completă (căi cunoscute, intervale, enumerări, culori, fișiere) e în `GcsThemeService.saveDraft`.
 */
export async function saveThemeStudioDraft(key: string, draft: unknown): Promise<GcsResult<{ savedAt: string }>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    assertKey(key);
    if (!isPlainObject(draft)) throw new GcsValidationError({ draft: "invalid_type" });
    await services().themes.saveDraft(actor, key, draft as GcsThemeDraft);
    return { savedAt: new Date().toISOString() };
  });
}

/** „Salvează”: draft-ul devine tema publicată (versiunea crește, intrare în jurnal). */
export async function publishThemeStudio(key: string): Promise<GcsResult<{ version: number }>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    assertKey(key);
    const theme = await services().themes.publish(actor, key);
    revalidatePath("/", "layout");
    return { version: theme.version };
  });
}

/** „Ieși fără salvare”: renunță la draft (tema publicată rămâne; intrare în jurnal). */
export async function discardThemeStudio(key: string): Promise<GcsResult<null>> {
  return runAcpAction(THEMES_ACP_SECTION, "edit", async (actor) => {
    assertKey(key);
    await services().themes.discardDraft(actor, key);
    revalidatePath("/", "layout");
    return null;
  });
}
