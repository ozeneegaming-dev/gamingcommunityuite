"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { ARCHIVE_ACP_SECTION, type GcsArchiveRuleInput } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const num = (fd: FormData, name: string): number | null => {
  const v = intField(fd, name);
  return Number.isNaN(v) ? null : v;
};
const dec = (fd: FormData, name: string): number | null => {
  const raw = field(fd, name).trim().replace(",", ".");
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};
const ids = (fd: FormData, name: string) => fd.getAll(name).map(Number).filter(Number.isSafeInteger);

/** Membrii scriși după nume (o listă despărțită prin virgule) → id-urile lor; un nume necunoscut e o eroare pe câmp. */
async function members(fd: FormData, name: string): Promise<string[]> {
  const names = field(fd, name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (names.length === 0) return [];
  const rows = await services().db.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  if (rows.length !== new Set(names).size) throw new GcsValidationError({ [name]: "unknown_member" });
  return rows.map((r) => r.id);
}

async function ruleInput(fd: FormData, id?: number): Promise<GcsArchiveRuleInput> {
  return {
    ...(id !== undefined ? { id } : {}),
    name: field(fd, "name"),
    enabled: fd.get("enabled") === "on",
    conditions: {
      lastPostDays: num(fd, "lastPostDays") ?? 365,
      forumIds: ids(fd, "forumIds"),
      pinned: (field(fd, "pinned") || "any") as "any",
      locked: (field(fd, "locked") || "any") as "any",
      hidden: (field(fd, "hidden") || "any") as "any",
      poll: (field(fd, "poll") || "any") as "any",
      repliesBelow: num(fd, "repliesBelow"),
      viewsBelow: num(fd, "viewsBelow"),
      ratingBelow: dec(fd, "ratingBelow"),
      starterIds: await members(fd, "starters"),
    },
    exclusions: {
      forumIds: ids(fd, "notForumIds"),
      pinned: fd.get("notPinned") === "on",
      locked: fd.get("notLocked") === "on",
      poll: fd.get("notPoll") === "on",
      repliesAtLeast: num(fd, "notRepliesAtLeast"),
      viewsAtLeast: num(fd, "notViewsAtLeast"),
      ratingAtLeast: dec(fd, "notRatingAtLeast"),
      starterIds: await members(fd, "notStarters"),
    },
  };
}

export async function saveArchiveRule(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(ARCHIVE_ACP_SECTION, "edit", async (actor) => ({ id: await services().archive.save(actor, await ruleInput(fd, id ?? undefined)) }));
}

export async function deleteArchiveRule(id: number): Promise<GcsResult<null>> {
  return runAcpAction(ARCHIVE_ACP_SECTION, "delete", async (actor) => {
    await services().archive.delete(actor, id);
    return null;
  });
}

/** „Rulează acum”: regula aleasă, chiar cu arhivarea automată oprită (comutatorul general e pentru job). */
export async function runArchiveRule(id: number): Promise<GcsResult<{ count: number }>> {
  return runAcpAction(ARCHIVE_ACP_SECTION, "edit", async () => {
    const out = await services().archive.run(new Date(), { force: true, ruleId: id });
    return { count: out[id] ?? 0 };
  });
}
