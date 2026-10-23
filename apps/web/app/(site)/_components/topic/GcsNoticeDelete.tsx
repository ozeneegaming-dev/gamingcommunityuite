"use client";

import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteTopicNoticeAction } from "../../forum-v2-actions";

/** Ștergerea mesajului unui moderator (cu confirmarea în pagină, nu `window.confirm`). */
export function GcsNoticeDelete({ noticeId }: { noticeId: number }) {
  const t = useTranslations("topic.notices");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="gcs-iconBtn gcs-topicNotice__delete" aria-label={t("delete")} onClick={() => setOpen(true)} data-testid="gcs-notice-delete">
        <GcsIconSvg icon={faTrash} />
      </button>
      {open && (
        <GcsModal title={t("delete")} icon={<GcsIconSvg icon={faTrash} />} onClose={() => setOpen(false)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("confirmDelete")}</p>
          {error && (
            <p role="alert" className="gcs-notice gcs-notice--error">
              {error}
            </p>
          )}
          <div className="gcs-dialog__actions">
            <GcsButton
              variant="primary"
              icon={<GcsIconSvg icon={faTrash} />}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteTopicNoticeAction({ noticeId });
                  if (!res.ok) return setError(errorMessage(res.error));
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {t("delete")}
            </GcsButton>
            <GcsButton variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </>
  );
}
