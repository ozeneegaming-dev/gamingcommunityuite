import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsCache, type GcsRealtime } from "@gcs/core";
import { type ChatProBarItem, type PrismaClient, jsonInts } from "@gcs/db";
import { CHAT_PRO_ACP_BAR, safeChatProUrl } from "./index";
import type { GcsChatProBarItemView } from "./types";

const CACHE_KEY = "chat_pro:bar";
const TAG = "chat_pro_bar";
const MAX_ITEMS = 30;

export type GcsChatProBarInput = {
  text: string;
  ctaLabel: string;
  ctaUrl: string;
  startsAt: string | null;
  endsAt: string | null;
  groupIds: number[];
  enabled: boolean;
};

/** Un element pentru ACP (toate câmpurile). */
export type GcsChatProBarAdminItem = GcsChatProBarItemView & { startsAt: string | null; endsAt: string | null; groupIds: number[]; enabled: boolean; position: number };

const toAdmin = (r: ChatProBarItem): GcsChatProBarAdminItem => ({
  id: r.id,
  text: r.text,
  ctaLabel: r.ctaLabel,
  ctaUrl: r.ctaUrl,
  startsAt: r.startsAt?.toISOString() ?? null,
  endsAt: r.endsAt?.toISOString() ?? null,
  groupIds: jsonInts(r.groupIds),
  enabled: r.enabled,
  position: r.position,
});

/**
 * Bara de anunțuri de deasupra conversației (Chat Pro): elementele definite în ACP (text, buton opțional cu link,
 * program de început / sfârșit, grupurile care le văd), rotite automat. Orice schimbare pleacă live (`chatpro:bar`) în
 * camerele de chat; clientul își recitește elementele (filtrate pe grupurile lui).
 */
export class GcsChatProBar {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; acp: GcsAcpRoleService; realtime: GcsRealtime }) {}

  private async all(): Promise<GcsChatProBarAdminItem[]> {
    const cached = await this.deps.cache.get<GcsChatProBarAdminItem[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = (await this.deps.db.chatProBarItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] })).map(toAdmin);
    await this.deps.cache.set(CACHE_KEY, rows, { ttlSec: 3600, tags: [TAG] });
    return rows;
  }

  /** Elementele pe care le vede acum un viewer (pornite, în program, pentru grupurile lui). */
  async visible(groupIds: readonly number[], now = new Date()): Promise<GcsChatProBarItemView[]> {
    const t = now.getTime();
    return (await this.all())
      .filter((i) => i.enabled && (!i.startsAt || Date.parse(i.startsAt) <= t) && (!i.endsAt || Date.parse(i.endsAt) > t))
      .filter((i) => i.groupIds.length === 0 || i.groupIds.some((g) => groupIds.includes(g)))
      .map(({ id, text, ctaLabel, ctaUrl }) => ({ id, text, ctaLabel, ctaUrl }));
  }

  async adminList(actor: GcsActor): Promise<GcsChatProBarAdminItem[]> {
    await this.deps.acp.assert(actor, CHAT_PRO_ACP_BAR, "view");
    return this.all();
  }

  private validate(input: GcsChatProBarInput): { text: string; ctaLabel: string; ctaUrl: string; startsAt: Date | null; endsAt: Date | null; groupIds: number[]; enabled: boolean } {
    const errors: Record<string, string> = {};
    const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
    const ctaLabel = typeof input.ctaLabel === "string" ? input.ctaLabel.trim() : "";
    const ctaUrl = typeof input.ctaUrl === "string" ? input.ctaUrl.trim() : "";
    if (text.length < 1 || text.length > 200) errors.text = "invalid_length";
    if (ctaLabel.length > 40) errors.ctaLabel = "too_long";
    if (!safeChatProUrl(ctaUrl)) errors.ctaUrl = "invalid_url";
    if ((ctaLabel === "") !== (ctaUrl === "")) errors[ctaLabel === "" ? "ctaLabel" : "ctaUrl"] = "required";
    const date = (v: string | null, key: string) => {
      if (v === null || v === "") return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) errors[key] = "invalid_date";
      return d;
    };
    const startsAt = date(input.startsAt, "startsAt");
    const endsAt = date(input.endsAt, "endsAt");
    if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "before_start";
    const groupIds = Array.isArray(input.groupIds) ? [...new Set(input.groupIds)] : [];
    if (!groupIds.every((g) => Number.isInteger(g) && g > 0) || groupIds.length > 50) errors.groupIds = "invalid_value";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return { text, ctaLabel, ctaUrl, startsAt, endsAt, groupIds, enabled: input.enabled !== false };
  }

  private async changed(): Promise<void> {
    await this.deps.cache.invalidateTags([TAG]);
    for (const c of await this.deps.db.chatChannel.findMany({ where: { enabled: true }, select: { key: true } })) {
      await this.deps.realtime.publish(`chat:${c.key}`, "chatpro:bar", {});
    }
  }

  async save(actor: GcsActor, id: number | null, input: GcsChatProBarInput): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_BAR, "edit");
    const data = this.validate(input);
    if (id === null && (await db.chatProBarItem.count()) >= MAX_ITEMS) throw new GcsValidationError({ text: "too_many" }, { max: String(MAX_ITEMS) });
    const row = await db.$transaction(async (tx) => {
      const saved =
        id === null
          ? await tx.chatProBarItem.create({ data: { ...data, position: ((await tx.chatProBarItem.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1 } })
          : await tx.chatProBarItem.update({ where: { id }, data }).catch(() => {
              throw new GcsNotFound();
            });
      await writeAudit(tx, { actorId: actor.userId, action: id === null ? "chat_pro.bar.create" : "chat_pro.bar.update", targetType: "chat_pro_bar", targetId: String(saved.id), after: data, ip: actor.ip });
      return saved;
    });
    await this.changed();
    return { id: row.id };
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_BAR, "delete");
    const before = await db.chatProBarItem.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatProBarItem.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat_pro.bar.delete", targetType: "chat_pro_bar", targetId: String(id), before, ip: actor.ip });
    });
    await this.changed();
  }

  /** Ordinea elementelor (toate id-urile, o singură dată). */
  async reorder(actor: GcsActor, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_BAR, "edit");
    const all = await db.chatProBarItem.findMany({ select: { id: true } });
    if (ids.length !== all.length || new Set(ids).size !== ids.length || !all.every((r) => ids.includes(r.id))) throw new GcsValidationError({ order: "incomplete" });
    await db.$transaction(ids.map((id, position) => db.chatProBarItem.update({ where: { id }, data: { position } })));
    await this.changed();
  }
}
