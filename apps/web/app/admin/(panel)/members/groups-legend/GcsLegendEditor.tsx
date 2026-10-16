"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  faArrowDown,
  faArrowUp,
  faCheck,
  faEye,
  faEyeSlash,
  faFloppyDisk,
  faGripVertical,
  faIcons,
  faLayerGroup,
  faPlus,
  faRotateLeft,
  faTrash,
  faTriangleExclamation,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import {
  addCategory,
  buildLegend,
  findGroup,
  LEGEND_CATEGORY_MAX,
  LEGEND_LABEL_MAX,
  LEGEND_TRAY,
  legendPlaces,
  moveCategory,
  moveGroup,
  removeCategory,
  setDisplay,
  updateCategory,
  type GcsLegendCount,
  type GcsLegendDisplay,
  type GcsLegendSourceGroup,
  type GcsLegendTarget,
  type GcsLegendTree,
} from "@gcs/modules/groups-pro-legend";
import { cx, gcsToast, GcsButton, GcsIconPicker, GcsIconSvg, GcsModal, type GcsIconPickerMatch } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { GcsLegendProBlock } from "@/app/(site)/_components/groups-pro/GcsLegendProView";
import { legendGroupCount, legendProCards } from "@/app/(site)/_components/groups-pro/legend-cards";
import { useErrorMessage } from "@/lib/use-error-message";
import type { GcsAcpIconDef } from "../../_components/types";
import { saveGroupsLegend } from "./actions";

/** Un grup în editor: datele legendei și iconița deja rezolvată pe server. */
export type GcsLegendEditorGroup = GcsLegendSourceGroup & { iconDef: GcsAcpIconDef | null };

type Props = {
  initial: GcsLegendTree;
  groups: GcsLegendEditorGroup[];
  counts: [number, GcsLegendCount][];
};

/** Previzualizările iconițelor deja căutate (numele → desenul). */
const iconCache = new Map<string, GcsIconPickerMatch | null>();

/** Iconița unei categorii, desenată din căutarea iconițelor (`/api/icons/search`). */
function CategoryIcon({ name, fallback = faLayerGroup }: { name: string | undefined; fallback?: typeof faLayerGroup }) {
  const [icon, setIcon] = useState<GcsIconPickerMatch | null>(name ? (iconCache.get(name) ?? null) : null);
  useEffect(() => {
    if (!name || iconCache.has(name)) {
      setIcon(name ? (iconCache.get(name) ?? null) : null);
      return;
    }
    const ctrl = new AbortController();
    const q = name.replace(/^fa-(solid|regular|brands) fa-/, "");
    fetch(`/api/icons/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ icons: GcsIconPickerMatch[] }>) : { icons: [] }))
      .then((d) => {
        const found = d.icons.find((i) => i.name === name) ?? null;
        iconCache.set(name, found);
        setIcon(found);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [name]);
  if (!icon) return <GcsIconSvg icon={fallback} />;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${icon.width} ${icon.height}`} width="1em" height="1em" fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}

const tint = (color: string | null) => ({ "--gcs-group": color ?? "var(--gcs-muted)" }) as CSSProperties;

/** Coliziunile: întâi zona de sub cursor (cardurile, „grup legat”, capătul coloanei), altfel cea mai apropiată. */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Editorul legendei Grupuri Pro (ACP → Membri → Legenda grupurilor): categoriile (adaugă, redenumește, iconiță,
 * reordonează prin tragere sau sus / jos, ascunde, șterge cu confirmare), grupurile pe categorii (tragere între
 * categorii, sub alt grup — grup legat în dropdown-ul lui — sau în „Neafișate”; alternativa din tastatură: sus / jos,
 * „Categorie” și „Sub grupul”), opțiunile de afișare și previzualizarea live a legendei din starea nesalvată.
 */
export function GcsLegendEditor({ initial, groups, counts }: Props) {
  const t = useTranslations("acp.groupsLegend");
  const tc = useTranslations("groupsPro.category");
  const tl = useTranslations("groupsPro.legend");
  const tp = useTranslations("groups.pill");
  const tIcons = useTranslations("acp.forums.form");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [tree, setTree] = useState(initial);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const id = useId();

  useEffect(() => {
    setTree(initial);
    setSavedJson(JSON.stringify(initial));
  }, [initial]);

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const countMap = useMemo(() => new Map(counts), [counts]);
  const dirty = JSON.stringify(tree) !== savedJson;
  const labelOf = (c: { key: string; label: string }) => c.label || (tc.has(c.key as never) ? tc(c.key as never) : c.key);
  const defaultLabel = (key: string) => (tc.has(key as never) ? tc(key as never) : "");

  // ─── Previzualizarea: legenda construită din starea nesalvată, ca pe site ───
  const legend = useMemo(() => {
    const places = legendPlaces(tree);
    // Un grup pus într-o categorie apare în legendă după salvare (chiar dacă grupul era ascuns din legendă).
    const shown = groups.map((g) => ({ ...g, inLegend: (places.get(g.id)?.category ?? LEGEND_TRAY) !== LEGEND_TRAY }));
    return buildLegend({ categories: tree.categories, places, groups: shown, counts: countMap, display: tree.display });
  }, [tree, groups, countMap]);
  const cards = legendProCards(legend, {
    categoryLabel: labelOf,
    total: (count) => tl("categoryTotal", { count }),
    linkedTotal: (count) => tl("linkedTotal", { count }),
    pill: (key, values) => tp(key, values as never),
    counts: countMap,
    groupIcon: (name) => {
      const g = groups.find((x) => x.icon === name);
      return <GcsIconSvg icon={g?.iconDef ?? faUsers} />;
    },
    categoryIcon: (name) => <CategoryIcon name={name} />,
  });

  // ─── Salvarea ───
  const save = () =>
    start(async () => {
      const res = await saveGroupsLegend(tree);
      if (!res.ok) {
        gcsToast({ title: errorMessage(res.error), icon: <GcsIconSvg icon={faTriangleExclamation} /> });
        return;
      }
      setSavedJson(JSON.stringify(tree));
      gcsToast({ title: t("saved"), icon: <GcsIconSvg icon={faCheck} /> });
      router.refresh();
    });

  // ─── Grupurile: tragere și alternativa din tastatură ───
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const catSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const lists: [string, string][] = [...tree.categories.map((c): [string, string] => [c.key, labelOf(c)]), [LEGEND_TRAY, t("tray")]];

  /** Ținta unei mutări, cu indexul de după scoaterea grupului din locul lui (aceeași listă). */
  const targetFor = (groupId: number, over: string): GcsLegendTarget | null => {
    const from = findGroup(tree, groupId);
    if (!from) return null;
    const [kind, rest] = [over.slice(0, over.indexOf(":")), over.slice(over.indexOf(":") + 1)];
    if (kind === "before") {
      const at = findGroup(tree, Number(rest));
      if (!at || Number(rest) === groupId) return null;
      const same = at.category === from.category && at.parentId === from.parentId;
      return { category: at.category, parentId: at.parentId, index: same && from.index < at.index ? at.index - 1 : at.index };
    }
    if (kind === "into") {
      const at = findGroup(tree, Number(rest));
      if (!at || at.parentId !== null || at.category === LEGEND_TRAY) return null;
      const parent = tree.lists[at.category]![at.index]!;
      return { category: at.category, parentId: parent.id, index: parent.children.filter((c) => c !== groupId).length };
    }
    if (kind === "end") {
      const list = tree.lists[rest] ?? [];
      return { category: rest, parentId: null, index: list.filter((s) => s.id !== groupId).length };
    }
    return null;
  };
  const onDragStart = (e: DragStartEvent) => setDragging(Number(String(e.active.id).slice(2)));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over) return;
    const groupId = Number(String(e.active.id).slice(2));
    const target = targetFor(groupId, String(e.over.id));
    if (target) setTree((tr) => moveGroup(tr, groupId, target));
  };
  const step = (groupId: number, delta: -1 | 1) => {
    const at = findGroup(tree, groupId);
    if (!at) return;
    setTree((tr) => moveGroup(tr, groupId, { category: at.category, parentId: at.parentId, index: at.index + delta }));
  };
  const toCategory = (groupId: number, category: string) =>
    setTree((tr) => moveGroup(tr, groupId, { category, parentId: null, index: (tr.lists[category] ?? []).length }));
  const toParent = (groupId: number, parent: string) => {
    const at = findGroup(tree, groupId);
    if (!at) return;
    if (parent === "") {
      setTree((tr) => moveGroup(tr, groupId, { category: at.category, parentId: null, index: (tr.lists[at.category] ?? []).length }));
      return;
    }
    const p = Number(parent);
    const slot = tree.lists[at.category]?.find((s) => s.id === p);
    if (slot) setTree((tr) => moveGroup(tr, groupId, { category: at.category, parentId: p, index: slot.children.length }));
  };

  const groupProps = (groupId: number, place: { category: string; parentId: number | null; index: number; size: number }): GroupCardProps | null => {
    const g = byId.get(groupId);
    if (!g) return null;
    // Părinții posibili: grupurile de pe primul nivel din aceeași categorie (un singur nivel).
    const parents = place.category === LEGEND_TRAY ? [] : (tree.lists[place.category] ?? []).filter((s) => s.id !== groupId);
    return {
      group: g,
      count: countMap.get(groupId)?.members ?? 0,
      place,
      categories: lists,
      parents: parents.map((s) => ({ id: s.id, name: byId.get(s.id)?.name ?? String(s.id) })),
      hasChildren: (tree.lists[place.category] ?? []).some((s) => s.id === groupId && s.children.length > 0),
      onStep: (d) => step(groupId, d),
      onCategory: (c) => toCategory(groupId, c),
      onParent: (p) => toParent(groupId, p),
    };
  };

  const categoryToDelete = tree.categories.find((c) => c.key === confirmDelete) ?? null;

  return (
    <div className="gcs-legendEditor" data-testid="gcs-legend-editor">
      <div className="gcs-legendEditor__main">
        {/* ─── Categoriile ─── */}
        <fieldset className="gcs-legendEditor__section" data-testid="gcs-legend-categories">
          <legend>{t("categories")}</legend>
          <p className="gcs-field__hint">{t("categoriesHint")}</p>
          <DndContext
            id={`${id}-cats`}
            sensors={catSensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => {
              if (!e.over || e.active.id === e.over.id) return;
              const to = tree.categories.findIndex((c) => c.key === e.over!.id);
              setTree((tr) => moveCategory(tr, String(e.active.id), to));
            }}
          >
            <SortableContext items={tree.categories.map((c) => c.key)} strategy={verticalListSortingStrategy}>
              <ul className="gcs-legendEditor__cats">
                {tree.categories.map((c, i) => (
                  <CategoryRow
                    key={c.key}
                    category={c}
                    label={labelOf(c)}
                    placeholder={defaultLabel(c.key) || t("categoryName")}
                    first={i === 0}
                    last={i === tree.categories.length - 1}
                    onlyOne={tree.categories.length === 1}
                    groups={(tree.lists[c.key] ?? []).reduce((n, s) => n + 1 + s.children.length, 0)}
                    onRename={(label) => setTree((tr) => updateCategory(tr, c.key, { label }))}
                    onMove={(d) => setTree((tr) => moveCategory(tr, c.key, i + d))}
                    onHide={() => setTree((tr) => updateCategory(tr, c.key, { hidden: !c.hidden }))}
                    onIcon={() => setPicking(c.key)}
                    onDelete={() => setConfirmDelete(c.key)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <form
            className="gcs-legendEditor__add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newLabel.trim()) return;
              setTree((tr) => addCategory(tr, newLabel));
              setNewLabel("");
            }}
          >
            <label className="gcs-field gcs-legendEditor__grow">
              <span className="gcs-srOnly">{t("newCategory")}</span>
              <input className="gcs-input" value={newLabel} maxLength={LEGEND_LABEL_MAX} placeholder={t("newCategory")} onChange={(e) => setNewLabel(e.target.value)} data-testid="gcs-legend-cat-new" />
            </label>
            <GcsButton type="submit" variant="ghost" icon={<GcsIconSvg icon={faPlus} />} disabled={!newLabel.trim() || tree.categories.length >= LEGEND_CATEGORY_MAX} data-testid="gcs-legend-cat-add">
              {t("addCategory")}
            </GcsButton>
          </form>
        </fieldset>

        {/* ─── Grupurile pe categorii ─── */}
        <fieldset className="gcs-legendEditor__section">
          <legend>{t("groups")}</legend>
          <p className="gcs-field__hint">{t("groupsHint")}</p>
          <DndContext id={`${id}-groups`} sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="gcs-legendEditor__board" data-testid="gcs-legend-board">
              {lists.map(([key, label]) => {
                const category = tree.categories.find((c) => c.key === key);
                const slots = tree.lists[key] ?? [];
                return (
                  <section key={key || "tray"} className={cx("gcs-legendEditor__col", key === LEGEND_TRAY && "gcs-legendEditor__col--tray", category?.hidden && "gcs-legendEditor__col--hidden")} aria-label={label} data-testid={`gcs-legend-col-${key || "tray"}`}>
                    <h4 className="gcs-legendEditor__colHead">
                      <span className="gcs-legendEditor__colIcon" aria-hidden="true">
                        {key === LEGEND_TRAY ? <GcsIconSvg icon={faEyeSlash} /> : <CategoryIcon name={category?.icon} />}
                      </span>
                      <span>{label}</span>
                      {category?.hidden && <span className="gcs-legendEditor__tag">{t("hiddenTag")}</span>}
                    </h4>
                    {key === LEGEND_TRAY && <p className="gcs-legendEditor__trayHint">{t("trayHint")}</p>}
                    <ul className="gcs-legendEditor__list">
                      {slots.map((slot, i) => {
                        const props = groupProps(slot.id, { category: key, parentId: null, index: i, size: slots.length });
                        if (!props) return null;
                        return (
                          <li key={slot.id} className="gcs-legendEditor__slot">
                            <GroupCard {...props} />
                            {slot.children.length > 0 && (
                              <ul className="gcs-legendEditor__children" aria-label={t("childrenOf", { name: props.group.name })}>
                                {slot.children.map((child, j) => {
                                  const cp = groupProps(child, { category: key, parentId: slot.id, index: j, size: slot.children.length });
                                  return cp ? (
                                    <li key={child}>
                                      <GroupCard {...cp} />
                                    </li>
                                  ) : null;
                                })}
                              </ul>
                            )}
                            {key !== LEGEND_TRAY && <IntoZone parent={slot.id} label={t("dropChild", { name: props.group.name })} active={dragging !== null && dragging !== slot.id} />}
                          </li>
                        );
                      })}
                    </ul>
                    <EndZone category={key} label={slots.length === 0 ? t("emptyColumn") : t("dropEnd")} />
                  </section>
                );
              })}
            </div>
            <DragOverlay>{dragging !== null && byId.get(dragging) ? <div className="gcs-legendEditor__ghost" style={tint(byId.get(dragging)!.color)}>{byId.get(dragging)!.name}</div> : null}</DragOverlay>
          </DndContext>
        </fieldset>

        {/* ─── Opțiunile de afișare ─── */}
        <fieldset className="gcs-legendEditor__section" data-testid="gcs-legend-display">
          <legend>{t("display")}</legend>
          <div className="gcs-legendEditor__columns" role="radiogroup" aria-label={t("columns")}>
            <span className="gcs-legendEditor__label">{t("columns")}</span>
            {([2, 3, 4] as const).map((n) => (
              <label key={n} className={cx("gcs-chip", "gcs-legendEditor__colOpt", tree.display.columns === n && "gcs-legendEditor__colOpt--on")}>
                <input type="radio" name={`${id}-columns`} className="gcs-srOnly" checked={tree.display.columns === n} onChange={() => setTree((tr) => setDisplay(tr, "columns", n))} data-testid={`gcs-legend-columns-${n}`} />
                {n}
              </label>
            ))}
          </div>
          <div className="gcs-legendEditor__checks">
            {(["memberCounts", "onlineCounts", "countSecondary", "hideEmpty", "seeAll", "groupsPage"] as const).map((key) => (
              <label key={key} className="gcs-checkRow">
                <input type="checkbox" checked={tree.display[key]} onChange={(e) => setTree((tr) => setDisplay(tr, key, e.target.checked as GcsLegendDisplay[typeof key]))} data-testid={`gcs-legend-opt-${key}`} />
                <span>
                  {t(`options.${key}`)}
                  <small className="gcs-field__hint">{t(`options.${key}Hint`)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="gcs-legendEditor__actions">
          <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} disabled={pending || !dirty} data-testid="gcs-legend-save">
            {t("save")}
          </GcsButton>
          <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => setConfirmReset(true)} disabled={pending || !dirty} data-testid="gcs-legend-reset">
            {t("discard")}
          </GcsButton>
          <span className="gcs-legendEditor__status" role="status" data-testid="gcs-legend-status">
            {dirty ? t("unsaved") : t("upToDate")}
          </span>
        </div>
      </div>

      {/* ─── Previzualizarea live ─── */}
      <aside className="gcs-legendEditor__preview" aria-label={t("preview")} data-testid="gcs-legend-preview">
        <h3 className="gcs-legendEditor__previewTitle">{t("preview")}</h3>
        <p className="gcs-field__hint">{t("previewHint")}</p>
        <div className="gcs-legendEditor__previewBox">
          {legend.length === 0 ? (
            <p className="gcs-muted">{t("previewEmpty")}</p>
          ) : (
            <GcsLegendProBlock
              place="panel"
              headingId={`${id}-preview`}
              cards={cards}
              columns={tree.display.columns}
              counts={{ members: tree.display.memberCounts, online: tree.display.onlineCounts }}
              seeAll={tree.display.seeAll && tree.display.groupsPage}
              labels={{
                title: tl("title"),
                info: tl("info"),
                groups: tl("groups", { count: legendGroupCount(legend) }),
                seeAll: tl("seeAll"),
                seeAllTip: tl("seeAllTip"),
                linked: tl("linked"),
                toggle: tl("toggle", { name: "{name}" }),
              }}
            />
          )}
        </div>
      </aside>

      {picking && (
        <GcsModal title={t("icon")} icon={<GcsIconSvg icon={faIcons} />} onClose={() => setPicking(null)} closeLabel={t("cancel")} size="md">
          <GcsIconPicker
            name="legend-category-icon"
            value={tree.categories.find((c) => c.key === picking)?.icon ?? null}
            searchUrl="/api/icons/search"
            labels={{ search: tIcons("iconSearch"), none: tIcons("iconNone"), noResults: tIcons("iconNoResults") }}
            onChange={(v) => {
              setTree((tr) => updateCategory(tr, picking, { icon: v ?? "" }));
              setPicking(null);
            }}
          />
        </GcsModal>
      )}

      {categoryToDelete && (
        <GcsModal title={t("deleteTitle", { name: labelOf(categoryToDelete) })} icon={<GcsIconSvg icon={faTrash} />} onClose={() => setConfirmDelete(null)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("deleteBody")}</p>
          <div className="gcs-legendEditor__actions">
            <GcsButton
              type="button"
              variant="primary"
              onClick={() => {
                setTree((tr) => removeCategory(tr, categoryToDelete.key));
                setConfirmDelete(null);
              }}
              data-testid="gcs-legend-cat-delete-confirm"
            >
              {t("deleteConfirm")}
            </GcsButton>
            <GcsButton type="button" variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}

      {confirmReset && (
        <GcsModal title={t("discardTitle")} icon={<GcsIconSvg icon={faRotateLeft} />} onClose={() => setConfirmReset(false)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("discardBody")}</p>
          <div className="gcs-legendEditor__actions">
            <GcsButton
              type="button"
              variant="primary"
              onClick={() => {
                setTree(JSON.parse(savedJson) as GcsLegendTree);
                setConfirmReset(false);
              }}
              data-testid="gcs-legend-reset-confirm"
            >
              {t("discardConfirm")}
            </GcsButton>
            <GcsButton type="button" variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </div>
  );
}

// ─── Un rând de categorie ───────────────────────────────────────────────────────────────────────────────────────────

type CategoryRowProps = {
  category: GcsLegendTree["categories"][number];
  label: string;
  placeholder: string;
  first: boolean;
  last: boolean;
  onlyOne: boolean;
  groups: number;
  onRename: (label: string) => void;
  onMove: (delta: -1 | 1) => void;
  onHide: () => void;
  onIcon: () => void;
  onDelete: () => void;
};

function CategoryRow({ category, label, placeholder, first, last, onlyOne, groups, onRename, onMove, onHide, onIcon, onDelete }: CategoryRowProps) {
  const t = useTranslations("acp.groupsLegend");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("gcs-legendEditor__cat", isDragging && "gcs-legendEditor__cat--dragging", category.hidden && "gcs-legendEditor__cat--hidden")}
      data-testid={`gcs-legend-cat-${category.key}`}
    >
      <button type="button" className="gcs-iconBtn gcs-legendEditor__grip" aria-label={t("dragCategory", { name: label })} {...attributes} {...listeners}>
        <GcsIconSvg icon={faGripVertical} />
      </button>
      <span className="gcs-legendEditor__moves">
        <button type="button" className="gcs-iconBtn" disabled={first} aria-label={t("moveUp", { name: label })} onClick={() => onMove(-1)}>
          <GcsIconSvg icon={faArrowUp} />
        </button>
        <button type="button" className="gcs-iconBtn" disabled={last} aria-label={t("moveDown", { name: label })} onClick={() => onMove(1)}>
          <GcsIconSvg icon={faArrowDown} />
        </button>
      </span>
      <button type="button" className="gcs-iconBtn gcs-legendEditor__icon" aria-label={`${t("icon")}: ${label}`} title={category.icon ?? t("icon")} onClick={onIcon} data-testid={`gcs-legend-cat-icon-${category.key}`}>
        <CategoryIcon name={category.icon} />
      </button>
      <label className="gcs-field gcs-legendEditor__grow">
        <span className="gcs-srOnly">{t("rename", { name: label })}</span>
        <input className="gcs-input" value={category.label} maxLength={LEGEND_LABEL_MAX} placeholder={placeholder} onChange={(e) => onRename(e.target.value)} data-testid={`gcs-legend-cat-label-${category.key}`} />
      </label>
      <span className="gcs-legendEditor__count">{t("groupCount", { count: groups })}</span>
      <button type="button" className="gcs-iconBtn" aria-pressed={!!category.hidden} aria-label={category.hidden ? t("show", { name: label }) : t("hide", { name: label })} title={category.hidden ? t("show", { name: label }) : t("hide", { name: label })} onClick={onHide} data-testid={`gcs-legend-cat-hide-${category.key}`}>
        <GcsIconSvg icon={category.hidden ? faEyeSlash : faEye} />
      </button>
      <button type="button" className="gcs-iconBtn" disabled={onlyOne} aria-label={t("delete", { name: label })} title={t("delete", { name: label })} onClick={onDelete} data-testid={`gcs-legend-cat-delete-${category.key}`}>
        <GcsIconSvg icon={faTrash} />
      </button>
    </li>
  );
}

// ─── Un grup pe tablă ───────────────────────────────────────────────────────────────────────────────────────────────

type GroupCardProps = {
  group: GcsLegendEditorGroup;
  count: number;
  place: { category: string; parentId: number | null; index: number; size: number };
  categories: [string, string][];
  parents: { id: number; name: string }[];
  hasChildren: boolean;
  onStep: (delta: -1 | 1) => void;
  onCategory: (category: string) => void;
  onParent: (parent: string) => void;
};

function GroupCard({ group, count, place, categories, parents, hasChildren, onStep, onCategory, onParent }: GroupCardProps) {
  const t = useTranslations("acp.groupsLegend");
  const drag = useDraggable({ id: `g:${group.id}` });
  const drop = useDroppable({ id: `before:${group.id}` });
  const ref = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const id = useId();
  return (
    <div
      ref={ref}
      className={cx("gcs-legendEditor__group", place.parentId !== null && "gcs-legendEditor__group--child", drop.isOver && "gcs-legendEditor__group--over", drag.isDragging && "gcs-legendEditor__group--dragging")}
      style={tint(group.color)}
      data-testid={`gcs-legend-group-${group.key}`}
      data-parent={place.parentId ?? ""}
    >
      <button type="button" className="gcs-iconBtn gcs-legendEditor__grip" aria-label={t("dragGroup", { name: group.name })} {...drag.attributes} {...drag.listeners} data-testid={`gcs-legend-drag-${group.key}`}>
        <GcsIconSvg icon={faGripVertical} />
      </button>
      <span className="gcs-legendEditor__groupIcon" aria-hidden="true">
        <GcsIconSvg icon={group.iconDef ?? faUsers} />
      </span>
      <span className="gcs-legendEditor__groupName">{group.name}</span>
      <span className="gcs-legendEditor__count">{t("members", { count })}</span>
      <span className="gcs-legendEditor__groupMoves">
        <button type="button" className="gcs-iconBtn" disabled={place.index === 0} aria-label={t("moveUp", { name: group.name })} onClick={() => onStep(-1)}>
          <GcsIconSvg icon={faArrowUp} />
        </button>
        <button type="button" className="gcs-iconBtn" disabled={place.index >= place.size - 1} aria-label={t("moveDown", { name: group.name })} onClick={() => onStep(1)}>
          <GcsIconSvg icon={faArrowDown} />
        </button>
        <label className="gcs-srOnly" htmlFor={`${id}-cat`}>
          {t("moveTo", { name: group.name })}
        </label>
        <select id={`${id}-cat`} className="gcs-input gcs-legendEditor__select" value={place.category} onChange={(e) => onCategory(e.target.value)} data-testid={`gcs-legend-group-cat-${group.key}`}>
          {categories.map(([key, label]) => (
            <option key={key || "tray"} value={key}>
              {label}
            </option>
          ))}
        </select>
        {place.category !== LEGEND_TRAY && !hasChildren && (
          <>
            <label className="gcs-srOnly" htmlFor={`${id}-parent`}>
              {t("parentOf", { name: group.name })}
            </label>
            <select id={`${id}-parent`} className="gcs-input gcs-legendEditor__select" value={place.parentId ?? ""} onChange={(e) => onParent(e.target.value)} data-testid={`gcs-legend-group-parent-${group.key}`}>
              <option value="">{t("noParent")}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("under", { name: p.name })}
                </option>
              ))}
            </select>
          </>
        )}
      </span>
    </div>
  );
}

/** Zona de sub un grup: tras aici, un grup devine grup legat (în dropdown-ul lui). */
function IntoZone({ parent, label, active }: { parent: number; label: string; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `into:${parent}` });
  return (
    <div ref={setNodeRef} className={cx("gcs-legendEditor__into", active && "gcs-legendEditor__into--active", isOver && "gcs-legendEditor__into--over")} data-testid={`gcs-legend-into-${parent}`}>
      {label}
    </div>
  );
}

/** Capătul unei coloane: tras aici, grupul ajunge ultimul în categorie (sau în „Neafișate”). */
function EndZone({ category, label }: { category: string; label: string }): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: `end:${category}` });
  return (
    <div ref={setNodeRef} className={cx("gcs-legendEditor__end", isOver && "gcs-legendEditor__end--over")} data-testid={`gcs-legend-end-${category || "tray"}`}>
      {label}
    </div>
  );
}
