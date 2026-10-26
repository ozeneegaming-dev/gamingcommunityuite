"use server";

import { GcsValidationError, normalizeUsername, type GcsResult } from "@gcs/core";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Secțiunea ACP a listei de banuri (Membri › Setări membri › Banuri). */
const SECTION = "members.bans";
const DURATIONS: Record<string, number | null> = { permanent: null, d1: 1, d7: 7, d30: 30, d365: 365 };

/** Un ban nou: pe cont (după nume), pe IP sau interval (CIDR), pe email sau domeniu (`@domeniu.ro`). */
export async function createBanAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { db, bans } = services();
    const type = field(fd, "type");
    const value = field(fd, "value").trim();
    const days = DURATIONS[field(fd, "duration")] ?? null;
    const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;
    const reason = field(fd, "reason");
    if (type === "ACCOUNT") {
      const user = value ? await db.user.findUnique({ where: { nameNormalized: normalizeUsername(value) }, select: { id: true } }) : null;
      if (!user) throw new GcsValidationError({ value: "unknown_member" });
      await bans.applyBan({ type: "ACCOUNT", value: user.id, userId: user.id, reason, expiresAt }, actor);
    } else if (type === "IP" || type === "EMAIL") {
      await bans.applyBan({ type, value, reason, expiresAt }, actor);
    } else {
      throw new GcsValidationError({ type: "invalid_choice" });
    }
    return null;
  });
}

export async function liftBanAction(banId: string): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().bans.lift(banId, actor, SECTION);
    return null;
  });
}
