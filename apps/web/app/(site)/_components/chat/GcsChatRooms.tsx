"use client";

import type { GcsUserRef } from "@gcs/modules";
import { GcsButton, GcsUserLink } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import { announceChat, createChatRoom, deleteChatRoom, inviteToChatRoom, leaveChatRoom, renameChatRoom } from "../../chat-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

/** Numele din câmpul de invitați: separate prin virgulă sau rând nou. */
const names = (raw: string) =>
  raw
    .split(/[,\n]/)
    .map((n) => n.trim().replace(/^@/, ""))
    .filter(Boolean);

type CreateLabels = { create: string; name: string; type: string; public: string; private: string; invite: string; inviteHint: string; submit: string; cancel: string };

/** „Creează cameră”: numele, tipul (doar cele permise) și invitații (pentru camerele private). */
export function GcsCreateRoom({ canPublic, canPrivate, labels }: { canPublic: boolean; canPrivate: boolean; labels: CreateLabels }) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"PUBLIC" | "PRIVATE">(canPrivate ? "PRIVATE" : "PUBLIC");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canPublic && !canPrivate) return null;
  if (!open) {
    return (
      <GcsButton variant="primary" size="sm" onClick={() => setOpen(true)} data-testid="gcs-chat-create">
        {labels.create}
      </GcsButton>
    );
  }
  const submit = () =>
    start(async () => {
      const res = await createChatRoom({ name, type, invite: type === "PRIVATE" ? names(invite) : [] });
      if (!res.ok) return setError(errorMessage(res.error));
      setOpen(false);
      router.push(`/chat?c=${res.data.key}`);
      router.refresh();
    });
  return (
    <form
      className="gcs-chatRooms__create"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="gcs-chat-create-form"
    >
      <label className="gcs-field">
        {labels.name}
        <input className="gcs-input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={50} autoFocus />
      </label>
      <fieldset className="gcs-chatRooms__types">
        <legend>{labels.type}</legend>
        {canPublic && (
          <label className="gcs-check">
            <input type="radio" name="room-type" checked={type === "PUBLIC"} onChange={() => setType("PUBLIC")} />
            {labels.public}
          </label>
        )}
        {canPrivate && (
          <label className="gcs-check">
            <input type="radio" name="room-type" checked={type === "PRIVATE"} onChange={() => setType("PRIVATE")} />
            {labels.private}
          </label>
        )}
      </fieldset>
      {type === "PRIVATE" && (
        <label className="gcs-field">
          {labels.invite}
          <input className="gcs-input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={labels.inviteHint} />
        </label>
      )}
      {error && (
        <p role="alert" className="gcs-chat__note gcs-chat__note--warn">
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <GcsButton type="submit" variant="primary" size="sm" disabled={pending || name.trim().length < 2}>
          {labels.submit}
        </GcsButton>
        <GcsButton type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {labels.cancel}
        </GcsButton>
      </div>
    </form>
  );
}

type ToolsLabels = { rename: string; invite: string; inviteHint: string; leave: string; delete: string; confirmDelete: string; save: string; cancel: string; done: string };

/** Uneltele camerei: redenumire și ștergere (proprietarul / staff-ul), invitații (private), ieșire (membrii). */
export function GcsRoomTools(props: { channel: string; name: string; isPrivate: boolean; canManage: boolean; canLeave: boolean; labels: ToolsLabels }) {
  const { channel, isPrivate, canManage, canLeave, labels } = props;
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<"rename" | "invite" | "delete" | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: unknown }>, after: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setStatus(errorMessage((res as { error: Parameters<typeof errorMessage>[0] }).error));
      setStatus(labels.done);
      setMode(null);
      setValue("");
      after();
    });
  if (!canManage && !canLeave) return null;
  return (
    <div className="gcs-chatRoomTools" data-testid="gcs-chat-room-tools">
      <div className="gcs-chatRoomTools__buttons">
        {canManage && (
          <GcsButton variant="ghost" size="sm" onClick={() => (setMode(mode === "rename" ? null : "rename"), setValue(props.name))}>
            {labels.rename}
          </GcsButton>
        )}
        {canManage && isPrivate && (
          <GcsButton variant="ghost" size="sm" onClick={() => (setMode(mode === "invite" ? null : "invite"), setValue(""))} data-testid="gcs-chat-invite">
            {labels.invite}
          </GcsButton>
        )}
        {canLeave && (
          <GcsButton variant="ghost" size="sm" onClick={() => run(() => leaveChatRoom({ channel }), () => (router.push("/chat"), router.refresh()))}>
            {labels.leave}
          </GcsButton>
        )}
        {canManage && (
          <GcsButton variant="ghost" size="sm" onClick={() => setMode(mode === "delete" ? null : "delete")}>
            {labels.delete}
          </GcsButton>
        )}
      </div>
      {mode === "rename" || mode === "invite" ? (
        <form
          className="gcs-chat__edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "rename") run(() => renameChatRoom({ channel, name: value.trim() }), () => router.refresh());
            else run(() => inviteToChatRoom({ channel, users: names(value) }), () => router.refresh());
          }}
        >
          <input
            className="gcs-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={mode === "rename" ? labels.rename : labels.invite}
            placeholder={mode === "invite" ? labels.inviteHint : undefined}
            autoFocus
          />
          <GcsButton type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>
            {labels.save}
          </GcsButton>
          <GcsButton type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
            {labels.cancel}
          </GcsButton>
        </form>
      ) : null}
      {mode === "delete" && (
        <p className="gcs-chat__note gcs-chat__note--warn">
          {labels.confirmDelete}{" "}
          <GcsButton variant="primary" size="sm" onClick={() => run(() => deleteChatRoom({ channel }), () => (router.push("/chat"), router.refresh()))} disabled={pending}>
            {labels.delete}
          </GcsButton>
        </p>
      )}
      {status && (
        <p role="status" className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          {status}
        </p>
      )}
    </div>
  );
}

/** Lista celor online din cameră: inițial de pe server, apoi live (evenimentul `readers` al camerei). */
export function GcsChatOnline({ channel, initial, title, nobody }: { channel: string; initial: GcsUserRef[]; title: string; nobody: string }) {
  const realtime = useRealtime();
  const [users, setUsers] = useState(initial);
  useEffect(
    () =>
      realtime.on("readers", (data) => {
        const d = data as { channel?: string; users?: GcsUserRef[] } | null;
        if (d?.channel === channel) setUsers(d.users ?? []);
      }),
    [realtime, channel],
  );
  return (
    <section className="gcs-card gcs-sideCard" aria-label={title} data-testid="gcs-chat-online">
      <h2 className="gcs-display gcs-sideCard__title">
        {title} <span className="gcs-muted">({users.length})</span>
      </h2>
      {users.length === 0 ? (
        <p className="gcs-sideCard__line">{nobody}</p>
      ) : (
        <ul className="gcs-recentList">
          {users.map((u) => (
            <li key={u.id}>
              <GcsUserLink userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Anunț global (staff): textul și durata în ore (gol = până la ștergere). */
export function GcsAnnounceForm({ labels }: { labels: { title: string; body: string; hours: string; submit: string; done: string } }) {
  const errorMessage = useErrorMessage();
  const [body, setBody] = useState("");
  const [hours, setHours] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="gcs-card gcs-sideCard"
      aria-label={labels.title}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const h = Number(hours);
          const res = await announceChat({ body: body.trim(), minutes: hours && h > 0 ? Math.round(h * 60) : null });
          if (!res.ok) return setStatus(errorMessage(res.error));
          setBody("");
          setStatus(labels.done);
        });
      }}
      data-testid="gcs-chat-announce"
    >
      <h2 className="gcs-display gcs-sideCard__title">{labels.title}</h2>
      <label className="gcs-field">
        {labels.body}
        <input className="gcs-input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
      </label>
      <label className="gcs-field">
        {labels.hours}
        <input className="gcs-input" type="number" min={1} max={8760} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <GcsButton type="submit" variant="primary" size="sm" disabled={pending || !body.trim()}>
        {labels.submit}
      </GcsButton>
      {status && (
        <p role="status" className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          {status}
        </p>
      )}
    </form>
  );
}
