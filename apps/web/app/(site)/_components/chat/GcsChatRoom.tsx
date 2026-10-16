"use client";

import type { GcsMentionHint } from "@gcs/core/text-mentions";
import { faFaceSmile } from "@fortawesome/free-regular-svg-icons";
import { faBullhorn, faEllipsis, faGaugeSimple, faGear, faScroll, faThumbtack, faVolumeHigh, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload } from "@gcs/core";
import type { GcsChatAnnouncementView, GcsChatConfig, GcsChatEphemeral, GcsChatMessageView, GcsChatReactionCount, GcsChatSystemLine as GcsSystemLineData, GcsChatViewerState } from "@gcs/modules";
import { GcsAvatar, GcsButton, GcsIconSvg, GcsMemberName, playNotificationSound, type GcsIconSvgProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatMessage, editChatMessage, ignoreChatUser, loadChatMessages, pinChatMessage, reactChatMessage, sendChatMessage } from "../../chat-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { GcsChatComposer, type GcsChatComposerHandle } from "./GcsChatComposer";
import { GcsChatMedia } from "./GcsChatMedia";
import {
  GcsChatBlocked,
  GcsChatEphemeralLine,
  GcsChatHiddenTag,
  GcsChatModMenu,
  GcsChatMutedNote,
  GcsChatReportDialog,
  GcsChatSystemLine,
  hideMessage,
  useAccessCommands,
  useChatModeration,
  type GcsChatRoomMod,
} from "./GcsChatModeration";
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
  /** Meniul de moderare al camerei (drepturile viewer-ului, motivele, „Ban pe site…”, istoricul). */
  mod: GcsChatRoomMod;
  /** Starea viewer-ului: mute, kick / ban, slow mode personal. */
  state: GcsChatViewerState;
  /** Mesajul spre care s-a deschis camera (`?m=<id>`): derulat în vedere și evidențiat. */
  focusId?: number | null;
};

/** Hide / unhide / purge, aplicate pe lista unei camere (live). */
export function applyModerationEvent(
  list: GcsChatMessageView[],
  event: "hidden" | "purged",
  data: unknown,
  channel: string,
  seesHidden: boolean,
): GcsChatMessageView[] | null {
  if (event === "purged") {
    const d = data as { channel?: string; ids?: number[] } | null;
    if (d?.channel !== channel || !Array.isArray(d.ids)) return null;
    const ids = new Set(d.ids);
    return list.filter((m) => !ids.has(m.id));
  }
  const d = data as { id?: number; channel?: string; hidden?: boolean; at?: string | null; by?: GcsChatMessageView["author"]; message?: GcsChatMessageView | null } | null;
  if (!d?.id || d.channel !== channel) return null;
  if (d.hidden) {
    if (!seesHidden) return list.filter((m) => m.id !== d.id);
    return list.map((m) => (m.id === d.id ? { ...m, hidden: { at: d.at ?? new Date().toISOString(), byId: d.by?.id ?? null, by: d.by ?? null } } : m));
  }
  if (list.some((m) => m.id === d.id)) return list.map((m) => (m.id === d.id ? { ...m, hidden: undefined } : m));
  if (!d.message) return null;
  return [...list, { ...d.message, mine: [] }].sort((a, b) => a.id - b.id);
}

const MAX_KEPT = 300;
const EDIT_WINDOW_MS = 5 * 60_000;
const SOUND_KEY = "gcs-chat-sound";
const AVATARS_KEY = "gcs-chat-avatars";

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
  const { channel, initial, viewerId, reactions, labels, config, compact, title, toolbar, settingsHref = null } = props;
  const t = useTranslations("chat.ui");
  const ts = useTranslations("chat.mod");
  const [messages, setMessages] = useState(initial);
  const [pinned, setPinned] = useState(props.pinned ?? null);
  const [announcements, setAnnouncements] = useState(props.announcements ?? []);
  const [ignored, setIgnored] = useState(() => new Set(props.ignored ?? []));
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  /** Meniul deschis al unui mesaj: reacțiile sau meniul „⋯”. */
  const [menu, setMenu] = useState<{ kind: "react" | "more"; id: number } | null>(null);
  const [ephemerals, setEphemerals] = useState<{ key: number; e: GcsChatEphemeral }[]>([]);
  const [report, setReport] = useState<number | null>(null);
  const moderation = useChatModeration({ channel: channel.key, viewerId, mod: props.mod, state: props.state });
  const { rights, state } = moderation;
  const mute = state.mute;
  const seesHidden = rights.has("hide");
  const accessCommands = useAccessCommands(moderation.mod.rooms ?? [channel.key]);
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
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const prefsRef = useRef<HTMLDivElement>(null);
  const prefsTrigger = useRef<HTMLButtonElement>(null);
  const prefsId = useId();
  const closeMenu = useCallback(() => setMenu(null), []);
  const closePrefs = useCallback(() => setPrefsOpen(false), []);
  useDismiss(menu?.kind === "more", menuRef, closeMenu, menuTrigger);
  useDismiss(menu?.kind === "react", pickerRef, closeMenu, menuTrigger);
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
      realtime.on("hidden", (data) => setMessages((list) => applyModerationEvent(list, "hidden", data, channel.key, seesHidden) ?? list)),
      realtime.on("purged", (data) => setMessages((list) => applyModerationEvent(list, "purged", data, channel.key, seesHidden) ?? list)),
      realtime.on("resync", () => void reload()),
    ];
    return () => {
      for (const off of offs) off();
      realtime.leave(room);
    };
  }, [realtime, room, channel.key, merge, reload, viewerId, seesHidden]);

  // Scos (kick) sau banat din chat: lista se golește și camera live se părăsește pe loc.
  const blocked = state.block !== null;
  useEffect(() => {
    if (!blocked) return;
    setMessages([]);
    realtime.leave(room);
  }, [blocked, realtime, room]);
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    // Sancțiunea ridicată: mesajele revin.
    if (wasBlocked.current && !blocked) void reload();
    wasBlocked.current = blocked;
  }, [blocked, reload]);

  // `?m=<id>`: mesajul căutat apare în vedere, evidențiat.
  useEffect(() => {
    if (!props.focusId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${props.focusId}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.classList.add("gcs-chat__msg--focus");
  }, []);

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

  const send = async (body: string, files: string[], mentions: GcsMentionHint[]): Promise<boolean> => {
    const res = await sendChatMessage({ channel: channel.key, body, files, mentions });
    if (!res.ok) {
      setError(message(res.error));
      return false;
    }
    setError(null);
    // O comandă de moderare (`/acces`): rezultatul îl vede doar autorul, sub mesaje.
    const eph = res.data.ephemeral;
    if (eph) {
      setEphemerals((list) => [...list, { key: Date.now(), e: eph }].slice(-3));
      return true;
    }
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

  const muted = mute !== null || !channel.canWrite || blocked;
  const canReact = viewerId !== null && !muted;
  const visible = messages.filter((m) => !m.author || !ignored.has(m.author.id));
  const shown = top ? [...visible].reverse() : visible;
  const hideAvatars = config.hideAvatars || !avatars;
  const hasRules = config.rulesHtml !== "";

  const composerEl = (
    <GcsChatComposer
      ref={composer}
      channel={channel.key}
      disabled={muted}
      busy={pending}
      config={config}
      labels={{ placeholder: labels.placeholder, send: labels.send, input: labels.input }}
      placement={top ? "below" : "above"}
      commands={moderation.mod.canGrant ? accessCommands : undefined}
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
  const tool = (label: string, icon: GcsIconSvgProps["icon"], onClick: () => void, extra: { expanded?: boolean; trigger?: boolean; testId?: string } = {}) => (
    <button
      type="button"
      className="gcs-chat__toolBtn gcs-sweep"
      {...(extra.testId ? { "data-testid": extra.testId } : {})}
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
      {...moderation.rootAttrs}
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
          {pinned.author && <GcsMemberName userId={pinned.author.id} name={pinned.author.name} nameKey={pinned.author.nameKey} href={memberHref(pinned.author)} />}
          <span className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: pinned.html }} />
          {rights.has("pin") && (
            <button type="button" className="gcs-linkButton" onClick={() => run(() => pinChatMessage({ channel: channel.key, id: null }), () => setPinned(null))}>
              {labels.unpin}
            </button>
          )}
        </div>
      )}
      {blocked && state.block && <GcsChatBlocked block={state.block} />}
      {top && !blocked && composerEl}
      {!top && !blocked && olderButton}
      <ol
        ref={listRef}
        className="gcs-chat__list"
        data-gcs-gallery="chat"
        style={compact ? undefined : { height: config.minHeight }}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={onScroll}
      >
        {shown.length === 0 && !blocked && <li className="gcs-chat__empty">{labels.empty}</li>}
        {shown.map((m) => {
          if (m.system) return <GcsChatSystemLine key={m.id} m={m as GcsChatMessageView & { system: GcsSystemLineData }} time={time(m.createdAt)} deletedMember={labels.deletedMember} />;
          const own = viewerId !== null && m.author?.id === viewerId;
          const canEdit = own && !muted && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
          const author = m.author;
          const open = menu?.id === m.id ? menu.kind : null;
          return (
            <li
              key={m.id}
              className={`gcs-chat__msg${own ? " gcs-chat__msg--own" : ""}${m.hidden ? " gcs-chat__msg--hidden" : ""}`}
              data-testid="gcs-chat-msg"
              data-message-id={m.id}
              data-gcs-caption-author={author?.name ?? labels.deletedMember}
              data-gcs-caption-date={m.createdAt}
            >
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
                    <GcsMemberName
                      userId={author.id}
                      name={author.name}
                      nameKey={author.nameKey}
                      className="gcs-chat__name"
                      title={t("mentionHint", { name: author.name })}
                      disabled={muted}
                      onClick={() => composer.current?.mention(author.name)}
                      data-testid="gcs-chat-name"
                    />
                  ) : (
                    <span className="gcs-deletedMember" data-testid="gcs-deleted-member">
                      {labels.deletedMember}
                    </span>
                  )}
                  <time className="gcs-chat__time" dateTime={m.createdAt} suppressHydrationWarning>
                    {time(m.createdAt)}
                  </time>
                  {m.editedAt && <span className="gcs-chat__edited">({labels.edited})</span>}
                  <GcsChatHiddenTag m={m} />
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
                {open === "react" && (
                  <span ref={pickerRef} className="gcs-chat__pickerList" role="group" aria-label={labels.react}>
                    {reactions.map((r) => (
                      <button key={r.id} type="button" className="gcs-sweep" title={r.label} aria-label={r.label} onClick={() => react(m.id, r.id)}>
                        {r.symbol}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <span className={`gcs-chat__tools${open !== null ? " gcs-chat__tools--open" : ""}`}>
                {canReact &&
                  reactions.length > 0 &&
                  tool(labels.react, faFaceSmile, () => setMenu(open === "react" ? null : { kind: "react", id: m.id }), { expanded: open === "react", trigger: open === "react" })}
                {viewerId !== null && tool(ts("more"), faEllipsis, () => setMenu(open === "more" ? null : { kind: "more", id: m.id }), { expanded: open === "more", trigger: open === "more", testId: "gcs-chat-more" })}
                {open === "more" && (
                  <div className="gcs-chatMod__anchor">
                    <GcsChatModMenu
                      panelRef={menuRef}
                      m={m}
                      own={own}
                      channel={channel.key}
                      mod={moderation.mod}
                      canEditOwn={canEdit}
                      onClose={closeMenu}
                      on={{
                        ...(canReact && reactions.length > 0 ? { react: () => setMenu({ kind: "react", id: m.id }) } : {}),
                        ...(m.body && editing?.id !== m.id ? { edit: () => setEditing({ id: m.id, body: m.body }) } : {}),
                        pin: () => run(() => pinChatMessage({ channel: channel.key, id: m.id }), () => setPinned(m)),
                        remove: () => run(() => deleteChatMessage({ id: m.id }), () => setMessages((list) => list.filter((x) => x.id !== m.id))),
                        hide: (hidden) => hideMessage(m.id, hidden, (e) => setError(message(e))),
                        ...(author && !own ? { ignore: () => run(() => ignoreChatUser({ userId: author.id, ignore: true }), () => setIgnored((s) => new Set(s).add(author.id))), report: () => setReport(m.id) } : {}),
                        open: (kind, preset) => author && moderation.open(kind, { userId: author.id, name: author.name, messageId: m.id, body: m.body }, preset),
                        card: () => author && moderation.openCard({ userId: author.id, name: author.name, messageId: m.id }),
                      }}
                    />
                  </div>
                )}
              </span>
            </li>
          );
        })}
        {ephemerals.map((x) => (
          <GcsChatEphemeralLine key={x.key} e={x.e} onDismiss={() => setEphemerals((list) => list.filter((y) => y.key !== x.key))} />
        ))}
        {top && hasOlder && <li className="gcs-chat__olderRow">{olderButton}</li>}
      </ol>
      {slow > 0 && (
        <p className="gcs-chat__note" data-testid="gcs-chat-slownote">
          {labels.slowMode.replace("{seconds}", String(slow))}
        </p>
      )}
      {state.slowSeconds > 0 && !blocked && (
        <p className="gcs-chat__note" data-testid="gcs-chat-slowuser">
          <GcsIconSvg icon={faGaugeSimple} /> {ts("slowNote", { seconds: state.slowSeconds })}
        </p>
      )}
      {blocked ? null : mute ? <GcsChatMutedNote mute={mute} remaining={moderation.remaining} /> : !channel.canWrite && <p className="gcs-chat__note">{labels.readOnly}</p>}
      {!top && !blocked && composerEl}
      {error && (
        <p role="alert" className="gcs-chat__note gcs-chat__note--warn">
          {error}
        </p>
      )}
      {moderation.nodes}
      {report !== null && <GcsChatReportDialog id={report} onClose={() => setReport(null)} />}
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
