import {
  BOT_GROUP_KEY,
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  normalizeUsername,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsDoc,
  type GcsSettingsService,
  type GcsTranslateProvider,
} from "@gcs/core";
import { Prisma, type PrismaClient } from "@gcs/db";
import type { GcsChatService } from "../chat/chat";
import type { GcsForumModerationService } from "../forums/moderation";
import { textDoc } from "../forums/moderation";
import type { GcsPostService } from "../forums/posts";
import type { GcsTopicService } from "../forums/topics";
import { convertContent } from "../importer/convert";
import { emptyContext } from "../importer/convert/context";
import type { GcsConversationService } from "../messages/conversations";
import { BOT_ACP_SECTION, BOT_FEATURES_SETTING, BOT_WELCOME_SETTING, BOT_WELCOME_TITLE_SETTING, pluginBotFeature } from "./settings";

export * from "./settings";

/** Conținutul unei publicări: HTML (importuri, curățat la conversie), text simplu sau un document al editorului. */
export type GcsBotContent = { html: string } | { text: string } | { doc: GcsDoc };

/** Ce se afișează deasupra / sub postarea botului (eticheta, sursa, „Citește pe sursă”, traducerea). */
export type GcsBotPostMeta = { label?: string | null; sourceName?: string | null; sourceUrl?: string | null; importEveryMinutes?: number | null };

export type GcsBotPostInput = {
  forumId: number;
  title: string;
  content: GcsBotContent;
  prefixId?: number | null;
  tags?: string[];
  lock?: boolean;
  pin?: boolean;
  /** Deduplicarea: același import (ex. `<flux>:<guid>`) se publică o singură dată. */
  dedupeKey?: string | null;
  meta?: GcsBotPostMeta;
  /** Limba originalului (`en`): titlul și textul se traduc automat în limba site-ului, dacă traducerea e configurată. */
  translateFrom?: string | null;
};

export type GcsBotPostResult = { topicId: number; postId: number; duplicate: boolean };

/** Rândul afișat pe o postare a botului (topic). */
export type GcsBotPostView = {
  label: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  translatedFrom: string | null;
  importEveryMinutes: number | null;
};

type Deps = {
  db: PrismaClient;
  settings: GcsSettingsService;
  topics: GcsTopicService;
  posts: GcsPostService;
  moderation: GcsForumModerationService;
  conversations: GcsConversationService;
  chat: GcsChatService;
  /** Providerul de traducere din setări (`null` = traducerea e oprită). */
  translator: () => Promise<GcsTranslateProvider | null>;
  acp: Pick<GcsAcpRoleService, "assert">;
  /** Avatarul unui membru (serviciul de profil): botul își pune avatarul ca orice membru. */
  setAvatar: (actor: GcsActor, file: { name: string; bytes: Buffer }) => Promise<string>;
  clock?: () => Date;
};

/** O postare programată (lista din ACP). */
export type GcsBotScheduledView = {
  id: number;
  forumId: number;
  title: string;
  publishAt: string;
  status: "pending" | "posted" | "failed";
  topicId: number | null;
  error: string | null;
  lock: boolean;
  pin: boolean;
};

export type GcsBotScheduleInput = { forumId: number; title: string; content: unknown; prefixId?: number | null; lock?: boolean; pin?: boolean; publishAt: Date };

const NAME_MIN = 2;
const NAME_MAX = 40;

const SOURCE_URL_MAX = 2000;

/**
 * Botul comunității (bot-stiri §1): publică în numele contului-bot pentru funcțiile nucleului și pentru pluginuri.
 * Scrie prin serviciile obișnuite (topicuri, răspunsuri, mesaje private, chat), cu un actor intern: contul-bot în grupul
 * lui plus `root_admin`, deci fără verificări de permisiuni, flood sau aprobare. Contul nu se autentifică niciodată,
 * deci actorul există doar aici. Fiecare funcție are comutatorul ei; o funcție oprită nu publică nimic (`null`).
 */
export class GcsCommunityBot {
  constructor(private readonly deps: Deps) {}

  /** Comutatoarele (lipsa unei funcții = pornită). */
  async features(): Promise<Record<string, boolean>> {
    const value = await this.deps.settings.get<unknown>(BOT_FEATURES_SETTING);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {};
  }

  async enabled(feature: string): Promise<boolean> {
    return (await this.features())[feature] !== false;
  }

  async setFeature(feature: string, on: boolean, actor: GcsActor): Promise<void> {
    if (!/^[a-z0-9_.:-]{1,80}$/.test(feature)) throw new GcsValidationError({ feature: "invalid" });
    await this.deps.settings.set(BOT_FEATURES_SETTING, { ...(await this.features()), [feature]: on }, actor);
  }

  /** Contul-bot (numele și avatarul, pentru pagina din ACP), sau `null` pe o bază fără seed. */
  async account(): Promise<{ id: string; name: string; image: string | null } | null> {
    return this.deps.db.user.findFirst({ where: { isBot: true }, select: { id: true, name: true, image: true } });
  }

  /** Actorul intern al botului. */
  private async actor(): Promise<GcsActor> {
    const { db } = this.deps;
    const [bot, groups] = await Promise.all([
      db.user.findFirst({ where: { isBot: true }, select: { id: true, primaryGroupId: true } }),
      db.group.findMany({ where: { key: { in: [BOT_GROUP_KEY, "root_admin"] } }, select: { id: true, key: true } }),
    ]);
    if (!bot) throw new GcsNotFound({ entity: "bot" });
    const root = groups.find((g) => g.key === "root_admin")!.id;
    return { userId: bot.id, groupIds: [bot.primaryGroupId, root], primaryGroupId: bot.primaryGroupId, isBanned: false, ip: "bot" };
  }

  /** Un topic nou al botului. `null` = funcția e oprită; `duplicate` = cheia a mai fost publicată. */
  async post(feature: string, input: GcsBotPostInput): Promise<GcsBotPostResult | null> {
    if (!(await this.enabled(feature))) return null;
    const { db } = this.deps;
    const dedupeKey = input.dedupeKey?.slice(0, 190) ?? null;
    if (dedupeKey) {
      const seen = await db.botPost.findUnique({ where: { dedupeKey }, select: { topicId: true, postId: true } });
      if (seen) return { topicId: seen.topicId ?? 0, postId: seen.postId ?? 0, duplicate: true };
    }
    const actor = await this.actor();
    const { title, doc, translatedFrom } = await this.prepare(input.title, input.content, input.translateFrom ?? null);
    // Rândul botului întâi (cheia unică): o a doua rulare simultană a aceluiași import se oprește aici.
    let row: { id: number };
    try {
      row = await db.botPost.create({ data: { feature, dedupeKey, translatedFrom, ...metaData(input.meta) }, select: { id: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const seen = await db.botPost.findUnique({ where: { dedupeKey: dedupeKey! }, select: { topicId: true, postId: true } });
        return { topicId: seen?.topicId ?? 0, postId: seen?.postId ?? 0, duplicate: true };
      }
      throw error;
    }
    try {
      const created = await this.deps.topics.create(actor, {
        forumId: input.forumId,
        title,
        content: doc,
        prefixId: input.prefixId ?? null,
        ...(input.tags?.length ? { tags: input.tags } : {}),
      });
      await db.botPost.update({ where: { id: row.id }, data: { topicId: created.topicId, postId: created.postId } });
      // Botul nu urmărește topicurile lui (fără notificări pentru un cont care nu le citește).
      await db.follow.deleteMany({ where: { userId: actor.userId!, contentType: "topic", contentId: String(created.topicId) } });
      if (input.pin) await this.deps.moderation.setPinned(actor, [created.topicId], true);
      if (input.lock) await this.deps.moderation.setLocked(actor, [created.topicId], true);
      return { topicId: created.topicId, postId: created.postId, duplicate: false };
    } catch (error) {
      await db.botPost.delete({ where: { id: row.id } }).catch(() => {});
      throw error;
    }
  }

  /** Un răspuns al botului într-un topic (ex. nota de moderare). */
  async reply(feature: string, input: { topicId: number; content: GcsBotContent; meta?: GcsBotPostMeta; translateFrom?: string | null }): Promise<{ postId: number } | null> {
    if (!(await this.enabled(feature))) return null;
    const actor = await this.actor();
    const { doc, translatedFrom } = await this.prepare("", input.content, input.translateFrom ?? null);
    const created = await this.deps.posts.reply(actor, { topicId: input.topicId, content: doc });
    await this.deps.db.botPost.create({ data: { feature, topicId: input.topicId, postId: created.postId, translatedFrom, ...metaData(input.meta) } });
    await this.deps.db.follow.deleteMany({ where: { userId: actor.userId!, contentType: "topic", contentId: String(input.topicId) } });
    return { postId: created.postId };
  }

  /** Un mesaj privat de la bot (ex. bun venit). */
  async pm(feature: string, input: { to: string[]; title: string; content: GcsBotContent }): Promise<{ conversationId: number } | null> {
    if (!(await this.enabled(feature))) return null;
    const actor = await this.actor();
    const { doc } = await this.prepare("", input.content, null);
    const started = await this.deps.conversations.start(actor, { to: input.to, title: input.title, content: doc });
    await this.deps.db.botPost.create({ data: { feature, conversationId: started.conversationId } });
    return { conversationId: started.conversationId };
  }

  /** Un mesaj al botului în chat (marcat `bot`: fără mențiuni, în afara clasamentului). */
  async chat(feature: string, input: { channelKey: string; text: string }): Promise<{ messageId: number } | null> {
    if (!(await this.enabled(feature))) return null;
    const actor = await this.actor();
    const message = await this.deps.chat.send(actor, input.channelKey, input.text, { bot: true });
    return { messageId: message.id };
  }

  /** Metadatele postărilor botului (pagina topicului). */
  async postMeta(postIds: number[]): Promise<Map<number, GcsBotPostView>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.deps.db.botPost.findMany({ where: { postId: { in: postIds } } });
    return new Map(rows.map((r) => [r.postId!, toView(r)]));
  }

  // ─── Funcțiile nucleului ─────────────────────────────────────────────────────────────────────────────────

  /** Mesajul de bun venit (jobul `bot.welcome`, după înregistrare). `false` = oprit, membru inexistent sau deja primit. */
  async welcome(userId: string): Promise<boolean> {
    const { db, settings } = this.deps;
    if (!(await this.enabled("welcome_pm"))) return false;
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, isBot: true } });
    if (!user || user.isBot) return false;
    // O singură dată pe membru (jobul se poate relua după o eroare).
    const key = `welcome_pm:${userId}`;
    if (await db.botPost.findUnique({ where: { dedupeKey: key }, select: { id: true } })) return false;
    const [site, title, text] = await Promise.all([settings.get<string>("site.name"), settings.get<string>(BOT_WELCOME_TITLE_SETTING), settings.get<string>(BOT_WELCOME_SETTING)]);
    const fill = (t: string) => t.replaceAll("{name}", user.name).replaceAll("{site}", site);
    const sent = await this.pm("welcome_pm", { to: [userId], title: fill(title).slice(0, 150), content: { text: fill(text) } });
    if (!sent) return false;
    await db.botPost.updateMany({ where: { conversationId: sent.conversationId, feature: "welcome_pm" }, data: { dedupeKey: key } });
    return true;
  }

  /** Publică postările programate scadente (jobul `bot.scheduled`); fiecare o singură dată, chiar cu rulări paralele. */
  async publishScheduled(now = this.now()): Promise<number> {
    const { db } = this.deps;
    const due = await db.botScheduledPost.findMany({ where: { status: "pending", publishAt: { lte: now } }, orderBy: { publishAt: "asc" }, take: 20 });
    let posted = 0;
    for (const p of due) {
      const { count } = await db.botScheduledPost.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "publishing" } });
      if (count !== 1) continue;
      try {
        const result = await this.post("scheduled", {
          forumId: p.forumId,
          title: p.title,
          content: { doc: p.contentJson as GcsDoc },
          prefixId: p.prefixId,
          lock: p.lock,
          pin: p.pin,
          dedupeKey: `scheduled:${p.id}`,
        });
        if (!result) {
          // Funcția e oprită: postarea rămâne programată și pleacă după ce e pornită din nou.
          await db.botScheduledPost.update({ where: { id: p.id }, data: { status: "pending" } });
          continue;
        }
        await db.botScheduledPost.update({ where: { id: p.id }, data: { status: "posted", topicId: result.topicId, error: null } });
        posted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.botScheduledPost.update({ where: { id: p.id }, data: { status: "failed", error: message.slice(0, 500) } });
      }
    }
    return posted;
  }

  // ─── ACP › Sistem › Botul comunității ─────────────────────────────────────────────────────────────────────

  /** Numele botului (unic, ca orice nume de membru). */
  async rename(actor: GcsActor, name: string): Promise<void> {
    const { db } = this.deps;
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "edit");
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < NAME_MIN || clean.length > NAME_MAX) throw new GcsValidationError({ name: "length" });
    const bot = await this.account();
    if (!bot) throw new GcsNotFound({ entity: "bot" });
    const nameNormalized = normalizeUsername(clean);
    const taken = await db.user.findUnique({ where: { nameNormalized }, select: { id: true } });
    if (taken && taken.id !== bot.id) throw new GcsConflict({ reason: "username_taken" });
    await db.user.update({ where: { id: bot.id }, data: { name: clean, nameNormalized } });
    await writeAudit(db, { actorId: actor.userId, action: "bot.rename", targetType: "user", targetId: bot.id, before: { name: bot.name }, after: { name: clean }, ip: actor.ip });
  }

  /** Avatarul botului (imaginea încărcată din ACP), cu limitele avatarului unui membru. */
  async setAvatar(actor: GcsActor, file: { name: string; bytes: Buffer }): Promise<string> {
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "edit");
    const url = await this.deps.setAvatar(await this.actor(), file);
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "bot.avatar", targetType: "user", targetId: (await this.actor()).userId!, ip: actor.ip });
    return url;
  }

  /** Pluginurile instalate care pot folosi botul (capabilitatea `bot.post`), pentru comutatoarele din ACP. */
  async pluginUsers(): Promise<{ key: string; name: string; feature: string }[]> {
    const rows = await this.deps.db.plugin.findMany({ select: { key: true, name: true, capabilities: true }, orderBy: { name: "asc" } });
    return rows
      .filter((p) => Array.isArray(p.capabilities) && (p.capabilities as unknown[]).includes("bot.post"))
      .map((p) => ({ key: p.key, name: p.name, feature: pluginBotFeature(p.key) }));
  }

  /** Comutatorul unei funcții, din ACP. */
  async toggle(actor: GcsActor, feature: string, on: boolean): Promise<void> {
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "edit");
    await this.setFeature(feature, on, actor);
  }

  async scheduled(actor: GcsActor): Promise<GcsBotScheduledView[]> {
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "view");
    const rows = await this.deps.db.botScheduledPost.findMany({ orderBy: [{ publishAt: "desc" }], take: 200 });
    return rows.map((r) => ({
      id: r.id,
      forumId: r.forumId,
      title: r.title,
      publishAt: r.publishAt.toISOString(),
      status: r.status === "posted" ? "posted" : r.status === "failed" ? "failed" : "pending",
      topicId: r.topicId,
      error: r.error,
      lock: r.lock,
      pin: r.pin,
    }));
  }

  /** O postare programată nouă (data în viitor; conținutul e documentul editorului). */
  async schedule(actor: GcsActor, input: GcsBotScheduleInput): Promise<{ id: number }> {
    const { db } = this.deps;
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "edit");
    const title = input.title.trim();
    if (title.length < 3 || title.length > 150) throw new GcsValidationError({ title: "length" });
    if (!(input.publishAt instanceof Date) || Number.isNaN(input.publishAt.getTime()) || input.publishAt.getTime() < this.now().getTime() - 60_000) {
      throw new GcsValidationError({ publishAt: "in_past" });
    }
    if (!input.content || typeof input.content !== "object" || (input.content as { type?: unknown }).type !== "doc") throw new GcsValidationError({ content: "required" });
    const forum = await db.forum.findUnique({ where: { id: input.forumId }, select: { id: true } });
    if (!forum) throw new GcsValidationError({ forumId: "invalid_choice" });
    const row = await db.botScheduledPost.create({
      data: {
        forumId: forum.id,
        title,
        contentJson: input.content as Prisma.InputJsonValue,
        prefixId: input.prefixId ?? null,
        lock: input.lock === true,
        pin: input.pin === true,
        publishAt: input.publishAt,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    await writeAudit(db, { actorId: actor.userId, action: "bot.schedule", targetType: "bot_scheduled", targetId: String(row.id), after: { title }, ip: actor.ip });
    return row;
  }

  /** Anulează o postare programată încă nepublicată (sau eșuată). */
  async unschedule(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, BOT_ACP_SECTION, "delete");
    const { count } = await this.deps.db.botScheduledPost.deleteMany({ where: { id, status: { in: ["pending", "failed"] } } });
    if (count === 0) throw new GcsNotFound({ entity: "bot_scheduled" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "bot.unschedule", targetType: "bot_scheduled", targetId: String(id), ip: actor.ip });
  }

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }

  /** Titlul și documentul, traduse automat dacă se cere și se poate (o traducere eșuată lasă originalul). */
  private async prepare(title: string, content: GcsBotContent, from: string | null): Promise<{ title: string; doc: unknown; translatedFrom: string | null }> {
    let html = "html" in content ? content.html : null;
    let outTitle = title;
    let translatedFrom: string | null = null;
    const target = await this.deps.settings.get<string>("site.locale");
    if (from && from !== target && (html !== null || "text" in content)) {
      const provider = await this.deps.translator().catch(() => null);
      if (provider) {
        try {
          const source = html ?? escapeHtml((content as { text: string }).text).replace(/\n/g, "<br>");
          const [t, h] = await Promise.all([title ? provider.translateHtml(escapeHtml(title), target) : Promise.resolve(""), provider.translateHtml(source, target)]);
          outTitle = title ? unescapeHtml(t).trim() || title : title;
          html = h;
          translatedFrom = from;
        } catch {
          // Traducerea e opțională: rămâne originalul.
        }
      }
    }
    if (html !== null) return { title: outTitle, doc: convertContent("html", html, emptyContext("core-schema")).doc, translatedFrom };
    if ("text" in content) return { title: outTitle, doc: textDoc(content.text), translatedFrom };
    return { title: outTitle, doc: "doc" in content ? content.doc : textDoc(""), translatedFrom };
  }
}

function metaData(meta: GcsBotPostMeta | undefined) {
  const url = meta?.sourceUrl && /^https?:\/\//i.test(meta.sourceUrl) && meta.sourceUrl.length <= SOURCE_URL_MAX ? meta.sourceUrl : null;
  const minutes = meta?.importEveryMinutes;
  return {
    label: meta?.label?.trim().slice(0, 40) || null,
    sourceName: meta?.sourceName?.trim().slice(0, 120) || null,
    sourceUrl: url,
    importEveryMinutes: typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 ? minutes : null,
  };
}

function toView(r: { label: string | null; sourceName: string | null; sourceUrl: string | null; translatedFrom: string | null; importEveryMinutes: number | null }): GcsBotPostView {
  return { label: r.label, sourceName: r.sourceName, sourceUrl: r.sourceUrl, translatedFrom: r.translatedFrom, importEveryMinutes: r.importEveryMinutes };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
