import {
  compileNameStylesCss,
  GcsForbidden,
  GcsNotFound,
  GcsValidationError,
  isHexColor,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAttachmentService,
  type GcsCache,
  type GcsEventBus,
  type GcsNameStyle,
  type GcsPermissionService,
} from "@gcs/core";
import { type AvatarFrame, type FrameKind, type NameStyle, type Prisma, type PrismaClient, jsonInts } from "@gcs/db";
import { actorOf } from "./social";

export const NAME_STYLES_ACP_SECTION = "vip.name_styles";
export const FRAMES_ACP_SECTION = "vip.frames";
const CSS_CACHE_KEY = "cosmetics:css";
const VERSION_KEY = "gcs:cosmetics:version";
const KEY = /^[a-z0-9_]{2,40}$/;
const ATTACHMENT_ID = /^[a-z0-9]{10,40}$/;

/** Stilul unei rame CSS: 2–6 culori (conic-gradient), grosimea în px, glow opțional, rotire. */
export type GcsFrameStyle = { colors: string[]; width?: number; glow?: string; spin?: boolean };
export type GcsFrameRow = Pick<AvatarFrame, "key" | "kind" | "imageAttachmentId"> & { style: unknown };

function hexToRgba(hex: string, alpha: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function frameWidth(style: Partial<GcsFrameStyle>): number {
  return Number.isInteger(style.width) && style.width! >= 2 && style.width! <= 8 ? style.width! : 3;
}

/**
 * CSS-ul ramelor (`.gcs-avatarFrame--{key}`). Tot ce vine din ACP e validat: cheile `[a-z0-9_]`, culorile `#RRGGBB`,
 * grosimea 2–8 px, id-ul imaginii alfanumeric. Orice altă valoare e ignorată, deci nu se poate injecta CSS.
 * Rotirea se oprește sub `prefers-reduced-motion` (regula comună din `base.css` + cea de mai jos).
 */
export function compileFramesCss(frames: GcsFrameRow[]): string {
  const parts: string[] = [];
  for (const f of frames) {
    if (!KEY.test(f.key)) continue;
    const style = (f.style && typeof f.style === "object" ? f.style : {}) as Partial<GcsFrameStyle>;
    const cls = `.gcs-avatarFrame--${f.key}`;
    parts.push(`${cls}{padding:${frameWidth(style)}px}`);
    const decls: string[] = [];
    if (f.kind === "IMAGE") {
      if (!f.imageAttachmentId || !ATTACHMENT_ID.test(f.imageAttachmentId)) continue;
      decls.push(`background:url(/files/${f.imageAttachmentId}) center/cover no-repeat`);
    } else {
      const colors = (Array.isArray(style.colors) ? style.colors : []).filter(isHexColor).slice(0, 6);
      if (colors.length < 2) continue;
      decls.push(`background:conic-gradient(${[...colors, colors[0]].join(",")})`);
      if (isHexColor(style.glow)) decls.push(`filter:drop-shadow(0 0 6px ${hexToRgba(style.glow, ".6")})`);
    }
    if (f.kind === "IMAGE" || style.spin === false) decls.push("animation:none");
    parts.push(`${cls}::before{${decls.join(";")}}`);
  }
  parts.push("@media (prefers-reduced-motion: reduce){.gcs-avatarFrame::before{animation:none}}");
  return parts.join("\n");
}

export type GcsAvailability = { allGroups: boolean; groupIds: number[]; badgeIds: number[] };
export type GcsNameStyleInput = GcsAvailability & { key: string; name: string; style: GcsNameStyle };
export type GcsFrameInput = GcsAvailability & { key: string; name: string; kind: FrameKind; style: GcsFrameStyle | null; imageAttachmentId: string | null };

const isAvailable = (item: GcsAvailability, groups: Set<number>, badges: Set<number>) =>
  item.allGroups || item.groupIds.some((id) => groups.has(id)) || item.badgeIds.some((id) => badges.has(id));

/**
 * Stilurile de nume și ramele alese de membri (spec §9, specul etapei 3 §4). Disponibilitatea vine din grupuri,
 * badge-uri sau „toți”, plus permisiunile `profile.styled_name` / `profile.avatar_frame`.
 */
export class GcsCosmeticsService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      cache: GcsCache;
      permissions: GcsPermissionService;
      acp: GcsAcpRoleService;
      attachments: GcsAttachmentService;
      kv: { incr(key: string): Promise<number>; get(key: string): Promise<string | null> };
    },
  ) {
    deps.attachments.registerAccess("cosmetics.frame", async () => true);
  }

  /** Versiunea CSS-ului generat (în URL-ul din layout): se schimbă la orice editare din ACP. */
  async version(): Promise<number> {
    return Number((await this.deps.kv.get(VERSION_KEY)) ?? 0);
  }

  /** Ce stiluri și rame poate alege un user acum. */
  async available(userId: string): Promise<{ styles: NameStyle[]; frames: AvatarFrame[] }> {
    const { db, permissions } = this.deps;
    const actor = await actorOf(db, userId);
    if (!actor) return { styles: [], frames: [] };
    const [canStyle, canFrame, badges, styles, frames] = await Promise.all([
      permissions.can(actor, "profile.styled_name"),
      permissions.can(actor, "profile.avatar_frame"),
      db.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
      db.nameStyle.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
      db.avatarFrame.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
    ]);
    const lists = <T extends { groupIds: unknown; badgeIds: unknown }>(r: T) => ({ ...r, groupIds: jsonInts(r.groupIds), badgeIds: jsonInts(r.badgeIds) });
    const groups = new Set(actor.groupIds);
    const badgeIds = new Set(badges.map((b) => b.badgeId));
    return {
      styles: canStyle ? styles.filter((s) => isAvailable(lists(s), groups, badgeIds)) : [],
      frames: canFrame ? frames.filter((f) => isAvailable(lists(f), groups, badgeIds)) : [],
    };
  }

  /** `undefined` = neschimbat, `null` = fără (stilul grupului / fără ramă). Doar dintre cele disponibile. */
  async choose(actor: GcsActor, choice: { nameStyleId?: number | null; avatarFrameId?: number | null }): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { styles, frames } = await this.available(actor.userId);
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (choice.nameStyleId !== undefined) {
      if (choice.nameStyleId !== null && !styles.some((s) => s.id === choice.nameStyleId)) throw new GcsForbidden({ permission: "profile.styled_name" });
      data.nameStyleId = choice.nameStyleId;
    }
    if (choice.avatarFrameId !== undefined) {
      if (choice.avatarFrameId !== null && !frames.some((f) => f.id === choice.avatarFrameId)) throw new GcsForbidden({ permission: "profile.avatar_frame" });
      data.avatarFrameId = choice.avatarFrameId;
    }
    if (Object.keys(data).length === 0) return;
    await this.deps.db.user.update({ where: { id: actor.userId }, data });
    await this.deps.bus.emit({ name: "profile.updated", payload: { userId: actor.userId, what: "cosmetics" }, tags: [`user:${actor.userId}`] });
  }

  /**
   * După o schimbare de grup sau de badge: scoate stilul și rama care nu mai sunt permise, iar cover-ul animat
   * devine static dacă membrul nu mai are `profile.animated_cover`.
   */
  async reconcile(userId: string): Promise<{ style: boolean; frame: boolean; cover: boolean }> {
    const { db, permissions, attachments, bus } = this.deps;
    const user = await db.user.findUnique({ where: { id: userId }, select: { nameStyleId: true, avatarFrameId: true, coverAttachmentId: true } });
    if (!user) return { style: false, frame: false, cover: false };
    const { styles, frames } = await this.available(userId);
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (user.nameStyleId !== null && !styles.some((s) => s.id === user.nameStyleId)) data.nameStyleId = null;
    if (user.avatarFrameId !== null && !frames.some((f) => f.id === user.avatarFrameId)) data.avatarFrameId = null;
    let cover = false;
    if (user.coverAttachmentId) {
      const actor = await actorOf(db, userId);
      if (actor && !(await permissions.can(actor, "profile.animated_cover"))) {
        const flat = await attachments.flattenProfileImage(userId, "cover");
        if (flat) {
          data.coverAttachmentId = flat.id;
          cover = true;
        }
      }
    }
    if (Object.keys(data).length > 0) {
      await db.user.update({ where: { id: userId }, data });
      await bus.emit({ name: "profile.updated", payload: { userId, what: "cosmetics_reconciled" }, tags: [`user:${userId}`] });
    }
    return { style: "nameStyleId" in data, frame: "avatarFrameId" in data, cover };
  }

  listen(bus: GcsEventBus): void {
    for (const name of ["user.groups_changed", "badge.revoked"]) {
      bus.on(name, async (e) => {
        if (typeof e.payload.userId === "string") await this.reconcile(e.payload.userId);
      });
    }
  }

  /** CSS-ul generat: stilurile de nume ale grupurilor (etapa 1), stilurile alese de membri și ramele. Cache în `GcsCache`. */
  async css(): Promise<string> {
    const { db, cache } = this.deps;
    const cached = await cache.get<string>(CSS_CACHE_KEY);
    if (cached !== null) return cached;
    const [groups, styles, frames] = await Promise.all([
      db.group.findMany({ select: { key: true, color: true, nameStyle: true }, orderBy: { position: "asc" } }),
      db.nameStyle.findMany({ orderBy: { position: "asc" } }),
      db.avatarFrame.findMany({ orderBy: { position: "asc" } }),
    ]);
    const css = [
      compileNameStylesCss([
        ...groups.map((g) => ({ key: g.key, color: g.color, nameStyle: (g.nameStyle as GcsNameStyle | null) ?? null })),
        ...styles.map((s) => ({ key: s.key, color: null, nameStyle: (s.style as GcsNameStyle | null) ?? null })),
      ]),
      compileFramesCss(frames),
    ].join("\n");
    await cache.set(CSS_CACHE_KEY, css, { ttlSec: 3600, tags: ["name-styles", "cosmetics"] });
    return css;
  }

  private async changed(): Promise<void> {
    await this.deps.kv.incr(VERSION_KEY);
    await this.deps.bus.emit({ name: "cosmetics.updated", payload: {}, tags: ["cosmetics", "name-styles"] });
  }

  // ─── ACP ─────────────────────────────────────────────────────────────────

  private validateAvailability(input: GcsAvailability, errors: Record<string, string>): void {
    if (!input.groupIds.every(Number.isInteger)) errors.groupIds = "invalid_choice";
    if (!input.badgeIds.every(Number.isInteger)) errors.badgeIds = "invalid_choice";
  }

  async saveNameStyle(actor: GcsActor, id: number | null, input: GcsNameStyleInput): Promise<NameStyle> {
    const { db, acp } = this.deps;
    await acp.assert(actor, NAME_STYLES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    // Prefixul `ns_` ține clasele separate de cele ale grupurilor (`gcs-name--{group.key}`).
    if (!/^ns_[a-z0-9_]{1,37}$/.test(input.key)) errors.key = "invalid";
    if (!input.name.trim() || input.name.length > 40) errors.name = "required";
    const s = input.style;
    const gradient = s.gradient ?? [];
    if (!isHexColor(s.color) && !(gradient.length >= 2 && gradient.length <= 4 && gradient.every(isHexColor))) errors.style = "invalid_color";
    if (s.glow !== undefined && !isHexColor(s.glow)) errors.style = "invalid_color";
    this.validateAvailability(input, errors);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const style: GcsNameStyle = {
      ...(isHexColor(s.color) ? { color: s.color } : {}),
      ...(gradient.length >= 2 ? { gradient, animated: s.animated === true } : {}),
      ...(isHexColor(s.glow) ? { glow: s.glow } : {}),
      bold: s.bold === true,
      italic: s.italic === true,
      ...(typeof s.icon === "string" && s.icon.trim() ? { icon: s.icon.trim() } : {}),
    };
    const data = { key: input.key, name: input.name.trim(), style, allGroups: input.allGroups, groupIds: input.groupIds, badgeIds: input.badgeIds };
    const row = await this.saveRow(actor, "name_style", id, () =>
      id === null ? db.nameStyle.create({ data: { ...data, position: 999 } }) : db.nameStyle.update({ where: { id }, data }),
    );
    await this.reconcileUsersOf("nameStyleId", row.id);
    return row;
  }

  async saveFrame(actor: GcsActor, id: number | null, input: GcsFrameInput): Promise<AvatarFrame> {
    const { db, acp } = this.deps;
    await acp.assert(actor, FRAMES_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    if (!KEY.test(input.key)) errors.key = "invalid";
    if (!input.name.trim() || input.name.length > 40) errors.name = "required";
    if (input.kind === "CSS") {
      const colors = input.style?.colors ?? [];
      if (colors.length < 2 || colors.length > 6 || !colors.every(isHexColor)) errors.style = "invalid_color";
      if (input.style?.glow !== undefined && !isHexColor(input.style.glow)) errors.style = "invalid_color";
      if (input.style?.width !== undefined && (!Number.isInteger(input.style.width) || input.style.width < 2 || input.style.width > 8)) errors.width = "invalid_range";
    } else if (!input.imageAttachmentId || !(await db.attachment.findUnique({ where: { id: input.imageAttachmentId } }))) {
      errors.image = "required";
    }
    this.validateAvailability(input, errors);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const style: GcsFrameStyle | null =
      input.kind === "CSS" && input.style
        ? { colors: input.style.colors, width: input.style.width ?? 3, spin: input.style.spin !== false, ...(input.style.glow ? { glow: input.style.glow } : {}) }
        : input.style
          ? { colors: [], width: input.style.width ?? 3 }
          : null;
    const data = {
      key: input.key,
      name: input.name.trim(),
      kind: input.kind,
      style: style ?? undefined,
      imageAttachmentId: input.kind === "IMAGE" ? input.imageAttachmentId : null,
      allGroups: input.allGroups,
      groupIds: input.groupIds,
      badgeIds: input.badgeIds,
    };
    const row = await this.saveRow(actor, "frame", id, () =>
      id === null ? db.avatarFrame.create({ data: { ...data, position: 999 } }) : db.avatarFrame.update({ where: { id }, data }),
    );
    if (input.kind === "IMAGE" && input.imageAttachmentId) {
      // Imaginea ramei e publică (o vede oricine vede avatarul).
      await db.attachment.update({ where: { id: input.imageAttachmentId }, data: { contentType: "cosmetics.frame", contentId: String(row.id) } });
    }
    await this.reconcileUsersOf("avatarFrameId", row.id);
    return row;
  }

  private async saveRow<T extends { id: number }>(actor: GcsActor, what: string, id: number | null, write: () => Promise<T>): Promise<T> {
    const row = await write().catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2002") throw new GcsValidationError({ key: "taken" });
      if ((error as { code?: string }).code === "P2025") throw new GcsNotFound();
      throw error;
    });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: `vip.${what}.${id === null ? "create" : "update"}`, targetType: what, targetId: String(row.id), after: row, ip: actor.ip });
    await this.changed();
    return row;
  }

  /** După ce disponibilitatea s-a schimbat: userii care îl folosesc și nu-l mai au voie îl pierd. */
  private async reconcileUsersOf(column: "nameStyleId" | "avatarFrameId", id: number): Promise<void> {
    const users = await this.deps.db.user.findMany({ where: { [column]: id }, select: { id: true } });
    for (const u of users) await this.reconcile(u.id);
  }

  async deleteNameStyle(actor: GcsActor, id: number): Promise<void> {
    await this.deleteRow(actor, NAME_STYLES_ACP_SECTION, "name_style", "nameStyleId", () => this.deps.db.nameStyle.delete({ where: { id } }), id);
  }

  async deleteFrame(actor: GcsActor, id: number): Promise<void> {
    await this.deleteRow(actor, FRAMES_ACP_SECTION, "frame", "avatarFrameId", () => this.deps.db.avatarFrame.delete({ where: { id } }), id);
    await this.deps.attachments.deleteFor("cosmetics.frame", [String(id)]);
  }

  private async deleteRow(actor: GcsActor, section: string, what: string, column: "nameStyleId" | "avatarFrameId", remove: () => Promise<unknown>, id: number): Promise<void> {
    const { db, acp, bus } = this.deps;
    await acp.assert(actor, section, "delete");
    const users = await db.user.findMany({ where: { [column]: id }, select: { id: true } });
    await remove().catch((error: unknown) => {
      if ((error as { code?: string }).code === "P2025") throw new GcsNotFound();
      throw error;
    });
    await writeAudit(db, { actorId: actor.userId, action: `vip.${what}.delete`, targetType: what, targetId: String(id), ip: actor.ip });
    await this.changed();
    // Cheia străină (SetNull) i-a resetat deja; cache-ul lor trebuie invalidat.
    if (users.length > 0) await bus.emit({ name: "profile.updated", payload: { what: "cosmetics_deleted" }, tags: users.map((u) => `user:${u.id}`) });
  }
}
