"use server";

import type { GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const SECTION = "members.members";

/** Profilul membrului editat de staff (bio și câmpurile custom `field:<cheie>`). Intră în jurnal. */
export async function staffSaveProfile(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { profiles } = services();
    await profiles.updateBio(actor, userId, field(fd, "bio"));
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("field:") && typeof v === "string") values[k.slice(6)] = v;
    await profiles.updateFields(actor, userId, values);
    return null;
  });
}

export async function staffResetImage(userId: string, kind: "avatar" | "cover"): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { profiles } = services();
    if (kind === "avatar") await profiles.resetAvatar(actor, userId);
    else await profiles.resetCover(actor, userId);
    return null;
  });
}

export async function awardBadge(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().achievements.awardBadge(actor, userId, intField(fd, "badgeId"), field(fd, "reason"));
    return null;
  });
}

export async function revokeBadge(userId: string, badgeId: number): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().achievements.revokeBadge(actor, userId, badgeId);
    return null;
  });
}

/** Acordă VIP (spec principal §18: „acordare VIP din ACP”). Zile goale sau „permanent” = fără expirare. */
export async function grantVip(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const permanent = fd.get("permanent") === "on" || field(fd, "days").trim() === "";
    await services().vip.grant(actor, {
      userId,
      groupId: intField(fd, "groupId"),
      days: permanent ? null : intField(fd, "days"),
      asPrimary: fd.get("asPrimary") === "on",
      note: field(fd, "note"),
    });
    return null;
  });
}

export async function extendVip(subscriptionId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().vip.extend(actor, subscriptionId, intField(fd, "days"), field(fd, "note"));
    return null;
  });
}

export async function revokeVip(subscriptionId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().vip.revoke(actor, subscriptionId, field(fd, "note"));
    return null;
  });
}
