"use client";

import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useErrorMessage } from "../_components/GcsActionForm";
import { createGroup } from "./actions";

/**
 * „Grup nou” din antetul paginii Grupuri: un dialog mic doar cu numele; după creare, adminul ajunge pe pagina
 * grupului, unde îi alege culoarea, drepturile și restul.
 */
export function GcsGroupCreate() {
  const t = useTranslations("acp.groups.create");
  const tPanel = useTranslations("ui.panel");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await createGroup(new FormData(e.currentTarget));
    if (!res.ok) {
      setPending(false);
      setError(errorMessage(res.error));
      return;
    }
    router.push(`/admin/groups/${res.data.id}`);
  }

  return (
    <>
      <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setOpen(true)} data-testid="gcs-group-new">
        {t("title")}
      </GcsButton>
      {open && (
        <GcsModal title={t("title")} icon={<GcsIconSvg icon={faPlus} />} onClose={() => setOpen(false)} closeLabel={tPanel("close")} size="sm">
          <form onSubmit={onSubmit} className="gcs-acpGroups__create">
            <div className="gcs-field">
              <label htmlFor={`${id}-name`}>{t("name")}</label>
              <input id={`${id}-name`} className="gcs-input" name="name" required maxLength={64} autoComplete="off" aria-describedby={`${id}-hint`} />
              <span id={`${id}-hint`} className="gcs-field__hint">
                {t("hint")}
              </span>
            </div>
            {error && (
              <p role="alert" className="gcs-field__error" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <div className="gcs-acpGroups__createActions">
              <GcsButton type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </GcsButton>
              <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faPlus} />} loading={pending}>
                {t("submit")}
              </GcsButton>
            </div>
          </form>
        </GcsModal>
      )}
    </>
  );
}
