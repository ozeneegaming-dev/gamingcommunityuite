"use client";

import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { GcsGroupPill, GcsIconSvg } from "@gcs/ui";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

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
export type GcsLegendProCard = { key: string; label: string; total: string; rows: GcsLegendProItem[] };

/**
 * Legenda Pro (aplicația Grupuri Pro): cardurile categoriilor (3 pe rând), fiecare cu rândurile grupurilor — iconița
 * într-un pătrat nuanțat, numele în culoarea grupului, numărul de membri și câți sunt online. Un grup cu grupuri legate
 * are un buton cu săgeată care deschide lista lor (Escape sau un click în afară o închide). Fiecare rând și fiecare
 * grup din listă e un link spre membrii lui, cu tooltip-ul numărătorii.
 */
export function GcsLegendProView({ cards, labels }: { cards: GcsLegendProCard[]; labels: { linked: string; toggle: string } }) {
  return (
    <div className="gcs-legendPro" data-testid="gcs-legend-pro">
      {cards.map((c) => (
        <section key={c.key} className="gcs-legendPro__card" aria-label={c.label} data-category={c.key}>
          <h4 className="gcs-legendPro__title">
            <i aria-hidden="true" />
            <span>{c.label}</span>
            <span className="gcs-legendPro__total">{c.total}</span>
          </h4>
          {c.rows.map((row) => (
            <LegendRow key={row.id} row={row} labels={labels} />
          ))}
        </section>
      ))}
    </div>
  );
}

const tint = (color: string | null) => ({ "--gcs-group": color ?? "var(--gcs-muted)" }) as CSSProperties;

function RowBody({ row }: { row: GcsLegendProRow }) {
  return (
    <>
      <span className="gcs-legendPro__icon" aria-hidden="true">
        {row.icon}
      </span>
      <span className="gcs-legendPro__name">{row.name}</span>
      <span className="gcs-legendPro__counts">
        <b>{row.members}</b>
        <span className="gcs-legendPro__online">
          <i aria-hidden="true" />
          {row.online}
        </span>
      </span>
    </>
  );
}

function LegendRow({ row, labels }: { row: GcsLegendProItem; labels: { linked: string; toggle: string } }) {
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
          <RowBody row={row} />
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
            <b>{row.linkedTotal}</b>
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
              <span className="gcs-legendPro__menuCount">{child.members}</span>
            </GcsGroupPill>
          ))}
        </div>
      )}
    </div>
  );
}
