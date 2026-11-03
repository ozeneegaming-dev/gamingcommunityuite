import { writeAudit, type GcsAcpRoleService, type GcsActor, type GcsAttachmentService, type GcsSettingsService } from "@gcs/core";
import { isMysql, type Prisma, type PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { UPLOAD_SETTINGS } from "./settings";

/** Secțiunea ACP (ACP › Sistem › Fișiere): `view` = lista, `edit` = ștergerea. */
export const FILES_ACP_SECTION = "system.files";
export const FILES_PER_PAGE = 30;

export const GCS_FILE_KINDS = ["image", "video", "audio", "archive", "document", "other"] as const;
export type GcsFileKind = (typeof GCS_FILE_KINDS)[number];

const ARCHIVE_MIMES = ["application/zip", "application/x-zip-compressed", "application/x-7z-compressed", "application/x-rar-compressed", "application/vnd.rar", "application/gzip", "application/x-tar"];
const DOCUMENT_MIMES = ["application/pdf", "application/json", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

/** Tipul unui fișier după MIME. */
export function fileKind(mime: string): GcsFileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ARCHIVE_MIMES.includes(mime)) return "archive";
  if (mime.startsWith("text/") || DOCUMENT_MIMES.includes(mime)) return "document";
  return "other";
}

function kindWhere(kind: GcsFileKind): Prisma.AttachmentWhereInput {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return { mime: { startsWith: `${kind}/` } };
    case "archive":
      return { mime: { in: ARCHIVE_MIMES } };
    case "document":
      return { OR: [{ mime: { startsWith: "text/" } }, { mime: { in: DOCUMENT_MIMES } }] };
    case "other":
      return { NOT: [{ mime: { startsWith: "image/" } }, { mime: { startsWith: "video/" } }, { mime: { startsWith: "audio/" } }, { mime: { startsWith: "text/" } }, { mime: { in: [...ARCHIVE_MIMES, ...DOCUMENT_MIMES] } }] };
  }
}

export type GcsFileFilter = {
  q?: string;
  kind?: GcsFileKind;
  /** `contentType` exact (ex. `forums.post`, `user.avatar`) sau `none` = nelegate de nimic. */
  area?: string;
  ownerId?: string;
  sort?: "new" | "old" | "big";
  page: number;
};

export type GcsFileRow = {
  id: string;
  filename: string;
  mime: string;
  kind: GcsFileKind;
  size: number;
  width: number | null;
  height: number | null;
  contentType: string | null;
  contentId: string | null;
  createdAt: Date;
  owner: GcsUserRef | null;
};

export type GcsFileOverview = {
  count: number;
  bytes: number;
  kinds: { kind: GcsFileKind; count: number; bytes: number }[];
  areas: { area: string; count: number }[];
  unattached: { count: number; bytes: number };
  orphanDays: number;
};

/** Unde e folosit un fișier: legătura lui (`contentType`) și coloanele care trimit direct la el. */
export type GcsFileUse = { kind: string; id: string; label?: string };

/**
 * ACP › Sistem › Fișiere: toate fișierele încărcate (postări, avatare, emoticoane, bannere, teme…), cu filtre după nume,
 * tip, zonă și proprietar, totalurile pe tip, unde e folosit fiecare și ștergerea (una sau mai multe; conținutul care
 * le folosea rămâne fără imagine). Setările încărcărilor rămân în ACP › Setări › Încărcări și imagini.
 */
export class GcsFileAdminService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: Pick<GcsAcpRoleService, "assert">;
      attachments: Pick<GcsAttachmentService, "removeAny">;
      settings: Pick<GcsSettingsService, "get">;
    },
  ) {}

  private where(f: Omit<GcsFileFilter, "page" | "sort">): Prisma.AttachmentWhereInput {
    const and: Prisma.AttachmentWhereInput[] = [];
    const q = f.q?.trim();
    // Postgres compară cu majuscule; MySQL (colaționarea implicită) nu, iar `mode` nu există acolo.
    if (q) and.push({ OR: [{ filename: { contains: q, ...(isMysql() ? {} : { mode: "insensitive" as const }) } }, { id: q }] });
    if (f.kind) and.push(kindWhere(f.kind));
    if (f.area === "none") and.push({ contentType: null });
    else if (f.area) and.push({ contentType: f.area });
    if (f.ownerId) and.push({ ownerId: f.ownerId });
    return and.length > 0 ? { AND: and } : {};
  }

  async list(filter: GcsFileFilter): Promise<{ items: GcsFileRow[]; total: number; page: number; pages: number }> {
    const where = this.where(filter);
    const orderBy: Prisma.AttachmentOrderByWithRelationInput[] =
      filter.sort === "big" ? [{ size: "desc" }, { id: "asc" }] : filter.sort === "old" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }];
    const total = await this.deps.db.attachment.count({ where });
    const pages = Math.max(1, Math.ceil(total / FILES_PER_PAGE));
    const page = Math.min(Math.max(1, filter.page), pages);
    const rows = await this.deps.db.attachment.findMany({
      where,
      orderBy,
      skip: (page - 1) * FILES_PER_PAGE,
      take: FILES_PER_PAGE,
      select: { id: true, filename: true, mime: true, size: true, width: true, height: true, contentType: true, contentId: true, createdAt: true, owner: { select: userRefSelect } },
    });
    return {
      items: rows.map((r) => ({ ...r, kind: fileKind(r.mime), owner: r.owner ? toRef(r.owner) : null })),
      total,
      page,
      pages,
    };
  }

  async overview(): Promise<GcsFileOverview> {
    const { db, settings } = this.deps;
    const [all, byMime, byArea, unattached, orphanDays] = await Promise.all([
      db.attachment.aggregate({ _count: { _all: true }, _sum: { size: true } }),
      db.attachment.groupBy({ by: ["mime"], _count: { _all: true }, _sum: { size: true } }),
      db.attachment.groupBy({ by: ["contentType"], _count: { _all: true } }),
      db.attachment.aggregate({ where: { contentType: null }, _count: { _all: true }, _sum: { size: true } }),
      settings.get<number>(UPLOAD_SETTINGS.orphanDays).catch(() => 0),
    ]);
    const kinds = new Map<GcsFileKind, { count: number; bytes: number }>();
    for (const r of byMime) {
      const k = fileKind(r.mime);
      const cur = kinds.get(k) ?? { count: 0, bytes: 0 };
      kinds.set(k, { count: cur.count + r._count._all, bytes: cur.bytes + (r._sum.size ?? 0) });
    }
    return {
      count: all._count._all,
      bytes: all._sum.size ?? 0,
      kinds: GCS_FILE_KINDS.filter((k) => kinds.has(k)).map((k) => ({ kind: k, ...kinds.get(k)! })),
      areas: byArea
        .filter((r) => r.contentType !== null)
        .map((r) => ({ area: r.contentType!, count: r._count._all }))
        .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
      unattached: { count: unattached._count._all, bytes: unattached._sum.size ?? 0 },
      orphanDays: Number.isInteger(orphanDays) ? orphanDays : 0,
    };
  }

  async get(id: string): Promise<GcsFileRow | null> {
    const r = await this.deps.db.attachment.findUnique({
      where: { id },
      select: { id: true, filename: true, mime: true, size: true, width: true, height: true, contentType: true, contentId: true, createdAt: true, owner: { select: userRefSelect } },
    });
    return r ? { ...r, kind: fileKind(r.mime), owner: r.owner ? toRef(r.owner) : null } : null;
  }

  /**
   * Unde e folosit fiecare fișier din listă: legătura lui și rândurile care trimit direct la el (cover, rang, badge, ramă,
   * emoticon, banner de server, clan, hartă, setare). Câte o interogare pe tabel pentru tot lotul.
   */
  async usageMany(ids: string[]): Promise<Map<string, GcsFileUse[]>> {
    const out = new Map<string, GcsFileUse[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const { db } = this.deps;
    const inIds = { in: ids };
    const [files, covers, ranks, badges, frames, emotes, servers, clans, maps, settingRows] = await Promise.all([
      db.attachment.findMany({ where: { id: inIds }, select: { id: true, contentType: true, contentId: true } }),
      db.user.findMany({ where: { coverAttachmentId: inIds }, select: { id: true, name: true, coverAttachmentId: true } }),
      db.rank.findMany({ where: { imageAttachmentId: inIds }, select: { id: true, name: true, imageAttachmentId: true } }),
      db.badge.findMany({ where: { imageAttachmentId: inIds }, select: { id: true, name: true, imageAttachmentId: true } }),
      db.avatarFrame.findMany({ where: { imageAttachmentId: inIds }, select: { id: true, name: true, imageAttachmentId: true } }),
      db.chatEmote.findMany({ where: { attachmentId: inIds }, select: { id: true, code: true, attachmentId: true } }),
      db.gameServer.findMany({ where: { bannerId: inIds }, select: { id: true, name: true, bannerId: true } }),
      db.clan.findMany({ where: { OR: [{ logoId: inIds }, { bannerId: inIds }] }, select: { id: true, name: true, logoId: true, bannerId: true } }),
      db.gameMap.findMany({ where: { imageId: inIds }, select: { id: true, name: true, imageId: true } }),
      db.setting.findMany({ select: { key: true, value: true } }),
    ]);
    const add = (id: string | null, use: GcsFileUse) => {
      if (id) out.get(id)?.push(use);
    };
    for (const f of files) if (f.contentType && f.contentId) add(f.id, { kind: f.contentType, id: f.contentId });
    for (const u of covers) add(u.coverAttachmentId, { kind: "user.cover", id: u.id, label: u.name });
    for (const r of ranks) add(r.imageAttachmentId, { kind: "rank", id: String(r.id), label: r.name });
    for (const b of badges) add(b.imageAttachmentId, { kind: "badge", id: String(b.id), label: b.name });
    for (const f of frames) add(f.imageAttachmentId, { kind: "frame", id: String(f.id), label: f.name });
    for (const e of emotes) add(e.attachmentId, { kind: "emote", id: String(e.id), label: e.code });
    for (const s of servers) add(s.bannerId, { kind: "server", id: String(s.id), label: s.name });
    for (const c of clans) {
      add(c.logoId, { kind: "clan", id: String(c.id), label: c.name });
      if (c.bannerId !== c.logoId) add(c.bannerId, { kind: "clan", id: String(c.id), label: c.name });
    }
    for (const m of maps) add(m.imageId, { kind: "map", id: String(m.id), label: m.name });
    for (const s of settingRows) {
      const text = JSON.stringify(s.value);
      for (const id of ids) if (text.includes(`/files/${id}`)) add(id, { kind: "setting", id: s.key });
    }
    return out;
  }

  /** Șterge fișierele alese (fișierul din stocare, miniatura și rândul). Întoarce câte a șters. */
  async remove(actor: GcsActor, ids: string[]): Promise<number> {
    await this.deps.acp.assert(actor, FILES_ACP_SECTION, "edit");
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length === 0) return 0;
    const rows = await this.deps.db.attachment.findMany({ where: { id: { in: unique } }, select: { id: true, filename: true, size: true, contentType: true } });
    const removed = await this.deps.attachments.removeAny(rows.map((r) => r.id));
    await writeAudit(this.deps.db, {
      actorId: actor.userId ?? null,
      action: "system.files_delete",
      targetType: "attachment",
      targetId: rows.length === 1 ? rows[0]!.id : `${rows.length}`,
      before: rows.map((r) => ({ id: r.id, filename: r.filename, size: r.size, contentType: r.contentType })),
      ip: actor.ip,
    });
    return removed;
  }
}
