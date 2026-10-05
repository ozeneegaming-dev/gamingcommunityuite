"use server";

import type { GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const DURATIONS: Record<string, number | null> = { permanent: null, d1: 1, d7: 7, d30: 30 };

export async function setPrimaryGroup(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    await services().groups.setPrimary(userId, intField(fd, "groupId"), actor);
    return null;
  });
}

export async function addSecondaryGroup(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    await services().groups.addSecondary(userId, intField(fd, "groupId"), actor);
    return null;
  });
}

export async function removeSecondaryGroup(userId: string, groupId: number): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    await services().groups.removeSecondary(userId, groupId, actor);
    return null;
  });
}

export async function banMember(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.members", "edit", async (actor) => {
    const days = DURATIONS[field(fd, "duration")] ?? null;
    await services().bans.ban(
      {
        type: "ACCOUNT",
        value: userId,
        userId,
        reason: field(fd, "reason"),
        expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
      },
      actor,
    );
    return null;
  });
}

export async function liftBan(banId: string): Promise<GcsResult<null>> {
  return runAcpAction("members.members", "edit", async (actor) => {
    await services().bans.lift(banId, actor);
    return null;
  });
}

export async function warnMember(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.warnings", "edit", async (actor) => {
    const days = intField(fd, "expiresDays");
    await services().warnings.warn(
      {
        userId,
        points: intField(fd, "points"),
        reason: field(fd, "reason"),
        expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
      },
      actor,
    );
    return null;
  });
}
