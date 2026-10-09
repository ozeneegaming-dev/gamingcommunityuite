"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { faArrowDown, faArrowUp, faArrowUpRightFromSquare, faGripVertical, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsBadge, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../_components/types";
import { deleteServer, reorderServers } from "./actions";

export type GcsServerOrderRow = {
  id: number;
  name: string;
  href: string;
  gameName: string;
  gameIcon: GcsAcpIconDef | null;
  address: string;
  enabled: boolean;
  restricted: boolean;
  /** Textul statusului, deja tradus pe server. */
  status: string;
  online: boolean;
};

/**
 * Lista serverelor din ACP (Gaming → Servere): drag & drop de mâner (și din tastatură: Spațiu, săgeți, Spațiu), butoane
 * ↑/↓, editare, pagina publică și ștergere. Ordinea se salvează imediat.
 */
export function GcsServerOrder({ servers }: { servers: GcsServerOrderRow[] }) {
  const t = useTranslations("acp.servers");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [rows, setRows] = useState(servers);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function save(next: GcsServerOrderRow[]) {
    const previous = rows;
    setRows(next);
    const res = await reorderServers(next.map((r) => r.id));
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

  async function remove(row: GcsServerOrderRow) {
    if (!window.confirm(t("confirmDelete", { name: row.name }))) return;
    // A doua întrebare: și jucătorii văzuți doar aici (ex. la un server de test), cu statisticile și ELO-ul lor.
    const purgePlayers = window.confirm(t("confirmPurgePlayers"));
    const res = await deleteServer(row.id, purgePlayers);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    setRows((list) => list.filter((r) => r.id !== row.id));
    router.refresh();
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="gcs-forumTree" data-testid="gcs-acp-servers">
            {rows.map((row, i) => (
              <Row
                key={row.id}
                row={row}
                first={i === 0}
                last={i === rows.length - 1}
                onMove={(delta) => void save(arrayMove(rows, i, i + delta))}
                onDelete={() => void remove(row)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"}>
          {status.text}
        </p>
      )}
    </div>
  );
}

type RowProps = { row: GcsServerOrderRow; first: boolean; last: boolean; onMove: (delta: -1 | 1) => void; onDelete: () => void };

function Row({ row, first, last, onMove, onDelete }: RowProps) {
  const t = useTranslations("acp.servers");
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="gcs-forumTree__item">
      <div className="gcs-forumTree__row" data-testid="gcs-acp-server" data-server-name={row.name}>
        <button type="button" className="gcs-iconBtn gcs-forumTree__handle" aria-label={t("drag", { name: row.name })} {...attributes} {...listeners}>
          <GcsIconSvg icon={faGripVertical} />
        </button>
        {row.gameIcon && <GcsIconSvg icon={row.gameIcon} className="gcs-forumTree__icon" />}
        <span className="gcs-forumTree__name">
          {row.name}
          <span className="gcs-muted" style={{ display: "block", fontSize: 12, fontWeight: 500 }}>
            {row.gameName} · <code>{row.address}</code>
          </span>
        </span>
        <GcsBadge tone={row.online ? "ok" : "neutral"}>{row.status}</GcsBadge>
        {!row.enabled && <GcsBadge tone="warn">{t("disabled")}</GcsBadge>}
        {row.restricted && <GcsBadge tone="info">{t("restricted")}</GcsBadge>}
        <span className="gcs-forumTree__actions">
          <button type="button" className="gcs-iconBtn" disabled={first} aria-label={t("moveUp", { name: row.name })} onClick={() => onMove(-1)}>
            <GcsIconSvg icon={faArrowUp} />
          </button>
          <button type="button" className="gcs-iconBtn" disabled={last} aria-label={t("moveDown", { name: row.name })} onClick={() => onMove(1)}>
            <GcsIconSvg icon={faArrowDown} />
          </button>
          <Link href={`/admin/gaming/servers/${row.id}`} className="gcs-acpBack">
            <GcsIconSvg icon={faPen} />
            {t("edit")}
          </Link>
          {row.enabled && (
            <Link href={row.href} className="gcs-acpBack">
              <GcsIconSvg icon={faArrowUpRightFromSquare} />
              {t("view")}
            </Link>
          )}
          <button type="button" className="gcs-acpBack" onClick={onDelete} aria-label={`${t("delete")}: ${row.name}`} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--gcs-accentInk)", font: "inherit" }}>
            <GcsIconSvg icon={faTrash} />
            {t("delete")}
          </button>
        </span>
      </div>
    </li>
  );
}
