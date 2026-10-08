"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { CLAN_SETTING, CLAN_SETTINGS, CLANS_ACP_SECTION, CLANS_SETTINGS_ACP_SECTION } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Opțiunile fiecărui tab al paginii de setări (doar ele se citesc din formular). */
const TAB_KEYS: Record<string, readonly string[]> = {
  create: [CLAN_SETTING.requireApproval, CLAN_SETTING.maxPerMember, CLAN_SETTING.leaveCooldownHours, CLAN_SETTING.requiredFields, CLAN_SETTING.logoMaxKb, CLAN_SETTING.bannerMaxKb],
  tag: [CLAN_SETTING.tagMin, CLAN_SETTING.tagMax, CLAN_SETTING.tagCharset],
  members: [CLAN_SETTING.inviteDays, CLAN_SETTING.requestDays, CLAN_SETTING.officerRights, CLAN_SETTING.archiveInactiveDays],
  forum: [CLAN_SETTING.forumMode, CLAN_SETTING.forumParent, CLAN_SETTING.forumStaffGroups],
  ranking: [
    CLAN_SETTING.weightPosts,
    CLAN_SETTING.weightReputation,
    CLAN_SETTING.weightActivity,
    CLAN_SETTING.weightMembers,
    CLAN_SETTING.weightPlaytime,
    CLAN_SETTING.weightKd,
    CLAN_SETTING.weightMixWins,
    CLAN_SETTING.weightElo,
  ],
  display: [CLAN_SETTING.tagPlaces, CLAN_SETTING.profileBadge],
};

/** Valoarea unei opțiuni din formular, după tipul ei: bifă, număr, listă (căsuțe cu același nume) sau text. */
function readSetting(fd: FormData, key: string): unknown {
  const def = CLAN_SETTINGS.find((d) => d.key === key)!;
  const name = `setting:${key}`;
  if (def.type === "boolean") return fd.get(name) === "on";
  if (def.type === "number") return intField(fd, name);
  if (def.type === "json") return fd.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");
  return field(fd, name).trim();
}

/** Setările unui tab (ACP → Gaming → Clanuri → Setări); validarea și efectele le face `GcsClanAdmin.saveOptions`. */
export async function saveClanSettings(tab: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_SETTINGS_ACP_SECTION, "edit", async (actor) => {
    const keys = TAB_KEYS[tab];
    if (!keys) throw new GcsValidationError({ tab: "invalid_choice" });
    // Câmpurile numerice și text absente din formular (ex. ponderile de joc, fără aplicația Servere) rămân neschimbate.
    const present = keys.filter((k) => fd.has(`setting:${k}`) || ["boolean", "json"].includes(CLAN_SETTINGS.find((d) => d.key === k)!.type));
    await services().clanAdmin.saveOptions(actor, Object.fromEntries(present.map((k) => [k, readSetting(fd, k)])));
    return null;
  });
}

const GROUP_KEYS = ["clans.create", "clans.join", "clans.moderate"] as const;

/**
 * Tab-ul „Grupuri”: cine creează, cine intră, cine e staff pe site (bife pe grup) și limita de membri pe grup.
 * Scrierea trece prin serviciul grupurilor, deci cere și dreptul ACP pe grupuri; se scriu doar valorile schimbate.
 */
export async function saveClanGroups(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_SETTINGS_ACP_SECTION, "edit", async (actor) => {
    const { db, groups, permissions } = services();
    const rows = await db.group.findMany({ select: { id: true, key: true }, orderBy: { position: "asc" } });
    const errors: Record<string, string> = {};
    for (const g of rows) {
      const groupActor = { userId: null, groupIds: [g.id], primaryGroupId: g.id, isBanned: false, ip: "" };
      for (const key of GROUP_KEYS) {
        const next = fd.get(`${key}:${g.id}`) === "on";
        const current = (await permissions.groupValue<boolean>(groupActor, key)) === true;
        if (next !== current && g.key !== "root_admin" && g.key !== "banned") await groups.setSetting(g.id, key, next, actor);
      }
      const raw = field(fd, `clans.max_members:${g.id}`).trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < -1 || value > 10_000) {
        errors[`clans.max_members:${g.id}`] = "invalid_range";
        continue;
      }
      const current = await permissions.groupValue<number | boolean>(groupActor, "clans.max_members");
      if (value !== current && g.key !== "root_admin" && g.key !== "banned") await groups.setSetting(g.id, "clans.max_members", value, actor);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return null;
  });
}

export async function recomputeClanRanking(_fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    await services().clans.recompute(actor);
    return null;
  });
}

export async function approveClan(id: number, _fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    await services().clans.approve(actor, id);
    return null;
  });
}

export async function rejectClan(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    await services().clans.reject(actor, id, field(fd, "reason"));
    return null;
  });
}

export async function setClanLock(id: number, locked: boolean, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    await services().clans.setLocked(actor, id, locked, field(fd, "reason"));
    return null;
  });
}

export async function setClanArchived(id: number, archived: boolean, _fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    if (archived) await services().clans.archive(actor, id);
    else await services().clans.reactivate(actor, id);
    return null;
  });
}

export async function setClanMemberLimit(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    const raw = field(fd, "memberLimit").trim();
    await services().clans.setMemberLimit(actor, id, raw === "" ? null : intField(fd, "memberLimit"));
    return null;
  });
}

export async function transferClanLeader(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "edit", async (actor) => {
    await services().clans.transfer(actor, id, field(fd, "userId"));
    return null;
  });
}

/** Desființarea din ACP (dreptul de ștergere pe secțiune); formularul duce apoi la listă. */
export async function disbandClanAcp(id: number, _fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CLANS_ACP_SECTION, "delete", async (actor) => {
    await services().clans.disband(actor, id, "");
    return null;
  });
}
