"use server";

import type { GcsResult } from "@gcs/core";
import { BADGES_ACP_SECTION, PROMOTIONS_ACP_SECTION, RANKS_ACP_SECTION, RULES_ACP_SECTION } from "@gcs/modules";
import type { AchievementTrigger } from "@gcs/db";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Un câmp numeric opțional: gol = fără prag (`null`). */
const optionalInt = (fd: FormData, name: string): number | null => (field(fd, name).trim() === "" ? null : intField(fd, name));

export async function saveRank(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.saveRank(actor, id, {
      name: field(fd, "name"),
      icon: field(fd, "icon").trim() || null,
      minPosts: optionalInt(fd, "minPosts"),
      minPoints: optionalInt(fd, "minPoints"),
      minReputation: optionalInt(fd, "minReputation"),
    });
    return null;
  });
}

export async function deleteRank(id: number): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "delete", async (actor) => {
    await services().achievementAdmin.deleteRank(actor, id);
    return null;
  });
}

export async function reorderRanks(order: number[]): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.reorderRanks(actor, order.map(Number));
    return null;
  });
}

export async function saveBadge(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(BADGES_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.saveBadge(actor, id, {
      key: field(fd, "key").trim(),
      name: field(fd, "name"),
      description: field(fd, "description"),
      symbol: field(fd, "symbol"),
      color: field(fd, "color"),
      manual: fd.get("manual") === "on",
      points: intField(fd, "points"),
    });
    return null;
  });
}

export async function deleteBadge(id: number): Promise<GcsResult<null>> {
  return runAcpAction(BADGES_ACP_SECTION, "delete", async (actor) => {
    await services().achievementAdmin.deleteBadge(actor, id);
    return null;
  });
}

export async function saveRule(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => {
    const badge = field(fd, "badgeId");
    await services().achievementAdmin.saveRule(actor, id, {
      name: field(fd, "name"),
      trigger: field(fd, "trigger") as AchievementTrigger,
      threshold: optionalInt(fd, "threshold") ?? 0,
      points: optionalInt(fd, "points") ?? 0,
      badgeId: badge === "" ? null : Number(badge),
      enabled: fd.get("enabled") === "on",
    });
    return null;
  });
}

export async function deleteRule(id: number): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "delete", async (actor) => {
    await services().achievementAdmin.deleteRule(actor, id);
    return null;
  });
}

/** Recalculează rangurile tuturor (job în worker). */
export async function recomputeRanks(): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async () => {
    const { jobs, achievements } = services();
    await jobs.enqueue("achievements.recompute_ranks", {}, { jobId: `ranks-${Date.now()}` }).catch(() => achievements.recomputeAllRanks());
    return null;
  });
}

export async function savePromotion(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PROMOTIONS_ACP_SECTION, "edit", async (actor) => {
    await services().promotions.save(actor, id, {
      name: field(fd, "name"),
      fromGroupIds: fd.getAll("fromGroupIds").map(Number).filter(Number.isInteger),
      toGroupId: intField(fd, "toGroupId"),
      asPrimary: field(fd, "mode") !== "secondary",
      minPosts: optionalInt(fd, "minPosts"),
      minDays: optionalInt(fd, "minDays"),
      minReputation: optionalInt(fd, "minReputation"),
      minPoints: optionalInt(fd, "minPoints"),
      enabled: fd.get("enabled") === "on",
    });
    return null;
  });
}

export async function deletePromotion(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PROMOTIONS_ACP_SECTION, "delete", async (actor) => {
    await services().promotions.delete(actor, id);
    return null;
  });
}
