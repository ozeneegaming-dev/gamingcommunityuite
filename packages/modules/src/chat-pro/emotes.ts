import {
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAttachmentService,
  type GcsCache,
  type GcsSettingsService,
  type GcsUploadedFile,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { CHAT_PRO_ACP_EMOTES } from "./index";
import type { GcsChatEmotePackView, GcsChatEmoteView } from "./types";

/** Atașamentele emoticoanelor (publice: le vede oricine vede chat-ul). */
export const CHAT_EMOTE_CONTENT_TYPE = "chat_pro.emote";
const CACHE_KEY = "chat_pro:emotes";
export const EMOTES_TAG = "chat_pro_emotes";
const CODE_RE = /^[a-z0-9_]{2,32}$/;
const MAX_PER_UPLOAD = 50;
const ALLOWED = new Set(["image/png", "image/gif", "image/webp"]);

/** Codul unui emoticon din numele fișierului: litere mici, cifre și `_`, 2–32 de caractere. */
export function emoteCodeFrom(filename: string): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base.length >= 2 ? base : `emote_${base}`.slice(0, 32);
}

/**
 * Înlocuiește `:cod:` din HTML-ul unui mesaj (text escapat + linkuri) cu imaginea emoticonului; textul linkurilor rămâne
 * neatins. Codurile au doar `[a-z0-9_]`, deci imaginea nu poate injecta nimic.
 */
export function renderEmotes(html: string, emotes: ReadonlyMap<string, GcsChatEmoteView>): string {
  if (emotes.size === 0 || !html.includes(":")) return html;
  return html
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/:([a-z0-9_]{2,32}):/g, (whole, code: string) => {
            const e = emotes.get(code);
            return e ? `<img class="gcs-emote" src="${e.url}" alt=":${code}:" title=":${code}:" width="${e.width}" height="${e.height}" loading="lazy" decoding="async">` : whole;
          }),
    )
    .join("");
}

/**
 * Emoticoanele Chat Pro: pachetele (categoriile) și emoticoanele încărcate de admini (PNG, GIF sau WebP, animația se
 * păstrează), cu limitele din ACP (KB, latura maximă). Lista e în cache (tag `chat_pro_emotes`).
 */
export class GcsChatEmoteService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; acp: GcsAcpRoleService; settings: GcsSettingsService; attachments: GcsAttachmentService }) {
    deps.attachments.registerAccess(CHAT_EMOTE_CONTENT_TYPE, async () => true);
  }

  /** Pachetele active, cu emoticoanele lor, în ordine. */
  async packs(): Promise<GcsChatEmotePackView[]> {
    const cached = await this.deps.cache.get<GcsChatEmotePackView[]>(CACHE_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.chatEmotePack.findMany({
      where: { enabled: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: { emotes: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    const packs = rows.map((p) => ({ id: p.id, name: p.name, emotes: p.emotes.map(toView) }));
    await this.deps.cache.set(CACHE_KEY, packs, { ttlSec: 3600, tags: [EMOTES_TAG] });
    return packs;
  }

  /** Codul → emoticonul (pentru afișarea mesajelor). */
  async map(): Promise<Map<string, GcsChatEmoteView>> {
    return new Map((await this.packs()).flatMap((p) => p.emotes.map((e) => [e.code, e] as const)));
  }

  private async invalidate(): Promise<void> {
    await this.deps.cache.invalidateTags([EMOTES_TAG]);
  }

  // ─── ACP ────────────────────────────────────────────────────────────────

  /** Toate pachetele (și cele oprite), pentru ACP. */
  async adminPacks(actor: GcsActor) {
    await this.deps.acp.assert(actor, CHAT_PRO_ACP_EMOTES, "view");
    const rows = await this.deps.db.chatEmotePack.findMany({
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: { emotes: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    return rows.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled, emotes: p.emotes.map(toView) }));
  }

  async savePack(actor: GcsActor, id: number | null, input: { name: string; enabled: boolean }): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_EMOTES, "edit");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 40) throw new GcsValidationError({ name: "invalid_length" });
    const row = await db.$transaction(async (tx) => {
      const saved =
        id === null
          ? await tx.chatEmotePack.create({ data: { name, enabled: input.enabled, position: ((await tx.chatEmotePack.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1 } })
          : await tx.chatEmotePack.update({ where: { id }, data: { name, enabled: input.enabled } }).catch(() => {
              throw new GcsNotFound();
            });
      await writeAudit(tx, { actorId: actor.userId, action: id === null ? "chat_pro.pack.create" : "chat_pro.pack.update", targetType: "chat_emote_pack", targetId: String(saved.id), after: { name, enabled: input.enabled }, ip: actor.ip });
      return saved;
    });
    await this.invalidate();
    return { id: row.id };
  }

  /** Șterge un pachet cu emoticoanele lui (și fișierele lor). */
  async deletePack(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_EMOTES, "delete");
    const pack = await db.chatEmotePack.findUnique({ where: { id }, include: { emotes: { select: { id: true } } } });
    if (!pack) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.chatEmotePack.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "chat_pro.pack.delete", targetType: "chat_emote_pack", targetId: String(id), before: { name: pack.name, emotes: pack.emotes.length }, ip: actor.ip });
    });
    await attachments.deleteFor(CHAT_EMOTE_CONTENT_TYPE, pack.emotes.map((e) => String(e.id)));
    await this.invalidate();
  }

  /**
   * Încărcarea în masă: fiecare fișier devine un emoticon cu codul din numele lui (unic: `_2`, `_3`… la nevoie). Doar
   * PNG, GIF și WebP, cel mult `chat_pro.emote_max_kb` KB și `chat_pro.emote_max_side` px pe latură. Fișierele
   * respinse apar în `rejected`, cu motivul; celelalte se salvează.
   */
  async upload(actor: GcsActor, packId: number, files: GcsUploadedFile[]): Promise<{ added: GcsChatEmoteView[]; rejected: { name: string; reason: string }[] }> {
    const { db, acp, settings, attachments } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_EMOTES, "edit");
    if (!actor.userId) throw new GcsValidationError({ files: "required" });
    const pack = await db.chatEmotePack.findUnique({ where: { id: packId }, select: { id: true } });
    if (!pack) throw new GcsNotFound();
    if (files.length === 0) throw new GcsValidationError({ files: "required" });
    if (files.length > MAX_PER_UPLOAD) throw new GcsValidationError({ files: "too_many" }, { max: String(MAX_PER_UPLOAD) });
    const [maxKb, maxSide] = await Promise.all([settings.get<number>("chat_pro.emote_max_kb"), settings.get<number>("chat_pro.emote_max_side")]);
    const taken = new Set((await db.chatEmote.findMany({ select: { code: true } })).map((e) => e.code));
    let position = ((await db.chatEmote.aggregate({ where: { packId }, _max: { position: true } }))._max.position ?? -1) + 1;
    const added: GcsChatEmoteView[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of files) {
      if (file.bytes.length > maxKb * 1024) {
        rejected.push({ name: file.name, reason: "too_large" });
        continue;
      }
      let info;
      try {
        // Emoticoanele au limitele lor (latura, KB) și își păstrează formatul (animația GIF / WebP).
        info = await attachments.importFile(actor.userId, file, { maxBytes: maxKb * 1024, original: true });
      } catch {
        rejected.push({ name: file.name, reason: "unsupported_type" });
        continue;
      }
      if (!ALLOWED.has(info.mime) || !info.width || !info.height) {
        rejected.push({ name: file.name, reason: "unsupported_type" });
        await attachments.discard([info.id]);
        continue;
      }
      if (info.width > maxSide || info.height > maxSide) {
        rejected.push({ name: file.name, reason: "too_big_dimensions" });
        await attachments.discard([info.id]);
        continue;
      }
      const base = emoteCodeFrom(file.name);
      let code = base;
      for (let n = 2; taken.has(code); n++) code = `${base.slice(0, 32 - String(n).length - 1)}_${n}`;
      taken.add(code);
      const emote = await db.$transaction(async (tx) => {
        const row = await tx.chatEmote.create({
          data: { packId, code, attachmentId: info.id, width: info.width!, height: info.height!, animated: info.mime === "image/gif" || info.mime === "image/webp", position: position++ },
        });
        await attachments.attach(tx, [info.id], { contentType: CHAT_EMOTE_CONTENT_TYPE, contentId: String(row.id), ownerId: actor.userId! });
        return row;
      });
      added.push(toView(emote));
    }
    if (added.length > 0) {
      await writeAudit(db, { actorId: actor.userId, action: "chat_pro.emotes.upload", targetType: "chat_emote_pack", targetId: String(packId), after: { codes: added.map((e) => e.code) }, ip: actor.ip });
      await this.invalidate();
    }
    return { added, rejected };
  }

  /** Schimbă codul unui emoticon (unic, `[a-z0-9_]{2,32}`). */
  async rename(actor: GcsActor, id: number, rawCode: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_EMOTES, "edit");
    const code = typeof rawCode === "string" ? rawCode.trim().replace(/^:|:$/g, "").toLowerCase() : "";
    if (!CODE_RE.test(code)) throw new GcsValidationError({ code: "invalid_emote_code" });
    const emote = await db.chatEmote.findUnique({ where: { id } });
    if (!emote) throw new GcsNotFound();
    if (emote.code === code) return;
    if (await db.chatEmote.findUnique({ where: { code } })) throw new GcsValidationError({ code: "taken" });
    await db.chatEmote.update({ where: { id }, data: { code } });
    await writeAudit(db, { actorId: actor.userId, action: "chat_pro.emote.rename", targetType: "chat_emote", targetId: String(id), before: { code: emote.code }, after: { code }, ip: actor.ip });
    await this.invalidate();
  }

  async deleteEmote(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, CHAT_PRO_ACP_EMOTES, "delete");
    const emote = await db.chatEmote.findUnique({ where: { id } });
    if (!emote) throw new GcsNotFound();
    await db.chatEmote.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "chat_pro.emote.delete", targetType: "chat_emote", targetId: String(id), before: { code: emote.code }, ip: actor.ip });
    await attachments.deleteFor(CHAT_EMOTE_CONTENT_TYPE, [String(id)]);
    await this.invalidate();
  }
}

function toView(e: { id: number; code: string; attachmentId: string; width: number; height: number; animated: boolean }): GcsChatEmoteView {
  return { id: e.id, code: e.code, url: `/files/${e.attachmentId}`, width: e.width, height: e.height, animated: e.animated };
}
