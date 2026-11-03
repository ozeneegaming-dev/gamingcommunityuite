"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { RSS_ACP_SECTION, RSS_ENABLED_SETTING, RSS_SETTING, rssConfigError, type GcsRssConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Fluxurile pornite și setările lor (panoul „Setări”). */
export async function saveRssConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(RSS_ACP_SECTION, "edit", async (actor) => {
    const value: GcsRssConfig = { items: intField(fd, "items"), snippets: field(fd, "snippets") === "on", siteFeed: field(fd, "siteFeed") === "on", cacheMinutes: intField(fd, "cacheMinutes") };
    if (rssConfigError(value)) throw new GcsValidationError({ items: "invalid_range" });
    const { settings } = services();
    await settings.set(RSS_ENABLED_SETTING, field(fd, "enabled") === "on", actor);
    await settings.set(RSS_SETTING, value, actor);
    return null;
  });
}
