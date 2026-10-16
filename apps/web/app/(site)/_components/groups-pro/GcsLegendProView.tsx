"use client";

import { faChevronDown, faChevronRight, faInfo, faUsers } from "@fortawesome/free-solid-svg-icons";
import { GcsGroupPill, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Textele blocului legendei (antetul, butonul „Vezi toate grupurile”, dropdown-ul grupurilor legate). */
export type GcsLegendProBlockLabels = {
  title: string;
  info: string;
  groups: string;
  seeAll: string;
  seeAllTip: string;
  linked: string;
  toggle: string;
};

/**
 * Blocul legendei Pro din panoul de statistici (sau, `place: "widget"`, doar cardurile și butonul, sub titlul
 * widget-ului): antetul „Legenda grupurilor” cu butonul de informații și numărul de grupuri, „Vezi toate grupurile”
 * (dacă e pornit din ACP) și cardurile. Același bloc e și previzualizarea live din ACP.
 */
export function GcsLegendProBlock({
  place,
  headingId,
  cards,
  labels,
  columns,
  counts,
  seeAll,
}: {
  place: "panel" | "widget";
  headingId?: string;
  cards: GcsLegendProCard[];
  labels: GcsLegendProBlockLabels;
  columns: 2 | 3 | 4;
  counts: GcsLegendProCounts;
  seeAll: boolean;
}) {
  const view = <GcsLegendProView cards={cards} labels={{ linked: labels.linked, toggle: labels.toggle }} columns={columns} counts={counts} />;
  const all = seeAll ? (
    <GcsTooltip content={labels.seeAllTip}>
      <a href="/members/groups" className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-legendPro__seeAll" data-testid="gcs-legend-pro-all">
        {labels.seeAll}
        <GcsIconSvg icon={faChevronRight} />
      </a>
    </GcsTooltip>
  ) : null;
  if (place === "widget") {
    return (
      <div className="gcs-legendPro__widget">
        {view}
        {all && <div className="gcs-legendPro__widgetFoot">{all}</div>}
      </div>
    );
  }
  return (
    <section className="gcs-legendBlock gcs-legendBlock--pro" aria-labelledby={headingId}>
      <div className="gcs-legendPro__head">
        <span className="gcs-legendPro__headIcon" aria-hidden="true">
          <GcsIconSvg icon={faUsers} />
        </span>
        <h3 id={headingId} className="gcs-legendPro__heading">
          {labels.title}
        </h3>
        <GcsTooltip content={labels.info}>
          <button type="button" className="gcs-legendPro__info" aria-label={labels.info}>
            <GcsIconSvg icon={faInfo} />
          </button>
        </GcsTooltip>
        <span className="gcs-legendPro__groupCount" data-testid="gcs-legend-pro-count">
          {labels.groups}
        </span>
        {all}
      </div>
      {view}
    </section>
  );
}

/** Un grup pe un rând al legendei Pro (datele pastilei calculate pe server: link, tooltip, etichetă, iconiță). */
export type GcsLegendProRow = {
  id: number;
  name: string;
  color: string | null;
  href: string | null;
  tooltip: string[];
  ariaLabel: string;
  icon: ReactNode;
  members: number;
  online: number;
};

export type GcsLegendProItem = GcsLegendProRow & { children: GcsLegendProRow[]; linkedTotal: string };
export type GcsLegendProCard = { key: string; label: string; total: string; rows: GcsLegendProItem[]; icon?: ReactNode };

/** Ce numărători arată rândurile (opțiunile de afișare din ACP → Membri → Legenda grupurilor). */
export type GcsLegendProCounts = { members: boolean; online: boolean };

/**
 * Legenda Pro (aplicația Grupuri Pro): cardurile categoriilor (2, 3 sau 4 pe rând, după opțiunea din ACP), fiecare cu
 * iconița categoriei și rândurile grupurilor — iconița într-un pătrat nuanțat, numele în culoarea grupului, numărul de
 * membri și câți sunt online (fiecare poate fi ascuns). Un grup cu grupuri legate are un buton cu săgeată care deschide
 * lista lor (Escape sau un click în afară o închide). Fiecare rând și fiecare grup din listă e un link spre membrii lui,
 * cu tooltip-ul numărătorii.
 */
export function GcsLegendProView({
  cards,
  labels,
  columns = 3,
  counts = { members: true, online: true },
}: {
  cards: GcsLegendProCard[];
  labels: { linked: string; toggle: string };
  columns?: 2 | 3 | 4;
  counts?: GcsLegendProCounts;
}) {
  return (
    <div className="gcs-legendPro" data-testid="gcs-legend-pro" data-columns={columns}>
      {cards.map((c) => (
        <section key={c.key} className="gcs-legendPro__card" aria-label={c.label} data-category={c.key}>
          <h4 className="gcs-legendPro__title">
            {c.icon ? (
              <span className="gcs-legendPro__catIcon" aria-hidden="true">
                {c.icon}
              </span>
            ) : (
              <i aria-hidden="true" />
            )}
            <span>{c.label}</span>
            {counts.members && <span className="gcs-legendPro__total">{c.total}</span>}
          </h4>
          {c.rows.map((row) => (
            <LegendRow key={row.id} row={row} labels={labels} counts={counts} />
          ))}
        </section>
      ))}
    </div>
  );
}

const tint = (color: string | null) => ({ "--gcs-group": color ?? "var(--gcs-muted)" }) as CSSProperties;

function RowBody({ row, counts }: { row: GcsLegendProRow; counts: GcsLegendProCounts }) {
  return (
    <>
      <span className="gcs-legendPro__icon" aria-hidden="true">
        {row.icon}
      </span>
      <span className="gcs-legendPro__name">{row.name}</span>
      {(counts.members || counts.online) && (
        <span className="gcs-legendPro__counts">
          {counts.members && <b data-testid="gcs-legend-pro-members">{row.members}</b>}
          {counts.online && (
            <span className="gcs-legendPro__online" data-testid="gcs-legend-pro-online">
              <i aria-hidden="true" />
              {row.online}
            </span>
          )}
        </span>
      )}
    </>
  );
}

function LegendRow({ row, labels, counts }: { row: GcsLegendProItem; labels: { linked: string; toggle: string }; counts: GcsLegendProCounts }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const hasChildren = row.children.length > 0;
  return (
    <div
      ref={box}
      className={`gcs-legendPro__item${open ? " gcs-legendPro__item--open" : ""}`}
      style={tint(row.color)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="gcs-legendPro__rowBox">
        <GcsGroupPill
          bare
          className="gcs-legendPro__row"
          group={{ id: row.id, name: row.name, color: row.color }}
          href={row.href}
          tooltip={row.tooltip}
          ariaLabel={row.ariaLabel}
          data-testid="gcs-legend-pro-row"
        >
          <RowBody row={row} counts={counts} />
        </GcsGroupPill>
        {hasChildren ? (
          <button
            ref={toggle}
            type="button"
            className="gcs-legendPro__toggle"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={labels.toggle.replace("{name}", row.name)}
            onClick={() => setOpen((v) => !v)}
            data-testid="gcs-legend-pro-toggle"
          >
            <GcsIconSvg icon={faChevronDown} />
          </button>
        ) : (
          <span className="gcs-legendPro__toggleSpace" aria-hidden="true" />
        )}
      </div>
      {hasChildren && open && (
        <div id={menuId} className="gcs-legendPro__menu" role="group" aria-label={labels.toggle.replace("{name}", row.name)} data-testid="gcs-legend-pro-menu">
          <div className="gcs-legendPro__menuHead">
            <span>{labels.linked}</span>
            {counts.members && <b>{row.linkedTotal}</b>}
          </div>
          {row.children.map((child) => (
            <GcsGroupPill
              key={child.id}
              bare
              className="gcs-legendPro__menuItem"
              style={tint(child.color)}
              group={{ id: child.id, name: child.name, color: child.color }}
              href={child.href}
              tooltip={child.tooltip}
              ariaLabel={child.ariaLabel}
            >
              <span className="gcs-legendPro__dot" aria-hidden="true" />
              <span className="gcs-legendPro__menuName">{child.name}</span>
              {counts.members && <span className="gcs-legendPro__menuCount">{child.members}</span>}
            </GcsGroupPill>
          ))}
        </div>
      )}
    </div>
  );
}
