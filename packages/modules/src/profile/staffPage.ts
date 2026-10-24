import {
  GCS_RICH_FIELDS,
  GcsForbidden,
  GcsNotFound,
  GcsValidationError,
  renderRichField,
  richValueToDoc,
  staffGroupIds,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsPermissionService,
} from "@gcs/core";
import { Prisma, type PrismaClient, jsonStrings } from "@gcs/db";
import { contactLink } from "./fieldGroups";
import type { GcsMemberCard, GcsMemberList } from "./members";

/** Secțiunea ACP a paginii Staff (ACP → Membri → Staff → Pagina Staff). */
export const STAFF_PAGE_ACP_SECTION = "members.staff_page";
export const STAFF_LAYOUTS = ["detailed", "compact"] as const;
export type GcsStaffLayout = (typeof STAFF_LAYOUTS)[number];
const MAX_DUTIES = 12;
const DUTY_MAX = 120;
const TITLE_MAX = 80;

/** Un buton de contact pe cardul detaliat: mesaj, profil, conturile legate (Steam, Discord) și câmpurile de contact. */
export type GcsStaffContact = { kind: string; label: string; href: string; icon: string; external: boolean };

export type GcsStaffMember = GcsMemberCard & { descriptionHtml: string; duties: string[]; contacts: GcsStaffContact[] };

export type GcsStaffSectionView = {
  groupId: number;
  key: string;
  name: string;
  /** Titlul benzii: cel ales din ACP sau numele grupului. */
  title: string;
  customTitle: string | null;
  layout: GcsStaffLayout;
  enabled: boolean;
  color: string | null;
  icon: string | null;
  members: GcsStaffMember[];
};

export type GcsStaffSectionInput = { groupId: number; title: string | null; layout: GcsStaffLayout; enabled: boolean };
export type GcsStaffProfileInput = { description: unknown; duties: string[] };

const MEMBERS_PER_SECTION = 200;
/** Poziția unui membru neordonat din ACP: după cei ordonați, alfabetic. */
const UNORDERED = 10_000;

/**
 * Pagina Staff v2 (/staff): secțiunile în ordinea din ACP (fiecare = un grup de staff, cu titlul benzii și aspectul
 * cardurilor: detaliat, 2 pe rând, sau compact), membrii cu descrierea, responsabilitățile și butoanele de contact.
 * Grupurile de staff sunt cele cu acces la moderare sau la ACP; o secțiune dezactivată nu apare pe site.
 */
export class GcsStaffPage {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; permissions: GcsPermissionService; members: GcsMemberList }) {}

  private async assertView(viewer: GcsActor): Promise<void> {
    if (viewer.isBanned || !(await this.deps.permissions.can(viewer, "core.members_list"))) throw new GcsForbidden({ permission: "core.members_list" });
  }

  /** Secțiunile, cu membrii; `all` = și cele dezactivate și goale (editorul din ACP). */
  private async build(opts: { all: boolean }, now: number): Promise<GcsStaffSectionView[]> {
    const { db, members } = this.deps;
    const staffIds = await staffGroupIds(db);
    const [groups, sections] = await Promise.all([
      db.group.findMany({ where: { id: { in: staffIds } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, color: true, icon: true } }),
      db.staffSection.findMany(),
    ]);
    const byGroup = new Map(sections.map((s) => [s.groupId, s]));
    // Ordinea: secțiunile salvate (poziția lor), apoi grupurile de staff noi, în ordinea grupurilor.
    const ordered = [...groups].sort((a, b) => (byGroup.get(a.id)?.position ?? 10_000) - (byGroup.get(b.id)?.position ?? 10_000));
    const users = await db.user.findMany({
      where: { primaryGroupId: { in: staffIds } },
      select: { id: true, primaryGroupId: true, nameNormalized: true, staffProfile: { select: { descriptionHtml: true, duties: true, position: true } } },
      take: MEMBERS_PER_SECTION * Math.max(1, staffIds.length),
    });
    const cards = new Map((await members.cards(users.map((u) => u.id), now)).map((c) => [c.id, c]));
    const contacts = await this.contacts(users.map((u) => u.id));
    const out: GcsStaffSectionView[] = [];
    for (const g of ordered) {
      const s = byGroup.get(g.id);
      const enabled = s?.enabled ?? true;
      if (!opts.all && !enabled) continue;
      const list = users
        .filter((u) => u.primaryGroupId === g.id)
        .sort((a, b) => (a.staffProfile?.position ?? UNORDERED) - (b.staffProfile?.position ?? UNORDERED) || a.nameNormalized.localeCompare(b.nameNormalized))
        .flatMap((u) => {
          const card = cards.get(u.id);
          return card ? [{ ...card, descriptionHtml: u.staffProfile?.descriptionHtml ?? "", duties: jsonStrings(u.staffProfile?.duties), contacts: contacts.get(u.id) ?? [] }] : [];
        });
      if (!opts.all && list.length === 0) continue;
      out.push({
        groupId: g.id,
        key: g.key,
        name: g.name,
        title: s?.title ?? g.name,
        customTitle: s?.title ?? null,
        layout: s?.layout === "compact" ? "compact" : "detailed",
        enabled,
        color: g.color,
        icon: g.icon,
        members: list,
      });
    }
    return out;
  }

  /** Pagina publică /staff. */
  async sections(viewer: GcsActor, now = Date.now()): Promise<GcsStaffSectionView[]> {
    await this.assertView(viewer);
    return this.build({ all: false }, now);
  }

  /** Editorul din ACP: toate secțiunile de staff, și cele dezactivate sau goale. */
  async editor(actor: GcsActor): Promise<GcsStaffSectionView[]> {
    await this.deps.acp.assert(actor, STAFF_PAGE_ACP_SECTION, "view");
    return this.build({ all: true }, Date.now());
  }

  /** Butoanele de contact: mesaj și profil (le pune site-ul), Steam / Discord (conturile legate), câmpurile de contact. */
  private async contacts(userIds: string[]): Promise<Map<string, GcsStaffContact[]>> {
    const { db } = this.deps;
    const [accounts, values] = await Promise.all([
      db.account.findMany({ where: { userId: { in: userIds }, providerId: { in: ["steam", "discord"] } }, select: { userId: true, providerId: true, accountId: true } }),
      db.profileFieldValue.findMany({
        where: { userId: { in: userIds }, field: { linkTemplate: { not: null }, visibility: "PUBLIC" } },
        select: { userId: true, value: true, field: { select: { key: true, label: true, icon: true, linkTemplate: true, position: true } } },
      }),
    ]);
    const out = new Map<string, GcsStaffContact[]>();
    const push = (userId: string, c: GcsStaffContact) => out.set(userId, [...(out.get(userId) ?? []), c]);
    for (const a of accounts) {
      if (a.providerId === "steam" && /^\d{17}$/.test(a.accountId)) push(a.userId, { kind: "steam", label: "Steam", href: `https://steamcommunity.com/profiles/${a.accountId}`, icon: "fa-brands fa-steam", external: true });
      if (a.providerId === "discord" && /^\d{5,25}$/.test(a.accountId)) push(a.userId, { kind: "discord", label: "Discord", href: `https://discord.com/users/${a.accountId}`, icon: "fa-brands fa-discord", external: true });
    }
    for (const v of [...values].sort((a, b) => a.field.position - b.field.position)) {
      const href = typeof v.value === "string" ? contactLink(v.field.linkTemplate, v.value) : null;
      if (href) push(v.userId, { kind: v.field.key, label: v.field.label, href, icon: v.field.icon ?? "fa-solid fa-link", external: true });
    }
    return out;
  }

  /** Salvează secțiunile (ordinea listei = ordinea pe pagină): titlul benzii, aspectul și dacă apare. */
  async saveSections(actor: GcsActor, input: GcsStaffSectionInput[]): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, STAFF_PAGE_ACP_SECTION, "edit");
    const staffIds = new Set(await staffGroupIds(db));
    const errors: Record<string, string> = {};
    input.forEach((s, i) => {
      if (!staffIds.has(s.groupId)) errors[`sections.${i}.groupId`] = "invalid_choice";
      if (!STAFF_LAYOUTS.includes(s.layout)) errors[`sections.${i}.layout`] = "invalid_choice";
      if (s.title !== null && s.title.trim().length > TITLE_MAX) errors[`sections.${i}.title`] = "too_long";
    });
    if (new Set(input.map((s) => s.groupId)).size !== input.length) errors.sections = "duplicate";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await db.$transaction(async (tx) => {
      const before = await tx.staffSection.findMany({ orderBy: { position: "asc" } });
      for (const [position, s] of input.entries()) {
        const data = { title: s.title?.trim() || null, layout: s.layout, enabled: s.enabled, position };
        await tx.staffSection.upsert({ where: { groupId: s.groupId }, create: { groupId: s.groupId, ...data }, update: data });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "staff.sections", targetType: "settings", targetId: "staff", before, after: input, ip: actor.ip });
    });
    await bus.emit({ name: "staff.updated", payload: {}, tags: ["staff"] });
  }

  /** Descrierea (text formatat) și responsabilitățile unui membru al echipei. */
  async saveProfile(actor: GcsActor, userId: string, input: GcsStaffProfileInput): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, STAFF_PAGE_ACP_SECTION, "edit");
    if (!(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new GcsNotFound({ entity: "user" });
    const duties = input.duties.map((d) => d.trim()).filter(Boolean);
    if (duties.length > MAX_DUTIES || duties.some((d) => d.length > DUTY_MAX)) throw new GcsValidationError({ duties: "too_long" }, { max: String(MAX_DUTIES) });
    let descriptionJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let descriptionHtml = "";
    if (richValueToDoc(input.description) !== null) {
      const rendered = renderRichField(input.description, GCS_RICH_FIELDS.profileText, { field: "description", maxChars: 2000 });
      if (rendered.text.trim() !== "") {
        descriptionJson = rendered.json as Prisma.InputJsonValue;
        descriptionHtml = rendered.html;
      }
    }
    await db.$transaction(async (tx) => {
      const before = await tx.staffProfile.findUnique({ where: { userId } });
      await tx.staffProfile.upsert({ where: { userId }, create: { userId, descriptionJson, descriptionHtml, duties, position: UNORDERED }, update: { descriptionJson, descriptionHtml, duties } });
      await writeAudit(tx, { actorId: actor.userId, action: "staff.profile", targetType: "user", targetId: userId, before: before ? { duties: before.duties } : undefined, after: { duties }, ip: actor.ip });
    });
    await bus.emit({ name: "staff.updated", payload: { userId }, tags: ["staff"] });
  }

  /** Documentul descrierii (pentru editorul din ACP). */
  async profileDoc(userId: string): Promise<unknown> {
    return (await this.deps.db.staffProfile.findUnique({ where: { userId }, select: { descriptionJson: true } }))?.descriptionJson ?? null;
  }

  /** Ordinea membrilor într-o secțiune (drag & drop în ACP). */
  async reorderMembers(actor: GcsActor, groupId: number, userIds: string[]): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, STAFF_PAGE_ACP_SECTION, "edit");
    const inGroup = await db.user.findMany({ where: { primaryGroupId: groupId }, select: { id: true } });
    const known = new Set(inGroup.map((u) => u.id));
    if (new Set(userIds).size !== userIds.length || !userIds.every((id) => known.has(id))) throw new GcsValidationError({ order: "invalid_order" });
    await db.$transaction(async (tx) => {
      for (const [position, userId] of userIds.entries()) {
        await tx.staffProfile.upsert({ where: { userId }, create: { userId, position }, update: { position } });
      }
    });
    await bus.emit({ name: "staff.updated", payload: { groupId }, tags: ["staff"] });
  }
}
