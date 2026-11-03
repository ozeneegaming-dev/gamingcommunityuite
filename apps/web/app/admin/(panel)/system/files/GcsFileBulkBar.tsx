"use client";

import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../_components/GcsConfirmDialog";
import { deleteFiles } from "./actions";

export const FILES_BULK_FORM_ID = "gcs-files-bulk";

/**
 * Ștergerea în masă din ACP › Sistem › Fișiere: bifele din tabel țin de formularul barei (atributul `form`); „Șterge”
 * cere confirmarea din pagină și spune câte fișiere au fost șterse.
 */
export function GcsFileBulkBar() {
  const t = useTranslations("acp.files.bulk");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [selected, setSelected] = useState(0);
  const [asking, setAsking] = useState<FormData | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${FILES_BULK_FORM_ID}"][name="ids"]`)];
    const update = () => setSelected(boxes().filter((b) => b.checked).length);
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target?.dataset.filesAll !== undefined) for (const b of boxes()) b.checked = target.checked;
      update();
    };
    document.addEventListener("change", onChange);
    update();
    return () => document.removeEventListener("change", onChange);
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    if (selected === 0) return setStatus({ ok: false, text: t("none") });
    setAsking(new FormData(e.currentTarget));
  }

  async function run(fd: FormData) {
    setPending(true);
    const result = await deleteFiles(fd);
    setPending(false);
    setAsking(null);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    setStatus({ ok: true, text: t("done", { count: result.data }) });
    router.refresh();
  }

  return (
    <form id={FILES_BULK_FORM_ID} className="gcs-bulkBar" onSubmit={onSubmit} aria-label={t("title")} data-testid="gcs-files-bulk">
      <span className="gcs-bulkBar__count" data-testid="gcs-files-bulk-count">
        {t("selected", { count: selected })}
      </span>
      <GcsButton variant="ghost" size="sm" type="submit" disabled={pending || selected === 0} icon={<GcsIconSvg icon={faTrash} />}>
        {t("delete")}
      </GcsButton>
      {status && (
        <span role={status.ok ? "status" : "alert"} className={`gcs-bulkBar__status gcs-bulkBar__status--${status.ok ? "ok" : "bad"}`}>
          {status.text}
        </span>
      )}
      {asking && (
        <GcsConfirmDialog
          title={t("delete")}
          body={t("confirm", { count: selected })}
          confirmLabel={t("delete")}
          danger
          busy={pending}
          onCancel={() => setAsking(null)}
          onConfirm={() => void run(asking)}
        />
      )}
    </form>
  );
}
