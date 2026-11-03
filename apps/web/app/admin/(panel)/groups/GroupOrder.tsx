"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { faArrowDown, faArrowUp, faGripVertical, faMagnifyingGlass, faPen } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsAvatar, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useErrorMessage } from "../_components/GcsActionForm";
import { reorderGroups } from "./actions";

export type GcsGroupType = "protected" | "vip" | "custom";
/** Drepturile importante ale unui grup, ca etichete pe rând. */
export type GcsGroupFlag = "acpFull" | "acp" | "globalMod" | "noAccess" | "vip";

export type GcsGroupRow = {
  id: number;
  key: string;
  name: string;
  color: string | null;
  type: GcsGroupType;
  members: number;
  /** Primii membri (avatarurile de lângă număr). */
  avatars: { id: string; name: string; image: string | null }[];
  flags: GcsGroupFlag[];
};

const FILTERS = ["all", "protected", "vip", "custom"] as const;
type Filter = (typeof FILTERS)[number];
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Lista grupurilor (ACP → Membri → Grupuri): rânduri compacte cu culoarea, numele în stilul grupului, tipul, primii
 * membri, drepturile importante și „Editează”. Filtre pe tip și căutare după nume. Ordinea se schimbă prin tragere de
 * mâner (și din tastatură: Spațiu, săgeți, Spațiu) sau cu butoanele ↑/↓, doar în lista completă, și se salvează imediat.
 */
export function GroupOrder({ groups }: { groups: GcsGroupRow[] }) {
  const t = useTranslations("acp.groups");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(groups);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, protected: 0, vip: 0, custom: 0 };
    for (const r of rows) c[r.type] += 1;
    return c;
  }, [rows]);
  const q = fold(search.trim());
  const shown = rows.filter((r) => (filter === "all" || r.type === filter) && (!q || fold(r.name).includes(q)));
  // Ordinea se schimbă doar în lista completă (altfel locul între rândurile ascunse ar fi ambiguu).
  const sortable = filter === "all" && !q;

  async function save(next: GcsGroupRow[]) {
    const previous = rows;
    setRows(next);
    const res = await reorderGroups(next.map((r) => r.id));
    if (!res.ok) {
      setRows(previous);
      setStatus({ ok: false, text: errorMessage(res.error) });
    } else {
      setStatus({ ok: true, text: t("orderSaved") });
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    void save(arrayMove(rows, rows.findIndex((r) => r.id === e.active.id), rows.findIndex((r) => r.id === e.over!.id)));
  }

  return (
    <div className="gcs-acpGroups">
      <div className="gcs-acpGroups__bar">
        <label className="gcs-acpGroups__search">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <span className="gcs-srOnly">{t("search")}</span>
          <input type="search" className="gcs-input" value={search} placeholder={t("search")} onChange={(e) => setSearch(e.target.value)} data-testid="gcs-groups-search" />
        </label>
        <div className="gcs-acpGroups__filters" role="group" aria-label={t("filter")}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={cx("gcs-acpGroups__filter", filter === f && "gcs-acpGroups__filter--on")} aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`gcs-groups-filter-${f}`}>
              {t(`filters.${f}`)}
              <span className="gcs-acpGroups__filterCount">{counts[f]}</span>
            </button>
          ))}
        </div>
        <span className="gcs-acpGroups__hint">{sortable ? t("dragHint") : t("dragOff")}</span>
      </div>

      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-acpGroups__status" : "gcs-acpGroups__status gcs-field__error"} data-testid="gcs-groups-status">
          {status.text}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="gcs-acpGroups__empty">{t("noMatch")}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((r) => r.id)} strategy={verticalListSortingStrategy} disabled={!sortable}>
            <ul className="gcs-acpGroups__list" aria-label={t("order")} data-testid="gcs-acp-groups">
              {shown.map((row) => {
                const i = rows.indexOf(row);
                return <Row key={row.id} row={row} sortable={sortable} first={i === 0} last={i === rows.length - 1} onMove={(delta) => void save(arrayMove(rows, i, i + delta))} />;
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

type RowProps = { row: GcsGroupRow; sortable: boolean; first: boolean; last: boolean; onMove: (delta: -1 | 1) => void };

function Row({ row, sortable, first, last, onMove }: RowProps) {
  const t = useTranslations("acp.groups");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !sortable });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("gcs-acpGroups__row", isDragging && "gcs-acpGroups__row--dragging")}
      data-testid="gcs-acp-group"
      data-group={row.key}
      data-group-name={row.name}
    >
      <button type="button" className="gcs-iconBtn gcs-acpGroups__grip" aria-label={t("drag", { group: row.name })} disabled={!sortable} {...attributes} {...listeners} data-testid="gcs-group-drag">
        <GcsIconSvg icon={faGripVertical} />
      </button>
      <span className="gcs-acpGroups__dot" style={row.color ? { background: row.color } : undefined} aria-hidden="true" />
      <span className="gcs-acpGroups__name">
        <b className={`gcs-name--${row.key}`}>{row.name}</b>
        <span>{t(row.type)}</span>
      </span>
      <span className="gcs-acpGroups__members" title={t("membersCount", { count: row.members })}>
        {row.avatars.length > 0 && (
          <span className="gcs-acpGroups__avatars" aria-hidden="true">
            {row.avatars.map((u) => (
              <GcsAvatar key={u.id} name={u.name} size="xs" {...(u.image ? { src: u.image } : {})} />
            ))}
          </span>
        )}
        <span aria-hidden="true" data-testid="gcs-group-members">
          {row.members}
        </span>
        <span className="gcs-srOnly">{t("membersCount", { count: row.members })}</span>
      </span>
      <span className="gcs-acpGroups__flags">
        {row.flags.map((f) => (
          <span key={f} className={cx("gcs-acpGroups__flag", f === "vip" && "gcs-acpGroups__flag--vip")} data-flag={f}>
            {t(`flags.${f}`)}
          </span>
        ))}
      </span>
      <span className="gcs-acpGroups__actions">
        <button type="button" className="gcs-iconBtn" disabled={!sortable || first} aria-label={t("moveUp", { group: row.name })} onClick={() => onMove(-1)}>
          <GcsIconSvg icon={faArrowUp} />
        </button>
        <button type="button" className="gcs-iconBtn" disabled={!sortable || last} aria-label={t("moveDown", { group: row.name })} onClick={() => onMove(1)}>
          <GcsIconSvg icon={faArrowDown} />
        </button>
        <Link href={`/admin/groups/${row.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" aria-label={`${t("edit")}: ${row.name}`}>
          <span className="gcs-btn__icon" aria-hidden="true">
            <GcsIconSvg icon={faPen} />
          </span>
          {t("edit")}
        </Link>
      </span>
    </li>
  );
}
