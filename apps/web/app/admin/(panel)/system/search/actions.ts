"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { SEARCH_ACP_SECTION, SEARCH_LOG_KEY, SEARCH_SETTING, searchConfigError, type GcsSearchConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Setările căutării (panoul „Setări”). */
export async function saveSearchConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SEARCH_ACP_SECTION, "edit", async (actor) => {
    const value: GcsSearchConfig = {
      guests: field(fd, "guests") === "on",
      minLength: intField(fd, "minLength"),
      perMinute: intField(fd, "perMinute"),
      perPage: intField(fd, "perPage"),
      defaultType: field(fd, "defaultType") === "posts" ? "posts" : "topics",
      maxAgeDays: intField(fd, "maxAgeDays"),
      logTerms: field(fd, "logTerms") === "on",
    };
    if (searchConfigError(value)) throw new GcsValidationError({ minLength: "invalid_range" });
    await services().settings.set(SEARCH_SETTING, value, actor);
    return null;
  });
}

/** Golește jurnalul termenilor căutați. */
export async function clearSearchLog(): Promise<GcsResult<null>> {
  return runAcpAction(SEARCH_ACP_SECTION, "delete", async () => {
    await services().kv.del(SEARCH_LOG_KEY);
    return null;
  });
}
