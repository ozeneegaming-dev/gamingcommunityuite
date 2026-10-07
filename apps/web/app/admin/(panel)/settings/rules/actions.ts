"use server";

import type { GcsResult } from "@gcs/core";
import { COMMUNITY_RULES_SETTING, COMMUNITY_RULES_ACP_SECTION } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * Salvează regulile comunității: documentul editorului trece prin același randator ca postările (validare + HTML
 * sanitizat), apoi se păstrează documentul, HTML-ul și momentul salvării. `null` (editor gol) șterge regulile: pagina
 * arată starea goală, iar itemul din meniu se ascunde. Jurnalul ACP primește modificarea (`settings.update`).
 */
export async function saveCommunityRules(input: { content: unknown }): Promise<GcsResult<null>> {
  return runAcpAction(COMMUNITY_RULES_ACP_SECTION, "edit", async (actor) => {
    const { posting, settings } = services();
    if (input.content === null || input.content === undefined) {
      await settings.set(COMMUNITY_RULES_SETTING, null, actor);
      return null;
    }
    const rendered = await posting.render(input.content);
    // Documentul randat e copiat ca JSON simplu (setările acceptă doar obiecte simple).
    const doc = JSON.parse(JSON.stringify(rendered.json)) as Record<string, unknown>;
    await settings.set(COMMUNITY_RULES_SETTING, { doc, html: rendered.html, updatedAt: new Date().toISOString() }, actor);
    return null;
  });
}
