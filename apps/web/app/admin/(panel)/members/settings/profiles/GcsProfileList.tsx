"use client";

import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsBadge, GcsButton, GcsIconSvg, type GcsBadgeTone } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsProfileSortable } from "./GcsProfileSortable";

export type GcsProfileListRow = {
  id: number;
  /** Eticheta (titlul rândului). */
  name: string;
  key: string;
  /** „Text · Echipamentul meu” (deja tradus pe server). */
  meta: string;
  /** Pătratul cu iconița, randat pe server. */
  icon: ReactNode;
  chips: { label: string; tone: GcsBadgeTone }[];
  /** Butonul care deschide panoul de editare (randat pe server, cu formularul elementului). */
  edit: ReactNode;
  /** Pentru filtre (doar la câmpuri). */
  section?: string;
  groupId?: number | null;
};

type Option = { value: string; label: string };

type Props = {
  rows: GcsProfileListRow[];
  /** Salvează ordinea nouă (toate id-urile). */
  reorder: (ids: number[]) => Promise<GcsResult<null>>;
  /** Căutarea și filtrele (secțiune, grup) de deasupra listei câmpurilor. */
  filters?: { sections: Option[]; groups: Option[] };
  /** Ce apare când lista e goală (cu butonul de adăugare). */
  empty: ReactNode;
  testId: string;
  rowTestId: string;
};

/**
 * Lista compactă din Profiluri (câmpurile sau grupurile lor): mâner de tragere, iconița, eticheta cu cheia, etichetele de
 * stare și butonul de editare care deschide panoul. Ordinea se salvează imediat; cu un filtru activ ordinea e blocată.
 */
export function GcsProfileList({ rows, reorder, filters, empty, testId, rowTestId }: Props) {
  const t = useTranslations("acp.profiles.list");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  // Ordinea arătată până când serverul trimite lista nouă (după `router.refresh()`).
  const [order, setOrder] = useState<number[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [group, setGroup] = useState("");

  // Lista nouă de la server (după salvare sau după un panou) înlocuiește ordinea locală.
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    setSeen(rows);
    setOrder(null);
  }

  const ordered = useMemo(() => {
    if (!order) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return order.map((id) => byId.get(id)).filter((r): r is GcsProfileListRow => Boolean(r));
  }, [rows, order]);

  const q = query.trim().toLocaleLowerCase();
  const filtered = Boolean(q || section || group);
  const shown = filtered
    ? ordered.filter(
        (r) =>
          (!q || r.name.toLocaleLowerCase().includes(q) || r.key.includes(q)) &&
          (!section || r.section === section) &&
          (!group || (group === "none" ? r.groupId == null : String(r.groupId) === group)),
      )
    : ordered;

  async function save(next: GcsProfileListRow[]) {
    const ids = next.map((r) => r.id);
    setOrder(ids);
    const res = await reorder(ids);
    if (!res.ok) {
      setOrder(null);
      setStatus({ ok: false, text: errorMessage(res.error) });
      return;
    }
    setStatus({ ok: true, text: t("orderSaved") });
    router.refresh();
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="gcs-acpProf__list">
      {filters && (
        <div className="gcs-acpProf__listHead">
          <label className="gcs-acpProf__search">
            <GcsIconSvg icon={faMagnifyingGlass} />
            <input type="search" className="gcs-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} data-testid={`${testId}-search`} />
          </label>
          <select className="gcs-input gcs-acpProf__filter" value={section} onChange={(e) => setSection(e.target.value)} aria-label={t("filterSection")} data-testid={`${testId}-section`}>
            <option value="">{t("allSections")}</option>
            {filters.sections.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select className="gcs-input gcs-acpProf__filter" value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t("filterGroup")} data-testid={`${testId}-group`}>
            <option value="">{t("allGroups")}</option>
            <option value="none">{t("noGroup")}</option>
            {filters.groups.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {filtered && shown.length > 0 && <p className="gcs-acpProf__note">{t("orderLocked")}</p>}
      {shown.length === 0 ? (
        <div className="gcs-acpProf__empty gcs-acpProf__empty--inline" role="status">
          <p>{t("noMatch")}</p>
          <GcsButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setSection("");
              setGroup("");
            }}
          >
            {t("clearFilters")}
          </GcsButton>
        </div>
      ) : (
        <GcsProfileSortable
          items={shown}
          locked={filtered}
          onChange={(next) => void save(next)}
          className="gcs-acpProf__rows"
          testId={testId}
          renderRow={(row, { handle, arrows }) => (
            <div className="gcs-acpProf__row" data-testid={rowTestId} data-key={row.key} data-id={row.id}>
              {handle}
              <span className="gcs-acpProf__tile" aria-hidden="true">
                {row.icon}
              </span>
              <span className="gcs-acpProf__text">
                <b className="gcs-acpProf__name">{row.name}</b>
                <span className="gcs-acpProf__meta">
                  <code className="gcs-acpProf__key">{row.key}</code>
                  {row.meta && <> · {row.meta}</>}
                </span>
              </span>
              {row.chips.length > 0 && (
                <span className="gcs-acpProf__chips">
                  {row.chips.map((c) => (
                    <GcsBadge key={c.label} tone={c.tone}>
                      {c.label}
                    </GcsBadge>
                  ))}
                </span>
              )}
              <span className="gcs-acpProf__actions">
                {arrows}
                {row.edit}
              </span>
            </div>
          )}
        />
      )}
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-acpProf__status" : "gcs-acpProf__status gcs-acpProf__status--error"} data-testid={`${testId}-status`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
