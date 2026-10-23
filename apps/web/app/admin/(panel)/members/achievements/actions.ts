"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
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

/**
 * Badge-ul cu insigna lui (specul 2026-10-07-insigne-grafice): forma, nivelul și iconița se validează în serviciu;
 * imaginea proprie trece prin upload-ul atașamentelor (tipul real, recodare, fără SVG), apoi serviciul o leagă de badge.
 */
export async function saveBadge(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(BADGES_ACP_SECTION, "edit", async (actor) => {
    const { achievementAdmin, attachments } = services();
    const file = fd.get("image");
    let imageAttachmentId: string | null | undefined = fd.get("removeImage") === "on" ? null : undefined;
    if (file instanceof File && file.size > 0) {
      const att = await attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "acp.access" });
      if (!att.isImage) throw new GcsValidationError({ image: "invalid_image" });
      imageAttachmentId = att.id;
    }
    await achievementAdmin.saveBadge(actor, id, {
      key: field(fd, "key").trim(),
      name: field(fd, "name"),
      description: field(fd, "description"),
      symbol: field(fd, "symbol"),
      color: field(fd, "color"),
      manual: fd.get("manual") === "on",
      points: intField(fd, "points"),
      artShape: field(fd, "artShape") || null,
      artTier: field(fd, "artTier") || null,
      artIcon: field(fd, "artIcon") || null,
      imageAttachmentId,
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

// ─── Realizări v2: constructorul de reguli, rangurile moderne, setările ───

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    throw new GcsValidationError({ file: "invalid_file" });
  }
};

/** Regula din constructor („Când → Și → Atunci”); condițiile și recompensele vin ca obiecte, validate în serviciu. */
export async function saveEventRule(id: number | null, input: { name: string; event: string; enabled: boolean; conditions: unknown; rewards: unknown }): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => {
    const row = await services().achievementAdmin.saveEventRule(actor, id, input);
    return { id: row.id };
  });
}

export async function toggleRule(id: number, enabled: boolean): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.setRuleEnabled(actor, id, enabled);
    return null;
  });
}

export async function duplicateRule(id: number): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.duplicateRule(actor, id);
    return null;
  });
}

export async function exportRules(): Promise<GcsResult<unknown>> {
  return runAcpAction(RULES_ACP_SECTION, "view", async () => services().achievementAdmin.exportRules());
}

export async function importRules(json: string): Promise<GcsResult<{ created: number; skipped: number; badges: number }>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => services().achievementAdmin.importRules(actor, parseJson(json)));
}

export async function importGamingPack(): Promise<GcsResult<{ created: number; skipped: number; badges: number }>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => services().achievementAdmin.importGamingPack(actor));
}

/** Setările realizărilor: grupurile excluse și pragul badge-urilor rare. */
export async function saveAchievementSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set("achievements.excluded_groups", fd.getAll("excludedGroups").map(Number).filter((n) => Number.isInteger(n) && n > 0), actor);
    const rare = Number(field(fd, "rarePercent").replace(",", "."));
    await settings.set("achievements.rare_percent", Number.isFinite(rare) ? rare : Number.NaN, actor);
    return null;
  });
}

export async function startRecalc(): Promise<GcsResult<null>> {
  return runAcpAction(RULES_ACP_SECTION, "edit", async () => {
    await services().achievementRules.requestRecalc();
    return null;
  });
}

export async function recalcStatus(): Promise<GcsResult<{ state: string; done: number; total: number; awarded: number }>> {
  return runAcpAction(RULES_ACP_SECTION, "view", async () => services().achievementRules.recalcStatus());
}

/** Rangul modern: câmpurile de bază + emblema, criteriile (JSON), avantajele; imaginea proprie prin atașamente. */
export async function saveRankV2(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => {
    const { achievementAdmin, attachments } = services();
    const file = fd.get("image");
    let imageAttachmentId: string | null | undefined = fd.get("removeImage") === "on" ? null : undefined;
    if (file instanceof File && file.size > 0) {
      const att = await attachments.upload(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { permission: "acp.access" });
      if (!att.isImage) throw new GcsValidationError({ image: "invalid_image" });
      imageAttachmentId = att.id;
    }
    const optionalId = (name: string) => (field(fd, name) === "" ? null : intField(fd, name));
    await achievementAdmin.saveRank(actor, id, {
      name: field(fd, "name"),
      icon: field(fd, "icon").trim() || null,
      minPosts: optionalInt(fd, "minPosts"),
      minPoints: optionalInt(fd, "minPoints"),
      minReputation: optionalInt(fd, "minReputation"),
      emblemTier: field(fd, "emblemTier") || null,
      emblemShape: field(fd, "emblemShape") || null,
      emblemIcon: field(fd, "emblemIcon") || null,
      color: field(fd, "color") || null,
      animated: fd.get("animated") === "on",
      match: field(fd, "match") || "all",
      criteria: fd
        .getAll("criterionMetric")
        .map((m, i) => ({ metric: String(m), min: Number(fd.getAll("criterionMin")[i]) }))
        .filter((c) => c.metric !== "" && Number.isFinite(c.min)),
      perkGroupId: optionalId("perkGroupId"),
      perkBadgeId: optionalId("perkBadgeId"),
      perkNameStyleId: optionalId("perkNameStyleId"),
      imageAttachmentId,
    });
    return null;
  });
}

export async function duplicateRank(id: number): Promise<GcsResult<null>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => {
    await services().achievementAdmin.duplicateRank(actor, id);
    return null;
  });
}

export async function exportRanks(): Promise<GcsResult<unknown>> {
  return runAcpAction(RANKS_ACP_SECTION, "view", async () => services().achievementAdmin.exportRanks());
}

export async function importRanks(json: string, replace: boolean): Promise<GcsResult<{ created: number; skipped: number }>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => services().achievementAdmin.importRanks(actor, parseJson(json), { replace }));
}

export async function applyRankPreset(key: string): Promise<GcsResult<{ created: number; skipped: number }>> {
  return runAcpAction(RANKS_ACP_SECTION, "edit", async (actor) => services().achievementAdmin.applyRankPreset(actor, key));
}
