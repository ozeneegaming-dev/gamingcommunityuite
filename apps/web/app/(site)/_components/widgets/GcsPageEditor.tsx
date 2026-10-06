"use client";

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GcsWidgetPage, GcsWidgetZone } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { faArrowDown, faArrowUp, faGear, faGripVertical, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { closePageEditor, resetPageLayout, savePageLayout } from "../../edit-actions";

const ZONES: GcsWidgetZone[] = ["top", "sidebar", "bottom"];

export type GcsPageEditorItem = {
  uid: string;
  type: string;
  config: Record<string, unknown>;
  groups: number[];
  /** Widget-ul randat pe server (lipsește pentru cele adăugate acum, până la salvare). */
  preview: ReactNode;
};
type Field =
  | { key: string; label: string; type: "number"; min: number; max: number }
  | { key: string; label: string; type: "text" | "textarea"; maxLength: number }
  | { key: string; label: string; type: "select"; options?: { value: string; label: string }[] };
export type GcsPageEditorWidget = { key: string; label: string; icon: ReactNode; zones: readonly GcsWidgetZone[]; defaultConfig: Record<string, unknown>; fields: Field[] };
type Zones = Record<GcsWidgetZone, GcsPageEditorItem[]>;

type Props = {
  page: GcsWidgetPage;
  pageLabel: string;
  initial: Zones;
  catalog: GcsPageEditorWidget[];
  groups: { id: number; name: string }[];
  children: ReactNode;
};

/**
 * Modul „Editează pagina” (specul etapei 5): zonele (sus, coloana din dreapta, jos) devin liste sortabile cu
 * `@dnd-kit` (mouse, atingere și tastatură: Spațiu ridică, săgețile mută, Spațiu lasă). Fiecare widget se poate muta
 * și cu butoanele ↑ ↓ sau în altă zonă, configura, restrânge la anumite grupuri sau șterge; „Salvează” aplică layout-ul.
 */
export function GcsPageEditor({ page, pageLabel, initial, catalog, groups, children }: Props) {
  const t = useTranslations("pageEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [zones, setZones] = useState<Zones>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<GcsWidgetZone | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDefault, setConfirmDefault] = useState(false);
  const counter = useRef(0);
  const byKey = useMemo(() => new Map(catalog.map((w) => [w.key, w])), [catalog]);
  const dirty = useMemo(() => JSON.stringify(strip(zones)) !== JSON.stringify(strip(initial)), [zones, initial]);

  // Layout-ul salvat (după „Salvează”) vine din nou de pe server, cu previzualizările noi.
  useEffect(() => setZones(initial), [initial]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const zoneOf = (id: string): GcsWidgetZone | undefined =>
    (ZONES as string[]).includes(id) ? (id as GcsWidgetZone) : ZONES.find((z) => zones[z].some((i) => i.uid === id));
  /** Numele unui widget sau al unei zone (pentru anunțurile cititorului de ecran). */
  const nameOf = (id: string) => {
    if ((ZONES as string[]).includes(id)) return t(`zones.${id as GcsWidgetZone}`);
    const item = ZONES.flatMap((z) => zones[z]).find((i) => i.uid === id);
    return item ? (byKey.get(item.type)?.label ?? item.type) : id;
  };
  const allowed = (item: GcsPageEditorItem, zone: GcsWidgetZone) => byKey.get(item.type)?.zones.includes(zone) ?? false;

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = zoneOf(String(active.id));
    const to = zoneOf(String(over.id));
    if (!from || !to || from === to) return;
    setZones((z) => {
      const item = z[from].find((i) => i.uid === active.id);
      if (!item || !allowed(item, to)) return z;
      const overIndex = z[to].findIndex((i) => i.uid === over.id);
      const target = [...z[to]];
      target.splice(overIndex < 0 ? target.length : overIndex, 0, item);
      return { ...z, [from]: z[from].filter((i) => i.uid !== active.id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const zone = zoneOf(String(active.id));
    if (!zone || zone !== zoneOf(String(over.id))) return;
    setZones((z) => {
      const oldIndex = z[zone].findIndex((i) => i.uid === active.id);
      const newIndex = z[zone].findIndex((i) => i.uid === over.id);
      return oldIndex < 0 || newIndex < 0 || oldIndex === newIndex ? z : { ...z, [zone]: arrayMove(z[zone], oldIndex, newIndex) };
    });
  };

  const update = (uid: string, patch: Partial<GcsPageEditorItem>) =>
    setZones((z) => Object.fromEntries(ZONES.map((zone) => [zone, z[zone].map((i) => (i.uid === uid ? { ...i, ...patch } : i))])) as Zones);
  const remove = (uid: string) => setZones((z) => Object.fromEntries(ZONES.map((zone) => [zone, z[zone].filter((i) => i.uid !== uid)])) as Zones);
  const step = (zone: GcsWidgetZone, index: number, delta: -1 | 1) =>
    setZones((z) => {
      const to = index + delta;
      return to < 0 || to >= z[zone].length ? z : { ...z, [zone]: arrayMove(z[zone], index, to) };
    });
  const moveTo = (uid: string, to: GcsWidgetZone) =>
    setZones((z) => {
      const from = ZONES.find((zone) => z[zone].some((i) => i.uid === uid));
      const item = from ? z[from].find((i) => i.uid === uid) : undefined;
      if (!from || !item || from === to) return z;
      return { ...z, [from]: z[from].filter((i) => i.uid !== uid), [to]: [...z[to], item] };
    });
  const add = (zone: GcsWidgetZone, w: GcsPageEditorWidget) => {
    const uid = `n${++counter.current}`;
    setZones((z) => ({ ...z, [zone]: [...z[zone], { uid, type: w.key, config: { ...w.defaultConfig }, groups: [], preview: null }] }));
    setAdding(null);
    setOpen(w.fields.length > 0 ? uid : null);
  };

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      const placements = ZONES.flatMap((zone) => zones[zone].map((i) => ({ zone, type: i.type, config: i.config, groups: i.groups })));
      const res = await savePageLayout({ page, placements });
      if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
      setStatus({ tone: "ok", text: t("saved") });
      setOpen(null);
      router.refresh();
    });

  const restoreDefault = () =>
    startTransition(async () => {
      setConfirmDefault(false);
      const res = await resetPageLayout({ page });
      if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
      setStatus({ tone: "ok", text: t("defaultRestored") });
      setOpen(null);
      router.refresh();
    });

  const exit = () =>
    startTransition(async () => {
      await closePageEditor();
      router.refresh();
    });

  const zoneBox = (zone: GcsWidgetZone) => (
    <EditZone key={zone} zone={zone} label={t(`zones.${zone}`)} empty={t("emptyZone")} count={zones[zone].length}>
      <SortableContext id={zone} items={zones[zone].map((i) => i.uid)} strategy={verticalListSortingStrategy}>
        {zones[zone].map((item, index) => {
          const w = byKey.get(item.type);
          return (
            <EditItem
              key={item.uid}
              item={item}
              widget={w}
              index={index}
              count={zones[zone].length}
              zone={zone}
              open={open === item.uid}
              groups={groups}
              onToggle={() => setOpen(open === item.uid ? null : item.uid)}
              onStep={(d) => step(zone, index, d)}
              onMove={(to) => moveTo(item.uid, to)}
              onRemove={() => remove(item.uid)}
              onChange={(patch) => update(item.uid, patch)}
            />
          );
        })}
      </SortableContext>
      {adding === zone ? (
        <div className="gcs-editZone__catalog" role="list" aria-label={t("catalog")} data-testid={`gcs-widget-catalog-${zone}`}>
          {catalog
            .filter((w) => w.zones.includes(zone))
            .map((w) => (
              <button key={w.key} type="button" role="listitem" className="gcs-editZone__catalogItem" onClick={() => add(zone, w)}>
                {w.icon}
                <span>{w.label}</span>
              </button>
            ))}
          <GcsButton variant="ghost" size="sm" onClick={() => setAdding(null)}>
            {t("cancel")}
          </GcsButton>
        </div>
      ) : (
        <button type="button" className="gcs-editZone__add" onClick={() => setAdding(zone)} data-testid={`gcs-widget-add-${zone}`}>
          <GcsIconSvg icon={faPlus} /> {t("add")}
        </button>
      )}
    </EditZone>
  );

  return (
    <div className="gcs-widgetPage gcs-widgetPage--editing" data-page={page} data-testid="gcs-page-editor">
      <div className="gcs-pageEditorBar" role="toolbar" aria-label={t("title")}>
        <strong>{t("editing", { page: pageLabel })}</strong>
        <span role="status" className={`gcs-pageEditorBar__status gcs-pageEditorBar__status--${status?.tone ?? "muted"}`} data-testid="gcs-page-editor-status">
          {status?.text ?? (dirty ? t("unsaved") : "")}
        </span>
        <div className="gcs-pageEditorBar__buttons">
          {confirmDefault ? (
            <GcsButton variant="ghost" size="sm" onClick={restoreDefault} disabled={pending} data-testid="gcs-page-editor-default-confirm">
              {t("confirmDefault")}
            </GcsButton>
          ) : (
            <GcsButton variant="ghost" size="sm" onClick={() => setConfirmDefault(true)} disabled={pending} data-testid="gcs-page-editor-default">
              {t("restoreDefault")}
            </GcsButton>
          )}
          <GcsButton variant="ghost" size="sm" onClick={() => setZones(initial)} disabled={!dirty || pending}>
            {t("reset")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" onClick={exit} disabled={pending} data-testid="gcs-page-editor-exit">
            {dirty ? t("exitWithoutSaving") : t("exit")}
          </GcsButton>
          <GcsButton variant="primary" size="sm" onClick={save} disabled={!dirty || pending} data-testid="gcs-page-editor-save">
            {t("save")}
          </GcsButton>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: { draggable: t("dragInstructions") },
          announcements: {
            onDragStart: ({ active }) => t("announce.start", { name: nameOf(String(active.id)) }),
            onDragOver: ({ active, over }) => (over && over.id !== active.id ? t("announce.over", { name: nameOf(String(active.id)), over: nameOf(String(over.id)) }) : undefined),
            onDragEnd: ({ active, over }) => (over ? t("announce.end", { name: nameOf(String(active.id)), over: nameOf(String(over.id)) }) : t("announce.cancel", { name: nameOf(String(active.id)) })),
            onDragCancel: ({ active }) => t("announce.cancel", { name: nameOf(String(active.id)) }),
          },
        }}
      >
        {zoneBox("top")}
        <div className="gcs-forumLayout">
          <div className="gcs-forumLayout__main gcs-widgetPage__content">{children}</div>
          <div className="gcs-forumSidebar">{zoneBox("sidebar")}</div>
        </div>
        {zoneBox("bottom")}
      </DndContext>
    </div>
  );
}

/** Ce se compară pentru „modificări nesalvate” (fără previzualizări). */
function strip(z: Zones) {
  return ZONES.map((zone) => z[zone].map((i) => [i.uid, i.type, i.config, i.groups]));
}

/**
 * O zonă e țintă de drop doar cât e goală; una cu widget-uri primește widget-uri prin ele. Altfel, din tastatură,
 * `sortableKeyboardCoordinates` ar putea alege containerul în locul vecinului (mutarea s-ar pierde).
 */
function EditZone({ zone, label, empty, count, children }: { zone: GcsWidgetZone; label: string; empty: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: zone, disabled: count > 0 });
  return (
    <section ref={setNodeRef} className={`gcs-editZone gcs-editZone--${zone}${isOver ? " gcs-editZone--over" : ""}`} aria-label={label} data-zone={zone} data-testid={`gcs-zone-${zone}`}>
      <header className="gcs-editZone__label">{label}</header>
      <div className="gcs-editZone__list" data-empty={empty}>
        {children}
      </div>
    </section>
  );
}

type ItemProps = {
  item: GcsPageEditorItem;
  widget: GcsPageEditorWidget | undefined;
  index: number;
  count: number;
  zone: GcsWidgetZone;
  open: boolean;
  groups: { id: number; name: string }[];
  onToggle: () => void;
  onStep: (delta: -1 | 1) => void;
  onMove: (zone: GcsWidgetZone) => void;
  onRemove: () => void;
  onChange: (patch: Partial<GcsPageEditorItem>) => void;
};

function EditItem({ item, widget, index, count, zone, open, groups, onToggle, onStep, onMove, onRemove, onChange }: ItemProps) {
  const t = useTranslations("pageEditor");
  const fieldId = useId();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid });
  const name = widget?.label ?? item.type;
  const setConfig = (key: string, value: unknown) => onChange({ config: { ...item.config, [key]: value } });
  const toggleGroup = (id: number) => onChange({ groups: item.groups.includes(id) ? item.groups.filter((g) => g !== id) : [...item.groups, id] });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`gcs-editItem${isDragging ? " gcs-editItem--dragging" : ""}`}
      data-widget-type={item.type}
      data-testid="gcs-edit-item"
    >
      <header className="gcs-editItem__bar">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="gcs-editItem__handle"
          aria-label={t("drag", { name })}
          data-testid="gcs-edit-item-handle"
          {...attributes}
          {...listeners}
        >
          <GcsIconSvg icon={faGripVertical} />
        </button>
        <span className="gcs-editItem__name">
          {widget?.icon}
          <strong>{name}</strong>
          {item.groups.length > 0 && <span className="gcs-badge">{t("restricted")}</span>}
        </span>
        <span className="gcs-editItem__tools">
          <button type="button" className="gcs-headerIcon" onClick={() => onStep(-1)} disabled={index === 0} aria-label={t("moveUp", { name })}>
            <GcsIconSvg icon={faArrowUp} />
          </button>
          <button type="button" className="gcs-headerIcon" onClick={() => onStep(1)} disabled={index === count - 1} aria-label={t("moveDown", { name })}>
            <GcsIconSvg icon={faArrowDown} />
          </button>
          <select className="gcs-input gcs-editItem__zone" value={zone} onChange={(e) => onMove(e.target.value as GcsWidgetZone)} aria-label={t("zone", { name })} data-testid="gcs-edit-item-zone">
            {ZONES.filter((z) => z === zone || widget?.zones.includes(z)).map((z) => (
              <option key={z} value={z}>
                {t(`zones.${z}`)}
              </option>
            ))}
          </select>
          <button type="button" className="gcs-headerIcon" onClick={onToggle} aria-expanded={open} aria-label={t("configure", { name })} data-testid="gcs-edit-item-config">
            <GcsIconSvg icon={faGear} />
          </button>
          <button type="button" className="gcs-headerIcon" onClick={onRemove} aria-label={t("remove", { name })} data-testid="gcs-edit-item-remove">
            <GcsIconSvg icon={faTrashCan} />
          </button>
        </span>
      </header>

      {open && (
        <div className="gcs-editItem__config" data-testid="gcs-edit-item-panel">
          {widget?.fields.map((f) => {
            const id = `${fieldId}-${f.key}`;
            const value = item.config[f.key];
            return (
              <label key={f.key} htmlFor={id} className="gcs-themeEditor__row">
                <span>{f.label}</span>
                {f.type === "number" ? (
                  <input id={id} className="gcs-input" type="number" min={f.min} max={f.max} value={typeof value === "number" ? value : ""} onChange={(e) => setConfig(f.key, Number(e.target.value))} />
                ) : f.type === "select" ? (
                  <select id={id} className="gcs-input" value={typeof value === "string" ? value : ""} onChange={(e) => setConfig(f.key, e.target.value)}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea id={id} className="gcs-input" rows={5} maxLength={f.maxLength} value={typeof value === "string" ? value : ""} onChange={(e) => setConfig(f.key, e.target.value)} />
                ) : (
                  <input id={id} className="gcs-input" maxLength={f.maxLength} value={typeof value === "string" ? value : ""} onChange={(e) => setConfig(f.key, e.target.value)} />
                )}
              </label>
            );
          })}
          <fieldset className="gcs-editItem__groups">
            <legend>{t("visibility")}</legend>
            <p className="gcs-muted">{t("visibilityHint")}</p>
            {groups.map((g) => (
              <label key={g.id} className="gcs-check">
                <input type="checkbox" checked={item.groups.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                <span>{g.name}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}

      <div className="gcs-editItem__preview" inert>
        {item.preview ?? (
          <p className="gcs-editItem__placeholder">
            {widget?.icon} {t("previewAfterSave")}
          </p>
        )}
      </div>
    </article>
  );
}
