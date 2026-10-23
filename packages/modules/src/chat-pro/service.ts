import {
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  normalizeUsername,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAppService,
  type GcsAttachmentService,
  type GcsCache,
  type GcsNotificationService,
  type GcsNotificationView,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsRateLimiter,
  type GcsReportService,
  type GcsSettingsService,
} from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { toChatView, type GcsChatMessageView, type GcsChatService } from "../chat/chat";
import type { GcsChatExtension } from "../chat/extensions";
import type { GcsChatQueries } from "../chat/queries";
import { userRefSelect } from "../forums/queries";
import { GcsChatProBar } from "./bar";
import { GcsChatCommandRegistry, parseRpsChoice, publicBot, rpsWinner, RPS_EMOJI, type GcsStoredBot } from "./commands";
import { GcsChatEmoteService, renderEmotes } from "./emotes";
import { cleanGif, GIF_ATTRIBUTION, searchGifs, trendingGifs } from "./gifs";
import { GcsChatHistory } from "./history";
import { CHAT_PRO_APP, CHAT_PRO_WINNER_BADGE } from "./index";
import type { GcsRankingPeriod } from "./period";
import { CHAT_PRO_COMMANDS, chatProPrefsError, mergeChatProPrefs, normalizeChatProPrefs, type GcsChatProCommand, type GcsChatProPrefs } from "./prefs";
import { GcsChatProRankingService } from "./ranking";
import type { GcsChatProConfig, GcsChatProEarnedBadge, GcsChatProGif, GcsChatProMe, GcsChatProMessage } from "./types";

const NICK_RE = /^[\p{L}\p{N} _.\-]{2,24}$/u;
const MAX_BADGES = 2;
const MAX_EMOTE_FAVORITES = 40;
const MAX_GIF_FAVORITES = 50;
const GIF_LIMIT = { window: 60, max: 30 };
/** Tipurile de notificări ale panoului chat-ului: „Toate” și „Mențiuni”. */
export const CHAT_NOTIFICATION_TYPES = { all: ["chat.mention", "chat_pro.reply"], mentions: ["chat.mention"] } as const;

const badgeLookSelect = { id: true, key: true, name: true, description: true, symbol: true, imageAttachmentId: true, color: true, manual: true, artShape: true, artTier: true, artIcon: true } as const;

/**
 * Chat Pro (specul 2026-10-10-chat-pro): aplicația premium peste chat-ul standard. Se leagă de el prin punctele de
 * extensie (`GcsChatExtensions`: comenzile, prima apariție, statisticile, notificarea răspunsurilor, datele afișate),
 * doar cât aplicația e pornită. Profilul de chat al membrului (preferințe, poreclă, insigne, favorite), configurația
 * pentru client, GIF-urile, jocul RPS și rapoartele; clasamentul, bara, emoticoanele și istoricul au serviciile lor.
 */
export class GcsChatProService {
  readonly commands = new GcsChatCommandRegistry();
  readonly emotes: GcsChatEmoteService;
  readonly ranking: GcsChatProRankingService;
  readonly bar: GcsChatProBar;
  readonly history: GcsChatHistory;

  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      apps: GcsAppService;
      acp: GcsAcpRoleService;
      chat: GcsChatService;
      chatQueries: GcsChatQueries;
      attachments: GcsAttachmentService;
      realtime: GcsRealtime;
      rateLimiter: GcsRateLimiter;
      notifications: GcsNotificationService;
      reports?: GcsReportService;
      /** Acordă un badge din sistemul de badge-uri (fără drept ACP: acordarea automată). */
      grantBadge?: (userId: string, badgeKey: string, reason: string) => Promise<unknown>;
      random?: () => number;
      fetch?: typeof fetch;
    },
  ) {
    const { db, cache, settings, acp, attachments, rateLimiter, realtime, permissions, chatQueries } = deps;
    this.emotes = new GcsChatEmoteService({ db, cache, acp, settings, attachments });
    this.ranking = new GcsChatProRankingService({
      db,
      cache,
      settings,
      rateLimiter,
      awardWinner: (userId, period) => this.awardWinner(userId, period),
    });
    this.bar = new GcsChatProBar({ db, cache, acp, realtime });
    this.history = new GcsChatHistory({ db, permissions, chatQueries, rights: deps.chat.rights, emotes: () => this.emotes.map() });
  }

  /** Leagă Chat Pro de chat (extensia) și de rapoarte (mesajele de chat devin raportabile). */
  register(): void {
    this.deps.chat.extensions.use(this.extension());
    this.deps.reports?.registerContent("chat.message", {
      canView: async (actor, id) => {
        const m = await this.deps.db.chatMessage.findUnique({ where: { id: Number(id) }, select: { deletedAt: true, channel: { select: { key: true } } } });
        return m !== null && m.deletedAt === null && (await this.deps.chatQueries.canRead(actor, m.channel.key));
      },
      canModerate: (actor) => this.deps.chat.canModerate(actor),
      hide: (actor, id) => this.deps.chat.delete(actor, Number(id)),
    });
  }

  /** Aplicația e pornită (și Chat-ul, de care depinde). */
  active(): Promise<boolean> {
    return this.deps.apps.enabled(CHAT_PRO_APP);
  }

  /** Viewer-ul folosește Chat Pro: aplicația pornită și accesibilă grupurilor lui. */
  canUse(viewer: GcsActor): Promise<boolean> {
    return this.deps.apps.canAccess(viewer, CHAT_PRO_APP);
  }

  private async assertUser(actor: GcsActor): Promise<string> {
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ reason: "guest" });
    if (!(await this.canUse(actor))) throw new GcsNotFound();
    return actor.userId;
  }

  private now(): Date {
    return new Date();
  }

  // ─── Configurația pentru client ───────────────────────────────────────

  async enabledCommands(): Promise<GcsChatProCommand[]> {
    const raw = await this.deps.settings.get<unknown>("chat_pro.commands");
    return Array.isArray(raw) ? CHAT_PRO_COMMANDS.filter((c) => raw.includes(c)) : [...CHAT_PRO_COMMANDS];
  }

  private async gifKey(): Promise<{ provider: "giphy" | "tenor"; key: string } | null> {
    const [provider, key] = await Promise.all([this.deps.settings.get<string>("chat_pro.gif_provider"), this.deps.settings.get<string>("chat_pro.gif_key")]);
    if (typeof key !== "string" || key.trim() === "") return null;
    return { provider: provider === "tenor" ? "tenor" : "giphy", key: key.trim() };
  }

  async config(): Promise<GcsChatProConfig> {
    const s = this.deps.settings;
    const [gif, commands, voteOn, voteText, voteUrl, voteMinutes, barSeconds] = await Promise.all([
      this.gifKey(),
      this.enabledCommands(),
      s.get<boolean>("chat_pro.vote_enabled"),
      s.get<string>("chat_pro.vote_text"),
      s.get<string>("chat_pro.vote_url"),
      s.get<number>("chat_pro.vote_interval"),
      s.get<number>("chat_pro.bar_seconds"),
    ]);
    return {
      gif: gif ? { provider: gif.provider, attribution: GIF_ATTRIBUTION[gif.provider] } : null,
      commands,
      vote: voteOn && voteText.trim() ? { text: voteText.trim(), url: voteUrl, minutes: voteMinutes } : null,
      barSeconds,
      rankingSeconds: 60,
    };
  }

  // ─── Profilul de chat al membrului ────────────────────────────────────

  async me(userId: string): Promise<GcsChatProMe> {
    const row = await this.deps.db.chatProProfile.findUnique({ where: { userId } });
    return {
      prefs: normalizeChatProPrefs(row?.prefs),
      nickname: row?.nickname ?? null,
      badgeIds: row?.badgeIds ?? [],
      emoteFavorites: row?.emoteFavorites ?? [],
      gifFavorites: Array.isArray(row?.gifFavorites) ? (row.gifFavorites as unknown[]).map(cleanGif).filter((g): g is GcsChatProGif => g !== null) : [],
    };
  }

  /** Preferințele membrului (fără profil: cele implicite). */
  async prefs(userId: string | null): Promise<GcsChatProPrefs> {
    if (!userId) return normalizeChatProPrefs({});
    const row = await this.deps.db.chatProProfile.findUnique({ where: { userId }, select: { prefs: true } });
    return normalizeChatProPrefs(row?.prefs);
  }

  /** Salvează o parte din preferințe (doar cheile trimise, validate); întoarce preferințele complete. */
  async updatePrefs(actor: GcsActor, patch: unknown): Promise<GcsChatProPrefs> {
    const userId = await this.assertUser(actor);
    const bad = chatProPrefsError(patch);
    if (bad) throw new GcsValidationError({ [bad]: "invalid_value" });
    const next = mergeChatProPrefs(await this.prefs(userId), patch as Record<string, unknown>);
    const prefs = next as unknown as Prisma.InputJsonValue;
    await this.deps.db.chatProProfile.upsert({ where: { userId }, create: { userId, prefs }, update: { prefs } });
    return next;
  }

  /**
   * Porecla din chat (gol = numele de pe forum): 2–24 litere, cifre, spații, `_`, `.`, `-`; nu poate fi numele altui
   * membru și nici porecla lui (după normalizare: fără diacritice, litere mici).
   */
  async setNickname(actor: GcsActor, raw: string): Promise<string | null> {
    const userId = await this.assertUser(actor);
    const nickname = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
    const { db } = this.deps;
    if (nickname === "") {
      await db.chatProProfile.upsert({ where: { userId }, create: { userId }, update: { nickname: null, nicknameNormalized: null } });
      return null;
    }
    if (!NICK_RE.test(nickname)) throw new GcsValidationError({ nickname: "invalid_nickname" });
    const normalized = normalizeUsername(nickname);
    const [user, other] = await Promise.all([
      db.user.findUnique({ where: { nameNormalized: normalized }, select: { id: true } }),
      db.chatProProfile.findUnique({ where: { nicknameNormalized: normalized }, select: { userId: true } }),
    ]);
    if ((user && user.id !== userId) || (other && other.userId !== userId)) throw new GcsValidationError({ nickname: "taken" });
    await db.chatProProfile.upsert({ where: { userId }, create: { userId, nickname, nicknameNormalized: normalized }, update: { nickname, nicknameNormalized: normalized } });
    return nickname;
  }

  /** Badge-urile obținute de membru (din care alege cele afișate în chat). */
  async earnedBadges(userId: string): Promise<GcsChatProEarnedBadge[]> {
    const rows = await this.deps.db.userBadge.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { badge: { select: badgeLookSelect } } });
    return rows.map((r) => ({
      id: r.badge.id,
      key: r.badge.key,
      name: r.badge.name,
      art: badgeArtSrc(r.badge),
      image: r.badge.imageAttachmentId ? `/files/${r.badge.imageAttachmentId}` : null,
    }));
  }

  /** Cel mult 2 badge-uri obținute, afișate lângă nume. */
  async setBadges(actor: GcsActor, ids: number[]): Promise<number[]> {
    const userId = await this.assertUser(actor);
    const unique = [...new Set(ids)];
    if (unique.length > MAX_BADGES || !unique.every((id) => Number.isInteger(id))) throw new GcsValidationError({ badges: "too_many" }, { max: String(MAX_BADGES) });
    const owned = await this.deps.db.userBadge.count({ where: { userId, badgeId: { in: unique } } });
    if (owned !== unique.length) throw new GcsValidationError({ badges: "not_owned" });
    await this.deps.db.chatProProfile.upsert({ where: { userId }, create: { userId, badgeIds: unique }, update: { badgeIds: unique } });
    return unique;
  }

  /** Adaugă / scoate un emoticon din favorite (cel mult 40). Întoarce lista nouă. */
  async toggleEmoteFavorite(actor: GcsActor, code: string): Promise<string[]> {
    const userId = await this.assertUser(actor);
    const map = await this.emotes.map();
    const current = (await this.me(userId)).emoteFavorites;
    const next = current.includes(code) ? current.filter((c) => c !== code) : map.has(code) ? [code, ...current].slice(0, MAX_EMOTE_FAVORITES) : null;
    if (!next) throw new GcsValidationError({ code: "invalid_emote_code" });
    await this.deps.db.chatProProfile.upsert({ where: { userId }, create: { userId, emoteFavorites: next }, update: { emoteFavorites: next } });
    return next;
  }

  /** Adaugă / scoate un GIF din favorite (cel mult 50; doar GIF-uri ale furnizorilor). Întoarce lista nouă. */
  async toggleGifFavorite(actor: GcsActor, raw: unknown): Promise<GcsChatProGif[]> {
    const userId = await this.assertUser(actor);
    const gif = cleanGif(raw);
    if (!gif) throw new GcsValidationError({ gif: "invalid_value" });
    const current = (await this.me(userId)).gifFavorites;
    const next = current.some((g) => g.id === gif.id) ? current.filter((g) => g.id !== gif.id) : [gif, ...current].slice(0, MAX_GIF_FAVORITES);
    const value = next as unknown as Prisma.InputJsonValue;
    await this.deps.db.chatProProfile.upsert({ where: { userId }, create: { userId, gifFavorites: value }, update: { gifFavorites: value } });
    return next;
  }

  /** Numele afișat în chat (porecla sau numele de pe forum): „scrie…”. */
  async displayName(userId: string): Promise<string | null> {
    const row = await this.deps.db.user.findUnique({ where: { id: userId }, select: { name: true, chatProProfile: { select: { nickname: true } } } });
    return row ? (row.chatProProfile?.nickname ?? row.name) : null;
  }

  // ─── GIF-uri ──────────────────────────────────────────────────────────

  /** Căutarea (cu `q`) sau GIF-urile populare, prin furnizorul ales; fără cheie → `null` (fără butonul GIF). */
  async gifs(actor: GcsActor, q: string | null, lang = "en"): Promise<GcsChatProGif[] | null> {
    const userId = await this.assertUser(actor);
    const key = await this.gifKey();
    if (!key) return null;
    const limit = await this.deps.rateLimiter.consume(`chat-pro-gif:${userId}`, GIF_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const opts = { lang, ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}) };
    return q && q.trim() ? searchGifs(key.provider, key.key, q, opts) : trendingGifs(key.provider, key.key, opts);
  }

  // ─── Notificările chat-ului (panoul din antet) ────────────────────────

  async notifications(actor: GcsActor, tab: "all" | "mentions"): Promise<GcsNotificationView[]> {
    const userId = await this.assertUser(actor);
    return this.deps.notifications.list(userId, { limit: 30, types: [...CHAT_NOTIFICATION_TYPES[tab]] });
  }

  /** Raportează un mesaj de chat (coada de moderare, rapoartele). */
  async report(actor: GcsActor, messageId: number, reason: string): Promise<void> {
    await this.assertUser(actor);
    if (!this.deps.reports) throw new GcsNotFound();
    await this.deps.reports.report(actor, { contentType: "chat.message", contentId: String(messageId), reason });
  }

  // ─── Piatră-hârtie-foarfecă ───────────────────────────────────────────

  /** Răspunsul adversarului la o provocare RPS: rezultatul se scrie în mesaj și pleacă live. */
  async answerRps(actor: GcsActor, messageId: number, rawChoice: string): Promise<GcsChatMessageView> {
    const userId = await this.assertUser(actor);
    const { db, chat, realtime } = this.deps;
    const choice = parseRpsChoice(rawChoice);
    if (!choice) throw new GcsValidationError({ choice: "invalid_choice" });
    const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { channel: { select: { key: true } } } });
    const stored = (message?.meta as { bot?: GcsStoredBot } | null)?.bot;
    if (!message || message.deletedAt || stored?.command !== "rps") throw new GcsNotFound();
    if (!(await this.deps.chatQueries.canRead(actor, message.channel.key))) throw new GcsNotFound();
    if (stored.opponent.id !== userId) throw new GcsForbidden({ reason: "not_opponent" });
    if (stored.state !== "open" || Date.parse(stored.expiresAt) < Date.now()) throw new GcsValidationError({ choice: "closed" });
    const challenger = (stored.secret?.challenger as string | undefined) ?? "rock";
    const first = parseRpsChoice(challenger) ?? "rock";
    const winner = rpsWinner(first, choice);
    const bot: GcsStoredBot = { ...stored, state: "done", result: { challenger: first, opponent: choice, winner } };
    const body = `✊✋✌️ @${stored.opponent.name}: ${RPS_EMOJI[first]} vs ${RPS_EMOJI[choice]}`;
    // Doar dacă provocarea e încă deschisă (două răspunsuri simultane: câștigă primul).
    const updated = await db.chatMessage.updateMany({
      where: { id: messageId, meta: { path: ["bot", "state"], equals: "open" } },
      data: { body, meta: { ...(message.meta as object), bot } as Prisma.InputJsonValue },
    });
    if (updated.count === 0) throw new GcsValidationError({ choice: "closed" });
    const fresh = await db.chatMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: { author: { select: userRefSelect }, reactions: { select: { userId: true, reactionId: true } } },
    });
    const [view] = await chat.extensions.decorate([toChatView(fresh, message.channel.key)]);
    await realtime.publish(`chat:${message.channel.key}`, "edited", view);
    return view!;
  }

  // ─── Extensia chat-ului ───────────────────────────────────────────────

  private extension(): GcsChatExtension {
    return {
      key: CHAT_PRO_APP,
      active: () => this.active(),
      beforeSend: async ({ actor, body, files }) => {
        const { db } = this.deps;
        const meta: Record<string, unknown> = {};
        let text: string | undefined;
        const parsed = body.startsWith("/") ? this.commands.parse(body) : null;
        if (parsed) {
          if (!(await this.enabledCommands()).includes(parsed.command.key)) throw new GcsValidationError({ body: "command_disabled" }, { command: parsed.command.key });
          if (files > 0) throw new GcsValidationError({ body: "command_files" });
          const now = this.now();
          const { today } = await this.ranking.current(now);
          const res = await parsed.command.run({ actor, args: parsed.args, db, now, today, random: this.deps.random ?? Math.random });
          text = res.body;
          meta.bot = res.bot;
        }
        // „Primul mesaj”: autorul nu a mai scris niciodată în chat (nici înainte de Chat Pro).
        if (actor.userId && !(await db.chatMessage.findFirst({ where: { authorId: actor.userId }, select: { id: true } }))) meta.first = true;
        return { ...(text !== undefined ? { body: text } : {}), ...(Object.keys(meta).length > 0 ? { meta } : {}) };
      },
      afterSend: async ({ actor, meta, replyToId, messageId, channel }) => {
        if (!actor.userId) return;
        // Clasamentul ignoră comenzile botului; pauza de numărare oprește spam-ul.
        if (!meta?.bot) await this.ranking.count(actor.userId);
        if (replyToId) {
          const target = await this.deps.db.chatMessage.findUnique({ where: { id: replyToId }, select: { authorId: true } });
          if (target?.authorId && target.authorId !== actor.userId) {
            const visible = await this.deps.notifications.visibleTo("chat.message", String(messageId), [target.authorId]);
            if (visible.length > 0) {
              await this.deps.notifications.notify({ userIds: visible, type: "chat_pro.reply", targetType: "chat.message", targetId: String(messageId), actorId: actor.userId, data: { channel: channel.key } });
            }
          }
        }
      },
      decorate: (views) => this.decorate(views),
    };
  }

  /** Datele Chat Pro ale mesajelor: porecla, insignele, citatul, rezultatul comenzii și emoticoanele din text. */
  async decorate(views: GcsChatMessageView[]): Promise<void> {
    const { db } = this.deps;
    if (views.length === 0) return;
    const ids = views.map((v) => v.id);
    const rows = await db.chatMessage.findMany({ where: { id: { in: ids } }, select: { id: true, meta: true, replyToId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is number => x !== null))];
    const authorIds = [...new Set(views.map((v) => v.author?.id).filter((x): x is string => typeof x === "string"))];
    const [replies, profiles, emotes, winner] = await Promise.all([
      replyIds.length > 0
        ? db.chatMessage.findMany({ where: { id: { in: replyIds } }, select: { id: true, body: true, deletedAt: true, author: { select: { name: true, chatProProfile: { select: { nickname: true } } } } } })
        : Promise.resolve([]),
      authorIds.length > 0 ? db.chatProProfile.findMany({ where: { userId: { in: authorIds } }, select: { userId: true, nickname: true, badgeIds: true } }) : Promise.resolve([]),
      this.emotes.map(),
      this.ranking.lastWinner(),
    ]);
    const chosen = profiles.flatMap((p) => p.badgeIds.map((badgeId) => ({ userId: p.userId, badgeId })));
    const owned =
      chosen.length > 0
        ? await db.userBadge.findMany({
            where: { OR: chosen.map((c) => ({ userId: c.userId, badgeId: c.badgeId })) },
            select: { userId: true, badge: { select: badgeLookSelect } },
          })
        : [];
    const replyMap = new Map(replies.map((r) => [r.id, r]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const now = Date.now();
    for (const view of views) {
      const row = byId.get(view.id);
      const meta = (row?.meta ?? null) as { first?: boolean; bot?: unknown } | null;
      const authorId = view.author?.id ?? null;
      const profile = authorId ? profileMap.get(authorId) : undefined;
      const reply = row?.replyToId ? replyMap.get(row.replyToId) : undefined;
      const badges = (profile?.badgeIds ?? []).flatMap((badgeId) => {
        const b = owned.find((o) => o.userId === authorId && o.badge.id === badgeId)?.badge;
        return b ? [{ kind: "badge" as const, key: b.key, name: b.name, art: badgeArtSrc(b), image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null }] : [];
      });
      const pro: GcsChatProMessage = {
        nickname: profile?.nickname ?? null,
        first: meta?.first === true,
        winner: authorId !== null && winner?.user.id === authorId,
        badges,
        replyTo: reply && !reply.deletedAt ? { id: reply.id, author: reply.author ? (reply.author.chatProProfile?.nickname ?? reply.author.name) : null, snippet: reply.body.slice(0, 120) } : null,
        bot: publicBot(meta?.bot, now),
      };
      view.pro = pro;
      if (emotes.size > 0) view.html = renderEmotes(view.html, emotes);
    }
  }

  /** Badge-ul câștigătorului unei perioade (prin sistemul de badge-uri). */
  private async awardWinner(userId: string, period: GcsRankingPeriod): Promise<void> {
    await this.deps.grantBadge?.(userId, CHAT_PRO_WINNER_BADGE, `${period.start} – ${period.end}`);
  }
}
