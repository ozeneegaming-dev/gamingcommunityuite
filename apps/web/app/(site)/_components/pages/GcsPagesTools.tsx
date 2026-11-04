"use client";

import { GcsIcon } from "@/lib/pages-icons";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { followPagesDatabase, moderatePagesComment, moderatePagesRecord, restorePagesRecordRevision } from "../../pages-actions";

/** „Urmărește” / „Urmărești” o bază de date (înregistrările noi ajung în notificări). */
export function GcsFollowDatabase({ databaseId, following }: { databaseId: number; following: boolean }) {
  const t = useTranslations("pages");
  const errorMessage = useErrorMessage();
  const [on, setOn] = useState(following);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={`gcs-btn gcs-btn--sm ${on ? "gcs-btn--ghost gcs-btn--on" : "gcs-btn--ghost"}`}
        aria-pressed={on}
        disabled={pending}
        data-testid="gcs-pages-follow"
        onClick={() =>
          start(async () => {
            const res = await followPagesDatabase({ databaseId, follow: !on });
            if (!res.ok) return setError(errorMessage(res.error));
            setOn(res.data.following);
          })
        }
      >
        <GcsIcon name={on ? "fa-solid fa-bell" : "fa-regular fa-bell"} />
        {on ? t("following") : t("follow")}
      </button>
      {error && (
        <span className="gcs-formError" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

type RecordAction = "approve" | "reject" | "hide" | "unhide" | "feature" | "unfeature" | "pin" | "unpin" | "delete";

/**
 * Bara staff-ului pe pagina unei înregistrări: aprobă / respinge (cu motiv) trimiterile, ascunde / arată, recomandă,
 * fixează, șterge (cu confirmare în pagină). Autorul vede doar „Șterge” cât trimiterea lui e în așteptare.
 */
export function GcsRecordModBar({ recordId, status, featured, pinned, moderate, canDelete }: { recordId: number; status: string; featured: boolean; pinned: boolean; moderate: boolean; canDelete: boolean }) {
  const t = useTranslations("pages.mod");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState("");
  const run = (action: RecordAction) =>
    start(async () => {
      setError(null);
      const res = await moderatePagesRecord({ recordId, action, ...(action === "reject" ? { reason } : {}) });
      if (!res.ok) return setError(errorMessage(res.error));
      if (res.data.href) router.push(res.data.href);
      else router.refresh();
      setRejecting(false);
    });
  const btn = (action: RecordAction, icon: string, kind: "primary" | "ghost" = "ghost") => (
    <button type="button" className={`gcs-btn gcs-btn--sm gcs-btn--${kind}`} disabled={pending} onClick={() => run(action)} data-testid={`gcs-pages-mod-${action}`}>
      <GcsIcon name={icon} />
      {t(action)}
    </button>
  );
  return (
    <div className="gcs-card gcs-pgModBar" role="group" aria-label={t("label")} data-testid="gcs-pages-modbar">
      <GcsIcon name="fa-solid fa-shield-halved" className="gcs-pgModBar__icon" />
      {moderate && status === "PENDING" && (
        <>
          {btn("approve", "fa-solid fa-check", "primary")}
          <button type="button" className="gcs-btn gcs-btn--sm gcs-btn--ghost" disabled={pending} onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting} data-testid="gcs-pages-mod-reject-open">
            <GcsIcon name="fa-solid fa-xmark" />
            {t("reject")}
          </button>
        </>
      )}
      {moderate && status === "REJECTED" && btn("approve", "fa-solid fa-check", "primary")}
      {moderate && status === "PUBLISHED" && btn("hide", "fa-solid fa-eye-slash")}
      {moderate && status === "HIDDEN" && btn("unhide", "fa-solid fa-eye")}
      {moderate && btn(featured ? "unfeature" : "feature", featured ? "fa-regular fa-star" : "fa-solid fa-star")}
      {moderate && btn(pinned ? "unpin" : "pin", "fa-solid fa-thumbtack")}
      {canDelete &&
        (confirmDelete ? (
          <span className="gcs-pgModBar__confirm">
            {t("deleteConfirm")}
            {btn("delete", "fa-solid fa-trash")}
            <button type="button" className="gcs-btn gcs-btn--sm gcs-btn--ghost" onClick={() => setConfirmDelete(false)}>
              {t("cancel")}
            </button>
          </span>
        ) : (
          <button type="button" className="gcs-btn gcs-btn--sm gcs-btn--ghost" onClick={() => setConfirmDelete(true)} data-testid="gcs-pages-mod-delete-open">
            <GcsIcon name="fa-solid fa-trash" />
            {t("delete")}
          </button>
        ))}
      {rejecting && (
        <span className="gcs-pgModBar__reject">
          <input className="gcs-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t("reason")} aria-label={t("reason")} data-testid="gcs-pages-reject-reason" />
          {btn("reject", "fa-solid fa-paper-plane")}
        </span>
      )}
      {error && (
        <span className="gcs-formError" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** „Restaurează” o revizie a înregistrării (staff-ul). */
export function GcsRestoreRevision({ revisionId }: { revisionId: number }) {
  const t = useTranslations("pages.revisions");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="gcs-btn gcs-btn--sm gcs-btn--ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await restorePagesRecordRevision({ revisionId });
            if (!res.ok) return setError(errorMessage(res.error));
            router.refresh();
          })
        }
      >
        <GcsIcon name="fa-solid fa-clock-rotate-left" />
        {t("restore")}
      </button>
      {error && <span className="gcs-formError">{error}</span>}
    </>
  );
}

/** Uneltele unui comentariu: aprobă (în așteptare), ascunde / arată (staff), șterge (autorul sau staff). */
export function GcsCommentTools({ commentId, pending: isPending, hidden, staff, canDelete }: { commentId: number; pending: boolean; hidden: boolean; staff: boolean; canDelete: boolean }) {
  const t = useTranslations("pages.mod");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: "hide" | "unhide" | "approve" | "delete") =>
    start(async () => {
      const res = await moderatePagesComment({ commentId, action });
      if (!res.ok) return setError(errorMessage(res.error));
      router.refresh();
    });
  return (
    <span className="gcs-pgComment__tools">
      {staff && isPending && (
        <button type="button" className="gcs-linkBtn" disabled={pending} onClick={() => run("approve")}>
          {t("approve")}
        </button>
      )}
      {staff && (
        <button type="button" className="gcs-linkBtn" disabled={pending} onClick={() => run(hidden ? "unhide" : "hide")}>
          {t(hidden ? "unhide" : "hide")}
        </button>
      )}
      {canDelete && (
        <button type="button" className="gcs-linkBtn" disabled={pending} onClick={() => run("delete")}>
          {t("delete")}
        </button>
      )}
      {error && <span className="gcs-formError">{error}</span>}
    </span>
  );
}
