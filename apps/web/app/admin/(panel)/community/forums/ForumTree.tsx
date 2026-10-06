"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  faArrowDown,
  faArrowUp,
  faArrowUpRightFromSquare,
  faCircleQuestion,
  faComments,
  faFolder,
  faGripVertical,
  faKey,
  faLink,
  faPen,
} from "@fortawesome/free-solid-svg-icons";
import { GcsBadge, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../_components/types";
import { reorderForums } from "./actions";

/** `icon`: iconița aleasă pentru forum, rezolvată pe server (lipsă → iconița tipului). */
export type ForumNode = {
  id: number;
  parentId: number | null;
  type: "CATEGORY" | "FORUM" | "QA" | "LINK";
  name: string;
  slug: string;
  position: number;
  icon?: GcsAcpIconDef | null;
};

/** Iconița implicită după tipul forumului, când adminul nu a ales una. */
const TYPE_ICONS: Record<ForumNode["type"], GcsAcpIconDef> = { CATEGORY: faFolder, FORUM: faComments, QA: faCircleQuestion, LINK: faLink };

/** Copiii fiecărui nod, ordonați după poziție. */
function childrenOf(nodes: ForumNode[], parentId: number | null): ForumNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.position - b.position || a.id - b.id);
}

function descendants(nodes: ForumNode[], id: number): Set<number> {
  const out = new Set<number>();
  const walk = (pid: number) => {
    for (const c of nodes) {
      if (c.parentId !== pid || out.has(c.id)) continue;
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Arborele forumurilor (ACP → Comunitate → Forumuri): drag & drop în cadrul aceluiași nivel, butoane ↑/↓ din tastatură
 * și „Mută sub…” pentru schimbarea părintelui. Fiecare schimbare se salvează imediat (`reorderForums`).
 */
export function ForumTree({ forums }: { forums: ForumNode[] }) {
  const t = useTranslations("acp.forums");
  const errorMessage = useErrorMessage();
  const [nodes, setNodes] = useState(forums);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function save(next: ForumNode[]) {
    // Pozițiile se renumerotează pe fiecare nivel.
    const parents = new Set(next.map((n) => n.parentId));
    const renumbered = next.map((n) => ({ ...n }));
    for (const p of parents) childrenOf(renumbered, p).forEach((n, i) => (n.position = i));
    const previous = nodes;
    setNodes(renumbered);
    const res = await reorderForums(renumbered.map((n) => ({ id: n.id, parentId: n.parentId, position: n.position })));
    if (!res.ok) {
      setNodes(previous);
      setStatus({ ok: false, text: errorMessage(res.error) });
    } else {
      setStatus({ ok: true, text: t("saved") });
    }
  }

  function moveWithin(parentId: number | null, from: number, to: number) {
    const siblings = arrayMove(childrenOf(nodes, parentId), from, to);
    const positions = new Map(siblings.map((s, i) => [s.id, i]));
    void save(nodes.map((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n)));
  }

  function setParent(id: number, parentId: number | null) {
    const end = childrenOf(nodes, parentId).length;
    void save(nodes.map((n) => (n.id === id ? { ...n, parentId, position: end } : n)));
  }

  function onDragEnd(parentId: number | null, e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const siblings = childrenOf(nodes, parentId);
    moveWithin(parentId, siblings.findIndex((s) => s.id === e.active.id), siblings.findIndex((s) => s.id === e.over!.id));
  }

  function level(parentId: number | null, depth: number) {
    const siblings = childrenOf(nodes, parentId);
    if (siblings.length === 0) return null;
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(parentId, e)}>
        <SortableContext items={siblings.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="gcs-forumTree" data-depth={depth}>
            {siblings.map((node, i) => (
              <TreeRow
                key={node.id}
                node={node}
                index={i}
                count={siblings.length}
                parents={nodes.filter((p) => p.id !== node.id && !descendants(nodes, node.id).has(p.id) && p.type !== "LINK")}
                onMove={(to) => moveWithin(parentId, i, to)}
                onParent={(pid) => setParent(node.id, pid)}
              >
                {level(node.id, depth + 1)}
              </TreeRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div>
      {nodes.length === 0 ? <p className="gcs-muted">{t("empty")}</p> : level(null, 0)}
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"}>
          {status.text}
        </p>
      )}
    </div>
  );
}

type RowProps = {
  node: ForumNode;
  index: number;
  count: number;
  parents: ForumNode[];
  onMove: (to: number) => void;
  onParent: (parentId: number | null) => void;
  children: React.ReactNode;
};

function TreeRow({ node, index, count, parents, onMove, onParent, children }: RowProps) {
  const t = useTranslations("acp.forums");
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: node.id });
  const isCategory = node.type === "CATEGORY";
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="gcs-forumTree__item">
      <div className="gcs-forumTree__row" data-testid="gcs-acp-forum" data-forum-name={node.name}>
        <button type="button" className="gcs-iconBtn gcs-forumTree__handle" aria-label={t("drag", { name: node.name })} {...attributes} {...listeners}>
          <GcsIconSvg icon={faGripVertical} />
        </button>
        <GcsIconSvg icon={node.icon ?? TYPE_ICONS[node.type]} className="gcs-forumTree__icon" />
        <span className="gcs-forumTree__name">{node.name}</span>
        <GcsBadge tone={isCategory ? "accent" : node.type === "QA" ? "ok" : node.type === "LINK" ? "neutral" : "info"}>{t(`types.${node.type}`)}</GcsBadge>
        <span className="gcs-forumTree__actions">
          <button type="button" className="gcs-iconBtn" disabled={index === 0} aria-label={t("moveUp", { name: node.name })} onClick={() => onMove(index - 1)}>
            <GcsIconSvg icon={faArrowUp} />
          </button>
          <button type="button" className="gcs-iconBtn" disabled={index === count - 1} aria-label={t("moveDown", { name: node.name })} onClick={() => onMove(index + 1)}>
            <GcsIconSvg icon={faArrowDown} />
          </button>
          {!isCategory && (
            <select
              className="gcs-input gcs-forumTree__parent"
              aria-label={t("parent", { name: node.name })}
              value={node.parentId ?? ""}
              onChange={(e) => onParent(e.target.value ? Number(e.target.value) : null)}
            >
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Link href={`/admin/community/forums/${node.id}`} className="gcs-acpBack">
            <GcsIconSvg icon={faPen} />
            {t("edit")}
          </Link>
          <Link href={`/admin/permissions/forum/${node.id}`} className="gcs-acpBack">
            <GcsIconSvg icon={faKey} />
            {t("permissions")}
          </Link>
          <Link href={`/forum/${node.id}-${node.slug}`} className="gcs-acpBack">
            <GcsIconSvg icon={faArrowUpRightFromSquare} />
            {t("view")}
          </Link>
        </span>
      </div>
      {children}
    </li>
  );
}
