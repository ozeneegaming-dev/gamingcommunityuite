"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { faArrowDown, faArrowUp, faFloppyDisk, faGripVertical } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { reorderStaffMembers, saveStaffSections } from "./actions";

export type GcsStaffEditorSection = { groupId: number; name: string; title: string; layout: "detailed" | "compact"; enabled: boolean; members: number };

const sensorsOptions = { activationConstraint: { distance: 4 } };

/**
 * Editorul secțiunilor paginii Staff (ACP → Membri → Staff → Pagina Staff): ordinea (drag & drop sau ↑/↓), titlul benzii,
 * aspectul cardurilor (detaliat / compact) și dacă secțiunea apare. „Salvează” scrie tot.
 */
export function GcsStaffSections({ sections }: { sections: GcsStaffEditorSection[] }) {
  const t = useTranslations("acp.staffPage");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(sections);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, sensorsOptions), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const patch = (groupId: number, p: Partial<GcsStaffEditorSection>) => setRows((list) => list.map((r) => (r.groupId === groupId ? { ...r, ...p } : r)));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setRows((list) => arrayMove(list, list.findIndex((r) => r.groupId === e.active.id), list.findIndex((r) => r.groupId === e.over!.id)));
  }

  async function save() {
    setPending(true);
    const res = await saveStaffSections(rows.map((r) => ({ groupId: r.groupId, title: r.title.trim() && r.title.trim() !== r.name ? r.title.trim() : null, layout: r.layout, enabled: r.enabled })));
    setPending(false);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setStatus({ ok: true, text: t("saved") });
    router.refresh();
  }

  return (
    <div className="gcs-staffEditor" data-testid="gcs-staff-editor">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.groupId)} strategy={verticalListSortingStrategy}>
          <ul className="gcs-forumTree">
            {rows.map((r, i) => (
              <SectionRow key={r.groupId} row={r} first={i === 0} last={i === rows.length - 1} onMove={(d) => setRows((list) => arrayMove(list, i, i + d))} onPatch={(p) => patch(r.groupId, p)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="gcs-staffEditor__foot">
        <GcsButton variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} disabled={pending} onClick={() => void save()} data-testid="gcs-staff-save">
          {t("save")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-bulkBar__ok" : "gcs-bulkBar__error"}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionRow({ row, first, last, onMove, onPatch }: { row: GcsStaffEditorSection; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onPatch: (p: Partial<GcsStaffEditorSection>) => void }) {
  const t = useTranslations("acp.staffPage");
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.groupId });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="gcs-forumTree__item">
      <div className="gcs-forumTree__row gcs-staffEditor__row" data-testid="gcs-staff-editor-section" data-group-id={row.groupId}>
        <GcsTooltip content={t("drag", { name: row.name })}><button type="button" className="gcs-iconBtn gcs-forumTree__handle" aria-label={t("drag", { name: row.name })} {...attributes} {...listeners}>
          <GcsIconSvg icon={faGripVertical} />
        </button></GcsTooltip>
        <label className="gcs-field gcs-staffEditor__title">
          {t("titleLabel", { group: row.name })}
          <input className="gcs-input" value={row.title} maxLength={80} onChange={(e) => onPatch({ title: e.target.value })} data-testid="gcs-staff-editor-title" />
        </label>
        <div className="gcs-segLinks gcs-staffEditor__layout" role="radiogroup" aria-label={t("layout")}>
          {(["detailed", "compact"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={row.layout === l} className={`gcs-segLink${row.layout === l ? " gcs-segLink--active" : ""}`} onClick={() => onPatch({ layout: l })} data-testid={`gcs-staff-layout-${l}`}>
              {t(`layouts.${l}`)}
            </button>
          ))}
        </div>
        <label className="gcs-staffEditor__switch">
          <input type="checkbox" className="gcs-switch" role="switch" checked={row.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} aria-label={t("visible", { group: row.name })} />
          {t("visibleShort")}
        </label>
        <span className="gcs-muted gcs-staffEditor__count">{t("members", { count: row.members })}</span>
        <span className="gcs-forumTree__actions">
          <GcsTooltip content={t("moveUp", { name: row.name })}><button type="button" className="gcs-iconBtn" disabled={first} aria-label={t("moveUp", { name: row.name })} onClick={() => onMove(-1)}>
            <GcsIconSvg icon={faArrowUp} />
          </button></GcsTooltip>
          <GcsTooltip content={t("moveDown", { name: row.name })}><button type="button" className="gcs-iconBtn" disabled={last} aria-label={t("moveDown", { name: row.name })} onClick={() => onMove(1)}>
            <GcsIconSvg icon={faArrowDown} />
          </button></GcsTooltip>
        </span>
      </div>
    </li>
  );
}

/** Ordinea membrilor unei secțiuni (drag & drop sau ↑/↓), salvată imediat. */
export function GcsStaffMemberOrder({ groupId, members }: { groupId: number; members: { id: string; name: string }[] }) {
  const t = useTranslations("acp.staffPage");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(members);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, sensorsOptions), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function save(next: { id: string; name: string }[]) {
    const previous = rows;
    setRows(next);
    const res = await reorderStaffMembers(groupId, next.map((r) => r.id));
    if (!res.ok) {
      setRows(previous);
      setError(errorMessage(res.error));
    } else setError(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => {
        if (!e.over || e.active.id === e.over.id) return;
        void save(arrayMove(rows, rows.findIndex((r) => r.id === e.active.id), rows.findIndex((r) => r.id === e.over!.id)));
      }}
    >
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <ol className="gcs-forumTree gcs-staffEditor__members" aria-label={t("order")}>
          {rows.map((r, i) => (
            <MemberRow key={r.id} row={r} first={i === 0} last={i === rows.length - 1} onMove={(d) => void save(arrayMove(rows, i, i + d))} />
          ))}
        </ol>
      </SortableContext>
      {error && (
        <p role="alert" className="gcs-bulkBar__error">
          {error}
        </p>
      )}
    </DndContext>
  );
}

function MemberRow({ row, first, last, onMove }: { row: { id: string; name: string }; first: boolean; last: boolean; onMove: (d: -1 | 1) => void }) {
  const t = useTranslations("acp.staffPage");
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="gcs-forumTree__item">
      <div className="gcs-forumTree__row" data-testid="gcs-staff-order-member">
        <GcsTooltip content={t("drag", { name: row.name })}><button type="button" className="gcs-iconBtn gcs-forumTree__handle" aria-label={t("drag", { name: row.name })} {...attributes} {...listeners}>
          <GcsIconSvg icon={faGripVertical} />
        </button></GcsTooltip>
        <span className="gcs-forumTree__name">{row.name}</span>
        <span className="gcs-forumTree__actions">
          <GcsTooltip content={t("moveUp", { name: row.name })}><button type="button" className="gcs-iconBtn" disabled={first} aria-label={t("moveUp", { name: row.name })} onClick={() => onMove(-1)}>
            <GcsIconSvg icon={faArrowUp} />
          </button></GcsTooltip>
          <GcsTooltip content={t("moveDown", { name: row.name })}><button type="button" className="gcs-iconBtn" disabled={last} aria-label={t("moveDown", { name: row.name })} onClick={() => onMove(1)}>
            <GcsIconSvg icon={faArrowDown} />
          </button></GcsTooltip>
        </span>
      </div>
    </li>
  );
}
