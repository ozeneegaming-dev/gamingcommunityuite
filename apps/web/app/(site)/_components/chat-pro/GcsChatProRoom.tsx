"use client";

import { faArrowDown, faBullhorn, faClockRotateLeft, faGear, faPowerOff, faScroll, faThumbtack, faCheckToSlot, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload } from "@gcs/core";
import type { GcsChatAnnouncementView, GcsChatMessageView, GcsChatProGif, GcsChatProPrefs, GcsChatReactionCount } from "@gcs/modules";
import { chatProStyleVars, mergeChatProPrefs } from "@gcs/modules/chat-pro-prefs";
import { GcsButton, GcsIconSvg, GcsModal, GcsUserLink, gcsToast, playNotificationSound } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatMessage, editChatMessage, ignoreChatUser, loadChatMessages, muteChatUser, pinChatMessage, reactChatMessage, sendChatMessage } from "../../chat-actions";
import {
  answerChatRps,
  loadChatProBar,
  loadChatProRanking,
  reportChatMessage,
  saveChatProPrefs,
  toggleChatEmoteFavorite,
  toggleChatGifFavorite,
} from "../../chat-pro-actions";
import type { GcsChatRoom } from "../chat/GcsChatRoom";
import { GcsChatComposer, type GcsChatComposerHandle } from "../chat/GcsChatComposer";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import type { GcsChatProData } from "./chat-pro-data";
import { GcsChatProBar } from "./GcsChatProBar";
import { GcsChatProEmotes } from "./GcsChatProEmotes";
import { GcsChatProGifs } from "./GcsChatProGifs";
import { GcsChatProMessage } from "./GcsChatProMessage";
import { GcsChatProNotifications } from "./GcsChatProNotifications";
import { GcsChatProRanking } from "./GcsChatProRanking";
import { GcsChatProSettings } from "./GcsChatProSettings";

type Props = Parameters<typeof GcsChatRoom>[0] & {
  pro: GcsChatProData;
  /** Secțiuni în plus în coloana laterală (pregătită pentru „Camere de voce”). */
  side?: ReactNode;
};

const MAX_KEPT = 300;
const EDIT_WINDOW_MS = 5 * 60_000;
const TYPING_MS = 5_000;
const TYPING_SEND_MS = 3_000;
const GROUP_MS = 5 * 60_000;
const VOTE_KEY = "gcs-chatpro-vote";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** O modificare de preferințe adunată (cheile simple se înlocuiesc, comenzile și culorile se combină). */
function mergePatch(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (k === "colors" || k === "commandResults") && typeof out[k] === "object" ? { ...(out[k] as object), ...(v as object) } : v;
  }
  return out;
}

/**
 * Camera de chat Chat Pro (aplicația premium): același canal și aceleași mesaje ca chat-ul standard, cu antetul cu
 * acțiuni (istoric, notificări, setări), bara de anunțuri rotativă, cele 7 aranjamente și culorile proprii ale
 * membrului, insignele de lângă nume, răspunsurile citate, meniul mesajului (răspunde, reacționează, ignoră,
 * raportează), emoticoanele comunității cu completare automată, GIF-urile furnizorului ales, comenzile botului, „scrie…”,
 * „Sari la ultimele mesaje” și panoul de clasament. Totul se actualizează live prin serviciul realtime.
 */
export function GcsChatProRoom(props: Props) {
  const { channel, initial, canModerate, canAnnounce = false, viewerId, reactions, mute, labels, config, compact, title, toolbar, settingsHref = null, pro } = props;
  const t = useTranslations("chatPro");
  const tc = useTranslations("chat.ui");
  const errorMessage = useErrorMessage();
  const realtime = useRealtime();
  const [messages, setMessages] = useState(initial);
  const [pinned, setPinned] = useState(props.pinned ?? null);
  const [announcements, setAnnouncements] = useState<GcsChatAnnouncementView[]>(props.announcements ?? []);
  const [ignored, setIgnored] = useState(() => new Set(props.ignored ?? []));
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: number; author: string; snippet: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(channel.slowModeSeconds);
  const [hasOlder, setHasOlder] = useState(initial.length >= config.pageSize);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [prefs, setPrefs] = useState<GcsChatProPrefs>(() => pro.me?.prefs ?? mergeChatProPrefs({} as GcsChatProPrefs, {}));
  const [nickname, setNickname] = useState(pro.me?.nickname ?? null);
  const [badgeIds, setBadgeIds] = useState(pro.me?.badgeIds ?? []);
  const [emoteFavs, setEmoteFavs] = useState(pro.me?.emoteFavorites ?? []);
  const [gifFavs, setGifFavs] = useState<GcsChatProGif[]>(pro.me?.gifFavorites ?? []);
  const [bar, setBar] = useState(pro.bar);
  const [ranking, setRanking] = useState({ data: pro.ranking, at: Date.now() });
  const [typers, setTypers] = useState<Map<string, { name: string; until: number }>>(() => new Map());
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [report, setReport] = useState<{ id: number; reason: string; status: string | null } | null>(null);
  const [vote, setVote] = useState(false);
  const [notifBump, setNotifBump] = useState(0);
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);
  const composer = useRef<GcsChatComposerHandle>(null);
  const keepScroll = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;
  const lastTyping = useRef(0);
  const pendingPatch = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const room = `chat:${channel.key}`;

  // ─── Preferințele: aplicate pe loc, salvate pe server după o scurtă pauză ─────────────
  const updatePrefs = useCallback((patch: Record<string, unknown>) => {
    setPrefs((p) => mergeChatProPrefs(p, patch));
    pendingPatch.current = mergePatch(pendingPatch.current, patch);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = pendingPatch.current;
      pendingPatch.current = {};
      void saveChatProPrefs(body).then((r) => r.ok && setPrefs(r.data));
    }, 400);
  }, []);
  useEffect(
    () => () => {
      // Plecarea de pe pagină nu pierde ultima modificare.
      if (saveTimer.current && Object.keys(pendingPatch.current).length > 0) void saveChatProPrefs(pendingPatch.current);
    },
    [],
  );

  // ─── Mențiunile viewer-ului (numele de pe forum sau porecla) ─────────────────────────
  const mentionRe = useMemo(() => {
    const names = [pro.viewerName, nickname].filter((n): n is string => !!n).map(escapeRe);
    return names.length > 0 ? new RegExp(`(^|[^\\p{L}\\p{N}_])@(?:${names.join("|")})(?![\\p{L}\\p{N}_])`, "iu") : null;
  }, [pro.viewerName, nickname]);
  const mentions = useCallback((m: GcsChatMessageView) => mentionRe !== null && m.author?.id !== viewerId && mentionRe.test(m.body), [mentionRe, viewerId]);

  const merge = useCallback((incoming: GcsChatMessageView[]) => {
    setMessages((list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...m, mine: m.mine.length > 0 ? m.mine : (byId.get(m.id)?.mine ?? []) });
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_KEPT);
    });
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setUnseen(0);
  }, []);

  const refreshRanking = useCallback(() => {
    void loadChatProRanking({}).then((r) => r.ok && setRanking({ data: r.data, at: Date.now() }));
  }, []);
  const rankingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRankingSoon = useCallback(() => {
    if (rankingTimer.current) clearTimeout(rankingTimer.current);
    rankingTimer.current = setTimeout(refreshRanking, 1500);
  }, [refreshRanking]);

  const reload = useCallback(async () => {
    const res = await loadChatMessages({ channel: channel.key, limit: config.pageSize });
    if (res.ok) merge(res.data);
  }, [channel.key, config.pageSize, merge]);

  // ─── Live ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    void realtime.join(room);
    const offs = [
      realtime.on("message", (data) => {
        const m = data as GcsChatMessageView;
        if (m?.channel !== channel.key) return;
        merge([m]);
        const fromOther = m.author !== null && m.author.id !== viewerId;
        if (!fromOther) return;
        setTypers((map) => {
          if (!m.author || !map.has(m.author.id)) return map;
          const next = new Map(map);
          next.delete(m.author.id);
          return next;
        });
        const p = prefsRef.current;
        if (mentions(m)) {
          setNotifBump((n) => n + 1);
          if (p.mentionAlerts) {
            gcsToast({ title: t("mentionToast", { name: m.pro?.nickname ?? m.author?.name ?? "" }), body: m.body.slice(0, 120) });
            playNotificationSound();
          }
        } else if (p.sound) playNotificationSound();
        if (p.autoscroll && atBottomRef.current) requestAnimationFrame(() => scrollToBottom());
        else setUnseen((n) => n + 1);
        refreshRankingSoon();
      }),
      realtime.on("edited", (data) => {
        const m = data as GcsChatMessageView;
        if (m?.channel === channel.key) setMessages((list) => list.map((x) => (x.id === m.id ? { ...m, mine: x.mine } : x)));
      }),
      realtime.on("deleted", (data) => {
        const id = (data as { id?: number } | null)?.id;
        setMessages((list) => list.filter((m) => m.id !== id));
      }),
      realtime.on("reactions", (data) => {
        const d = data as { id?: number; reactions?: GcsChatReactionCount[] } | null;
        if (d?.id) setMessages((list) => list.map((m) => (m.id === d.id ? { ...m, reactions: d.reactions ?? [] } : m)));
      }),
      realtime.on("pinned", (data) => {
        const d = data as { channel?: string; message?: GcsChatMessageView | null } | null;
        if (d?.channel === channel.key) setPinned(d.message ?? null);
      }),
      realtime.on("announcement", (data) => {
        const a = data as GcsChatAnnouncementView | null;
        if (a?.id) setAnnouncements((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 5));
      }),
      realtime.on("announcement:removed", (data) => {
        const id = (data as { id?: number } | null)?.id;
        setAnnouncements((list) => list.filter((a) => a.id !== id));
      }),
      realtime.on("channel", (data) => {
        const s = (data as { slowModeSeconds?: number } | null)?.slowModeSeconds;
        if (typeof s === "number") setSlow(s);
      }),
      realtime.on("chatpro:bar", () => void loadChatProBar({}).then((r) => r.ok && setBar(r.data))),
      realtime.on("chat:typing", (data) => {
        const d = data as { channel?: string; userId?: string; name?: string } | null;
        if (d?.channel !== channel.key || !d.userId || d.userId === viewerId) return;
        setTypers((map) => new Map(map).set(d.userId!, { name: d.name ?? "", until: Date.now() + TYPING_MS }));
      }),
      realtime.on("resync", () => void reload()),
    ];
    return () => {
      for (const off of offs) off();
      realtime.leave(room);
    };
  }, [realtime, room, channel.key, merge, reload, viewerId, mentions, t, scrollToBottom, refreshRankingSoon]);

  // „scrie…” expiră după 5 s fără semnal.
  useEffect(() => {
    if (typers.size === 0) return;
    const timer = setInterval(() => {
      setTypers((map) => {
        const now = Date.now();
        const next = new Map([...map].filter(([, v]) => v.until > now));
        return next.size === map.size ? map : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typers.size]);

  // Fără live: reîncărcare periodică; clasamentul se reîmprospătează oricum.
  useEffect(() => {
    if (realtime.connected) return;
    const timer = setInterval(() => void reload(), Math.max(5, config.pollSeconds) * 1000);
    return () => clearInterval(timer);
  }, [realtime.connected, reload, config.pollSeconds]);
  useEffect(() => {
    const timer = setInterval(refreshRanking, Math.max(30, pro.config.rankingSeconds) * 1000);
    return () => clearInterval(timer);
  }, [refreshRanking, pro.config.rankingSeconds]);

  // Mementoul de vot: privat, periodic (intervalul din ACP), doar cu opțiunea membrului pornită.
  useEffect(() => {
    const v = pro.config.vote;
    if (!v || !viewerId || !prefs.voteReminders) return setVote(false);
    const check = () => {
      let last = 0;
      try {
        last = Number(localStorage.getItem(VOTE_KEY) ?? "0");
      } catch {
        last = 0;
      }
      if (Date.now() - last >= v.minutes * 60_000) setVote(true);
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [pro.config.vote, viewerId, prefs.voteReminders]);
  const dismissVote = () => {
    setVote(false);
    try {
      localStorage.setItem(VOTE_KEY, String(Date.now()));
    } catch {
      // Fără localStorage: mementoul revine la reîncărcarea paginii.
    }
  };

  // La deschidere: ultimele mesaje.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || keepScroll.current === null) return;
    el.scrollTop += el.scrollHeight - keepScroll.current;
    keepScroll.current = null;
  }, [firstId]);

  const older = async () => {
    const first = messages[0];
    if (!first || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const res = await loadChatMessages({ channel: channel.key, before: first.id, limit: config.pageSize });
      if (!res.ok) return;
      if (res.data.length < config.pageSize) setHasOlder(false);
      keepScroll.current = listRef.current?.scrollHeight ?? null;
      setMessages((list) => [...res.data.filter((m) => !list.some((x) => x.id === m.id)), ...list]);
    } finally {
      setLoadingOlder(false);
    }
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (bottom !== atBottomRef.current) setAtBottom(bottom);
    if (bottom) setUnseen(0);
    if (el.scrollTop < 40 && hasOlder && !loadingOlder) void older();
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: unknown }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(errorMessage((res as { error: GcsErrorPayload }).error));
      else {
        setError(null);
        after?.();
      }
    });

  const send = async (body: string, files: string[]): Promise<boolean> => {
    const res = await sendChatMessage({ channel: channel.key, body, files, replyTo: replyTo?.id ?? null });
    if (!res.ok) {
      setError(errorMessage(res.error));
      return false;
    }
    setError(null);
    setReplyTo(null);
    merge([res.data]);
    requestAnimationFrame(() => scrollToBottom());
    refreshRankingSoon();
    return true;
  };

  const onInput = (text: string) => {
    if (!prefs.shareTyping || !text.trim()) return;
    const now = Date.now();
    if (now - lastTyping.current < TYPING_SEND_MS) return;
    lastTyping.current = now;
    realtime.emit("chat:typing", channel.key);
  };

  const react = (id: number, reactionId: number) =>
    start(async () => {
      const res = await reactChatMessage({ id, reactionId });
      if (!res.ok) return setError(errorMessage(res.error));
      setMessages((list) =>
        list.map((m) => (m.id === id ? { ...m, reactions: res.data, mine: m.mine.includes(reactionId) ? m.mine.filter((r) => r !== reactionId) : [...m.mine, reactionId] } : m)),
      );
    });

  const saveEdit = () => {
    if (!editing) return;
    const { id, body } = editing;
    start(async () => {
      const res = await editChatMessage({ id, body });
      if (!res.ok) return setError(errorMessage(res.error));
      setError(null);
      setEditing(null);
      setMessages((list) => list.map((m) => (m.id === id ? { ...res.data, mine: m.mine } : m)));
    });
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: config.timeFormat === "12h" });
  const blocked = mute !== null || !channel.canWrite;
  const canReact = viewerId !== null && !blocked;
  const style = useMemo(() => chatProStyleVars(prefs) as CSSProperties, [prefs]);
  const emotes = useMemo(() => pro.emotes.flatMap((p) => p.emotes), [pro.emotes]);
  const typing = [...typers.values()].map((v) => v.name).filter(Boolean);

  // ─── Chat-ul oprit de membru ───────────────────────────────────────────────────────
  if (prefs.disabled) {
    return (
      <div className={`gcs-chat gcs-chatPro gcs-chatPro--off${compact ? " gcs-chat--compact" : ""}`} data-testid={`gcs-chat-${channel.key}`} data-chat-pro="">
        <header className="gcs-chat__head">
          <div className="gcs-chat__title">{title}</div>
        </header>
        <div className="gcs-chatPro__offBox" data-testid="gcs-chatpro-disabled">
          <p>{t("disabled")}</p>
          <GcsButton variant="primary" size="sm" onClick={() => updatePrefs({ disabled: false })}>
            <GcsIconSvg icon={faPowerOff} /> {t("enable")}
          </GcsButton>
        </div>
      </div>
    );
  }

  // ─── Lista: filtrele membrului (ignorați, rezultatele comenzilor) și gruparea ─────────
  const rows: ReactNode[] = [];
  let prev: GcsChatMessageView | null = null;
  for (const m of messages) {
    const own = viewerId !== null && m.author?.id === viewerId;
    const bot = m.pro?.bot;
    if (bot && !own && prefs.commandResults[bot.command as keyof GcsChatProPrefs["commandResults"]] === false) continue;
    if (m.author && ignored.has(m.author.id) && !revealed.has(m.id)) {
      if (prefs.ignoredPlaceholder)
        rows.push(
          <li key={m.id} className="gcs-chatPro__hidden" data-testid="gcs-chatpro-hidden">
            {t("ignoredMessage")}{" "}
            <button type="button" className="gcs-linkButton" onClick={() => setRevealed((s) => new Set(s).add(m.id))}>
              {t("show")}
            </button>
          </li>,
        );
      prev = null;
      continue;
    }
    const grouped =
      prefs.layout === "discord" &&
      prev !== null &&
      prev.author !== null &&
      prev.author.id === m.author?.id &&
      !m.pro?.replyTo &&
      !bot &&
      !prev.pro?.bot &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
    const author = m.author;
    const canEdit = own && !blocked && !bot && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
    rows.push(
      <GcsChatProMessage
        key={m.id}
        m={m}
        own={own}
        mentioned={mentions(m)}
        grouped={grouped}
        viewerId={viewerId}
        prefs={prefs}
        allowImages={config.allowImages}
        allowYoutube={config.allowYoutube}
        hideAvatar={config.hideAvatars}
        time={time(m.createdAt)}
        labels={{ edited: labels.edited, deletedMember: labels.deletedMember }}
        reactions={reactions}
        can={{
          react: canReact,
          reply: !blocked,
          edit: canEdit,
          pin: canAnnounce && !compact,
          moderate: canModerate && author !== null && !own,
          delete: canModerate || own,
          ignore: viewerId !== null && author !== null && !own && !canModerate,
          report: viewerId !== null && author !== null && !own,
        }}
        editor={
          editing?.id === m.id ? (
            <form
              className="gcs-chat__edit"
              onSubmit={(e) => {
                e.preventDefault();
                saveEdit();
              }}
            >
              <input
                className="gcs-input"
                aria-label={labels.editInput}
                value={editing.body}
                maxLength={config.maxLength > 0 ? config.maxLength : 2000}
                autoFocus
                onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
              />
              <GcsButton type="submit" variant="primary" size="sm" disabled={pending || (!editing.body.trim() && m.files.length === 0)}>
                {labels.save}
              </GcsButton>
              <GcsButton type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {labels.cancel}
              </GcsButton>
            </form>
          ) : undefined
        }
        actions={{
          reply: () => {
            setReplyTo({ id: m.id, author: m.pro?.nickname ?? author?.name ?? labels.deletedMember, snippet: m.body.slice(0, 80) });
            composer.current?.focus();
          },
          react: (reactionId) => react(m.id, reactionId),
          edit: () => setEditing({ id: m.id, body: m.body }),
          remove: () => run(() => deleteChatMessage({ id: m.id }), () => setMessages((list) => list.filter((x) => x.id !== m.id))),
          pin: () => run(() => pinChatMessage({ channel: channel.key, id: m.id }), () => setPinned(m)),
          mute: (minutes) => author && run(() => muteChatUser({ userId: author.id, channel: channel.key, minutes, reason: "" })),
          ignore: () => author && run(() => ignoreChatUser({ userId: author.id, ignore: true }), () => setIgnored((s) => new Set(s).add(author.id))),
          report: () => setReport({ id: m.id, reason: "", status: null }),
          mention: (name) => !blocked && composer.current?.mention(name),
          answerRps: (choice) => run(() => answerChatRps({ id: m.id, choice })),
        }}
      />,
    );
    prev = m;
  }

  const showSide = prefs.showRanking;
  return (
    <div
      className={`gcs-chat gcs-chatPro gcs-chatPro--${prefs.layout}${compact ? " gcs-chat--compact gcs-chatPro--compact" : ""}${showSide ? " gcs-chatPro--withSide" : ""}${prefs.accent || prefs.colors.accent ? " gcs-chatPro--ownAccent" : ""}`}
      style={style}
      data-testid={`gcs-chat-${channel.key}`}
      data-chat-pro=""
      data-layout={prefs.layout}
    >
      <header className="gcs-chat__head gcs-chatPro__head">
        <div className="gcs-chat__title">{title}</div>
        <div className="gcs-chat__headTools">
          {config.rulesHtml !== "" && (
            <button type="button" className="gcs-chat__headButton" aria-label={tc("rules")} title={tc("rules")} onClick={() => setRulesOpen(true)} data-testid="gcs-chat-rules-open">
              <GcsIconSvg icon={faScroll} />
            </button>
          )}
          {pro.historyHref && (
            <a href={pro.historyHref} className="gcs-chat__headButton" aria-label={t("history")} title={t("history")} data-testid="gcs-chatpro-history">
              <GcsIconSvg icon={faClockRotateLeft} />
            </a>
          )}
          {viewerId !== null && <GcsChatProNotifications bump={notifBump} />}
          {viewerId !== null && (
            <button type="button" className="gcs-chat__headButton" aria-label={t("settings.title")} title={t("settings.title")} aria-haspopup="dialog" onClick={() => setSettingsOpen(true)} data-testid="gcs-chat-settings">
              <GcsIconSvg icon={faGear} />
            </button>
          )}
        </div>
      </header>
      {toolbar && <div className="gcs-chat__toolbar">{toolbar}</div>}
      <div className="gcs-chatPro__body">
        <div className="gcs-chatPro__conv">
          {!prefs.hideBar && bar.length > 0 && <GcsChatProBar items={bar} seconds={pro.config.barSeconds} />}
          {announcements.map((a) => (
            <p key={a.id} className="gcs-chat__announcement" role="note" data-testid="gcs-chat-announcement">
              <GcsIconSvg icon={faBullhorn} className="gcs-chat__barIcon" />
              <span className="gcs-srOnly">{labels.announcement}</span>
              <span>{a.body}</span>
            </p>
          ))}
          {pinned && (
            <div className="gcs-chat__pinned" data-testid="gcs-chat-pinned">
              <GcsIconSvg icon={faThumbtack} className="gcs-chat__barIcon" />
              <strong>{labels.pinned}</strong>
              {pinned.author && <GcsUserLink userId={pinned.author.id} name={pinned.author.name} nameKey={pinned.author.nameKey} href={memberHref(pinned.author)} />}
              {/* HTML-ul mesajului fixat: textul escapat de server (`renderChatText`), ca în lista de mesaje. */}
              <span className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: pinned.html }} />
              {canAnnounce && (
                <button type="button" className="gcs-linkButton" onClick={() => run(() => pinChatMessage({ channel: channel.key, id: null }), () => setPinned(null))}>
                  {labels.unpin}
                </button>
              )}
            </div>
          )}
          <div className="gcs-chatPro__listWrap">
            {hasOlder && (
              <GcsButton variant="ghost" size="sm" className="gcs-chat__older" onClick={() => void older()} disabled={loadingOlder}>
                {labels.older}
              </GcsButton>
            )}
            <ol ref={listRef} className="gcs-chat__list gcs-chatPro__list" data-gcs-gallery="chat" aria-live="polite" aria-relevant="additions" onScroll={onScroll} data-testid="gcs-chatpro-list">
              {rows.length === 0 && <li className="gcs-chat__empty">{labels.empty}</li>}
              {rows}
              {vote && pro.config.vote && (
                <li className="gcs-chatPro__msg gcs-chatPro__msg--bot gcs-chatPro__vote" data-testid="gcs-chatpro-vote">
                  <div className="gcs-chatPro__bot">
                    <span className="gcs-chatPro__botTag">{t("bot.tag")}</span>
                    <GcsIconSvg icon={faCheckToSlot} />
                    <span>{pro.config.vote.text}</span>
                    {pro.config.vote.url && (
                      <a href={pro.config.vote.url} className="gcs-chatPro__barCta" target={pro.config.vote.url.startsWith("https://") ? "_blank" : undefined} rel="noopener noreferrer" onClick={dismissVote}>
                        {t("vote")}
                      </a>
                    )}
                    <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("dismiss")} title={t("dismiss")} onClick={dismissVote}>
                      <GcsIconSvg icon={faXmark} />
                    </button>
                  </div>
                </li>
              )}
            </ol>
            {!atBottom && (
              <button type="button" className="gcs-chatPro__jump" onClick={() => scrollToBottom(true)} data-testid="gcs-chatpro-jump">
                <GcsIconSvg icon={faArrowDown} />
                {unseen > 0 ? t("jumpNew", { count: unseen }) : t("jump")}
              </button>
            )}
          </div>
          <p className="gcs-chatPro__typing" aria-live="polite" data-testid="gcs-chatpro-typing">
            {prefs.showTyping && typing.length > 0 ? (typing.length === 1 ? t("typingOne", { name: typing[0]! }) : typing.length === 2 ? t("typingTwo", { a: typing[0]!, b: typing[1]! }) : t("typingMany")) : ""}
          </p>
          {slow > 0 && (
            <p className="gcs-chat__note" data-testid="gcs-chat-slownote">
              {labels.slowMode.replace("{seconds}", String(slow))}
            </p>
          )}
          {mute ? (
            <p className="gcs-chat__note gcs-chat__note--warn" role="status" data-testid="gcs-chat-muted">
              {labels.muted.replace("{until}", mute.until ? new Date(mute.until).toLocaleString() : "∞").replace("{reason}", mute.reason || "—")}
            </p>
          ) : (
            !channel.canWrite && <p className="gcs-chat__note">{labels.readOnly}</p>
          )}
          <GcsChatComposer
            ref={composer}
            channel={channel.key}
            disabled={blocked}
            busy={pending}
            config={{ ...config, giphy: false }}
            labels={{ placeholder: labels.placeholder, send: labels.send, input: labels.input }}
            placement="above"
            onSend={send}
            onError={(e) => setError(e === null ? null : typeof e === "string" ? e : errorMessage(e))}
            ext={{
              onInput,
              before: replyTo && (
                <div className="gcs-chatPro__replyBar" data-testid="gcs-chatpro-replybar">
                  <span>
                    {t("replyingTo", { name: replyTo.author })} <span className="gcs-chatPro__replySnippet">{replyTo.snippet}</span>
                  </span>
                  <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("cancelReply")} title={t("cancelReply")} onClick={() => setReplyTo(null)} data-testid="gcs-chatpro-cancel-reply">
                    <GcsIconSvg icon={faXmark} />
                  </button>
                </div>
              ),
              emojiPanel: ({ insert, close, placement }) => (
                <GcsChatProEmotes
                  packs={pro.emotes}
                  favorites={emoteFavs}
                  placement={placement}
                  onPick={(text) => {
                    insert(text.startsWith(":") ? `${text} ` : text);
                    if (text.startsWith(":")) close();
                  }}
                  onToggleFavorite={(code) => void toggleChatEmoteFavorite({ code }).then((r) => r.ok && setEmoteFavs(r.data))}
                />
              ),
              ...(pro.config.gif
                ? {
                    gifLabel: pro.config.gif.provider === "tenor" ? "Tenor" : "GIPHY",
                    gifPanel: ({ send: sendGif, close, placement }) => (
                      <GcsChatProGifs
                        attribution={pro.config.gif!.attribution}
                        favorites={gifFavs}
                        placement={placement}
                        onSend={(g) => void sendGif(g.url).then((ok) => ok && close())}
                        onToggleFavorite={(g) => void toggleChatGifFavorite(g).then((r) => r.ok && setGifFavs(r.data))}
                      />
                    ),
                  }
                : {}),
              suggest: (q) =>
                [...emotes.filter((e) => e.code.startsWith(q)), ...emotes.filter((e) => !e.code.startsWith(q) && e.code.includes(q))].map((e) => ({
                  key: String(e.id),
                  value: `:${e.code}:`,
                  label: (
                    <>
                      <img src={e.url} alt="" width={20} height={20} /> :{e.code}:
                    </>
                  ),
                })),
            }}
          />
          {error && (
            <p role="alert" className="gcs-chat__note gcs-chat__note--warn">
              {error}
            </p>
          )}
        </div>
        {showSide && (
          // Coloana laterală: clasamentul și provocările; aici vor sta și „Camerele de voce” (etapă viitoare).
          <aside className="gcs-chatPro__side" aria-label={t("side")}>
            <GcsChatProRanking ranking={ranking.data} loadedAt={ranking.at} />
            {props.side}
          </aside>
        )}
      </div>

      {settingsOpen && (
        <GcsChatProSettings
          prefs={prefs}
          onPrefs={updatePrefs}
          nickname={nickname}
          onNickname={setNickname}
          earned={pro.badges}
          badgeIds={badgeIds}
          onBadges={setBadgeIds}
          commands={pro.config.commands}
          voteAvailable={pro.config.vote !== null}
          acpHref={settingsHref}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {report && (
        <GcsModal title={t("report.title")} onClose={() => setReport(null)} closeLabel={tc("close")} size="sm">
          <form
            className="gcs-chatPro__reportForm"
            onSubmit={(e) => {
              e.preventDefault();
              void reportChatMessage({ id: report.id, reason: report.reason.trim() }).then((r) =>
                setReport(r.ok ? { ...report, status: t("report.done") } : { ...report, status: errorMessage(r.error) }),
              );
            }}
          >
            <label className="gcs-field">
              {t("report.reason")}
              <textarea className="gcs-input" rows={3} minLength={3} maxLength={500} required value={report.reason} onChange={(e) => setReport({ ...report, reason: e.target.value })} data-testid="gcs-chatpro-report-reason" />
            </label>
            {report.status && <p role="status">{report.status}</p>}
            <GcsButton type="submit" variant="primary" disabled={report.reason.trim().length < 3} data-testid="gcs-chatpro-report-send">
              {t("report.send")}
            </GcsButton>
          </form>
        </GcsModal>
      )}
      {rulesOpen && (
        <GcsModal title={tc("rules")} onClose={() => setRulesOpen(false)} closeLabel={tc("close")}>
          {/* Regulile: HTML-ul produs și sanitizat de server din documentul editorului (`GcsChatConfig.rulesHtml`). */}
          <div className="gcs-chat__rules gcs-postBody gcs-richText" data-testid="gcs-chat-rules-body" dangerouslySetInnerHTML={{ __html: config.rulesHtml }} />
        </GcsModal>
      )}
    </div>
  );
}
