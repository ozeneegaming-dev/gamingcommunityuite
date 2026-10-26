"use server";

import { BULK_MAX, GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError, type GcsActor, type GcsCsvImportResult, type GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { parseMemberSearch } from "@/lib/member-search";
import { services } from "@/lib/services";

const DURATIONS: Record<string, number | null> = { permanent: null, d1: 1, d7: 7, d30: 30 };

/** O dată `AAAA-LL-ZZ` din formular → sfârșitul zilei (UTC); goală = fără expirare. */
function expiryField(fd: FormData, name = "expiresAt"): Date | null {
  const v = field(fd, name).trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new GcsValidationError({ [name]: "invalid_date" });
  return new Date(`${v}T23:59:59.000Z`);
}

export type GcsBulkResult = { changed: number; skipped: number };

/** Membrii acțiunii în masă: cei bifați sau, cu `scope=filtered`, toți cei din căutarea curentă (cel mult `BULK_MAX`). */
async function bulkIds(fd: FormData): Promise<string[]> {
  if (field(fd, "scope") === "filtered") {
    const query = parseMemberSearch(Object.fromEntries(new URLSearchParams(field(fd, "query"))));
    return services().members.ids(query, BULK_MAX);
  }
  return [...new Set(fd.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 40))];
}

/** Rulează o operație pe fiecare membru; refuzurile (Root protejat, operații în curs) se numără la „sărite”. */
async function each(ids: string[], fn: (id: string) => Promise<boolean | void>): Promise<GcsBulkResult> {
  let changed = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      if ((await fn(id)) === false) skipped++;
      else changed++;
    } catch (error) {
      if (error instanceof GcsForbidden || error instanceof GcsConflict || error instanceof GcsNotFound) skipped++;
      else throw error;
    }
  }
  return { changed, skipped };
}

/**
 * Acțiunile în masă din ACP → Membri (Membri v2): adaugă / scoate un grup secundar (cu expirare), mută grupul
 * principal, validează, banează sau șterge (operația de ștergere a contului, cu confirmarea din pagină).
 */
export async function bulkMembers(fd: FormData): Promise<GcsResult<GcsBulkResult>> {
  const op = field(fd, "op");
  const section = op === "delete" ? "members.members" : op === "validate" || op === "ban" ? "members.members" : "members.groups";
  return runAcpAction(section, op === "delete" ? "delete" : "edit", async (actor: GcsActor) => {
    const ids = await bulkIds(fd);
    if (ids.length === 0) throw new GcsValidationError({ ids: "required" });
    if (ids.length > BULK_MAX) throw new GcsValidationError({ ids: "invalid_range" }, { max: String(BULK_MAX) });
    const { groups, memberAdmin, bans, memberRemoval } = services();
    switch (op) {
      case "add_secondary":
        return groups.bulk(ids, { kind: "add_secondary", groupId: intField(fd, "groupId"), expiresAt: expiryField(fd) }, actor);
      case "remove_secondary":
        return groups.bulk(ids, { kind: "remove_secondary", groupId: intField(fd, "groupId") }, actor);
      case "set_primary":
        return groups.bulk(ids, { kind: "set_primary", groupId: intField(fd, "groupId") }, actor);
      case "validate": {
        const changed = await memberAdmin.validate(actor, ids);
        return { changed, skipped: ids.length - changed };
      }
      case "ban": {
        const reason = field(fd, "reason").trim();
        if (!reason) throw new GcsValidationError({ reason: "required" });
        const days = DURATIONS[field(fd, "duration")] ?? null;
        return each(ids, async (id) => {
          if (id === actor.userId) return false;
          await bans.ban({ type: "ACCOUNT", value: id, userId: id, reason, expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null }, actor);
        });
      }
      case "delete":
        return each(ids, async (id) => {
          if (id === actor.userId) return false;
          await memberRemoval.requestDelete(actor, id, { mode: field(fd, "mode") === "DELETE_CONTENT" ? "DELETE_CONTENT" : "KEEP_CONTENT", keepMessages: true });
        });
      default:
        throw new GcsValidationError({ op: "invalid_choice" });
    }
  });
}

/** „Membru nou” din ACP: numele, emailul, parola și grupul; emailul e confirmat. */
export async function createMember(fd: FormData): Promise<GcsResult<{ id: string }>> {
  return runAcpAction("members.members", "edit", async (actor) => {
    const created = await services().memberAdmin.create(actor, { name: field(fd, "name"), email: field(fd, "email"), password: field(fd, "password"), groupId: intField(fd, "groupId") });
    return { id: created.id };
  });
}

/** Importul CSV (textul fișierului ales, citit în browser; cel mult 1 MB). */
export async function importMembersCsv(text: string): Promise<GcsResult<GcsCsvImportResult>> {
  return runAcpAction("members.members", "edit", async (actor) => {
    if (typeof text !== "string" || text.length > 1024 * 1024) throw new GcsValidationError({ file: "too_large" });
    return services().memberAdmin.importCsv(actor, text);
  });
}

export async function setPrimaryGroup(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    await services().groups.setPrimary(userId, intField(fd, "groupId"), actor);
    return null;
  });
}

export async function addSecondaryGroup(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    // Membri v2: cu expirare opțională („Fără expirare” = gol).
    await services().groups.addSecondary(userId, intField(fd, "groupId"), actor, { expiresAt: expiryField(fd) });
    return null;
  });
}

/** Prelungește / schimbă expirarea unui grup secundar (gol = fără expirare). */
export async function setSecondaryExpiry(userId: string, groupId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    await services().groups.setSecondaryExpiry(userId, groupId, expiryField(fd), actor);
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
    const { warnings } = services();
    // Un motiv predefinit completează câmpurile lăsate goale (textul, punctele, expirarea).
    const reasonId = intField(fd, "reasonId");
    const preset = Number.isFinite(reasonId) ? (await warnings.reasons()).find((r) => r.id === reasonId) : undefined;
    const pointsField = intField(fd, "points");
    const daysField = intField(fd, "expiresDays");
    const points = Number.isFinite(pointsField) ? pointsField : (preset?.points ?? Number.NaN);
    const days = Number.isFinite(daysField) ? daysField : (preset?.expiresDays ?? 0);
    await warnings.warn(
      {
        userId,
        points,
        reason: field(fd, "reason").trim() || preset?.name || "",
        expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
        reasonId: preset?.id ?? null,
      },
      actor,
    );
    return null;
  });
}

/** Anulează un avertisment (punctele nu mai contează; pragurile se recalculează). */
export async function revokeWarning(warningId: string): Promise<GcsResult<null>> {
  return runAcpAction("members.warnings", "edit", async (actor) => {
    await services().warnings.revoke(warningId, actor);
    return null;
  });
}
