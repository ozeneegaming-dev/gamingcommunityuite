"use client";

import { faBell, faFloppyDisk, faLockOpen, faRightFromBracket, faShieldHalved, faTrash } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { GcsEditor, type GcsEditorHandle, type GcsEditorTool } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { TwoFactorSetup } from "../../../admin/(auth)/2fa-setup/TwoFactorSetup";
import { revokeOtherSessions, revokeSession, saveAlertPrefs, saveSignature, setTimezone } from "../../settings-actions";
import { useEditorLabels } from "../topic/useEditorLabels";

/** Starea comună a formularelor: rulează acțiunea, arată „Salvat.” sau eroarea tradusă. */
function useRun(saved: string) {
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<GcsResult<unknown>>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setStatus(res.ok ? { ok: true, text: saved } : { ok: false, text: errorMessage(res.error) });
      if (res.ok) after?.();
    });
  const message = status && (
    <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"} style={{ margin: 0 }}>
      {status.text}
    </p>
  );
  return { run, pending, message };
}

/** Fusul orar: lista IANA a runtime-ului, cu cel curent preselectat. */
export function GcsTimezoneForm({ current, zones, labels }: { current: string; zones: string[]; labels: { timezone: string; save: string; saved: string } }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const { run, pending, message } = useRun(labels.saved);
  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setTimezone({ timezone: value }), () => router.refresh());
      }}
    >
      <label className="gcs-field">
        {labels.timezone}
        <select className="gcs-input" value={value} onChange={(e) => setValue(e.target.value)} data-testid="gcs-timezone">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending}>
        {labels.save}
      </GcsButton>
      {message}
    </form>
  );
}

/** Toast-urile și sunetul notificărilor. */
export function GcsAlertPrefsForm({ toasts, sound, labels }: { toasts: boolean; sound: boolean; labels: { title: string; toasts: string; sound: string; save: string; saved: string } }) {
  const [t, setT] = useState(toasts);
  const [s, setS] = useState(sound);
  const { run, pending, message } = useRun(labels.saved);
  return (
    <form
      className="gcs-settingsForm"
      aria-label={labels.title}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAlertPrefs({ toasts: t, sound: s }));
      }}
      data-testid="gcs-alert-prefs"
    >
      <h3 className="gcs-settingsSubtitle">
        <GcsIconSvg icon={faBell} className="gcs-hIcon" />
        {labels.title}
      </h3>
      <label className="gcs-check">
        <input type="checkbox" checked={t} onChange={(e) => setT(e.target.checked)} />
        {labels.toasts}
      </label>
      <label className="gcs-check">
        <input type="checkbox" checked={s} onChange={(e) => setS(e.target.checked)} />
        {labels.sound}
      </label>
      <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending}>
        {labels.save}
      </GcsButton>
      {message}
    </form>
  );
}

export type GcsSessionView = { id: string; current: boolean; device: string; ip: string | null; lastSeen: string };

/** Sesiunile active: dispozitivul, IP-ul, ultima activitate; „Deconectează” pentru celelalte sesiuni. */
export function GcsSessionsList({
  sessions,
  labels,
}: {
  sessions: GcsSessionView[];
  labels: { current: string; revoke: string; revokeOthers: string; lastSeen: string; done: string };
}) {
  const router = useRouter();
  const { run, pending, message } = useRun(labels.done);
  return (
    <div className="gcs-settingsForm">
      <ul className="gcs-sessionList" data-testid="gcs-sessions">
        {sessions.map((s) => (
          <li key={s.id} className="gcs-sessionList__item" data-testid="gcs-session">
            <div>
              <strong>{s.device}</strong>
              {s.current && <span className="gcs-badge gcs-badge--accent">{labels.current}</span>}
              <span className="gcs-muted">
                {s.ip ?? "—"} · {labels.lastSeen.replace("{date}", s.lastSeen)}
              </span>
            </div>
            {!s.current && (
              <GcsButton icon={<GcsIconSvg icon={faRightFromBracket} />} variant="ghost" size="sm" disabled={pending} onClick={() => run(() => revokeSession({ id: s.id }), () => router.refresh())}>
                {labels.revoke}
              </GcsButton>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <GcsButton icon={<GcsIconSvg icon={faRightFromBracket} />} variant="ghost" disabled={pending} onClick={() => run(() => revokeOtherSessions({}), () => router.refresh())}>
          {labels.revokeOthers}
        </GcsButton>
      )}
      {message}
    </div>
  );
}

/** 2FA pentru membri: activarea (QR + coduri de rezervă + confirmare) sau dezactivarea cu parola contului. */
export function GcsTwoFactorSettings({
  enabled,
  hasPassword,
  labels,
}: {
  enabled: boolean;
  hasPassword: boolean;
  labels: { enabled: string; disabled: string; enable: string; disable: string; password: string; wrongPassword: string };
}) {
  const [setup, setSetup] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (enabled) {
    return (
      <form
        className="gcs-settingsForm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const { error: err } = await authClient.twoFactor.disable(hasPassword ? { password } : {});
            if (err) return setError(labels.wrongPassword);
            window.location.assign("/settings/security");
          });
        }}
      >
        <p className="gcs-notice" style={{ margin: 0 }} data-testid="gcs-2fa-status">
          {labels.enabled}
        </p>
        {hasPassword && (
          <label className="gcs-field">
            {labels.password}
            <input className="gcs-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        )}
        {error && (
          <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <GcsButton icon={<GcsIconSvg icon={faLockOpen} />} type="submit" variant="ghost" disabled={pending}>
          {labels.disable}
        </GcsButton>
      </form>
    );
  }
  return (
    <div className="gcs-settingsForm">
      <p className="gcs-muted" style={{ margin: 0 }} data-testid="gcs-2fa-status">
        {labels.disabled}
      </p>
      {setup ? (
        <TwoFactorSetup askPassword={hasPassword} doneHref="/settings/security" />
      ) : (
        <GcsButton icon={<GcsIconSvg icon={faShieldHalved} />} variant="primary" onClick={() => setSetup(true)} data-testid="gcs-2fa-enable">
          {labels.enable}
        </GcsButton>
      )}
    </div>
  );
}

/** Bara de unelte a semnăturii (specul `2026-10-07-editor-campuri`): formatarea, linkul, imaginea din adresă, emoji. */
const SIGNATURE_TOOLS: GcsEditorTool[] = ["bold", "italic", "underline", "strike", "color", "size", "align", "clear", "link", "image", "emoji"];

/**
 * Semnătura: editorul compact (schema semnăturii din `@gcs/core/rich-fields`), cu limita de caractere și imaginile din
 * adrese (dacă sunt permise); „Șterge” o scoate. Fără drept de semnătură (grupul / site-ul), doar mesajul și „Șterge”.
 */
export function GcsSignatureForm({
  initial,
  maxLength,
  maxImages,
  hasSignature,
  labels,
}: {
  initial: JSONContent | null;
  maxLength: number;
  maxImages: number;
  hasSignature: boolean;
  labels: { save: string; remove: string; saved: string; hint: string; disabled: string; label: string };
}) {
  const editorLabels = useEditorLabels();
  const editor = useRef<GcsEditorHandle>(null);
  const router = useRouter();
  const { run, pending, message } = useRun(labels.saved);
  const disabled = maxLength <= 0;
  const remove = (
    <GcsButton icon={<GcsIconSvg icon={faTrash} />}
      variant="ghost"
      disabled={pending}
      onClick={() =>
        run(
          () => saveSignature({ content: null }),
          () => {
            editor.current?.clear();
            router.refresh();
          },
        )
      }
    >
      {labels.remove}
    </GcsButton>
  );
  if (disabled) {
    return (
      <div className="gcs-settingsForm" data-testid="gcs-signature-form">
        <p className="gcs-notice" style={{ margin: 0 }} data-testid="gcs-signature-disabled">
          {labels.disabled}
        </p>
        {hasSignature && <div>{remove}</div>}
        {message}
      </div>
    );
  }
  return (
    <div className="gcs-settingsForm" data-testid="gcs-signature-form">
      <p className="gcs-muted" style={{ margin: 0 }}>
        {labels.hint}
      </p>
      <span id="gcs-signature-label" className="gcs-srOnly">
        {labels.label}
      </span>
      <GcsEditor
        ref={editor}
        id="gcs-signature-editor"
        className="gcs-editor--signature"
        labels={editorLabels}
        forumId={0}
        initialContent={initial}
        maxLength={maxLength}
        compact
        allow={GCS_RICH_FIELDS.signature}
        tools={SIGNATURE_TOOLS}
        imageUrl={maxImages > 0}
        labelledBy="gcs-signature-label"
      />
      <div style={{ display: "flex", gap: 8 }}>
        <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />}
          variant="primary"
          disabled={pending}
          onClick={() => run(() => saveSignature({ content: editor.current?.isEmpty() ? null : (editor.current?.getJSON() ?? null) }), () => router.refresh())}
        >
          {labels.save}
        </GcsButton>
        {remove}
      </div>
      {message}
    </div>
  );
}
