"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { ANNOUNCEMENT_ACP_SECTION, ANNOUNCEMENT_SETTING, announcementConfigError, normalizeAnnouncementConfig, type GcsAnnouncementConfig } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { announcementConfig } from "@/lib/announcement";
import { services } from "@/lib/services";

/**
 * Salvează barele de anunț (ACP → Aspect → Conținut → Bară de anunț): configurația e validată (texte, adrese, programare,
 * cel mult 6 bare), normalizată (o bară schimbată primește o versiune nouă, deci reapare celor care o închiseseră) și
 * scrisă în setarea `announcement.bars` (cu jurnalul setărilor).
 */
export async function saveAnnouncementBars(input: GcsAnnouncementConfig): Promise<GcsResult<GcsAnnouncementConfig>> {
  return runAcpAction(ANNOUNCEMENT_ACP_SECTION, "edit", async (actor) => {
    const error = announcementConfigError(input);
    if (error) throw new GcsValidationError({ [ANNOUNCEMENT_SETTING]: error });
    const next = normalizeAnnouncementConfig(input, await announcementConfig());
    await services().settings.set(ANNOUNCEMENT_SETTING, next, actor);
    return next;
  });
}
