"use client";

import type { GcsChatMessageView } from "@gcs/modules";
import { GcsButton, GcsUserLink } from "@gcs/ui";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatMessage, loadChatMessages, muteChatUser, sendChatMessage } from "../../chat-actions";
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
};

type Props = {
  channel: { key: string; name: string; slowModeSeconds: number; canWrite: boolean };
  initial: GcsChatMessageView[];
  canModerate: boolean;
  /** Mute-ul activ al viewer-ului (motiv și sfârșit; `until: null` = permanent). */
  mute: { reason: string; until: string | null } | null;
  labels: GcsChatRoomLabels;
  /** Shoutbox-ul: fără „Mai vechi”, înălțime mică. */
  compact?: boolean;
};

const POLL_MS = 30_000;
const MAX_KEPT = 200;

/**
 * Un canal de chat (shoutbox-ul paginii principale și `/chat`): mesajele randate pe server, apoi live din `chat:{cheie}`.
 * Fără conexiune live, lista se reîncarcă la 30 s.
 */
export function GcsChatRoom({ channel, initial, canModerate, mute, labels, compact }: Props) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(channel.slowModeSeconds);
  const [hasOlder, setHasOlder] = useState(!compact && initial.length >= 30);
  const [pending, start] = useTransition();
  const realtime = useRealtime();
  const message = useErrorMessage();
  const listRef = useRef<HTMLOListElement>(null);
  const room = `chat:${channel.key}`;

  const merge = useCallback((incoming: GcsChatMessageView[]) => {
    setMessages((list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
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
      realtime.on("deleted", (data) => {
        const id = (data as { id?: number } | null)?.id;
        setMessages((list) => list.filter((m) => m.id !== id));
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

  const older = () =>
    start(async () => {
      const first = messages[0];
      if (!first) return;
      const res = await loadChatMessages({ channel: channel.key, before: first.id });
      if (!res.ok) return;
      if (res.data.length < 30) setHasOlder(false);
      setMessages((list) => [...res.data, ...list]);
    });

  const moderate = (fn: () => Promise<{ ok: boolean; error?: unknown }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(message((res as { error: Parameters<typeof message>[0] }).error));
    });

  const blocked = mute !== null || !channel.canWrite;
  return (
    <div className={`gcs-chat${compact ? " gcs-chat--compact" : ""}`} data-testid={`gcs-chat-${channel.key}`}>
      {hasOlder && (
        <GcsButton variant="ghost" onClick={older} disabled={pending}>
          {labels.older}
        </GcsButton>
      )}
      <ol ref={listRef} className="gcs-chat__list" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <li className="gcs-chat__empty">{labels.empty}</li>}
        {messages.map((m) => (
          <li key={m.id} className="gcs-chat__msg" data-testid="gcs-chat-msg">
            {m.author ? (
              <GcsUserLink userId={m.author.id} name={m.author.name} nameKey={m.author.nameKey} href={memberHref(m.author)} />
            ) : (
              <span className="gcs-muted">—</span>
            )}
            <span className="gcs-chat__body" dangerouslySetInnerHTML={{ __html: m.html }} />
            <time className="gcs-chat__time" dateTime={m.createdAt}>
              {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </time>
            {canModerate && (
              <span className="gcs-chat__tools">
                <button type="button" className="gcs-linkButton" onClick={() => moderate(() => deleteChatMessage({ id: m.id }))}>
                  {labels.delete}
                </button>
                {m.author && (
                  <button
                    type="button"
                    className="gcs-linkButton"
                    onClick={() => moderate(() => muteChatUser({ userId: m.author!.id, channel: channel.key, minutes: 10, reason: "" }))}
                  >
                    {labels.mute}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      {slow > 0 && <p className="gcs-chat__note">{labels.slowMode.replace("{seconds}", String(slow))}</p>}
      {mute ? (
        <p className="gcs-chat__note gcs-chat__note--warn" role="status" data-testid="gcs-chat-muted">
          {labels.muted
            .replace("{until}", mute.until ? new Date(mute.until).toLocaleString() : "∞")
            .replace("{reason}", mute.reason || "—")}
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
