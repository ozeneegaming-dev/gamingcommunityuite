"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { assignTicket, setTicketStatus } from "../../bridge-actions";

type Status = "OPEN" | "REVIEW" | "ACCEPTED" | "REJECTED" | "CLOSED";

/**
 * Tratarea unui tichet (specul 2026-10-08-servere-pagini §5): stările permise (cu motivul opțional și „Ridică
 * sancțiunea” la acceptarea unei contestații) și responsabilul („Preiau”, „Eliberez” sau alegerea staff-ului). Autorul
 * primește doar „Închide”.
 */
export function GcsTicketControls({
  ticketId,
  transitions,
  canHandle,
  canLift,
  me,
  assigneeId,
  handlers,
}: {
  ticketId: number;
  transitions: Status[];
  canHandle: boolean;
  /** Contestație deschisă cu sancțiunea încă activă, iar actorul o poate ridica. */
  canLift: boolean;
  me: string;
  assigneeId: string | null;
  handlers: { id: string; name: string }[];
}) {
  const t = useTranslations("bridge.ticket");
  const ts = useTranslations("bridge.ticketStatus");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [reason, setReason] = useState("");
  const [lift, setLift] = useState(canLift);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: Parameters<typeof errorMessage>[0] }>) {
    setPending(true);
    setError(null);
    const res = await fn();
    setPending(false);
    if (!res.ok) return setError(res.error ? errorMessage(res.error) : null);
    setReason("");
    router.refresh();
  }

  if (transitions.length === 0 && !canHandle) return null;
  return (
    <div className="gcs-ticketControls" data-testid="gcs-ticket-controls">
      {transitions.length > 0 && (
        <div className="gcs-ticketControls__status">
          {canHandle && (
            <label className="gcs-field">
              <span>{t("statusReason")}</span>
              <input id={`${uid}-reason`} className="gcs-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-testid="gcs-ticket-status-reason" />
            </label>
          )}
          {canLift && transitions.includes("ACCEPTED") && (
            <label className="gcs-checkRow" data-testid="gcs-ticket-lift">
              <input type="checkbox" checked={lift} onChange={(e) => setLift(e.target.checked)} />
              {t("liftOnAccept")}
            </label>
          )}
          <div className="gcs-ticketControls__buttons">
            {transitions.map((s) => (
              <button
                key={s}
                type="button"
                className={`gcs-btn ${s === "ACCEPTED" ? "gcs-btn--primary" : "gcs-btn--ghost"}`}
                disabled={pending}
                data-status={s}
                data-testid={`gcs-ticket-to-${s}`}
                onClick={() => void run(() => setTicketStatus({ ticketId, status: s, lift: s === "ACCEPTED" && canLift && lift, reason }))}
              >
                {t(`to.${s}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {canHandle && (
        <div className="gcs-ticketControls__assign">
          <span className="gcs-ticketControls__label">{t("assignee")}</span>
          {assigneeId !== me ? (
            <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" disabled={pending} onClick={() => void run(() => assignTicket({ ticketId, assigneeId: me }))} data-testid="gcs-ticket-take">
              {t("take")}
            </button>
          ) : (
            <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" disabled={pending} onClick={() => void run(() => assignTicket({ ticketId, assigneeId: null }))} data-testid="gcs-ticket-release">
              {t("release")}
            </button>
          )}
          {handlers.length > 1 && (
            <label className="gcs-field gcs-ticketControls__select">
              <span className="gcs-srOnly">{t("assignTo")}</span>
              <select
                className="gcs-input"
                value={assigneeId ?? ""}
                disabled={pending}
                onChange={(e) => void run(() => assignTicket({ ticketId, assigneeId: e.target.value || null }))}
                data-testid="gcs-ticket-assignee"
              >
                <option value="">{t("nobody")}</option>
                {handlers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="gcs-formError" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <span className="gcs-srOnly" aria-live="polite">
        {pending ? ts("saving") : ""}
      </span>
    </div>
  );
}
