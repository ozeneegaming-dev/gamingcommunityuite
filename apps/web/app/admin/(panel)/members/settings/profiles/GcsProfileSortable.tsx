"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { faArrowDown, faArrowUp, faGripVertical } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export type GcsSortableControls = {
  /** Mânerul de tragere (din tastatură: Spațiu, săgeți, Spațiu). */
  handle: ReactNode;
  /** Butoanele ↑/↓ (alternativa simplă la tragere). */
  arrows: ReactNode;
};

type Props<T extends { id: number | string; name: string }> = {
  items: T[];
  /** Ordinea nouă, după o tragere sau o săgeată. */
  onChange: (next: T[]) => void;
  /** Fără tragere și săgeți (ex. când lista e filtrată și ordinea completă nu se vede). */
  locked?: boolean;
  renderRow: (item: T, controls: GcsSortableControls) => ReactNode;
  className?: string;
  testId?: string;
};

/**
 * Lista reordonabilă din pagina Profiluri (câmpuri, grupuri, ordinea în postare): drag & drop de mâner, cu tastatura
 * prin dnd-kit și butoane ↑/↓. Componenta doar mută rândurile; cine o folosește decide când se salvează ordinea.
 */
export function GcsProfileSortable<T extends { id: number | string; name: string }>({ items, onChange, locked, renderRow, className, testId }: Props<T>) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((r) => r.id === e.active.id);
    const to = items.findIndex((r) => r.id === e.over!.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(items, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((r) => r.id)} strategy={verticalListSortingStrategy} disabled={locked}>
        <ul className={className} data-testid={testId}>
          {items.map((item, i) => (
            <SortRow key={item.id} item={item} locked={locked} first={i === 0} last={i === items.length - 1} onMove={(delta) => onChange(arrayMove(items, i, i + delta))} renderRow={renderRow} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

type RowProps<T extends { id: number | string; name: string }> = {
  item: T;
  locked?: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  renderRow: (item: T, controls: GcsSortableControls) => ReactNode;
};

function SortRow<T extends { id: number | string; name: string }>({ item, locked, first, last, onMove, renderRow }: RowProps<T>) {
  const t = useTranslations("acp.profiles.list");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: locked });
  const handle = locked ? (
    <span className="gcs-acpProf__grip gcs-acpProf__grip--off" aria-hidden="true">
      <GcsIconSvg icon={faGripVertical} />
    </span>
  ) : (
    <button type="button" className="gcs-iconBtn gcs-acpProf__grip" aria-label={t("drag", { name: item.name })} title={t("drag", { name: item.name })} {...attributes} {...listeners}>
      <GcsIconSvg icon={faGripVertical} />
    </button>
  );
  const arrows = locked ? null : (
    <span className="gcs-acpProf__arrows">
      <button type="button" className="gcs-iconBtn" disabled={first} aria-label={t("moveUp", { name: item.name })} title={t("moveUp", { name: item.name })} onClick={() => onMove(-1)} data-testid="gcs-acp-sort-up">
        <GcsIconSvg icon={faArrowUp} />
      </button>
      <button type="button" className="gcs-iconBtn" disabled={last} aria-label={t("moveDown", { name: item.name })} title={t("moveDown", { name: item.name })} onClick={() => onMove(1)} data-testid="gcs-acp-sort-down">
        <GcsIconSvg icon={faArrowDown} />
      </button>
    </span>
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "gcs-acpProf__item gcs-acpProf__item--drag" : "gcs-acpProf__item"}>
      {renderRow(item, { handle, arrows })}
    </li>
  );
}
