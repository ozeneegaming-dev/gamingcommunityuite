"use client";

import type { GcsEditorAllow, GcsEditorTool } from "@gcs/ui/editor";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { createTicket, replyTicket } from "../../bridge-actions";
import { GcsRichTextInput } from "../editor/GcsRichTextInput";
import { GcsPlayerPicker, type GcsPickedPlayer } from "./GcsPlayerPicker";

/** Ce acceptă textul unui tichet: același renderer ca postările, fără titluri și video (adrese de imagini https). */
export const TICKET_ALLOW: GcsEditorAllow = {
  nodes: ["paragraph", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule", "hardBreak", "image", "mention"],
  marks: ["bold", "italic", "underline", "strike", "code", "link"],
};
export const TICKET_TOOLS: GcsEditorTool[] = ["bold", "italic", "underline", "strike", "bulletList", "orderedList", "quote", "link", "image", "emoji", "clear"];
const MAX_CHARS = 10_000;

type Kind = "APPEAL" | "CHEATER" | "ADMIN";

export type GcsTicketFormData = {
  sanctions: { id: number; label: string; appealOpen: boolean }[];
  servers: { id: number; name: string }[];
  admins: { id: number; name: string; serverId: number | null }[];
};

/**
 * Contestație / reclamație nouă (specul 2026-10-08-servere-pagini §5): felul, ținta după fel (sancțiunea proprie,
 * jucătorul reclamat sau adminul serverului), titlul, textul (editorul) și dovezile (adrese https).
 */
export function GcsTicketForm({ data, initialKind, initialSanction }: { data: GcsTicketFormData; initialKind: Kind; initialSanction: number | null }) {
  const t = useTranslations("bridge.ticketForm");
  const tf = useTranslations("errors.fields");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [kind, setKind] = useState<Kind>(initialKind);
  const open = data.sanctions.filter((s) => !s.appealOpen);
  const [sanctionId, setSanctionId] = useState<number | null>(initialSanction ?? open[0]?.id ?? null);
  const [serverId, setServerId] = useState<number | null>(data.servers[0]?.id ?? null);
  const [player, setPlayer] = useState<GcsPickedPlayer | null>(null);
  const [targetName, setTargetName] = useState("");
  const admins = data.admins.filter((a) => a.serverId === null || a.serverId === serverId);
  const [adminId, setAdminId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<unknown>("");
  const [evidence, setEvidence] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="gcs-formError" role="alert">
        {tf.has(fieldErrors[key]!) ? tf(fieldErrors[key]!) : fieldErrors[key]}
      </span>
    ) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    const res = await createTicket({
      kind,
      title,
      content,
      evidence: evidence.split(/\s+/).filter(Boolean),
      ...(kind === "APPEAL" ? { sanctionId } : { serverId }),
      ...(kind === "CHEATER" ? { targetPlayerId: player?.id ?? null, targetName: targetName || null } : {}),
      ...(kind === "ADMIN" ? { targetAdminId: adminId ?? admins[0]?.id ?? null } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setFieldErrors(res.error.fields ?? {});
      setError(errorMessage(res.error));
      return;
    }
    router.push(`/servers/tickets/${(res.data as { id: number }).id}`);
  }

  return (
    <form className="gcs-sanctionForm" onSubmit={onSubmit} data-testid="gcs-ticket-form">
      <fieldset className="gcs-sanctionForm__group">
        <legend>{t("kind")}</legend>
        <div className="gcs-optionRow">
          {(["APPEAL", "CHEATER", "ADMIN"] as const).map((k) => (
            <label key={k} className="gcs-option">
              <input type="radio" name={`${uid}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} data-testid={`gcs-ticket-kind-${k}`} />
              <span>{t(`kinds.${k}`)}</span>
              <span className="gcs-option__hint">{t(`kindHints.${k}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="gcs-sanctionForm__group">
        <legend>{t("target")}</legend>
        {kind === "APPEAL" ? (
          data.sanctions.length === 0 ? (
            <p className="gcs-serverNote" data-testid="gcs-ticket-no-sanctions">
              {t("noSanctions")}
            </p>
          ) : (
            <label className="gcs-field">
              <span>{t("sanction")}</span>
              <select className="gcs-input" value={sanctionId ?? ""} onChange={(e) => setSanctionId(e.target.value ? Number(e.target.value) : null)} data-testid="gcs-ticket-sanction">
                {data.sanctions.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.appealOpen}>
                    {s.appealOpen ? t("appealOpen", { label: s.label }) : s.label}
                  </option>
                ))}
              </select>
              {fieldError("sanctionId")}
            </label>
          )
        ) : (
          <>
            <label className="gcs-field" style={{ maxWidth: 360 }}>
              <span>{t("server")}</span>
              <select className="gcs-input" value={serverId ?? ""} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)} data-testid="gcs-ticket-server">
                {data.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {fieldError("serverId")}
            </label>
            {kind === "CHEATER" ? (
              <div className="gcs-formRow">
                <div style={{ flex: "2 1 260px" }}>
                  <GcsPlayerPicker value={player} onChange={setPlayer} label={t("player")} hint={t("playerHint")} testId="gcs-ticket-player" />
                </div>
                <label className="gcs-field" style={{ flex: "1 1 200px" }}>
                  <span>{t("targetName")}</span>
                  <input className="gcs-input" value={targetName} onChange={(e) => setTargetName(e.target.value)} maxLength={32} data-testid="gcs-ticket-target-name" />
                </label>
              </div>
            ) : admins.length === 0 ? (
              <p className="gcs-serverNote">{t("noAdmins")}</p>
            ) : (
              <label className="gcs-field" style={{ maxWidth: 360 }}>
                <span>{t("admin")}</span>
                <select className="gcs-input" value={adminId ?? admins[0]?.id ?? ""} onChange={(e) => setAdminId(Number(e.target.value))} data-testid="gcs-ticket-admin">
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fieldError("target")}
          </>
        )}
      </fieldset>

      <fieldset className="gcs-sanctionForm__group">
        <legend>{t("message")}</legend>
        <label className="gcs-field">
          <span>{t("title")}</span>
          <input className="gcs-input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required data-testid="gcs-ticket-title" />
          {fieldError("title")}
        </label>
        <div className="gcs-field">
          <span id={`${uid}-content`}>{t("content")}</span>
          <GcsRichTextInput initial="" allow={TICKET_ALLOW} tools={TICKET_TOOLS} maxLength={MAX_CHARS} imageUrl compact labelledBy={`${uid}-content`} onValue={setContent} />
          {fieldError("content")}
        </div>
        <label className="gcs-field">
          <span>{t("evidence")}</span>
          <textarea className="gcs-input" rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://" data-testid="gcs-ticket-evidence" />
          <span className="gcs-field__hint">{t("evidenceHint")}</span>
          {fieldError("evidence")}
        </label>
      </fieldset>

      <div className="gcs-formActions">
        <button type="submit" className="gcs-btn gcs-btn--primary" disabled={pending || (kind === "APPEAL" && open.length === 0)} data-testid="gcs-ticket-submit">
          {t("submit")}
        </button>
        {error && (
          <span role="alert" className="gcs-formError">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

/** Răspunsul într-un tichet: textul (editorul) și, pentru cine tratează, „Notă internă”. */
export function GcsTicketReply({ ticketId, canInternal }: { ticketId: number; canInternal: boolean }) {
  const t = useTranslations("bridge.ticket");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [content, setContent] = useState<unknown>("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <form
      className="gcs-ticketReply"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await replyTicket({ ticketId, content, internal });
        setPending(false);
        if (!res.ok) return setError(errorMessage(res.error));
        setContent("");
        setInternal(false);
        setKey((k) => k + 1);
        router.refresh();
      }}
      data-testid="gcs-ticket-reply"
    >
      <span id={`${uid}-label`} className="gcs-srOnly">
        {t("reply")}
      </span>
      <GcsRichTextInput key={key} initial="" allow={TICKET_ALLOW} tools={TICKET_TOOLS} maxLength={MAX_CHARS} imageUrl compact labelledBy={`${uid}-label`} onValue={setContent} />
      <div className="gcs-formActions">
        {canInternal && (
          <label className="gcs-checkRow" data-testid="gcs-ticket-internal">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            {t("internal")}
          </label>
        )}
        <button type="submit" className="gcs-btn gcs-btn--primary" disabled={pending} data-testid="gcs-ticket-reply-submit">
          {internal ? t("sendInternal") : t("send")}
        </button>
        {error && (
          <span role="alert" className="gcs-formError">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
