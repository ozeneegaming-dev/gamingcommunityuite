"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { FOOTER_ACP_SECTION, FOOTER_SETTING, footerConfigError, normalizeFooterConfig, type GcsFooterConfig } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * Salvează subsolul (ACP → Aspect → Subsol): configurația e validată (adrese, iconițe, lungimi, cel mult 4 coloane),
 * normalizată și scrisă în setarea `footer.config` (cu jurnalul setărilor). `null` = înapoi la subsolul implicit.
 */
export async function saveFooter(input: GcsFooterConfig | null): Promise<GcsResult<null>> {
  return runAcpAction(FOOTER_ACP_SECTION, "edit", async (actor) => {
    const error = footerConfigError(input);
    if (error) throw new GcsValidationError({ [FOOTER_SETTING]: error });
    await services().settings.set(FOOTER_SETTING, input === null ? null : normalizeFooterConfig(input), actor);
    return null;
  });
}
