"use server";

import { CSS_ACP_SECTION, GcsValidationError, type GcsCssFileView, type GcsCssSaveResult, type GcsCssVersionView, type GcsResult } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { THEME_KEY_RE } from "@/lib/theme-preview";

function assertTheme(key: unknown): asserts key is string {
  if (typeof key !== "string" || !THEME_KEY_RE.test(key)) throw new GcsValidationError({ theme: "invalid" });
}
function assertId(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) throw new GcsValidationError({ id: "invalid" });
}

/** Salvează un fișier CSS (sanitizat; raportul spune ce s-a scos). Intră imediat în CSS-ul public al temei. */
export async function saveCssFile(theme: string, fileId: number, content: string): Promise<GcsResult<GcsCssSaveResult>> {
  return runAcpAction(CSS_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertId(fileId);
    if (typeof content !== "string") throw new GcsValidationError({ content: "invalid_type" });
    const res = await services().themeCss.save(actor, theme, fileId, content);
    if (res.changed) revalidatePath("/", "layout");
    return res;
  });
}

export async function createCssFile(theme: string, name: string): Promise<GcsResult<GcsCssFileView>> {
  return runAcpAction(CSS_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    if (typeof name !== "string") throw new GcsValidationError({ name: "invalid_type" });
    return services().themeCss.create(actor, theme, name);
  });
}

export async function renameCssFile(theme: string, fileId: number, name: string): Promise<GcsResult<GcsCssFileView>> {
  return runAcpAction(CSS_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertId(fileId);
    if (typeof name !== "string") throw new GcsValidationError({ name: "invalid_type" });
    return services().themeCss.rename(actor, theme, fileId, name);
  });
}

export async function deleteCssFile(theme: string, fileId: number): Promise<GcsResult<null>> {
  return runAcpAction(CSS_ACP_SECTION, "delete", async (actor) => {
    assertTheme(theme);
    assertId(fileId);
    await services().themeCss.remove(actor, theme, fileId);
    revalidatePath("/", "layout");
    return null;
  });
}

export async function moveCssFile(theme: string, fileId: number, direction: -1 | 1): Promise<GcsResult<null>> {
  return runAcpAction(CSS_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertId(fileId);
    if (direction !== -1 && direction !== 1) throw new GcsValidationError({ direction: "invalid" });
    await services().themeCss.move(actor, theme, fileId, direction);
    return null;
  });
}

/** Istoricul unui fișier (după o salvare, editorul îl reîncarcă). */
export async function cssFileHistory(theme: string, fileId: number): Promise<GcsResult<{ versions: GcsCssVersionView[]; original: GcsCssVersionView | null }>> {
  return runAcpAction(CSS_ACP_SECTION, "view", async () => {
    assertTheme(theme);
    assertId(fileId);
    return services().themeCss.history(theme, fileId);
  });
}

export async function restoreCssVersion(theme: string, fileId: number, versionId: number): Promise<GcsResult<GcsCssSaveResult>> {
  return runAcpAction(CSS_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertId(fileId);
    assertId(versionId);
    const res = await services().themeCss.restore(actor, theme, fileId, versionId);
    if (res.changed) revalidatePath("/", "layout");
    return res;
  });
}
