"use server";

import {
  defaultTemplate,
  GcsTemplateError,
  GcsValidationError,
  isTemplateKey,
  templateValidationError,
  TEMPLATES_ACP_SECTION,
  type GcsResult,
  type GcsTemplateDetail,
} from "@gcs/core";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { templateSample } from "@/lib/template-samples";
import { siteRenderOptions } from "@/lib/templates";
import { THEME_KEY_RE } from "@/lib/theme-preview";

function assertTheme(key: unknown): asserts key is string {
  if (typeof key !== "string" || !THEME_KEY_RE.test(key)) throw new GcsValidationError({ theme: "invalid" });
}
function assertKey(key: unknown): asserts key is string {
  if (!isTemplateKey(key) || !defaultTemplate(key)) throw new GcsValidationError({ key: "invalid" });
}

/** Salvează un șablon (validat: sintaxa, cu rândul și coloana erorii); site-ul îl folosește imediat. */
export async function saveTemplate(theme: string, key: string, source: string): Promise<GcsResult<GcsTemplateDetail>> {
  return runAcpAction(TEMPLATES_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertKey(key);
    if (typeof source !== "string") throw new GcsValidationError({ source: "invalid_type" });
    await services().templates.save(actor, theme, key, source);
    revalidatePath("/", "layout");
    return services().templates.detail(theme, key);
  });
}

/** „Revino la original”: suprascrierea dispare, site-ul revine la componenta implicită. */
export async function revertTemplate(theme: string, key: string): Promise<GcsResult<GcsTemplateDetail>> {
  return runAcpAction(TEMPLATES_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertKey(key);
    await services().templates.revert(actor, theme, key);
    revalidatePath("/", "layout");
    return services().templates.detail(theme, key);
  });
}

export async function restoreTemplateVersion(theme: string, key: string, versionId: number): Promise<GcsResult<GcsTemplateDetail>> {
  return runAcpAction(TEMPLATES_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertKey(key);
    if (!Number.isInteger(versionId) || versionId < 1) throw new GcsValidationError({ id: "invalid" });
    const restored = await services().templates.restore(actor, theme, versionId);
    revalidatePath("/", "layout");
    return services().templates.detail(theme, restored);
  });
}

export async function markTemplateReviewed(theme: string, key: string): Promise<GcsResult<GcsTemplateDetail>> {
  return runAcpAction(TEMPLATES_ACP_SECTION, "edit", async (actor) => {
    assertTheme(theme);
    assertKey(key);
    await services().templates.markReviewed(actor, theme, key);
    return services().templates.detail(theme, key);
  });
}

/**
 * Previzualizarea: sursa nesalvată, randată pe server pe date reale (cu includerile temei), sanitizată și pusă în
 * contextul ei de markup. O eroare (de sintaxă sau o limită depășită) vine cu rândul și coloana.
 */
export async function previewTemplate(theme: string, key: string, source: string): Promise<GcsResult<{ html: string }>> {
  return runAcpAction(TEMPLATES_ACP_SECTION, "view", async (actor) => {
    assertTheme(theme);
    assertKey(key);
    if (typeof source !== "string") throw new GcsValidationError({ source: "invalid_type" });
    const { templates } = services();
    templates.validate(key, source);
    const [sample, opts] = await Promise.all([templateSample(key, actor), siteRenderOptions()]);
    let html: string | null;
    try {
      html = await templates.render(theme, key, { ...opts.common, ...sample.data }, { ...opts.render, source, limits: { timeMs: 250 } });
    } catch (error) {
      if (error instanceof GcsTemplateError) throw templateValidationError(error);
      throw error;
    }
    const used = new Set<string>();
    let body = (html ?? "").replace(/<gcs-slot data-name="([a-z][a-z0-9_.]*)"><\/gcs-slot>/g, (_m, name: string) => {
      used.add(name);
      return sample.slots[name] ?? "";
    });
    for (const slot of defaultTemplate(key)!.slots) if (slot.required && !used.has(slot.name)) body += sample.slots[slot.name] ?? "";
    return { html: `${sample.before}${body}${sample.after}` };
  });
}
