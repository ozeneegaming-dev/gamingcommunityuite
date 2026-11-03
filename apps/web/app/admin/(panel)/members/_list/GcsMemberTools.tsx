"use client";

import { faFileExport, faFileImport, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal, type GcsUploadRules } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { useErrorMessage } from "@/lib/use-error-message";
import { createMember, importMembersCsv } from "../actions";

/** Fișierul importului: CSV (după extensie; Windows îl dă uneori ca `application/vnd.ms-excel`), cel mult 1 MB. */
const CSV_RULES: GcsUploadRules = { accept: [".csv", "text/csv", "application/vnd.ms-excel"], typesLabel: "CSV", maxBytes: 1024 * 1024 };

/**
 * Uneltele listei ACP → Membri (Membri v2): „Membru nou” (dialog cu nume, email, parolă și grup), „Import CSV”
 * (fișierul se alege din popupul de încărcare și se citește în browser; rezultatul arată rândurile create și pe cele
 * greșite) și „Export CSV” (căutarea curentă).
 */
export function GcsMemberTools({ groups, defaultGroupId, exportHref, canEdit }: { groups: { id: number; name: string }[]; defaultGroupId: number | null; exportHref: string; canEdit: boolean }) {
  const t = useTranslations("acp.members.tools");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState<"create" | "import" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ created: number; errors: { line: number; code: string }[] } | null>(null);

  const close = () => {
    setOpen(null);
    setError(null);
    setReport(null);
  };

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createMember(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) return setError(errorMessage(result.error));
    router.push(`/admin/members/${result.data.id}`);
  }

  async function onImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) return setError(t("import.noFile"));
    setPending(true);
    setError(null);
    const result = await importMembersCsv(await file.text());
    setPending(false);
    if (!result.ok) return setError(errorMessage(result.error));
    setReport(result.data);
    router.refresh();
  }

  return (
    <div className="gcs-memberTools">
      {canEdit && (
        <>
          <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faUserPlus} />} onClick={() => setOpen("create")} data-testid="gcs-member-create-open">
            {t("create.open")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faFileImport} />} onClick={() => setOpen("import")} data-testid="gcs-member-import-open">
            {t("import.open")}
          </GcsButton>
        </>
      )}
      <a className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={exportHref} download data-testid="gcs-member-export">
        <span className="gcs-btn__icon" aria-hidden="true">
          <GcsIconSvg icon={faFileExport} />
        </span>
        {t("export")}
      </a>

      {open === "create" && (
        <GcsModal title={t("create.title")} icon={<GcsIconSvg icon={faUserPlus} />} closeLabel={t("close")} onClose={close}>
          <form className="gcs-memberToolsForm" onSubmit={onCreate} data-testid="gcs-member-create">
            <label className="gcs-field">
              {t("create.name")}
              <input className="gcs-input" name="name" required minLength={3} maxLength={20} autoComplete="off" />
            </label>
            <label className="gcs-field">
              {t("create.email")}
              <input className="gcs-input" name="email" type="email" required autoComplete="off" />
            </label>
            <label className="gcs-field">
              {t("create.password")}
              <input className="gcs-input" name="password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <label className="gcs-field">
              {t("create.group")}
              <select className="gcs-input" name="groupId" defaultValue={defaultGroupId ?? undefined}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="gcs-memberToolsForm__error">
                {error}
              </p>
            )}
            <div className="gcs-confirmDialog__actions">
              <GcsButton variant="ghost" onClick={close}>
                {t("cancel")}
              </GcsButton>
              <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faUserPlus} />}>
                {t("create.submit")}
              </GcsButton>
            </div>
          </form>
        </GcsModal>
      )}

      {open === "import" && (
        <GcsModal title={t("import.title")} icon={<GcsIconSvg icon={faFileImport} />} closeLabel={t("close")} onClose={close}>
          <form className="gcs-memberToolsForm" onSubmit={onImport} data-testid="gcs-member-import">
            <p className="gcs-memberToolsForm__hint">{t("import.hint")}</p>
            <code className="gcs-memberToolsForm__sample">name,email,password,group</code>
            <div className="gcs-field">
              <span>{t("import.file")}</span>
              <GcsUploadInput name="file" title={t("import.title")} rules={CSV_RULES} testId="gcs-member-import-file" />
            </div>
            {error && (
              <p role="alert" className="gcs-memberToolsForm__error">
                {error}
              </p>
            )}
            {report && (
              <div role="status" className="gcs-memberToolsForm__report" data-testid="gcs-member-import-report">
                <strong>{t("import.created", { count: report.created })}</strong>
                {report.errors.length > 0 && (
                  <ul>
                    {report.errors.slice(0, 50).map((e) => (
                      <li key={e.line}>{t("import.lineError", { line: e.line, code: e.code })}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="gcs-confirmDialog__actions">
              <GcsButton variant="ghost" onClick={close}>
                {t("close")}
              </GcsButton>
              <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faFileImport} />}>
                {t("import.submit")}
              </GcsButton>
            </div>
          </form>
        </GcsModal>
      )}
    </div>
  );
}
