"use server";

import { GcsValidationError, WARNINGS_ACK_SETTING, WARNINGS_ACP_SECTION, type GcsResult } from "@gcs/core";
import type { WarningActionType } from "@gcs/db";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const optionalInt = (fd: FormData, name: string): number | null => {
  const v = intField(fd, name);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export async function saveWarningSettingsAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "edit", async (actor) => {
    await services().settings.set(WARNINGS_ACK_SETTING, fd.get("ack") === "on", actor);
    return null;
  });
}

export async function saveWarningReasonAction(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "edit", async (actor) => {
    await services().warnings.saveReason(actor, { ...(id ? { id } : {}), name: field(fd, "name"), points: intField(fd, "points"), expiresDays: optionalInt(fd, "expiresDays") });
    return null;
  });
}

export async function deleteWarningReasonAction(id: number): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "delete", async (actor) => {
    await services().warnings.deleteReason(actor, id);
    return null;
  });
}

export async function saveWarningThresholdAction(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "edit", async (actor) => {
    const action = field(fd, "action") as WarningActionType;
    if (!["MODERATE_POSTS", "RESTRICT", "BAN"].includes(action)) throw new GcsValidationError({ action: "invalid_choice" });
    await services().warnings.saveThreshold(actor, { ...(id ? { id } : {}), threshold: intField(fd, "threshold"), action, durationHours: optionalInt(fd, "durationHours") });
    return null;
  });
}

export async function deleteWarningThresholdAction(id: number): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "delete", async (actor) => {
    await services().warnings.deleteThreshold(actor, id);
    return null;
  });
}

/** Decizia pe o contestație (`decision` = `accept` / `reject`), cu motivul arătat membrului. */
export async function decideAppealAction(appealId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(WARNINGS_ACP_SECTION, "edit", async (actor) => {
    await services().warnings.decideAppeal(actor, appealId, field(fd, "decision") === "accept", field(fd, "reason"));
    return null;
  });
}
