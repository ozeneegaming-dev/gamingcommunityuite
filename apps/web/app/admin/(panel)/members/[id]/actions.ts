"use server";

import type { GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const SECTION = "members.members";

/**
 * Profilul membrului editat de staff (bio și câmpurile custom `field:<cheie>`; câmpurile „Text lung” vin din editor ca
 * JSON, în `fieldDoc:<cheie>`: documentul, `""` sau textul vechi neatins). Intră în jurnal.
 */
export async function staffSaveProfile(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { profiles } = services();
    await profiles.updateBio(actor, userId, field(fd, "bio"));
    const values: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("field:")) values[k.slice(6)] = v;
      else if (k.startsWith("fieldDoc:")) values[k.slice(9)] = parseJson(v);
    }
    await profiles.updateFields(actor, userId, values);
    return null;
  });
}

/** JSON-ul unui câmp ascuns; invalid → o valoare pe care validarea câmpului o refuză. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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

/** O donație înregistrată de echipă (profil gaming v2): peste pragul din ACP → Profiluri, insigna automată „Sponsor”. */
export async function addDonation(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().profileExtras.addDonation(actor, userId, { amount: Number(field(fd, "amount").replace(",", ".")), currency: field(fd, "currency") || "EUR", note: field(fd, "note") });
    return null;
  });
}

export async function deleteDonation(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().profileExtras.deleteDonation(actor, id);
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

/**
 * Permisiunile individuale ale membrului (specul etapei 5): pentru fiecare permisiune de grup, „moștenit” (fără
 * valoare), da / nu sau un număr. Se scriu doar cele schimbate (fiecare intră în jurnal).
 */
export async function saveMemberPermissions(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { permissions, registry } = services();
    const current = await permissions.userPermissions(userId);
    for (const def of registry.permissionDefs().filter((d) => d.scope === "group")) {
      const raw = fd.get(`perm:${def.key}`);
      if (typeof raw !== "string") continue;
      const value: boolean | number | null = raw === "" ? null : raw === "true" ? true : raw === "false" ? false : Number(raw);
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      const before = current[def.key] ?? null;
      if (before === value) continue;
      await permissions.setUserPermission(actor, userId, def.key, value);
    }
    return null;
  });
}
