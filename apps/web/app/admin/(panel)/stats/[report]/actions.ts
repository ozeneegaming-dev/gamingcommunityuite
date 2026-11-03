"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { statsConfigError, type GcsStatsConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Setările rapoartelor (panoul „Setări” din orice raport): staff-ul exclus, începutul săptămânii, perioada implicită. */
export async function saveStatsConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("stats.overview", "edit", async (actor) => {
    const value = {
      excludeStaff: field(fd, "excludeStaff") === "on",
      weekStart: field(fd, "weekStart") === "sunday" ? "sunday" : "monday",
      defaultDays: intField(fd, "defaultDays"),
    } as GcsStatsConfig;
    if (statsConfigError(value)) throw new GcsValidationError({ defaultDays: "invalid_choice" });
    await services().statsReports.saveConfig(actor, value);
    return null;
  });
}
