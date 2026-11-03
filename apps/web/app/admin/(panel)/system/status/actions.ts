"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { STATUS_ACP_SECTION, STATUS_ALERTS_SETTING, statusAlertsError, type GcsStatusAlerts } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** „Rulează acum”: pune jobul repetabil în coadă (worker-ul VPS sau următoarea trecere a cron-ului Lite). */
export async function runJobNow(name: string): Promise<GcsResult<null>> {
  return runAcpAction(STATUS_ACP_SECTION, "edit", async (actor) => {
    await services().systemStatus.runNow(actor, name);
    return null;
  });
}

/** Alertele de stare: comutatorul general, discul (pragul în %), joburile picate și cât de des se repetă. */
export async function saveStatusAlerts(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(STATUS_ACP_SECTION, "edit", async (actor) => {
    const value: GcsStatusAlerts = {
      enabled: field(fd, "enabled") === "on",
      disk: field(fd, "disk") === "on",
      diskMinFreePct: intField(fd, "diskMinFreePct"),
      jobs: field(fd, "jobs") === "on",
      repeatHours: intField(fd, "repeatHours"),
    };
    const error = statusAlertsError(value);
    if (error) throw new GcsValidationError({ [Number.isInteger(value.diskMinFreePct) && value.diskMinFreePct >= 1 && value.diskMinFreePct <= 50 ? "repeatHours" : "diskMinFreePct"]: error });
    await services().settings.set(STATUS_ALERTS_SETTING, value, actor);
    return null;
  });
}
