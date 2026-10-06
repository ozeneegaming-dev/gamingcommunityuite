"use client";

import type { GcsChatAnnouncementView, GcsChatMessageView, GcsChatReactionCount } from "@gcs/modules";
import { GcsButton, GcsUserLink } from "@gcs/ui";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import {
  deleteChatMessage,
  editChatMessage,
  loadChatMessages,
  muteChatUser,
  pinChatMessage,
  reactChatMessage,
  sendChatMessage,
} from "../../chat-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

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
  /** Shoutbox-ul: fără „Mai vechi”, înălțime mică. */
  compact?: boolean;
};

const POLL_MS = 30_000;
const MAX_KEPT = 200;
const EDIT_WINDOW_MS = 5 * 60_000;

/**
 * Un canal de chat (shoutbox-ul paginii principale și `/chat`): mesajele randate pe server, apoi live din `chat:{cheie}`
 * (mesaje noi, editări, ștergeri, reacții, mesajul fixat, anunțurile globale). Fără conexiune live, lista se
 * reîncarcă la 30 s.
 */
export function GcsChatRoom(props: Props) {
  const { channel, initial, canModerate, canAnnounce = false, viewerId, reactions, mute, labels, compact } = props;
  const [messages, setMessages] = useState(initial);
  const [pinned, setPinned] = useState(props.pinned ?? null);
  const [announcements, setAnnouncements] = useState(props.announcements ?? []);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(channel.slowModeSeconds);
  const [hasOlder, setHasOlder] = useState(!compact && initial.length >= 30);
  const [pending, start] = useTransition();
  const realtime = useRealtime();
  const message = useErrorMessage();
  const listRef = useRef<HTMLOListElement>(null);
  const room = `chat:${channel.key}`;
  const symbols = new Map(reactions.map((r) => [r.id, r]));

  const merge = useCallback((incoming: GcsChatMessageView[]) => {
    setMessages((list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...m, mine: m.mine.length > 0 ? m.mine : (byId.get(m.id)?.mine ?? []) });
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_KEPT);
    });
  }, []);

  const reload = useCallback(async () => {
    const res = await loadChatMessages({ channel: channel.key });
    if (res.ok) setMessages(res.data);
  }, [channel.key]);

  useEffect(() => {
    void realtime.join(room);
    const offs = [
      realtime.on("message", (data) => {
        const m = data as GcsChatMessageView;
        if (m?.channel === channel.key) merge([m]);
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
  }, [realtime, room, channel.key, merge, reload]);

  // Fără live: reîncărcare periodică.
  useEffect(() => {
    if (realtime.connected) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [realtime.connected, reload]);

  // Derulează la ultimul mesaj când apare unul nou (doar dacă viewer-ul era deja jos).
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const run = (fn: () => Promise<{ ok: boolean; error?: unknown }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(message((res as { error: Parameters<typeof message>[0] }).error));
      else {
        setError(null);
        after?.();
      }
    });

  const send = () => {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const res = await sendChatMessage({ channel: channel.key, body });
      if (!res.ok) {
        setError(message(res.error));
        return;
      }
      setError(null);
      setText("");
      merge([res.data]);
    });
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
      setPicker(null);
      const res = await reactChatMessage({ id, reactionId });
      if (!res.ok) return setError(message(res.error));
      setMessages((list) =>
        list.map((m) =>
          m.id === id ? { ...m, reactions: res.data, mine: m.mine.includes(reactionId) ? m.mine.filter((r) => r !== reactionId) : [...m.mine, reactionId] } : m,
        ),
      );
    });

  const older = () =>
    start(async () => {
      const first = messages[0];
      if (!first) return;
      const res = await loadChatMessages({ channel: channel.key, before: first.id });
      if (!res.ok) return;
      if (res.data.length < 30) setHasOlder(false);
      setMessages((list) => [...res.data, ...list]);
    });

  const blocked = mute !== null || !channel.canWrite;
  const canReact = viewerId !== null && !blocked;
  return (
    <div className={`gcs-chat${compact ? " gcs-chat--compact" : ""}`} data-testid={`gcs-chat-${channel.key}`}>
      {announcements.map((a) => (
        <p key={a.id} className="gcs-chat__announcement" role="note" data-testid="gcs-chat-announcement">
          <strong>{labels.announcement}</strong> {a.body}
        </p>
      ))}
      {pinned && (
        <div className="gcs-chat__pinned" data-testid="gcs-chat-pinned">
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
      {hasOlder && (
        <GcsButton variant="ghost" onClick={older} disabled={pending}>
          {labels.older}
        </GcsButton>
      )}
      <ol ref={listRef} className="gcs-chat__list" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <li className="gcs-chat__empty">{labels.empty}</li>}
        {messages.map((m) => {
          const own = viewerId !== null && m.author?.id === viewerId;
          const canEdit = own && !blocked && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
          return (
            <li key={m.id} className="gcs-chat__msg" data-testid="gcs-chat-msg" data-message-id={m.id}>
              {m.author ? (
                <GcsUserLink userId={m.author.id} name={m.author.name} nameKey={m.author.nameKey} href={memberHref(m.author)} />
              ) : (
                <span className="gcs-muted">—</span>
              )}
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
                    maxLength={500}
                    autoFocus
                    onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <GcsButton type="submit" variant="primary" size="sm" disabled={pending || !editing.body.trim()}>
                    {labels.save}
                  </GcsButton>
                  <GcsButton type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    {labels.cancel}
                  </GcsButton>
                </form>
              ) : (
                <span className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: m.html }} />
              )}
              {m.editedAt && <span className="gcs-chat__edited">({labels.edited})</span>}
              <time className="gcs-chat__time" dateTime={m.createdAt}>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
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
              <span className="gcs-chat__tools">
                {canReact && reactions.length > 0 && (
                  <span className="gcs-chat__picker">
                    <button type="button" className="gcs-linkButton" aria-expanded={picker === m.id} onClick={() => setPicker(picker === m.id ? null : m.id)}>
                      {labels.react}
                    </button>
                    {picker === m.id && (
                      <span className="gcs-chat__pickerList" role="group" aria-label={labels.react}>
                        {reactions.map((r) => (
                          <button key={r.id} type="button" title={r.label} aria-label={r.label} onClick={() => react(m.id, r.id)}>
                            {r.symbol}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
                {canEdit && editing?.id !== m.id && (
                  <button type="button" className="gcs-linkButton" onClick={() => setEditing({ id: m.id, body: m.body })}>
                    {labels.edit}
                  </button>
                )}
                {canAnnounce && !compact && (
                  <button type="button" className="gcs-linkButton" onClick={() => run(() => pinChatMessage({ channel: channel.key, id: m.id }), () => setPinned(m))}>
                    {labels.pin}
                  </button>
                )}
                {canModerate && (
                  <>
                    <button type="button" className="gcs-linkButton" onClick={() => run(() => deleteChatMessage({ id: m.id }))}>
                      {labels.delete}
                    </button>
                    {m.author && !own && (
                      <button type="button" className="gcs-linkButton" onClick={() => run(() => muteChatUser({ userId: m.author!.id, channel: channel.key, minutes: 10, reason: "" }))}>
                        {labels.mute}
                      </button>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {slow > 0 && <p className="gcs-chat__note">{labels.slowMode.replace("{seconds}", String(slow))}</p>}
      {mute ? (
        <p className="gcs-chat__note gcs-chat__note--warn" role="status" data-testid="gcs-chat-muted">
          {labels.muted.replace("{until}", mute.until ? new Date(mute.until).toLocaleString() : "∞").replace("{reason}", mute.reason || "—")}
        </p>
      ) : (
        !channel.canWrite && <p className="gcs-chat__note">{labels.readOnly}</p>
      )}
      <form
        className="gcs-chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="gcs-input"
          aria-label={labels.input}
          placeholder={labels.placeholder}
          maxLength={500}
          value={text}
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          data-testid="gcs-chat-input"
        />
        <GcsButton type="submit" variant="primary" disabled={blocked || pending || !text.trim()}>
          {labels.send}
        </GcsButton>
      </form>
      {error && (
        <p role="alert" className="gcs-chat__note gcs-chat__note--warn">
          {error}
        </p>
      )}
    </div>
  );
}
