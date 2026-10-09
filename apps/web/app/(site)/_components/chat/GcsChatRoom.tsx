"use client";

import { faFaceSmile, faTrashCan } from "@fortawesome/free-regular-svg-icons";
import { faBullhorn, faCommentSlash, faGear, faPen, faScroll, faThumbtack, faUserSlash, faVolumeHigh, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload } from "@gcs/core";
import type { GcsChatAnnouncementView, GcsChatConfig, GcsChatMessageView, GcsChatReactionCount } from "@gcs/modules";
import { GcsAvatar, GcsButton, GcsIconSvg, GcsUserLink, playNotificationSound, type GcsIconSvgProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import {
  deleteChatMessage,
  editChatMessage,
  ignoreChatUser,
  loadChatMessages,
  muteChatUser,
  pinChatMessage,
  reactChatMessage,
  sendChatMessage,
} from "../../chat-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsChatComposer, type GcsChatComposerHandle } from "./GcsChatComposer";
import { GcsChatMedia } from "./GcsChatMedia";
import { useDismiss } from "./use-dismiss";

export type GcsChatRoomLabels = {
  placeholder: string;
  send: string;
  empty: string;
  older: string;
  delete: string;
  mute: string;
  muted: string;
  slowMode: string;
  readOnly: string;
  input: string;
  edit: string;
  editInput: string;
  save: string;
  cancel: string;
  edited: string;
  react: string;
  pin: string;
  unpin: string;
  pinned: string;
  announcement: string;
  /** Autorul unui mesaj al cărui cont a fost șters. */
  deletedMember: string;
};

export type GcsChatReactionOption = { id: number; symbol: string; label: string };

type Props = {
  channel: { key: string; name: string; slowModeSeconds: number; canWrite: boolean };
  initial: GcsChatMessageView[];
  canModerate: boolean;
  /** Poate fixa mesaje (`chat.announce`). */
  canAnnounce?: boolean;
  viewerId: string | null;
  reactions: GcsChatReactionOption[];
  pinned?: GcsChatMessageView | null;
  announcements?: GcsChatAnnouncementView[];
  /** Mute-ul activ al viewer-ului (motiv și sfârșit; `until: null` = permanent). */
  mute: { reason: string; until: string | null } | null;
  labels: GcsChatRoomLabels;
  /** Setările chat-ului din ACP (afișare, limite, conținut permis). */
  config: GcsChatConfig;
  /** Membrii ignorați de viewer: mesajele lor nu se afișează. */
  ignored?: string[];
  /** Shoutbox-ul: înălțime mică. */
  compact?: boolean;
  /** Titlul din antet, la stânga (titlul widget-ului sau numele camerei). */
  title?: ReactNode;
  /** Conținut sub antet (pe `/chat`: descrierea și uneltele camerei). */
  toolbar?: ReactNode;
  /** Linkul rotiței spre setările din ACP (staff-ul cu acces); fără el, rotița deschide preferințele viewer-ului. */
  settingsHref?: string | null;
};

const MAX_KEPT = 300;
const EDIT_WINDOW_MS = 5 * 60_000;
const SOUND_KEY = "gcs-chat-sound";
const AVATARS_KEY = "gcs-chat-avatars";
/** Duratele de mute din meniul moderatorului (minute; `null` = permanent). */
const MUTE_CHOICES: { key: string; minutes: number | null }[] = [
  { key: "10m", minutes: 10 },
  { key: "1h", minutes: 60 },
  { key: "1d", minutes: 1440 },
  { key: "forever", minutes: null },
];

/** O preferință a viewer-ului din browser (`on` implicit). */
function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Fără localStorage: alegerea ține până la reîncărcare.
  }
}

/**
 * Un canal de chat (shoutbox-ul paginii principale și `/chat`), după chatbox-ul de referință: antetul cu titlul și
 * butoanele pătrate (reguli, sunet, setări), bara galbenă de anunț, rândurile separate de linii (avatarul rotund,
 * numele în culoarea grupului, textul dedesubt, ora discret, uneltele ca iconițe la hover), emoticoane, imagini,
 * YouTube, GIF-uri, mesaje vocale, mențiuni la click pe nume, mesajele noi sus sau jos și încărcarea celor vechi la
 * derulare. Mesajele vin randate de server, apoi live din `chat:{cheie}`; fără conexiune live, lista se reîncarcă
 * periodic.
 */
export function GcsChatRoom(props: Props) {
  const { channel, initial, canModerate, canAnnounce = false, viewerId, reactions, mute, labels, config, compact, title, toolbar, settingsHref = null } = props;
  const t = useTranslations("chat.ui");
  const [messages, setMessages] = useState(initial);
  const [pinned, setPinned] = useState(props.pinned ?? null);
  const [announcements, setAnnouncements] = useState(props.announcements ?? []);
  const [ignored, setIgnored] = useState(() => new Set(props.ignored ?? []));
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  /** Meniul deschis al unui mesaj: reacțiile sau duratele de mute. */
  const [menu, setMenu] = useState<{ kind: "react" | "mute"; id: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(channel.slowModeSeconds);
  const [hasOlder, setHasOlder] = useState(initial.length >= config.pageSize);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sound, setSound] = useState(true);
  const [avatars, setAvatars] = useState(true);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pending, start] = useTransition();
  const realtime = useRealtime();
  const message = useErrorMessage();
  const listRef = useRef<HTMLOListElement>(null);
  const composer = useRef<GcsChatComposerHandle>(null);
  const soundRef = useRef(true);
  const menuRef = useRef<HTMLSpanElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const prefsRef = useRef<HTMLDivElement>(null);
  const prefsTrigger = useRef<HTMLButtonElement>(null);
  const prefsId = useId();
  const closeMenu = useCallback(() => setMenu(null), []);
  const closePrefs = useCallback(() => setPrefsOpen(false), []);
  useDismiss(menu !== null, menuRef, closeMenu, menuTrigger);
  useDismiss(prefsOpen, prefsRef, closePrefs, prefsTrigger);
  /** Înălțimea listei înainte de adăugarea mesajelor vechi (ca poziția să nu sară). */
  const keepScroll = useRef<number | null>(null);
  const room = `chat:${channel.key}`;
  const symbols = new Map(reactions.map((r) => [r.id, r]));
  const top = config.newestOnTop;

  useEffect(() => {
    const on = readPref(SOUND_KEY);
    setSound(on);
    soundRef.current = on;
    setAvatars(readPref(AVATARS_KEY));
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    soundRef.current = next;
    writePref(SOUND_KEY, next);
  };
  const toggleAvatars = () => {
    setAvatars(!avatars);
    writePref(AVATARS_KEY, !avatars);
  };

  const showError = (e: GcsErrorPayload | string | null) => setError(e === null ? null : typeof e === "string" ? e : message(e));

  const merge = useCallback((incoming: GcsChatMessageView[]) => {
    setMessages((list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...m, mine: m.mine.length > 0 ? m.mine : (byId.get(m.id)?.mine ?? []) });
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_KEPT);
    });
  }, []);

  const reload = useCallback(async () => {
    const res = await loadChatMessages({ channel: channel.key, limit: config.pageSize });
    if (res.ok) merge(res.data);
  }, [channel.key, config.pageSize, merge]);

  useEffect(() => {
    void realtime.join(room);
    const offs = [
      realtime.on("message", (data) => {
        const m = data as GcsChatMessageView;
        if (m?.channel !== channel.key) return;
        merge([m]);
        if (soundRef.current && m.author && m.author.id !== viewerId) playNotificationSound();
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
      realtime.on("resync", () => void reload()),
    ];
    return () => {
      for (const off of offs) off();
      realtime.leave(room);
    };
  }, [realtime, room, channel.key, merge, reload, viewerId]);

  // Fără live: reîncărcare periodică (intervalul din ACP).
  useEffect(() => {
    if (realtime.connected) return;
    const timer = setInterval(() => void reload(), Math.max(5, config.pollSeconds) * 1000);
    return () => clearInterval(timer);
  }, [realtime.connected, reload, config.pollSeconds]);

  // La deschidere, lista arată cele mai noi mesaje.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = top ? 0 : el.scrollHeight;
  }, [top]);

  // Un mesaj nou: lista rămâne la capătul cu mesajele noi, dacă viewer-ul era deja acolo.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (top) {
      if (el.scrollTop < 120) el.scrollTop = 0;
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [lastId, top]);

  // După încărcarea mesajelor vechi (sus, când cele noi sunt jos), poziția vizibilă rămâne pe loc.
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || keepScroll.current === null) return;
    if (!top) el.scrollTop += el.scrollHeight - keepScroll.current;
    keepScroll.current = null;
  }, [firstId, top]);

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

  // Derularea până la capătul cu mesajele vechi încarcă următoarea pagină.
  const onScroll = () => {
    const el = listRef.current;
    if (!el || !hasOlder || loadingOlder) return;
    const atOldEnd = top ? el.scrollHeight - el.scrollTop - el.clientHeight < 40 : el.scrollTop < 40;
    if (atOldEnd) void older();
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: unknown }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(message((res as { error: GcsErrorPayload }).error));
      else {
        setError(null);
        after?.();
      }
    });

  const send = async (body: string, files: string[]): Promise<boolean> => {
    const res = await sendChatMessage({ channel: channel.key, body, files });
    if (!res.ok) {
      setError(message(res.error));
      return false;
    }
    setError(null);
    merge([res.data]);
    const el = listRef.current;
    if (el) requestAnimationFrame(() => (el.scrollTop = top ? 0 : el.scrollHeight));
    return true;
  };

  const saveEdit = () => {
    if (!editing) return;
    const { id, body } = editing;
    start(async () => {
      const res = await editChatMessage({ id, body });
      if (!res.ok) return setError(message(res.error));
      setError(null);
      setEditing(null);
      setMessages((list) => list.map((m) => (m.id === id ? { ...res.data, mine: m.mine } : m)));
    });
  };

  const react = (id: number, reactionId: number) =>
    start(async () => {
      setMenu(null);
      const res = await reactChatMessage({ id, reactionId });
      if (!res.ok) return setError(message(res.error));
      setMessages((list) =>
        list.map((m) =>
          m.id === id ? { ...m, reactions: res.data, mine: m.mine.includes(reactionId) ? m.mine.filter((r) => r !== reactionId) : [...m.mine, reactionId] } : m,
        ),
      );
    });

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: config.timeFormat === "12h" });

  const blocked = mute !== null || !channel.canWrite;
  const canReact = viewerId !== null && !blocked;
  const visible = messages.filter((m) => !m.author || !ignored.has(m.author.id));
  const shown = top ? [...visible].reverse() : visible;
  const hideAvatars = config.hideAvatars || !avatars;
  const hasRules = config.rulesHtml !== "";

  const composerEl = (
    <GcsChatComposer
      ref={composer}
      channel={channel.key}
      disabled={blocked}
      busy={pending}
      config={config}
      labels={{ placeholder: labels.placeholder, send: labels.send, input: labels.input }}
      placement={top ? "below" : "above"}
      onSend={send}
      onError={showError}
    />
  );

  const olderButton = hasOlder && (
    <GcsButton variant="ghost" size="sm" className="gcs-chat__older" onClick={() => void older()} disabled={loadingOlder}>
      {labels.older}
    </GcsButton>
  );

  /** Un buton-iconiță din uneltele unui mesaj (numele accesibil e și tooltip-ul). */
  const tool = (label: string, icon: GcsIconSvgProps["icon"], onClick: () => void, extra: { expanded?: boolean; trigger?: boolean } = {}) => (
    <button
      type="button"
      className="gcs-chat__toolBtn"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={pending}
      {...(extra.expanded !== undefined ? { "aria-expanded": extra.expanded, "aria-haspopup": "true" as const } : {})}
      {...(extra.trigger ? { ref: menuTrigger } : {})}
    >
      <GcsIconSvg icon={icon} />
    </button>
  );

  return (
    <div
      className={`gcs-chat${compact ? " gcs-chat--compact" : ""}${hideAvatars ? " gcs-chat--noAvatars" : ""}${top ? " gcs-chat--newestTop" : ""}`}
      data-testid={`gcs-chat-${channel.key}`}
    >
      <header className="gcs-chat__head">
        <div className="gcs-chat__title">{title}</div>
        <div className="gcs-chat__headTools">
          {hasRules && (
            <button type="button" className="gcs-chat__headButton gcs-chat__headButton--text" onClick={() => setRulesOpen(true)} data-testid="gcs-chat-rules-open">
              <GcsIconSvg icon={faScroll} />
              <span>{t("rules")}</span>
            </button>
          )}
          <button
            type="button"
            className="gcs-chat__headButton"
            aria-pressed={sound}
            aria-label={sound ? t("soundOff") : t("soundOn")}
            title={sound ? t("soundOff") : t("soundOn")}
            onClick={toggleSound}
            data-testid="gcs-chat-sound"
          >
            <GcsIconSvg icon={sound ? faVolumeHigh : faVolumeXmark} />
          </button>
          {settingsHref ? (
            <a href={settingsHref} className="gcs-chat__headButton" aria-label={t("settingsAcp")} title={t("settingsAcp")} data-testid="gcs-chat-settings">
              <GcsIconSvg icon={faGear} />
            </a>
          ) : (
            viewerId !== null && (
              <span className="gcs-chat__prefsWrap">
                <button
                  ref={prefsTrigger}
                  type="button"
                  className="gcs-chat__headButton"
                  aria-label={t("settings")}
                  title={t("settings")}
                  aria-haspopup="dialog"
                  aria-expanded={prefsOpen}
                  aria-controls={prefsOpen ? prefsId : undefined}
                  onClick={() => setPrefsOpen(!prefsOpen)}
                  data-testid="gcs-chat-settings"
                >
                  <GcsIconSvg icon={faGear} />
                </button>
                {prefsOpen && (
                  <div ref={prefsRef} id={prefsId} className="gcs-chat__prefs" role="dialog" aria-label={t("settings")} data-testid="gcs-chat-prefs">
                    <label className="gcs-chat__switchRow">
                      <span>{t("prefSound")}</span>
                      <input type="checkbox" role="switch" className="gcs-chat__switch" checked={sound} onChange={toggleSound} />
                    </label>
                    <label className="gcs-chat__switchRow">
                      <span>{t("prefAvatars")}</span>
                      <input type="checkbox" role="switch" className="gcs-chat__switch" checked={!hideAvatars} disabled={config.hideAvatars} onChange={toggleAvatars} />
                    </label>
                  </div>
                )}
              </span>
            )
          )}
        </div>
      </header>
      {toolbar && <div className="gcs-chat__toolbar">{toolbar}</div>}
      {rulesOpen && <GcsChatRules html={config.rulesHtml} title={t("rules")} close={t("close")} onClose={() => setRulesOpen(false)} />}
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
          <span className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: pinned.html }} />
          {canAnnounce && (
            <button type="button" className="gcs-linkButton" onClick={() => run(() => pinChatMessage({ channel: channel.key, id: null }), () => setPinned(null))}>
              {labels.unpin}
            </button>
          )}
        </div>
      )}
      {top && composerEl}
      {!top && olderButton}
      <ol
        ref={listRef}
        className="gcs-chat__list"
        style={compact ? undefined : { height: config.minHeight }}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={onScroll}
      >
        {shown.length === 0 && <li className="gcs-chat__empty">{labels.empty}</li>}
        {shown.map((m) => {
          const own = viewerId !== null && m.author?.id === viewerId;
          const canEdit = own && !blocked && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
          const author = m.author;
          const open = menu?.id === m.id ? menu.kind : null;
          return (
            <li key={m.id} className={`gcs-chat__msg${own ? " gcs-chat__msg--own" : ""}`} data-testid="gcs-chat-msg" data-message-id={m.id}>
              {!hideAvatars &&
                (author ? (
                  <a href={memberHref(author)} className="gcs-chat__avatar" tabIndex={-1} aria-hidden="true" data-testid="gcs-chat-avatar">
                    <GcsAvatar name={author.name} userId={author.id} src={author.image ?? undefined} size={compact ? "s" : "m"} frame={author.frameKey ?? undefined} />
                  </a>
                ) : (
                  <span className="gcs-chat__avatar" aria-hidden="true" />
                ))}
              <div className="gcs-chat__main">
                <div className="gcs-chat__meta">
                  {author ? (
                    <button
                      type="button"
                      className={`gcs-chat__name gcs-name--${author.nameKey}`}
                      data-user-id={author.id}
                      title={t("mentionHint", { name: author.name })}
                      disabled={blocked}
                      onClick={() => composer.current?.mention(author.name)}
                      data-testid="gcs-chat-name"
                    >
                      {author.name}
                    </button>
                  ) : (
                    <span className="gcs-deletedMember" data-testid="gcs-deleted-member">
                      {labels.deletedMember}
                    </span>
                  )}
                  <time className="gcs-chat__time" dateTime={m.createdAt} suppressHydrationWarning>
                    {time(m.createdAt)}
                  </time>
                  {m.editedAt && <span className="gcs-chat__edited">({labels.edited})</span>}
                </div>
                {editing?.id === m.id ? (
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
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <GcsButton type="submit" variant="primary" size="sm" disabled={pending || (!editing.body.trim() && m.files.length === 0)}>
                      {labels.save}
                    </GcsButton>
                    <GcsButton type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      {labels.cancel}
                    </GcsButton>
                  </form>
                ) : (
                  m.body && <div className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: m.html }} />
                )}
                <GcsChatMedia files={m.files ?? []} embeds={m.embeds ?? []} allowImages={config.allowImages} allowYoutube={config.allowYoutube} />
                {m.reactions.length > 0 && (
                  <span className="gcs-chat__reactions" data-testid="gcs-chat-reactions">
                    {m.reactions.map((r) => {
                      const opt = symbols.get(r.reactionId);
                      if (!opt) return null;
                      const mine = m.mine.includes(r.reactionId);
                      return (
                        <button
                          key={r.reactionId}
                          type="button"
                          className={`gcs-chat__reaction${mine ? " gcs-chat__reaction--mine" : ""}`}
                          aria-pressed={mine}
                          aria-label={`${opt.label}: ${r.count}`}
                          disabled={!canReact || pending}
                          onClick={() => react(m.id, r.reactionId)}
                        >
                          {opt.symbol} {r.count}
                        </button>
                      );
                    })}
                  </span>
                )}
                {open !== null && (
                  <span ref={menuRef} className={`gcs-chat__pickerList${open === "mute" ? " gcs-chat__pickerList--text" : ""}`} role="group" aria-label={open === "react" ? labels.react : labels.mute}>
                    {open === "react"
                      ? reactions.map((r) => (
                          <button key={r.id} type="button" title={r.label} aria-label={r.label} onClick={() => react(m.id, r.id)}>
                            {r.symbol}
                          </button>
                        ))
                      : author &&
                        MUTE_CHOICES.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() =>
                              run(
                                () => muteChatUser({ userId: author.id, channel: channel.key, minutes: c.minutes, reason: "" }),
                                () => setMenu(null),
                              )
                            }
                          >
                            {t(`muteFor.${c.key}`)}
                          </button>
                        ))}
                  </span>
                )}
              </div>
              <span className={`gcs-chat__tools${open !== null ? " gcs-chat__tools--open" : ""}`}>
                {canReact &&
                  reactions.length > 0 &&
                  tool(labels.react, faFaceSmile, () => setMenu(open === "react" ? null : { kind: "react", id: m.id }), { expanded: open === "react", trigger: open === "react" })}
                {canEdit && editing?.id !== m.id && m.body && tool(labels.edit, faPen, () => setEditing({ id: m.id, body: m.body }))}
                {canAnnounce && !compact && tool(labels.pin, faThumbtack, () => run(() => pinChatMessage({ channel: channel.key, id: m.id }), () => setPinned(m)))}
                {canModerate &&
                  author &&
                  !own &&
                  tool(labels.mute, faCommentSlash, () => setMenu(open === "mute" ? null : { kind: "mute", id: m.id }), { expanded: open === "mute", trigger: open === "mute" })}
                {(canModerate || own) &&
                  tool(labels.delete, faTrashCan, () => run(() => deleteChatMessage({ id: m.id }), () => setMessages((list) => list.filter((x) => x.id !== m.id))))}
                {viewerId !== null &&
                  author &&
                  !own &&
                  !canModerate &&
                  tool(t("block"), faUserSlash, () =>
                    run(
                      () => ignoreChatUser({ userId: author.id, ignore: true }),
                      () => setIgnored((s) => new Set(s).add(author.id)),
                    ),
                  )}
              </span>
            </li>
          );
        })}
        {top && hasOlder && <li className="gcs-chat__olderRow">{olderButton}</li>}
      </ol>
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
      {!top && composerEl}
      {error && (
        <p role="alert" className="gcs-chat__note gcs-chat__note--warn">
          {error}
        </p>
      )}
    </div>
  );
}

/** Dialogul regulilor: HTML-ul produs și sanitizat de server (`GcsChatConfig.rulesHtml`). */
function GcsChatRules({ html, title, close, onClose }: { html: string; title: string; close: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="gcs-chat__dialog" aria-labelledby="gcs-chat-rules-title" onClose={onClose} data-testid="gcs-chat-rules">
      <h2 id="gcs-chat-rules-title" className="gcs-display">
        {title}
      </h2>
      <div className="gcs-chat__rules gcs-postBody gcs-richText" data-testid="gcs-chat-rules-body" dangerouslySetInnerHTML={{ __html: html }} />
      <GcsButton variant="primary" onClick={onClose}>
        {close}
      </GcsButton>
    </dialog>
  );
}
