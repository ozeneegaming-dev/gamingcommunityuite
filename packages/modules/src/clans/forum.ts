import type { GcsMemberGrant, GcsMemberGrantsContext } from "@gcs/core";
import type { Prisma } from "@gcs/db";
import { slugify } from "../forums/slug";

/**
 * Forumul privat al unui clan (specul 2026-10-08-clanuri §5): un rând `forums` sub categoria din opțiuni, cu moștenirea
 * oprită și fără drepturi pentru grupurile obișnuite. Membrii îl primesc prin `memberGrants` (după apartenența curentă),
 * staff-ul ales în opțiuni prin matricea forumului.
 */

const CONTAINER = "forum";
/** Ce face un membru în forumul unui clan activ. */
export const CLAN_FORUM_ACTIONS = ["forums.view", "forums.read", "forums.create", "forums.reply", "forums.upload", "forums.download"] as const;
/** Clan blocat sau arhivat: forumul devine doar citire. */
export const CLAN_FORUM_READONLY = ["forums.view", "forums.read", "forums.download"] as const;
/** Puterile liderului și ale ofițerilor cu dreptul `forum` (fără ștergere, mutare, unire, împărțire, avertismente). */
export const CLAN_FORUM_POWERS = ["edit", "hide", "pin", "lock", "approve"] as const;

type Tx = Prisma.TransactionClient;

/** Numele forumului: tagul și numele clanului. */
export const clanForumName = (clan: { tag: string; name: string }) => `[${clan.tag}] ${clan.name}`;

/**
 * Drepturile unui membru pe forumurile private ale clanurilor lui (`GcsModule.memberGrants`). Nimic dacă aplicația e
 * dezactivată; clanurile în așteptare nu au forum.
 */
export async function clanMemberGrants({ db }: GcsMemberGrantsContext, userId: string): Promise<GcsMemberGrant[]> {
  const app = await db.app.findUnique({ where: { key: "clans" }, select: { enabled: true } });
  if (app && !app.enabled) return [];
  const rows = await db.clanMember.findMany({
    where: { userId, clan: { forumId: { not: null }, status: { not: "PENDING" } } },
    select: { role: true, clan: { select: { forumId: true, status: true, locked: true, officerRights: true } } },
  });
  return rows.map((r) => {
    const readOnly = r.clan.locked || r.clan.status !== "ACTIVE";
    const moderates = !readOnly && (r.role === "LEADER" || (r.role === "OFFICER" && r.clan.officerRights.includes("forum")));
    return {
      type: CONTAINER,
      id: String(r.clan.forumId),
      actions: [...(readOnly ? CLAN_FORUM_READONLY : CLAN_FORUM_ACTIONS)],
      powers: moderates ? [...CLAN_FORUM_POWERS] : [],
    };
  });
}

/** Părintele folosit pentru forumurile clanurilor: o categorie sau un forum existent (nu un link); altfel `null`. */
export async function clanForumParent(tx: Tx, parentId: number): Promise<number | null> {
  if (!Number.isInteger(parentId) || parentId <= 0) return null;
  const parent = await tx.forum.findUnique({ where: { id: parentId }, select: { type: true } });
  return parent && parent.type !== "LINK" ? parentId : null;
}

/** Id-urile grupurilor de staff din opțiuni (cheile necunoscute se ignoră). */
async function staffGroupIds(tx: Tx, keys: string[]): Promise<number[]> {
  if (keys.length === 0) return [];
  return (await tx.group.findMany({ where: { key: { in: keys } }, select: { id: true } })).map((g) => g.id);
}

/** Creează forumul privat al clanului; întoarce id-ul lui. Apelantul a verificat părintele (`clanForumParent`). */
export async function createClanForum(tx: Tx, clan: { id: number; tag: string; name: string }, opts: { parentId: number; staffGroups: string[] }): Promise<number> {
  const last = await tx.forum.findFirst({ where: { parentId: opts.parentId }, orderBy: { position: "desc" }, select: { position: true } });
  const name = clanForumName(clan);
  const forum = await tx.forum.create({
    data: { parentId: opts.parentId, type: "FORUM", name, slug: slugify(name), description: "", icon: "fa-solid fa-people-group", position: last ? last.position + 1 : 0 },
  });
  const ref = { containerType: CONTAINER, containerId: String(forum.id) };
  // Moștenirea oprită: forumul nu primește drepturile categoriei.
  await tx.containerInherit.create({ data: { ...ref, parentId: String(opts.parentId), inherits: false } });
  const groups = await staffGroupIds(tx, opts.staffGroups);
  await tx.containerPermission.createMany({
    data: groups.flatMap((groupId) => CLAN_FORUM_ACTIONS.map((action) => ({ ...ref, groupId, action }))),
    skipDuplicates: true,
  });
  await tx.clan.update({ where: { id: clan.id }, data: { forumId: forum.id } });
  return forum.id;
}

/** Numele forumului după tagul și numele clanului. */
export async function renameClanForum(tx: Tx, forumId: number, clan: { tag: string; name: string }): Promise<void> {
  const name = clanForumName(clan);
  await tx.forum.update({ where: { id: forumId }, data: { name, slug: slugify(name) } });
}

/**
 * La desființare: forumul fără topicuri se șterge (cu rândurile lui de permisiuni); cel cu topicuri rămâne doar pentru
 * staff, cu „(arhivă)” în nume. Întoarce `true` dacă forumul a fost șters.
 */
export async function retireClanForum(tx: Tx, forumId: number): Promise<boolean> {
  const forum = await tx.forum.findUnique({ where: { id: forumId }, select: { name: true } });
  if (!forum) return false;
  const ref = { containerType: CONTAINER, containerId: String(forumId) };
  if ((await tx.topic.count({ where: { forumId } })) === 0 && (await tx.forum.count({ where: { parentId: forumId } })) === 0) {
    await tx.containerPermission.deleteMany({ where: ref });
    await tx.containerInherit.deleteMany({ where: ref });
    await tx.moderator.deleteMany({ where: ref });
    await tx.follow.deleteMany({ where: { contentType: CONTAINER, contentId: String(forumId) } });
    await tx.forumReadMark.deleteMany({ where: { forumId } });
    await tx.forum.delete({ where: { id: forumId } });
    return true;
  }
  const name = `${forum.name} (arhivă)`.slice(0, 100);
  await tx.forum.update({ where: { id: forumId }, data: { name, slug: slugify(name) } });
  return false;
}

/**
 * Drepturile staff-ului pe toate forumurile clanurilor, după schimbarea `clans.forum_staff_groups`: grupurile scoase
 * pierd cele șase acțiuni, cele adăugate le primesc. Restul matricei (ajustările făcute din ACP) rămâne.
 */
export async function syncClanForumStaff(tx: Tx, forumIds: number[], before: string[], after: string[]): Promise<void> {
  if (forumIds.length === 0) return;
  const removed = await staffGroupIds(tx, before.filter((k) => !after.includes(k)));
  const added = await staffGroupIds(tx, after.filter((k) => !before.includes(k)));
  const ids = forumIds.map(String);
  if (removed.length > 0) {
    await tx.containerPermission.deleteMany({ where: { containerType: CONTAINER, containerId: { in: ids }, groupId: { in: removed }, action: { in: [...CLAN_FORUM_ACTIONS] } } });
  }
  if (added.length > 0) {
    await tx.containerPermission.createMany({
      data: ids.flatMap((containerId) => added.flatMap((groupId) => CLAN_FORUM_ACTIONS.map((action) => ({ containerType: CONTAINER, containerId, groupId, action })))),
      skipDuplicates: true,
    });
  }
}
