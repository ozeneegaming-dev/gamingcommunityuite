"use client";

import { faBolt } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../_components/GcsConfirmDialog";
import { bulkMembers } from "../actions";

export const BULK_FORM_ID = "gcs-member-bulk";
const OPS = ["add_secondary", "remove_secondary", "set_primary", "validate", "ban", "delete"] as const;
type Op = (typeof OPS)[number];

/**
 * Bara acțiunilor în masă din ACP → Membri (Membri v2): bifele din tabel țin de formularul ei (atributul `form`), deci
 * selecția rămâne în pagină. „Toți cei filtrați” aplică acțiunea pe întreaga căutare. Fiecare acțiune cere confirmarea
 * din pagină; rezultatul arată câți s-au schimbat și câți au fost săriți (ex. un Root Admin protejat).
 */
export function GcsMemberBulkBar({ groups, total, query, canDelete }: { groups: { id: number; name: string }[]; total: number; query: string; canDelete: boolean }) {
  const t = useTranslations("acp.members.bulk");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const form = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);
  const [op, setOp] = useState<Op>("add_secondary");
  const [scope, setScope] = useState<"selected" | "filtered">("selected");
  const [asking, setAsking] = useState<FormData | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Numărul bifelor (din tabel, legate de formular prin `form`).
  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="ids"]`)];
    const update = () => setSelected(boxes().filter((b) => b.checked).length);
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target?.dataset.bulkAll !== undefined) for (const b of boxes()) b.checked = target.checked;
      update();
    };
    document.addEventListener("change", onChange);
    update();
    return () => document.removeEventListener("change", onChange);
  }, []);

  const count = scope === "filtered" ? total : selected;
  const needsGroup = op === "add_secondary" || op === "remove_secondary" || op === "set_primary";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    if (count === 0) return setStatus({ ok: false, text: t("none") });
    setAsking(new FormData(e.currentTarget));
  }

  async function run(fd: FormData) {
    setPending(true);
    const result = await bulkMembers(fd);
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    setStatus({ ok: true, text: t("done", { changed: result.data.changed, skipped: result.data.skipped }) });
    router.refresh();
  }

  return (
    <form id={BULK_FORM_ID} ref={form} className="gcs-bulkBar" onSubmit={onSubmit} aria-label={t("title")} data-testid="gcs-member-bulk">
      <input type="hidden" name="query" value={query} />
      <span className="gcs-bulkBar__count" data-testid="gcs-member-bulk-count">
        <GcsIconSvg icon={faBolt} /> {t("selected", { count: selected })}
      </span>
      <label className="gcs-field gcs-bulkBar__field">
        {t("scope")}
        <select className="gcs-input" name="scope" value={scope} onChange={(e) => setScope(e.target.value as "selected" | "filtered")}>
          <option value="selected">{t("scopeSelected")}</option>
          <option value="filtered">{t("scopeFiltered", { count: total })}</option>
        </select>
      </label>
      <label className="gcs-field gcs-bulkBar__field">
        {t("action")}
        <select className="gcs-input" name="op" value={op} onChange={(e) => setOp(e.target.value as Op)} data-testid="gcs-member-bulk-op">
          {OPS.filter((o) => o !== "delete" || canDelete).map((o) => (
            <option key={o} value={o}>
              {t(`ops.${o}`)}
            </option>
          ))}
        </select>
      </label>
      {needsGroup && (
        <label className="gcs-field gcs-bulkBar__field">
          {t("group")}
          <select className="gcs-input" name="groupId" required data-testid="gcs-member-bulk-group">
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {op === "add_secondary" && (
        <label className="gcs-field gcs-bulkBar__field">
          {t("expiresAt")}
          <input className="gcs-input" type="date" name="expiresAt" data-testid="gcs-member-bulk-expiry" />
        </label>
      )}
      {op === "ban" && (
        <>
          <label className="gcs-field gcs-bulkBar__field">
            {t("reason")}
            <input className="gcs-input" name="reason" maxLength={500} required />
          </label>
          <label className="gcs-field gcs-bulkBar__field">
            {t("duration")}
            <select className="gcs-input" name="duration" defaultValue="permanent">
              {(["permanent", "d1", "d7", "d30"] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`durations.${d}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {op === "delete" && (
        <label className="gcs-field gcs-bulkBar__field">
          {t("mode")}
          <select className="gcs-input" name="mode" defaultValue="KEEP_CONTENT">
            <option value="KEEP_CONTENT">{t("modes.keep")}</option>
            <option value="DELETE_CONTENT">{t("modes.delete")}</option>
          </select>
        </label>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending} data-testid="gcs-member-bulk-apply">
        {t("apply")}
      </GcsButton>
      {status && (
        <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-bulkBar__ok" : "gcs-bulkBar__error"} data-testid="gcs-member-bulk-status">
          {status.text}
        </span>
      )}
      {asking && (
        <GcsConfirmDialog
          title={t(`ops.${op}`)}
          body={t(op === "delete" ? "confirmDelete" : "confirm", { count, action: t(`ops.${op}`) })}
          confirmLabel={t("confirmOk", { count })}
          danger={op === "delete" || op === "ban"}
          busy={pending}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const fd = asking;
            setAsking(null);
            void run(fd);
          }}
        />
      )}
    </form>
  );
}
