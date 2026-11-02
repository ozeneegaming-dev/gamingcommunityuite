"use server";

import { GcsValidationError, type GcsActor, type GcsResult } from "@gcs/core";
import {
  COOKIE_BANNER_SETTING,
  COOKIE_TEXT_SETTING,
  LEGAL_ACP_SECTION,
  LEGAL_DOCS,
  LEGAL_MODES,
  REQUIRE_TERMS_SETTING,
  RETENTION_SETTING_DEFS,
  isLegalUrlOrEmpty,
  legalSetting,
  type GcsLegalDocKind,
  type GcsLegalMode,
} from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { saveSettingDefs } from "@/lib/settings-save";

/** Scrie o setare doar dacă s-a schimbat (fără intrări inutile în jurnal). */
async function setIfChanged(key: string, value: unknown, actor: GcsActor): Promise<void> {
  const { settings } = services();
  if (JSON.stringify(await settings.get(key)) === JSON.stringify(value)) return;
  await settings.set(key, value, actor);
}

/**
 * Un document legal (termenii sau confidențialitatea): modul (niciunul / pagina de pe site / adresă externă), adresa
 * externă și conținutul scris cu editorul postărilor (același randator și sanitizer ca regulile). Pagina de pe site cere
 * un conținut, iar adresa externă o adresă `https://`; conținutul și adresa se păstrează și când modul se schimbă.
 */
export async function saveLegalDoc(input: { kind: unknown; mode: unknown; url: unknown; content: unknown }): Promise<GcsResult<null>> {
  return runAcpAction(LEGAL_ACP_SECTION, "edit", async (actor) => {
    const kind = input.kind as GcsLegalDocKind;
    if (!LEGAL_DOCS.includes(kind)) throw new GcsValidationError({ kind: "invalid_choice" });
    const mode = input.mode as GcsLegalMode;
    if (!LEGAL_MODES.includes(mode)) throw new GcsValidationError({ [legalSetting(kind, "mode")]: "invalid_choice" });
    const url = typeof input.url === "string" ? input.url.trim() : "";
    if (isLegalUrlOrEmpty(url)) throw new GcsValidationError({ [legalSetting(kind, "url")]: "invalid_url" });
    if (mode === "external" && url === "") throw new GcsValidationError({ [legalSetting(kind, "url")]: "required" });

    const { posting } = services();
    let content: unknown = null;
    if (input.content !== null && input.content !== undefined) {
      const rendered = await posting.render(input.content);
      // Documentul randat e copiat ca JSON simplu (setările acceptă doar obiecte simple).
      const doc = JSON.parse(JSON.stringify(rendered.json)) as Record<string, unknown>;
      content = rendered.html.trim() === "" ? null : { doc, html: rendered.html, updatedAt: new Date().toISOString() };
    }
    if (mode === "page" && content === null) throw new GcsValidationError({ [legalSetting(kind, "content")]: "required" });

    // Conținutul neschimbat își păstrează data (pagina publică arată „actualizat la”).
    const current = await services().settings.get<{ html?: string } | null>(legalSetting(kind, "content"));
    const sameContent = content !== null && current?.html === (content as { html: string }).html;
    if (!sameContent) await setIfChanged(legalSetting(kind, "content"), content, actor);
    await setIfChanged(legalSetting(kind, "url"), url, actor);
    await setIfChanged(legalSetting(kind, "mode"), mode, actor);
    return null;
  });
}

/** Acceptarea termenilor la înregistrare și banda de cookie-uri (formularul generic de setări). */
export async function saveLegalOptions(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(LEGAL_ACP_SECTION, "edit", async (actor) => {
    const keys = [REQUIRE_TERMS_SETTING, COOKIE_BANNER_SETTING, COOKIE_TEXT_SETTING];
    await saveSettingDefs(services().registry.settingDefs().filter((d) => keys.includes(d.key)), fd, actor);
    return null;
  });
}

/** Perioadele de păstrare a datelor (zile; 0 = mereu), aplicate de jobul zilnic `system.retention`. */
export async function saveRetention(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(LEGAL_ACP_SECTION, "edit", async (actor) => {
    const keys = RETENTION_SETTING_DEFS.map((d) => d.key);
    await saveSettingDefs(services().registry.settingDefs().filter((d) => keys.includes(d.key)), fd, actor);
    return null;
  });
}
