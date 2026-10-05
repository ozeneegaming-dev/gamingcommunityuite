"use client";

import { GcsButton } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { inviteToConversation, leaveConversation, replyToConversation, reportMessage, startConversation } from "../../messages-actions";
import { useEditorLabels } from "../topic/useEditorLabels";

type Picked = { id: string; name: string };

/** Destinatari: „chip”-uri + căutare după nume (sugestiile din `/api/forums/mentions`). */
export function GcsUserPicker({ value, onChange, label, placeholder, removeLabel }: { value: Picked[]; onChange: (v: Picked[]) => void; label: string; placeholder: string; removeLabel: string }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Picked[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ users: Picked[] }>)
        .then((d) => setOptions(d.users.filter((u) => !value.some((v) => v.id === u.id))))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, value]);
  const add = (u: Picked) => {
    onChange([...value, u]);
    setQ("");
    setOptions([]);
  };
  const visible = q.trim().length >= 2 ? options : [];
  return (
    <div className="gcs-field">
      <label htmlFor="gcs-pick-user">{label}</label>
      <div className="gcs-userPicker">
        {value.map((u) => (
          <span key={u.id} className="gcs-chip" data-testid="gcs-recipient">
            {u.name}
            <button type="button" aria-label={`${removeLabel} ${u.name}`} onClick={() => onChange(value.filter((v) => v.id !== u.id))}>
              ×
            </button>
          </span>
        ))}
        <input
          id="gcs-pick-user"
          className="gcs-userPicker__input"
          value={q}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls="gcs-pick-user-list"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && visible[0]) {
              e.preventDefault();
              add(visible[0]);
            }
          }}
        />
      </div>
      {visible.length > 0 && (
        <ul id="gcs-pick-user-list" role="listbox" className="gcs-userPicker__list">
          {visible.map((u) => (
            <li key={u.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => add(u)}>
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type NewLabels = { to: string; toPlaceholder: string; remove: string; title: string; send: string; sending: string };

export function GcsNewConversationForm({ initial, labels }: { initial: Picked[]; labels: NewLabels }) {
  const router = useRouter();
  const editorLabels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const [to, setTo] = useState(initial);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      if (!editor.current || editor.current.isEmpty()) return;
      const res = await startConversation({ to: to.map((u) => u.id), title, content: editor.current.getJSON() });
      if (!res.ok) {
        const user = res.error.params?.user;
        setError(user ? `${errorMessage(res.error)} (${user})` : errorMessage(res.error));
        return;
      }
      editor.current.clear();
      router.push(`/messages/${res.data.conversationId}`);
    });

  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <GcsUserPicker value={to} onChange={setTo} label={labels.to} placeholder={labels.toPlaceholder} removeLabel={labels.remove} />
      <div className="gcs-field">
        <label htmlFor="gcs-conversation-title">{labels.title}</label>
        <input id="gcs-conversation-title" className="gcs-input" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <GcsEditor
        ref={editor}
        id="gcs-message-editor"
        labels={editorLabels}
        forumId={0}
        uploadUrl="/api/messages/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey="pm-new"
        footer={
          <GcsButton type="submit" variant="primary" disabled={pending || to.length === 0}>
            {pending ? labels.sending : labels.send}
          </GcsButton>
        }
      />
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </form>
  );
}

export function GcsConversationReply({ conversationId, labels }: { conversationId: number; labels: { send: string; sending: string; reply: string } }) {
  const router = useRouter();
  const editorLabels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () =>
    startTransition(async () => {
      if (!editor.current || editor.current.isEmpty()) return;
      const res = await replyToConversation({ conversationId, content: editor.current.getJSON() });
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      editor.current.clear();
      setError(null);
      router.refresh();
    });
  return (
    <section aria-label={labels.reply} className="gcs-replyBox">
      <GcsEditor
        ref={editor}
        id="gcs-message-reply"
        labels={editorLabels}
        forumId={0}
        uploadUrl="/api/messages/uploads"
        mentionUrl="/api/forums/mentions"
        draftKey={`pm-${conversationId}`}
        footer={
          <GcsButton variant="primary" onClick={send} disabled={pending}>
            {pending ? labels.sending : labels.send}
          </GcsButton>
        }
      />
      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
    </section>
  );
}

type SideLabels = { invite: string; inviteTo: string; invitePlaceholder: string; remove: string; leave: string; confirmLeave: string; invited: string };

/** Invitarea în conversație și părăsirea ei. */
export function GcsConversationTools({ conversationId, labels }: { conversationId: number; labels: SideLabels }) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await inviteToConversation({ conversationId, userIds: picked.map((u) => u.id) });
            if (!res.ok) {
              const user = res.error.params?.user;
              setStatus({ ok: false, text: user ? `${errorMessage(res.error)} (${user})` : errorMessage(res.error) });
              return;
            }
            setPicked([]);
            setStatus({ ok: true, text: labels.invited });
            router.refresh();
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <GcsUserPicker value={picked} onChange={setPicked} label={labels.inviteTo} placeholder={labels.invitePlaceholder} removeLabel={labels.remove} />
        <GcsButton type="submit" variant="ghost" disabled={pending || picked.length === 0}>
          {labels.invite}
        </GcsButton>
      </form>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"}>
          {status.text}
        </p>
      )}
      <GcsButton
        variant="ghost"
        disabled={pending}
        data-testid="gcs-conversation-leave"
        onClick={() => {
          if (!window.confirm(labels.confirmLeave)) return;
          startTransition(async () => {
            const res = await leaveConversation({ conversationId });
            if (res.ok) router.push("/messages");
            else setStatus({ ok: false, text: errorMessage(res.error) });
          });
        }}
      >
        {labels.leave}
      </GcsButton>
    </div>
  );
}

export function GcsReportMessageButton({ messageId, labels }: { messageId: number; labels: { report: string; reason: string; done: string } }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  if (done) return <span className="gcs-muted">{labels.done}</span>;
  return (
    <button
      type="button"
      className="gcs-linkButton"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt(labels.reason);
        if (!reason || reason.trim().length < 3) return;
        startTransition(async () => {
          const res = await reportMessage({ messageId, reason: reason.trim() });
          if (res.ok) setDone(true);
        });
      }}
    >
      {labels.report}
    </button>
  );
}

/**
 * Header-ul se randează în paralel cu pagina, deci numără conversația ca necitită înainte ca pagina s-o marcheze citită.
 * Dacă era necitită, reîncarcă datele serverului o dată, ca plicul din header să se actualizeze.
 */
export function GcsRefreshAfterRead({ wasUnread }: { wasUnread: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (wasUnread) router.refresh();
  }, [wasUnread, router]);
  return null;
}
