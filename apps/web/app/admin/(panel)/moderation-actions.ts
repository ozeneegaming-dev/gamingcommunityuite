"use server";

import { REACTIONS_ACP_SECTION, type GcsResult } from "@gcs/core";
import { MODERATORS_ACP_SECTION, SAVED_ACTIONS_ACP_SECTION, type GcsSavedActionSteps } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const QUEUE = "members.queue";
const REPORTS = "members.reports";
const ids = (fd: FormData, name: string) => fd.getAll(name).map(Number).filter(Number.isSafeInteger);

/** Coada: aprobă sau respinge postările bifate (sau una singură, prin `postId`). */
export async function moderateQueue(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(QUEUE, "edit", async (actor) => {
    const postIds = ids(fd, "postId");
    const { moderation } = services();
    if (fd.get("decision") === "reject") await moderation.reject(actor, postIds, field(fd, "reason"));
    else await moderation.approve(actor, postIds);
    return null;
  });
}

/** Închide un raport; cu `hide`, ascunde și conținutul (și închide toate rapoartele lui). */
export async function closeReport(reportId: string, action: "none" | "hide"): Promise<GcsResult<null>> {
  return runAcpAction(REPORTS, "edit", async (actor) => {
    await services().reports.close(actor, reportId, { action });
    return null;
  });
}

export async function saveReaction(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(REACTIONS_ACP_SECTION, "edit", async (actor) => {
    await services().reactions.upsert(actor, {
      ...(id !== null ? { id } : {}),
      key: field(fd, "key").trim(),
      label: field(fd, "label"),
      symbol: field(fd, "symbol"),
      color: field(fd, "color").toUpperCase(),
      weight: intField(fd, "weight"),
      enabled: fd.get("enabled") === "on",
    });
    return null;
  });
}

export async function reorderReactions(order: number[]): Promise<GcsResult<null>> {
  return runAcpAction(REACTIONS_ACP_SECTION, "edit", async (actor) => {
    await services().reactions.reorder(actor, order.map(Number));
    return null;
  });
}

export async function addModerators(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(MODERATORS_ACP_SECTION, "edit", async (actor) => {
    const userName = field(fd, "userName").trim();
    const groupId = intField(fd, "groupId");
    await services().forumModerators.add(actor, {
      forumIds: ids(fd, "forumId"),
      powers: fd.getAll("power").map(String),
      ...(userName ? { userName } : Number.isNaN(groupId) ? {} : { groupId }),
    });
    return null;
  });
}

export async function removeModerator(id: number): Promise<GcsResult<null>> {
  return runAcpAction(MODERATORS_ACP_SECTION, "delete", async (actor) => {
    await services().forumModerators.remove(actor, id);
    return null;
  });
}

export async function saveSavedAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SAVED_ACTIONS_ACP_SECTION, "edit", async (actor) => {
    const steps: GcsSavedActionSteps = {};
    if (fd.get("lock") === "on") steps.lock = true;
    if (fd.get("pin") === "on") steps.pin = true;
    if (fd.get("feature") === "on") steps.feature = true;
    const moveTo = intField(fd, "moveTo");
    if (!Number.isNaN(moveTo)) steps.moveTo = moveTo;
    const reply = field(fd, "reply").trim();
    if (reply) steps.reply = reply;
    await services().moderation.saveAction(actor, { name: field(fd, "name"), forumIds: ids(fd, "forumId"), actions: steps });
    return null;
  });
}

export async function deleteSavedAction(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SAVED_ACTIONS_ACP_SECTION, "delete", async (actor) => {
    await services().moderation.deleteAction(actor, id);
    return null;
  });
}
