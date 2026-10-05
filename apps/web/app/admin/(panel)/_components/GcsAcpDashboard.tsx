"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GcsAcpLayout, GcsAcpWidget } from "@gcs/core";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { saveAcpLayout } from "../actions";

type Column = "main" | "side";
type WidgetView = { title: string; body: ReactNode; extra?: ReactNode };

type Props = {
  layout: Omit<GcsAcpLayout, "appOrder">;
  widgets: Record<GcsAcpWidget, WidgetView>;
  labels: { move: Record<string, string>; collapse: Record<string, string>; expand: Record<string, string>; moveToOther: Record<string, string> };
};

/**
 * Dashboard-ul ACP (spec §12.2): widgeturi în două coloane, reordonabile cu mouse-ul sau din tastatură
 * (Space pe mâner, săgeți, Space), pliabile și mutabile între coloane. Layout-ul se salvează pe admin.
 */
export function GcsAcpDashboard({ layout, widgets, labels }: Props) {
  const [state, setState] = useState(layout);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function persist(next: typeof state) {
    setState(next);
    startTransition(() => {
      void saveAcpLayout(next);
    });
  }

  const columnOf = (id: GcsAcpWidget): Column => (state.main.includes(id) ? "main" : "side");

  function onDragEnd(e: DragEndEvent) {
    const active = e.active.id as GcsAcpWidget;
    const over = e.over?.id as GcsAcpWidget | undefined;
    if (!over || active === over) return;
    const from = columnOf(active);
    const to = columnOf(over);
    if (from === to) {
      const list = state[from];
      persist({ ...state, [from]: arrayMove(list, list.indexOf(active), list.indexOf(over)) });
    } else {
      const source = state[from].filter((w) => w !== active);
      const target = [...state[to]];
      target.splice(target.indexOf(over), 0, active);
      persist({ ...state, [from]: source, [to]: target });
    }
  }

  function moveToOther(id: GcsAcpWidget) {
    const from = columnOf(id);
    const to: Column = from === "main" ? "side" : "main";
    persist({ ...state, [from]: state[from].filter((w) => w !== id), [to]: [...state[to], id] });
  }

  function toggle(id: GcsAcpWidget) {
    const collapsed = state.collapsed.includes(id) ? state.collapsed.filter((w) => w !== id) : [...state.collapsed, id];
    persist({ ...state, collapsed });
  }

  const column = (name: Column, style: CSSProperties) => (
    <SortableContext items={state[name]} strategy={verticalListSortingStrategy}>
      <div data-testid={`gcs-acp-column-${name}`} style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0, ...style }}>
        {state[name].map((id) => (
          <SortableWidget
            key={id}
            id={id}
            view={widgets[id]}
            collapsed={state.collapsed.includes(id)}
            onToggle={() => toggle(id)}
            onMoveToOther={() => moveToOther(id)}
            labels={{
              move: labels.move[id]!,
              collapse: labels.collapse[id]!,
              expand: labels.expand[id]!,
              moveToOther: labels.moveToOther[id]!,
            }}
          />
        ))}
      </div>
    </SortableContext>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        {column("main", { flex: "999 1 560px" })}
        {column("side", { flex: "1 1 320px" })}
      </div>
    </DndContext>
  );
}

function SortableWidget({
  id,
  view,
  collapsed,
  onToggle,
  onMoveToOther,
  labels,
}: {
  id: GcsAcpWidget;
  view: WidgetView;
  collapsed: boolean;
  onToggle: () => void;
  onMoveToOther: () => void;
  labels: { move: string; collapse: string; expand: string; moveToOther: string };
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const bodyId = `gcs-widget-${id}`;
  return (
    <section
      ref={setNodeRef}
      className="gcs-card"
      data-widget={id}
      aria-label={view.title}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, position: "relative" }}
    >
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">
          <button
            type="button"
            className="gcs-iconBtn"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? labels.expand : labels.collapse}
            onClick={onToggle}
            style={{ width: 24, height: 24 }}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          {view.title}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {view.extra}
          <button type="button" className="gcs-iconBtn" aria-label={labels.moveToOther} onClick={onMoveToOther}>
            ⇄
          </button>
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="gcs-iconBtn"
            aria-label={labels.move}
            style={{ cursor: "grab", touchAction: "none" }}
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        </div>
      </div>
      <div id={bodyId} hidden={collapsed}>
        {view.body}
      </div>
    </section>
  );
}
