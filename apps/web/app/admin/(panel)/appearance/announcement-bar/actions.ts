"use server";

import { GcsNotFound, GcsValidationError, type GcsResult } from "@gcs/core";
import {
  ANNOUNCEMENT_ACP_SECTION,
  ANNOUNCEMENT_SETTING,
  announcementConfigIssue,
  normalizeAnnouncementConfig,
  upgradeAnnouncementConfig,
  type GcsAnnouncementConfig,
  type GcsAnnouncementStats,
} from "@gcs/modules";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { runAcpAction } from "@/lib/acp-actions";
import { announcementConfig, announcementStats, dropAnnouncementStats, resetAnnouncementStats } from "@/lib/announcement";
import { services } from "@/lib/services";

/**
 * Salvează barele de anunț (ACP → Aspect → Conținut → Bară de anunț): configurația e validată (texte, adrese, iconițe,
 * culori, adrese de pagini, program, cel mult 10 bare; eroarea vine cu câmpul ei, ex. `bars.2.text`), normalizată (o bară
 * schimbată primește o versiune nouă, deci reapare celor care o închiseseră) și scrisă în setarea `announcement.bars`
 * (cu jurnalul setărilor). Barele noi încep să-și numere statisticile acum; cele șterse își pierd cifrele.
 */
export async function saveAnnouncementBars(input: GcsAnnouncementConfig): Promise<GcsResult<GcsAnnouncementConfig>> {
  return runAcpAction(ANNOUNCEMENT_ACP_SECTION, "edit", async (actor) => {
    const upgraded = upgradeAnnouncementConfig(input);
    const issue = announcementConfigIssue(upgraded, { isIcon: isGcsIcon });
    if (issue) throw new GcsValidationError({ [issue.path || ANNOUNCEMENT_SETTING]: issue.code });
    const previous = await announcementConfig();
    const next = normalizeAnnouncementConfig(upgraded as GcsAnnouncementConfig, previous);
    await services().settings.set(ANNOUNCEMENT_SETTING, next, actor);
    const before = new Set(previous.bars.map((b) => b.id));
    const after = new Set(next.bars.map((b) => b.id));
    await Promise.all([
      resetAnnouncementStats(next.bars.filter((b) => !before.has(b.id)).map((b) => b.id)),
      dropAnnouncementStats([...before].filter((id) => !after.has(id))),
    ]).catch(() => {});
    return next;
  });
}

/** „Resetează statisticile” unei bare salvate: afișările, click-urile și închiderile pornesc de la zero, de acum. */
export async function resetAnnouncementBarStats(barId: string): Promise<GcsResult<GcsAnnouncementStats>> {
  return runAcpAction(ANNOUNCEMENT_ACP_SECTION, "edit", async () => {
    const config = await announcementConfig();
    if (typeof barId !== "string" || !config.bars.some((b) => b.id === barId)) throw new GcsNotFound();
    await resetAnnouncementStats([barId]);
    return (await announcementStats([barId]))[barId]!;
  });
}
