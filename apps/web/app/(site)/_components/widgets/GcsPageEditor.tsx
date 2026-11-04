"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GcsWidgetPage, GcsWidgetZone } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import type { GcsEditorAllow } from "@gcs/ui/editor";
import {
  faArrowDown,
  faArrowRotateLeft,
  faArrowUp,
  faArrowsRotate,
  faEye,
  faFloppyDisk,
  faGear,
  faGripVertical,
  faPlus,
  faTrashCan,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { closePageEditor, resetPageLayout, savePageLayout, saveWidgetFavorites } from "../../edit-actions";
import { GcsWidgetSidebar } from "./GcsWidgetSidebar";

const ZONES: GcsWidgetZone[] = ["top", "main", "sidebar", "bottom"];
/** Editorul textului formatat (Tiptap) se încarcă doar când se deschide configurarea unui widget care îl folosește. */
const GcsRichTextInput = dynamic(() => import("../editor/GcsRichTextInput").then((m) => m.GcsRichTextInput), { ssr: false });
/** Id-urile dnd-kit ale zonelor de drop pentru widget-urile noi („Trage widget-urile aici”). */
const DROP_PREFIX = "drop:";

export type GcsPageEditorItem = {
  uid: string;
  type: string;
  config: Record<string, unknown>;
  groups: number[];
  /** Widget-ul randat pe server (lipsește pentru cele adăugate acum, până la salvare). */
  preview: ReactNode;
};
/** Un câmp din configurarea unui widget, cu eticheta tradusă (vezi `GcsWidgetField` din nucleu). */
export type GcsPageEditorField =
  | { key: string; label: string; type: "number"; min: number; max: number }
  | { key: string; label: string; type: "text" | "textarea"; maxLength: number }
  | { key: string; label: string; type: "richtext"; maxLength: number; allow: GcsEditorAllow }
  | { key: string; label: string; type: "select"; options?: { value: string; label: string }[] };
export type GcsPageEditorWidget = {
  key: string;
  label: string;
  description: string;
  /** Categoria din lista „Widget-uri disponibile” (modulul widget-ului) și eticheta ei. */
  category: string;
  categoryLabel: string;
  icon: ReactNode;
  zones: readonly GcsWidgetZone[];
  defaultConfig: Record<string, unknown>;
  fields: GcsPageEditorField[];
};
type Zones = Record<GcsWidgetZone, GcsPageEditorItem[]>;

type Props = {
  page: GcsWidgetPage;
  pageLabel: string;
  initial: Zones;
  catalog: GcsPageEditorWidget[];
  groups: { id: number; name: string }[];
  /** Widget-urile favorite ale adminului (`users.prefs.widgetFavorites`). */
  favorites: string[];
  children: ReactNode;
};

/** Cheia widget-ului nou tras din listă (lipsește pentru widget-urile deja pe pagină). */
const newWidgetKey = (data: { current?: Record<string, unknown> | undefined }): string | undefined =>
  typeof data.current?.newWidget === "string" ? data.current.newWidget : undefined;

/**
 * Widget-urile noi se lasă unde e indicatorul (lista e fixată, iar pagina se poate derula); mutările din pagină
 * rămân pe colțurile cele mai apropiate (merg și din tastatură).
 */
const collision: CollisionDetection = (args) => {
  if (!newWidgetKey(args.active.data)) return closestCorners(args);
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Modul „Editează pagina” (specul etapei 5): în stânga, lista „Widget-uri disponibile” (căutare, favorite, categorii),
 * din care widget-urile se trag pe pagină sau se adaugă cu „+”; zonele paginii (sus, coloana din dreapta, jos) devin
 * liste sortabile cu `@dnd-kit` (mouse, atingere și tastatură: Spațiu ridică, săgețile mută, Spațiu lasă), fiecare
 * cu zona de drop „Trage widget-urile aici”. Un widget se poate muta și cu butoanele ↑ ↓ sau în altă zonă, configura,
 * restrânge la anumite grupuri sau șterge; „Termină editarea” salvează layout-ul și închide editorul.
 */
export function GcsPageEditor({ page, pageLabel, initial, catalog, groups, favorites: initialFavorites, children }: Props) {
  const t = useTranslations("pageEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [zones, setZones] = useState<Zones>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<GcsWidgetZone | null>(null);
  const [dragging, setDragging] = useState<GcsPageEditorWidget | null>(null);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDefault, setConfirmDefault] = useState(false);
  const counter = useRef(0);
  const byKey = useMemo(() => new Map(catalog.map((w) => [w.key, w])), [catalog]);
  const dirty = useMemo(() => JSON.stringify(strip(zones)) !== JSON.stringify(strip(initial)), [zones, initial]);

  // Layout-ul salvat (după „Salvează”) vine din nou de pe server, cu previzualizările noi.
  useEffect(() => setZones(initial), [initial]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const zoneOf = (id: string): GcsWidgetZone | undefined => {
    if (id.startsWith(DROP_PREFIX)) id = id.slice(DROP_PREFIX.length);
    return (ZONES as string[]).includes(id) ? (id as GcsWidgetZone) : ZONES.find((z) => zones[z].some((i) => i.uid === id));
  };
  /** Numele unui widget sau al unei zone (pentru anunțurile cititorului de ecran). */
  const nameOf = (id: string) => {
    if (id.startsWith("new:")) return byKey.get(id.split(":").slice(2).join(":"))?.label ?? id;
    const zone = id.startsWith(DROP_PREFIX) ? id.slice(DROP_PREFIX.length) : id;
    if ((ZONES as string[]).includes(zone)) return t(`zones.${zone as GcsWidgetZone}`);
    const item = ZONES.flatMap((z) => zones[z]).find((i) => i.uid === id);
    return item ? (byKey.get(item.type)?.label ?? item.type) : id;
  };
  const allowed = (item: GcsPageEditorItem, zone: GcsWidgetZone) => byKey.get(item.type)?.zones.includes(zone) ?? false;

  const add = (zone: GcsWidgetZone, w: GcsPageEditorWidget, index?: number) => {
    const uid = `n${++counter.current}`;
    setZones((z) => {
      const list = [...z[zone]];
      list.splice(index ?? list.length, 0, { uid, type: w.key, config: { ...w.defaultConfig }, groups: [], preview: null });
      return { ...z, [zone]: list };
    });
    setAdding(null);
    setStatus(null);
    setOpen(w.fields.length > 0 ? uid : null);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const key = newWidgetKey(active.data);
    setDragging(key ? (byKey.get(key) ?? null) : null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    // Un widget nou intră în pagină doar la final (unde e lăsat); cele existente se mută între zone pe loc.
    if (!over || newWidgetKey(active.data)) return;
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
    const key = newWidgetKey(active.data);
    if (key) {
      setDragging(null);
      const w = byKey.get(key);
      const zone = over ? zoneOf(String(over.id)) : undefined;
      if (!w || !zone || !w.zones.includes(zone)) return;
      const index = zones[zone].findIndex((i) => i.uid === over!.id);
      return add(zone, w, index < 0 ? undefined : index);
    }
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

  const toggleFavorite = (key: string) => {
    const next = favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
    setFavorites(next);
    void saveWidgetFavorites({ keys: next }).then((res) => {
      if (!res.ok) setStatus({ tone: "error", text: errorMessage(res.error) });
    });
  };

  /** Salvează layout-ul (validarea completă e pe server); `false` dacă n-a mers (mesajul e deja afișat). */
  const persist = async () => {
    const placements = ZONES.flatMap((zone) => zones[zone].map((i) => ({ zone, type: i.type, config: i.config, groups: i.groups })));
    const res = await savePageLayout({ page, placements });
    if (!res.ok) setStatus({ tone: "error", text: errorMessage(res.error) });
    return res.ok;
  };

  const save = () =>
    startTransition(async () => {
      setStatus(null);
      if (!(await persist())) return;
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

  /** „Termină editarea”: salvează ce e nesalvat, apoi închide modul de editare. */
  const done = () =>
    startTransition(async () => {
      setStatus(null);
      if (dirty && !(await persist())) return;
      await closePageEditor();
      router.refresh();
    });

  const exitWithoutSaving = () =>
    startTransition(async () => {
      await closePageEditor();
      router.refresh();
    });

  const zoneBox = (zone: GcsWidgetZone) => (
    <EditZone key={zone} zone={zone} label={t(`zones.${zone}`)} count={zones[zone].length}>
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
      {adding === zone && (
        <div className="gcs-editZone__catalog" role="list" aria-label={t("catalog")} data-testid={`gcs-widget-catalog-${zone}`}>
          {catalog
            .filter((w) => w.zones.includes(zone))
            .map((w) => (
              <button key={w.key} type="button" role="listitem" className="gcs-editZone__catalogItem" onClick={() => add(zone, w)}>
                {w.icon}
                <span>{w.label}</span>
              </button>
            ))}
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faXmark} />} onClick={() => setAdding(null)}>
            {t("cancel")}
          </GcsButton>
        </div>
      )}
      <DropArea zone={zone} dragging={dragging} open={adding === zone} onClick={() => setAdding(adding === zone ? null : zone)} />
    </EditZone>
  );

  const footer = (
    <>
      <p role="status" className={`gcs-pageSidebar__status gcs-pageSidebar__status--${status?.tone ?? "muted"}`} data-testid="gcs-page-editor-status">
        {status?.text ?? (dirty ? t("unsaved") : "")}
      </p>
      <div className="gcs-pageSidebar__actions">
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} disabled={!dirty || pending} data-testid="gcs-page-editor-save">
          {t("save")}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faArrowsRotate} />} onClick={() => setZones(initial)} disabled={!dirty || pending}>
          {t("reset")}
        </GcsButton>
        {confirmDefault ? (
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faArrowRotateLeft} />} onClick={restoreDefault} disabled={pending} data-testid="gcs-page-editor-default-confirm">
            {t("confirmDefault")}
          </GcsButton>
        ) : (
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faArrowRotateLeft} />} onClick={() => setConfirmDefault(true)} disabled={pending} data-testid="gcs-page-editor-default">
            {t("restoreDefault")}
          </GcsButton>
        )}
        {dirty && (
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faXmark} />} onClick={exitWithoutSaving} disabled={pending} data-testid="gcs-page-editor-discard">
            {t("exitWithoutSaving")}
          </GcsButton>
        )}
      </div>
      <GcsButton variant="primary" className="gcs-pageSidebar__done" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={done} disabled={pending} data-testid="gcs-page-editor-done">
        {t("done")}
      </GcsButton>
    </>
  );

  return (
    <div className="gcs-widgetPage gcs-widgetPage--editing" data-page={page} data-testid="gcs-page-editor">
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
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
        <GcsWidgetSidebar catalog={catalog} favorites={favorites} pageLabel={pageLabel} onToggleFavorite={toggleFavorite} onAdd={(zone, w) => add(zone, w)} footer={footer} />
        {zoneBox("top")}
        <div className="gcs-forumLayout">
          <div className="gcs-forumLayout__main">
            <div className="gcs-widgetPage__content">{children}</div>
            {zoneBox("main")}
          </div>
          <div className="gcs-forumSidebar">{zoneBox("sidebar")}</div>
        </div>
        {zoneBox("bottom")}
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="gcs-widgetCard gcs-widgetCard--overlay">
              <span className="gcs-widgetCard__icon">{dragging.icon}</span>
              <strong>{dragging.label}</strong>
            </div>
          )}
        </DragOverlay>
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
function EditZone({ zone, label, count, children }: { zone: GcsWidgetZone; label: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: zone, disabled: count > 0 });
  return (
    <section ref={setNodeRef} className={`gcs-editZone gcs-editZone--${zone}${isOver ? " gcs-editZone--over" : ""}`} aria-label={label} data-zone={zone} data-testid={`gcs-zone-${zone}`}>
      <header className="gcs-editZone__label">{label}</header>
      <div className="gcs-editZone__list">{children}</div>
    </section>
  );
}

/**
 * „Trage widget-urile aici”: mereu vizibilă, chiar și într-o zonă goală. E țintă de drop doar cât se trage un widget
 * nou care are voie în zonă (mutările widget-urilor existente nu o văd); clic / Enter deschide lista zonei.
 */
function DropArea({ zone, dragging, open, onClick }: { zone: GcsWidgetZone; dragging: GcsPageEditorWidget | null; open: boolean; onClick: () => void }) {
  const t = useTranslations("pageEditor");
  const accepts = dragging?.zones.includes(zone) ?? false;
  const { setNodeRef, isOver } = useDroppable({ id: `${DROP_PREFIX}${zone}`, disabled: !accepts });
  const state = !dragging ? undefined : !accepts ? "blocked" : isOver ? "over" : "ready";
  return (
    <button ref={setNodeRef} type="button" className="gcs-editZone__drop" data-state={state} onClick={onClick} aria-expanded={open} data-testid={`gcs-widget-add-${zone}`}>
      <GcsIconSvg icon={faPlus} />
      <span>{t("dropHere")}</span>
      <span className="gcs-visuallyHidden"> — {t("add")}</span>
    </button>
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
            if (f.type === "richtext") {
              // Editorul nu e un control „etichetabil”: eticheta îl numește prin `aria-labelledby`.
              return (
                <div key={f.key} className="gcs-fieldRow gcs-fieldRow--rich">
                  <span id={`${id}-label`}>{f.label}</span>
                  <GcsRichTextInput
                    id={id}
                    initial={value ?? ""}
                    allow={f.allow}
                    maxLength={f.maxLength}
                    imageUrl={f.allow.nodes.includes("image")}
                    labelledBy={`${id}-label`}
                    onValue={(v) => setConfig(f.key, v)}
                  />
                </div>
              );
            }
            return (
              <label key={f.key} htmlFor={id} className="gcs-fieldRow">
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
            <legend>
              <GcsIconSvg icon={faEye} className="gcs-hIcon" />
              {t("visibility")}
            </legend>
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
