"use client";

import { faStar as faStarEmpty } from "@fortawesome/free-regular-svg-icons";
import { faBan, faBell, faBellSlash, faCheck, faComment, faCrown, faDownload, faEye, faEyeSlash, faFileContract, faLock, faLockOpen, faStar, faTrash, faArrowsUpDownLeftRight } from "@fortawesome/free-solid-svg-icons";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../../admin/(panel)/_components/GcsConfirmDialog";
import {
  commentDownloadAction,
  downloadFlagsAction,
  followDownloadAction,
  moderateDownloadPostAction,
  moveDownloadAction,
  removeDownloadAction,
  reviewDownloadAction,
  reviewVersionAction,
} from "../../download-actions";
import { GcsRichTextInput } from "../editor/GcsRichTextInput";

type Result = { ok: true } | { ok: false; error: Parameters<ReturnType<typeof useErrorMessage>>[0] };

/** O acțiune cu reîmprospătarea paginii și eroarea afișată lângă buton. */
function useRun() {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(errorMessage(res.error));
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

/** Urmărește fișierul (versiunile noi) sau categoria (fișierele noi). */
export function GcsFollowButton({ kind, id, following }: { kind: "file" | "category"; id: number; following: boolean }) {
  const t = useTranslations("downloads.actions");
  const { pending, run } = useRun();
  return (
    <GcsButton variant="ghost" icon={<GcsIconSvg icon={following ? faBellSlash : faBell} />} disabled={pending} onClick={() => run(() => followDownloadAction({ kind, id, follow: !following }))} data-testid={`gcs-download-follow-${kind}`}>
      {following ? t("unfollow") : t(kind === "file" ? "followFile" : "followCategory")}
    </GcsButton>
  );
}

/**
 * Butonul de descărcare al unui fișier: direct sau, dacă categoria are termeni, după acceptarea lor într-un dialog.
 * Linkul (cu tokenul paginii) e o simplă navigare: fișierul vine ca atașament.
 */
export function GcsDownloadButton({ href, name, size, terms, primary = true }: { href: string; name: string; size: string; terms: string; primary?: boolean }) {
  const t = useTranslations("downloads.actions");
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const label = (
    <>
      <GcsIconSvg icon={faDownload} />
      <span className="gcs-dlGet__text">
        <strong>{t("download")}</strong>
        <small>{name} · {size}</small>
      </span>
    </>
  );
  if (!terms) {
    return (
      <a className={`gcs-btn ${primary ? "gcs-btn--primary" : "gcs-btn--ghost"} gcs-dlGet`} href={href} rel="nofollow" data-testid="gcs-download-get">
        {label}
      </a>
    );
  }
  return (
    <>
      <button type="button" className={`gcs-btn ${primary ? "gcs-btn--primary" : "gcs-btn--ghost"} gcs-dlGet`} onClick={() => setOpen(true)} data-testid="gcs-download-get">
        {label}
      </button>
      {open && (
        <GcsModal title={t("termsTitle")} icon={<GcsIconSvg icon={faFileContract} />} closeLabel={t("cancel")} onClose={() => setOpen(false)}>
          <div className="gcs-dlTerms" data-testid="gcs-download-terms-text">{terms}</div>
          <label className="gcs-check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="gcs-download-terms-accept" />
            {t("acceptTerms")}
          </label>
          <div className="gcs-confirmDialog__actions">
            <GcsButton variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</GcsButton>
            {accepted ? (
              <a className="gcs-btn gcs-btn--primary" href={href} rel="nofollow" onClick={() => setOpen(false)} data-testid="gcs-download-terms-go">
                <GcsIconSvg icon={faDownload} />
                {t("download")}
              </a>
            ) : (
              <GcsButton variant="primary" disabled icon={<GcsIconSvg icon={faDownload} />}>{t("download")}</GcsButton>
            )}
          </div>
        </GcsModal>
      )}
    </>
  );
}

/** Staff pe site: aprobă / respinge versiunea din coadă, recomandă, ascunde, închide comentariile, mută, șterge. */
export function GcsDownloadStaffTools({
  fileId,
  pendingVersionId,
  featured,
  hidden,
  commentsLocked,
  vipOnly,
  canDelete,
  moderate,
  categories,
  categoryId,
}: {
  fileId: number;
  pendingVersionId: number | null;
  featured: boolean;
  hidden: boolean;
  commentsLocked: boolean;
  vipOnly: boolean;
  canDelete: boolean;
  moderate: boolean;
  categories: { id: number; name: string; depth: number }[];
  categoryId: number;
}) {
  const t = useTranslations("downloads.actions");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [dialog, setDialog] = useState<"reject" | "delete" | "move" | null>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(categoryId);
  return (
    <div className="gcs-dlStaff" data-testid="gcs-download-staff">
      {moderate && pendingVersionId !== null && (
        <>
          <GcsButton variant="primary" icon={<GcsIconSvg icon={faCheck} />} disabled={pending} onClick={() => run(() => reviewVersionAction({ versionId: pendingVersionId, decision: "approve" }))} data-testid="gcs-download-approve">
            {t("approve")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={faBan} />} disabled={pending} onClick={() => setDialog("reject")} data-testid="gcs-download-reject">
            {t("reject")}
          </GcsButton>
        </>
      )}
      {moderate && (
        <>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={featured ? faStarEmpty : faStar} />} disabled={pending} onClick={() => run(() => downloadFlagsAction({ fileId, featured: !featured }))} data-testid="gcs-download-feature">
            {featured ? t("unfeature") : t("feature")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={hidden ? faEye : faEyeSlash} />} disabled={pending} onClick={() => run(() => downloadFlagsAction({ fileId, hidden: !hidden }))} data-testid="gcs-download-hide">
            {hidden ? t("unhide") : t("hide")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={commentsLocked ? faLockOpen : faLock} />} disabled={pending} onClick={() => run(() => downloadFlagsAction({ fileId, commentsLocked: !commentsLocked }))}>
            {commentsLocked ? t("unlockComments") : t("lockComments")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={faCrown} />} disabled={pending} onClick={() => run(() => downloadFlagsAction({ fileId, vipOnly: !vipOnly }))}>
            {vipOnly ? t("unvip") : t("vip")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={faArrowsUpDownLeftRight} />} disabled={pending} onClick={() => setDialog("move")}>
            {t("move")}
          </GcsButton>
        </>
      )}
      {canDelete && (
        <GcsButton variant="ghost" className="gcs-btn--dangerGhost" icon={<GcsIconSvg icon={faTrash} />} disabled={pending} onClick={() => setDialog("delete")} data-testid="gcs-download-delete">
          {t("delete")}
        </GcsButton>
      )}
      {error && <p className="gcs-formError" role="alert">{error}</p>}
      {dialog === "reject" && pendingVersionId !== null && (
        <GcsConfirmDialog title={t("rejectTitle")} confirmLabel={t("reject")} danger busy={pending} onCancel={() => setDialog(null)} onConfirm={() => run(() => reviewVersionAction({ versionId: pendingVersionId, decision: "reject", reason }), () => setDialog(null))}>
          <label className="gcs-field">
            {t("rejectReason")}
            <textarea className="gcs-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="gcs-download-reject-reason" />
          </label>
        </GcsConfirmDialog>
      )}
      {dialog === "move" && (
        <GcsConfirmDialog title={t("moveTitle")} confirmLabel={t("move")} busy={pending} onCancel={() => setDialog(null)} onConfirm={() => run(() => moveDownloadAction({ fileId, categoryId: target }), () => setDialog(null))}>
          <label className="gcs-field">
            {t("moveTo")}
            <select className="gcs-input" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{`${"— ".repeat(c.depth)}${c.name}`}</option>
              ))}
            </select>
          </label>
        </GcsConfirmDialog>
      )}
      {dialog === "delete" && (
        <GcsConfirmDialog title={t("deleteTitle")} body={t("deleteBody")} confirmLabel={t("delete")} danger busy={pending} onCancel={() => setDialog(null)} onConfirm={() => run(() => removeDownloadAction({ fileId }), () => { setDialog(null); router.push("/downloads"); })} />
      )}
    </div>
  );
}

/** Nota cu stele (alegerea) și textul recenziei, cu mențiuni. */
export function GcsReviewForm({ fileId, mine }: { fileId: number; mine: { rating: number } | null }) {
  const t = useTranslations("downloads.reviews");
  const uid = useId();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState<unknown>("");
  const [key, setKey] = useState(0);
  const { pending, error, run } = useRun();
  const shown = hover || rating;
  return (
    <form
      className="gcs-dlReviewForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reviewDownloadAction({ fileId, rating, body }), () => setKey((k) => k + 1));
      }}
      data-testid="gcs-download-review-form"
    >
      <fieldset className="gcs-dlStarsPick" onMouseLeave={() => setHover(0)}>
        <legend>{mine ? t("updateRating") : t("yourRating")}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="gcs-dlStarsPick__star" onMouseEnter={() => setHover(n)}>
            <input type="radio" name={`${uid}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} className="gcs-srOnly" />
            <GcsIconSvg icon={n <= shown ? faStar : faStarEmpty} />
            <span className="gcs-srOnly">{t("stars", { count: n })}</span>
          </label>
        ))}
      </fieldset>
      <div className="gcs-field">
        <span id={`${uid}-body`}>{t("text")}</span>
        <GcsRichTextInput key={key} initial="" allow={GCS_RICH_FIELDS.downloadText} tools={["bold", "italic", "bulletList", "link", "spoiler", "emoji"]} maxLength={5000} compact labelledBy={`${uid}-body`} onValue={setBody} />
      </div>
      {error && <p className="gcs-formError" role="alert">{error}</p>}
      <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faStar} />} disabled={pending || rating === 0} data-testid="gcs-download-review-submit">
        {mine ? t("update") : t("submit")}
      </GcsButton>
    </form>
  );
}

/** Comentariul nou (editorul compact, cu @mențiuni). */
export function GcsCommentForm({ fileId }: { fileId: number }) {
  const t = useTranslations("downloads.comments");
  const uid = useId();
  const [body, setBody] = useState<unknown>("");
  const [key, setKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  return (
    <form
      className="gcs-dlCommentForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            const res = await commentDownloadAction({ fileId, body });
            if (res.ok) setNote(res.data.pending ? t("pending") : null);
            return res;
          },
          () => setKey((k) => k + 1),
        );
      }}
      data-testid="gcs-download-comment-form"
    >
      <span id={`${uid}-c`} className="gcs-srOnly">{t("write")}</span>
      <GcsRichTextInput key={key} initial="" allow={GCS_RICH_FIELDS.downloadText} tools={["bold", "italic", "code", "link", "spoiler", "emoji", "image"]} maxLength={5000} compact imageUrl labelledBy={`${uid}-c`} onValue={setBody} />
      {error && <p className="gcs-formError" role="alert">{error}</p>}
      {note && <p className="gcs-formOk" role="status">{note}</p>}
      <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faComment} />} disabled={pending} data-testid="gcs-download-comment-submit">
        {t("submit")}
      </GcsButton>
    </form>
  );
}

/** Uneltele unui comentariu / unei recenzii: aprobă (în așteptare), ascunde, șterge. */
export function GcsPostTools({ kind, id, status, moderate, canDelete }: { kind: "comment" | "review"; id: number; status: string; moderate: boolean; canDelete: boolean }) {
  const t = useTranslations("downloads.actions");
  const { pending, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <span className="gcs-dlPostTools">
      {moderate && status !== "visible" && (
        <button type="button" className="gcs-dlIconBtn gcs-sweep" disabled={pending} onClick={() => run(() => moderateDownloadPostAction({ kind, id, action: "approve" }))} aria-label={t("approvePost")} title={t("approvePost")}>
          <GcsIconSvg icon={faCheck} />
        </button>
      )}
      {moderate && status === "visible" && (
        <button type="button" className="gcs-dlIconBtn gcs-sweep" disabled={pending} onClick={() => run(() => moderateDownloadPostAction({ kind, id, action: "hide" }))} aria-label={t("hidePost")} title={t("hidePost")}>
          <GcsIconSvg icon={faEyeSlash} />
        </button>
      )}
      {canDelete && (
        <button type="button" className="gcs-dlIconBtn gcs-sweep" disabled={pending} onClick={() => setConfirm(true)} aria-label={t("deletePost")} title={t("deletePost")}>
          <GcsIconSvg icon={faTrash} />
        </button>
      )}
      {confirm && <GcsConfirmDialog title={t("deletePost")} body={t("deletePostBody")} confirmLabel={t("delete")} danger busy={pending} onCancel={() => setConfirm(false)} onConfirm={() => run(() => moderateDownloadPostAction({ kind, id, action: "delete" }), () => setConfirm(false))} />}
    </span>
  );
}
