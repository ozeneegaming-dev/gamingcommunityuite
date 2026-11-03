"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  faArrowDown,
  faArrowUp,
  faCopy,
  faDesktop,
  faEllipsis,
  faGripVertical,
  faIndent,
  faMobileScreen,
  faOutdent,
  faPen,
  faPlus,
  faRotate,
  faRotateLeft,
  faTrash,
  faUpload,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsNavItemEdit, GcsNavItemInput, GcsNavLabel } from "@gcs/core";
import { GcsButton, GcsDropdown, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { GcsIconInput } from "@/lib/ui-inputs";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../_components/GcsConfirmDialog";
import { discardMenuDraft, publishMenuDraft, restoreMenuDefaults, saveMenuDraft } from "./actions";

type Kind = "link" | "app" | "dropdown" | "separator";
type Audience = "all" | "guests" | "members";

type Item = {
  uid: string;
  kind: Kind;
  /** Eticheta tradusă automat (cheia unui modul); textele scrise de admin au prioritate. */
  labelKey: string | null;
  texts: Record<string, string>;
  descTexts: Record<string, string>;
  badge: string;
  counter: string | null;
  highlight: string | null;
  icon: string | null;
  href: string;
  appKey: string | null;
  groups: number[];
  newTab: boolean;
  enabled: boolean;
  audience: Audience;
  /** „Link scurt” (doar subitemii): coloana din dreapta a mega meniului. */
  shortLink: boolean;
  children: Item[];
};

type Flat = { item: Item; depth: 0 | 1 };

export type GcsMenuAppPage = { appKey: string; label: string; href: string; icon: string | null; labelKey: string };

const INDENT = 28;
/** Descrierea de un rând: aceeași limită ca validarea serverului (`NAV_DESCRIPTION_MAX`). */
const DESCRIPTION_MAX = 100;
let counter = 0;
const uid = () => `n${++counter}`;

function fromEdit(it: GcsNavItemEdit): Item {
  const label = it.label as Record<string, string>;
  const key = "key" in label ? label.key : null;
  return {
    uid: uid(),
    kind: (it.kind ?? "link") as Kind,
    labelKey: key ?? null,
    texts: key ? {} : { ...label },
    descTexts: { ...((it.description ?? {}) as Record<string, string>) },
    badge: it.badge ?? "",
    counter: it.counter ?? null,
    highlight: it.highlight ?? null,
    icon: it.icon ?? null,
    href: it.href ?? "",
    appKey: it.appKey ?? null,
    groups: it.groups ?? [],
    newTab: it.newTab ?? false,
    enabled: it.enabled ?? true,
    audience: (it.audience ?? "all") as Audience,
    shortLink: it.shortLink ?? false,
    children: it.children.map(fromEdit),
  };
}

function toInput(it: Item): GcsNavItemInput {
  if (it.kind === "separator") return { kind: "separator", label: {}, enabled: it.enabled, groups: it.groups, audience: it.audience };
  const texts = Object.fromEntries(Object.entries(it.texts).filter(([, v]) => v.trim()));
  const label: GcsNavLabel = Object.keys(texts).length > 0 || !it.labelKey ? texts : { key: it.labelKey };
  const description = Object.fromEntries(Object.entries(it.descTexts).filter(([, v]) => v.trim()));
  return {
    kind: it.kind,
    label,
    description: Object.keys(description).length > 0 ? description : null,
    badge: it.badge.trim() || null,
    counter: it.counter,
    highlight: it.highlight,
    icon: it.icon,
    href: it.href.trim() || null,
    appKey: it.kind === "app" ? it.appKey : null,
    groups: it.groups,
    newTab: it.newTab,
    enabled: it.enabled,
    audience: it.audience,
    shortLink: it.shortLink,
    children: it.children.map(toInput),
  };
}

const flatten = (items: Item[]): Flat[] => items.flatMap((it) => [{ item: it, depth: 0 as const }, ...it.children.map((c) => ({ item: c, depth: 1 as const }))]);

/** Lista plată (după drag) → arborele: un item cu adâncimea 1 devine copilul ultimului item de pe primul nivel. */
function build(flat: Flat[]): Item[] {
  const out: Item[] = [];
  for (const f of flat) {
    if (f.depth === 1 && out.length > 0) out[out.length - 1]!.children.push({ ...f.item, children: [] });
    else out.push({ ...f.item, children: [] });
  }
  return out;
}

/**
 * Managerul de meniu v2 (ACP → Aspect → Manager meniu): arborele compact (drag & drop cu așezare sub alt item, comutatorul
 * „activ” și meniul ⋯ pe fiecare rând), panoul lateral de editare cu tab-uri pe limbi, tipurile (pagina unei aplicații,
 * link propriu, grup, separator), vizibilitatea, insigna și evidențierea. Fiecare schimbare se salvează în ciornă, iar
 * previzualizarea arată antetul real al site-ului cu ciorna (desktop / mobil). „Publică” o aplică pe site.
 */
export function GcsMenuManager({
  initial,
  hasDraft,
  locales,
  autoLabels,
  autoDescriptions,
  groups,
  appPages,
  counters,
}: {
  initial: GcsNavItemEdit[];
  hasDraft: boolean;
  locales: { code: string; label: string }[];
  autoLabels: Record<string, string>;
  /** Descrierile automate (după cheia etichetei), traduse în limba adminului: rezerva unei descrieri goale. */
  autoDescriptions: Record<string, string>;
  groups: { id: number; name: string }[];
  appPages: GcsMenuAppPage[];
  counters: { key: string; label: string }[];
}) {
  const t = useTranslations("acp.menuManager.v2");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [items, setItems] = useState<Item[]>(() => initial.map(fromEdit));
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(hasDraft);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "discard" | "restore" | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const [lang, setLang] = useState(locales[0]?.code ?? "ro");
  const dirty = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const flat = useMemo(() => flatten(items), [items]);

  // Ciorna se salvează la fiecare schimbare (după o mică pauză); previzualizarea se reîncarcă după salvare.
  const texts = useRef({ errorMessage, saved: t("draftSaved") });
  texts.current = { errorMessage, saved: t("draftSaved") };
  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      const res = await saveMenuDraft(items.map(toInput));
      setSaving(false);
      if (!res.ok) return setStatus({ ok: false, text: texts.current.errorMessage(res.error) });
      setDraft(true);
      setStatus({ ok: true, text: texts.current.saved });
      setPreviewKey((k) => k + 1);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [items]);

  const change = (next: Item[] | ((list: Item[]) => Item[])) => {
    dirty.current = true;
    setItems(next);
  };
  const patch = (id: string, p: Partial<Item>) => change((list) => list.map((x) => (x.uid === id ? { ...x, ...p } : { ...x, children: x.children.map((c) => (c.uid === id ? { ...c, ...p } : c)) })));
  const find = (id: string | null): Flat | undefined => flat.find((f) => f.item.uid === id);
  const remove = (id: string) => {
    change((list) => list.filter((x) => x.uid !== id).map((x) => ({ ...x, children: x.children.filter((c) => c.uid !== id) })));
    if (selected === id) setSelected(null);
  };
  const blank = (kind: Kind = "link"): Item => ({
    uid: uid(),
    kind,
    labelKey: null,
    texts: kind === "separator" ? {} : { [locales[0]?.code ?? "ro"]: t("newItem") },
    descTexts: {},
    badge: "",
    counter: null,
    highlight: null,
    icon: null,
    href: kind === "link" ? "/" : "",
    appKey: null,
    groups: [],
    newTab: false,
    enabled: true,
    audience: "all",
    shortLink: false,
    children: [],
  });
  const addTop = () => {
    const it = blank();
    change((list) => [...list, it]);
    setSelected(it.uid);
  };
  const addChild = (parent: string, kind: Kind = "link") => {
    const it = blank(kind);
    change((list) => list.map((x) => (x.uid === parent ? { ...x, children: [...x.children, it] } : x)));
    setSelected(it.uid);
  };
  /** Mută în lista plată (↑/↓, ⋯) păstrând adâncimea; un item de pe primul nivel își ia copiii cu el. */
  const moveFlat = (id: string, delta: -1 | 1) => {
    const f = find(id);
    if (!f) return;
    if (f.depth === 1) {
      change((list) =>
        list.map((x) => {
          const i = x.children.findIndex((c) => c.uid === id);
          if (i < 0) return x;
          const j = i + delta;
          if (j < 0 || j >= x.children.length) return x;
          const kids = [...x.children];
          [kids[i], kids[j]] = [kids[j]!, kids[i]!];
          return { ...x, children: kids };
        }),
      );
    } else {
      change((list) => {
        const i = list.findIndex((x) => x.uid === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[i], next[j]] = [next[j]!, next[i]!];
        return next;
      });
    }
  };
  const indent = (id: string) => {
    const idx = flat.findIndex((f) => f.item.uid === id);
    const f = flat[idx];
    if (!f || f.depth === 1 || f.item.children.length > 0) return;
    const above = [...flat.slice(0, idx)].reverse().find((x) => x.depth === 0);
    if (!above || above.item.kind === "separator") return;
    change(build(flat.map((x): Flat => (x.item.uid === id ? { ...x, depth: 1 } : x))));
  };
  const outdent = (id: string) => {
    const idx = flat.findIndex((f) => f.item.uid === id);
    const f = flat[idx];
    if (!f || f.depth === 0 || f.item.kind === "separator") return;
    // Iese pe primul nivel, după grupul părintelui (frații lui rămân la părinte).
    const nextTop = flat.slice(idx + 1).findIndex((x) => x.depth === 0);
    const end = nextTop === -1 ? flat.length : idx + 1 + nextTop;
    const without = flat.filter((x) => x.item.uid !== id);
    const insertAt = end - 1;
    change(build([...without.slice(0, insertAt), { item: f.item, depth: 0 as const }, ...without.slice(insertAt)]));
  };
  const duplicate = (id: string) => {
    const copy = (it: Item): Item => ({ ...it, uid: uid(), children: it.children.map(copy) });
    const after = (list: Item[]): Item[] => {
      const i = list.findIndex((x) => x.uid === id);
      return i < 0 ? list : [...list.slice(0, i + 1), copy(list[i]!), ...list.slice(i + 1)];
    };
    change((list) => (list.some((x) => x.uid === id) ? after(list) : list.map((x) => ({ ...x, children: after(x.children) }))));
  };

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const from = flat.findIndex((f) => f.item.uid === e.active.id);
    const to = flat.findIndex((f) => f.item.uid === e.over!.id);
    if (from < 0 || to < 0) return;
    const moving = flat[from]!;
    const block = moving.depth === 0 ? flat.slice(from, from + 1 + moving.item.children.length) : [moving];
    if (block.some((b) => b.item.uid === e.over!.id) && e.active.id !== e.over.id) return;
    const rest = flat.filter((f) => !block.includes(f));
    let insertAt = rest.findIndex((f) => f.item.uid === e.over!.id);
    if (insertAt < 0) insertAt = to > from ? rest.length : 0;
    else if (to > from) insertAt += 1;
    // Sub un item de pe primul nivel cu copii, coborârea îl pune după copiii lui.
    while (to > from && rest[insertAt]?.depth === 1 && moving.depth === 0 && Math.round(e.delta.x / INDENT) <= 0) insertAt++;
    const above = rest[insertAt - 1];
    const next = rest[insertAt];
    const hasKids = moving.item.children.length > 0;
    const canNest = !!above && !hasKids && (above.depth === 1 || above.item.kind !== "separator");
    let depth: 0 | 1 = moving.depth + Math.round(e.delta.x / INDENT) >= 1 ? 1 : 0;
    if (!canNest) depth = 0;
    if (next?.depth === 1 && depth === 0 && !hasKids) depth = canNest ? 1 : 0;
    if (moving.item.kind === "separator") {
      if (!canNest) return;
      depth = 1;
    }
    if (from === to && depth === moving.depth) return;
    const moved: Flat[] = block.map((b, i) => ({ item: b.item, depth: i === 0 ? depth : 1 }));
    change(build([...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]));
  }

  async function run(kind: "publish" | "discard" | "restore") {
    setConfirm(null);
    setSaving(true);
    const res = kind === "publish" ? await publishMenuDraft() : kind === "discard" ? await discardMenuDraft() : await restoreMenuDefaults();
    setSaving(false);
    if (!res.ok) return setStatus({ ok: false, text: errorMessage(res.error) });
    dirty.current = false;
    setStatus({ ok: true, text: t(kind === "publish" ? "published" : kind === "discard" ? "discarded" : "restored") });
    setDraft(kind === "restore");
    setPreviewKey((k) => k + 1);
    router.refresh();
  }

  const current = find(selected);
  const itemLabel = (it: Item) => (it.kind === "separator" ? t("separator") : it.texts[lang]?.trim() || Object.values(it.texts).find((v) => v.trim()) || (it.labelKey ? (autoLabels[it.labelKey] ?? it.labelKey) : t("untitled")));

  return (
    <div className="gcs-menuMgr" data-testid="gcs-menu-manager">
      <div className="gcs-menuMgr__bar">
        <span className={`gcs-menuMgr__state${draft ? " gcs-menuMgr__state--draft" : ""}`} data-testid="gcs-menu-state">
          {saving ? t("saving") : draft ? t("stateDraft") : t("statePublished")}
        </span>
        <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faUpload} />} disabled={!draft || saving} onClick={() => setConfirm("publish")} data-testid="gcs-menu-publish">
          {t("publish")}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faXmark} />} disabled={!draft || saving} onClick={() => setConfirm("discard")} data-testid="gcs-menu-discard">
          {t("discard")}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} disabled={saving} onClick={() => setConfirm("restore")} data-testid="gcs-menu-restore">
          {t("restore")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-bulkBar__ok" : "gcs-bulkBar__error"} data-testid="gcs-menu-status">
            {status.text}
          </span>
        )}
      </div>

      <div className="gcs-menuMgr__layout">
        <section className="gcs-menuMgr__tree" aria-label={t("tree")}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={flat.map((f) => f.item.uid)} strategy={verticalListSortingStrategy}>
              <ul className="gcs-menuMgr__list" data-testid="gcs-menu-tree">
                {flat.map((f, i) => (
                  <Row
                    key={f.item.uid}
                    flat={f}
                    label={itemLabel(f.item)}
                    selected={selected === f.item.uid}
                    first={i === 0}
                    last={i === flat.length - 1}
                    onSelect={() => setSelected(f.item.uid)}
                    onToggle={(v) => patch(f.item.uid, { enabled: v })}
                    actions={{
                      edit: () => setSelected(f.item.uid),
                      up: () => moveFlat(f.item.uid, -1),
                      down: () => moveFlat(f.item.uid, 1),
                      indent: () => indent(f.item.uid),
                      outdent: () => outdent(f.item.uid),
                      child: f.depth === 0 && f.item.kind !== "separator" ? () => addChild(f.item.uid) : null,
                      separator: f.depth === 0 && f.item.kind !== "separator" ? () => addChild(f.item.uid, "separator") : null,
                      duplicate: () => duplicate(f.item.uid),
                      remove: () => remove(f.item.uid),
                    }}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={addTop} data-testid="gcs-menu-add">
            {t("add")}
          </GcsButton>
          <p className="gcs-menuMgr__hint">{t("dragHint")}</p>
        </section>

        <aside className="gcs-menuMgr__panel" aria-label={t("panel")} data-testid="gcs-menu-panel">
          {!current ? (
            <p className="gcs-menuMgr__hint">{t("pick")}</p>
          ) : (
            <Editor
              key={current.item.uid}
              item={current.item}
              depth={current.depth}
              lang={lang}
              setLang={setLang}
              locales={locales}
              autoLabels={autoLabels}
              autoDescriptions={autoDescriptions}
              groups={groups}
              appPages={appPages}
              counters={counters}
              onPatch={(p) => patch(current.item.uid, p)}
              onClose={() => setSelected(null)}
            />
          )}
        </aside>
      </div>

      <section className="gcs-menuMgr__preview" aria-label={t("preview")} data-testid="gcs-menu-preview">
        <div className="gcs-menuMgr__previewBar">
          <strong>{t("preview")}</strong>
          <div className="gcs-segLinks" role="radiogroup" aria-label={t("device")}>
            {(["desktop", "mobile"] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={device === d} className={`gcs-segLink${device === d ? " gcs-segLink--active" : ""}`} onClick={() => setDevice(d)} data-testid={`gcs-menu-device-${d}`}>
                <GcsIconSvg icon={d === "desktop" ? faDesktop : faMobileScreen} /> {t(`devices.${d}`)}
              </button>
            ))}
          </div>
          <GcsTooltip content={t("reload")}>
            <button type="button" className="gcs-iconBtn" aria-label={t("reload")} onClick={() => setPreviewKey((k) => k + 1)}>
              <GcsIconSvg icon={faRotate} />
            </button>
          </GcsTooltip>
        </div>
        <div className={`gcs-menuMgr__frameWrap gcs-menuMgr__frameWrap--${device}`}>
          <iframe key={previewKey} title={t("preview")} src={`/?gcs-nav-preview=1&r=${previewKey}`} className="gcs-menuMgr__frame" data-testid="gcs-menu-preview-frame" />
        </div>
        <p className="gcs-menuMgr__hint">{t("previewHint")}</p>
      </section>

      {confirm && (
        <GcsConfirmDialog
          title={t(confirm === "publish" ? "publish" : confirm === "discard" ? "discard" : "restore")}
          body={t(`confirm.${confirm}`)}
          confirmLabel={t(confirm === "publish" ? "publish" : confirm === "discard" ? "discard" : "restore")}
          danger={confirm !== "publish"}
          busy={saving}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(confirm)}
        />
      )}
    </div>
  );
}

type RowActions = { edit: () => void; up: () => void; down: () => void; indent: () => void; outdent: () => void; child: (() => void) | null; separator: (() => void) | null; duplicate: () => void; remove: () => void };

function Row({ flat, label, selected, first, last, onSelect, onToggle, actions }: { flat: Flat; label: string; selected: boolean; first: boolean; last: boolean; onSelect: () => void; onToggle: (v: boolean) => void; actions: RowActions }) {
  const t = useTranslations("acp.menuManager.v2");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: flat.item.uid });
  const it = flat.item;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, marginLeft: flat.depth * INDENT }}
      className={`gcs-menuMgr__row${selected ? " gcs-menuMgr__row--selected" : ""}${isDragging ? " gcs-menuMgr__row--dragging" : ""}${!it.enabled ? " gcs-menuMgr__row--off" : ""}${it.kind === "separator" ? " gcs-menuMgr__row--sep" : ""}`}
      data-testid="gcs-menu-row"
      data-depth={flat.depth}
      data-label={label}
      data-kind={it.kind}
    >
      <GcsTooltip content={t("drag", { name: label })}>
        <button type="button" className="gcs-iconBtn gcs-menuMgr__grip" aria-label={t("drag", { name: label })} {...attributes} {...listeners} data-testid="gcs-menu-grip">
          <GcsIconSvg icon={faGripVertical} />
        </button>
      </GcsTooltip>
      <button type="button" className="gcs-menuMgr__label gcs-sweep" onClick={onSelect} aria-pressed={selected} data-testid="gcs-menu-row-label">
        <span className="gcs-menuMgr__name">{label}</span>
        <span className="gcs-menuMgr__kind">{t(`kinds.${it.kind}`)}</span>
        {it.badge && <span className="gcs-menuMgr__badge">{it.badge}</span>}
        {it.counter && <span className="gcs-menuMgr__badge">#{it.counter}</span>}
        {flat.depth === 1 && it.shortLink && it.kind !== "separator" && (
          <span className="gcs-menuMgr__kind" data-testid="gcs-menu-row-short">
            {t("shortChip")}
          </span>
        )}
        {it.audience !== "all" && <span className="gcs-menuMgr__kind">{t(`audiences.${it.audience}`)}</span>}
      </button>
      <label className="gcs-menuMgr__switch">
        <input type="checkbox" className="gcs-switch" role="switch" checked={it.enabled} onChange={(e) => onToggle(e.target.checked)} aria-label={t("active", { name: label })} data-testid="gcs-menu-row-active" />
      </label>
      <GcsDropdown
        label={t("more", { name: label })}
        trigger={<GcsIconSvg icon={faEllipsis} />}
        triggerClassName="gcs-iconBtn"
        testId="gcs-menu-row-more"
        items={[
          { kind: "action", label: t("actions.edit"), icon: <GcsIconSvg icon={faPen} />, onSelect: actions.edit },
          ...(actions.child ? [{ kind: "action" as const, label: t("actions.child"), icon: <GcsIconSvg icon={faPlus} />, onSelect: actions.child, testId: "gcs-menu-add-child" }] : []),
          ...(actions.separator ? [{ kind: "action" as const, label: t("actions.separator"), icon: <GcsIconSvg icon={faPlus} />, onSelect: actions.separator }] : []),
          ...(first ? [] : [{ kind: "action" as const, label: t("actions.up"), icon: <GcsIconSvg icon={faArrowUp} />, onSelect: actions.up }]),
          ...(last ? [] : [{ kind: "action" as const, label: t("actions.down"), icon: <GcsIconSvg icon={faArrowDown} />, onSelect: actions.down }]),
          ...(flat.depth === 0 ? [{ kind: "action" as const, label: t("actions.indent"), icon: <GcsIconSvg icon={faIndent} />, onSelect: actions.indent, testId: "gcs-menu-indent" }] : []),
          ...(flat.depth === 1 && it.kind !== "separator" ? [{ kind: "action" as const, label: t("actions.outdent"), icon: <GcsIconSvg icon={faOutdent} />, onSelect: actions.outdent }] : []),
          { kind: "action", label: t("actions.duplicate"), icon: <GcsIconSvg icon={faCopy} />, onSelect: actions.duplicate },
          { kind: "separator" },
          { kind: "action", label: t("actions.remove"), icon: <GcsIconSvg icon={faTrash} />, onSelect: actions.remove, testId: "gcs-menu-remove" },
        ]}
      />
    </li>
  );
}

function Editor({
  item,
  depth,
  lang,
  setLang,
  locales,
  autoLabels,
  autoDescriptions,
  groups,
  appPages,
  counters,
  onPatch,
  onClose,
}: {
  item: Item;
  depth: 0 | 1;
  lang: string;
  setLang: (l: string) => void;
  locales: { code: string; label: string }[];
  autoLabels: Record<string, string>;
  autoDescriptions: Record<string, string>;
  groups: { id: number; name: string }[];
  appPages: GcsMenuAppPage[];
  counters: { key: string; label: string }[];
  onPatch: (p: Partial<Item>) => void;
  onClose: () => void;
}) {
  const t = useTranslations("acp.menuManager.v2");
  const tm = useTranslations("acp.menuManager");
  const kinds: Kind[] = depth === 0 ? ["app", "link", "dropdown"] : ["app", "link", "separator"];
  // Descrierea automată (itemii impliciți): rămâne până când adminul scrie una proprie.
  const autoDescription = item.labelKey ? autoDescriptions[item.labelKey] : undefined;
  return (
    <div className="gcs-menuMgr__editor" data-testid="gcs-menu-editor-panel">
      <div className="gcs-menuMgr__editorHead">
        <strong>{t("editTitle")}</strong>
        <GcsTooltip content={t("close")}>
          <button type="button" className="gcs-iconBtn" aria-label={t("close")} onClick={onClose}>
            <GcsIconSvg icon={faXmark} />
          </button>
        </GcsTooltip>
      </div>
      <div className="gcs-segLinks" role="radiogroup" aria-label={t("kind")}>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={item.kind === k}
            className={`gcs-segLink${item.kind === k ? " gcs-segLink--active" : ""}`}
            onClick={() => onPatch({ kind: k, ...(k === "dropdown" && !item.href ? { href: "" } : {}) })}
            data-testid={`gcs-menu-kind-${k}`}
          >
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>

      {item.kind !== "separator" && (
        <>
          {item.kind === "app" && (
            <label className="gcs-field">
              {t("appPage")}
              <select
                className="gcs-input"
                value={appPages.findIndex((p) => p.appKey === item.appKey && p.href === item.href)}
                onChange={(e) => {
                  const p = appPages[Number(e.target.value)];
                  if (p) onPatch({ appKey: p.appKey, href: p.href, labelKey: p.labelKey, icon: item.icon ?? p.icon, texts: Object.values(item.texts).some((v) => v.trim()) ? item.texts : {} });
                }}
                data-testid="gcs-menu-app-page"
              >
                <option value={-1}>{t("appPick")}</option>
                {appPages.map((p, i) => (
                  <option key={`${p.appKey}:${p.href}`} value={i}>
                    {p.label} — {p.href}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="gcs-menuMgr__fieldset">
            <legend>{tm("label")}</legend>
            <div className="gcs-tabs gcs-menuMgr__langs" role="tablist" aria-label={t("languages")}>
              {locales.map((l) => (
                <button key={l.code} type="button" role="tab" aria-selected={lang === l.code} className={`gcs-tab${lang === l.code ? " gcs-tab--active" : ""}`} onClick={() => setLang(l.code)} data-testid={`gcs-menu-lang-${l.code}`}>
                  {l.code.toUpperCase()}
                  {item.texts[l.code]?.trim() ? " •" : ""}
                </button>
              ))}
            </div>
            {item.labelKey && <p className="gcs-menuMgr__hint">{tm("autoLabel", { label: autoLabels[item.labelKey] ?? item.labelKey })}</p>}
            <label className="gcs-field">
              {t("labelIn", { lang: locales.find((l) => l.code === lang)?.label ?? lang })}
              <input className="gcs-input" value={item.texts[lang] ?? ""} maxLength={40} onChange={(e) => onPatch({ texts: { ...item.texts, [lang]: e.target.value } })} data-testid="gcs-menu-label-input" />
            </label>
            <label className="gcs-field">
              {t("descriptionIn", { lang: locales.find((l) => l.code === lang)?.label ?? lang })}
              <input
                className="gcs-input"
                value={item.descTexts[lang] ?? ""}
                maxLength={DESCRIPTION_MAX}
                placeholder={autoDescription}
                // Un singur rând (câmpul nu primește rânduri noi); tab-urile lipite devin spații (serverul le refuză).
                onChange={(e) => onPatch({ descTexts: { ...item.descTexts, [lang]: e.target.value.replace(/\t/g, " ") } })}
                data-testid="gcs-menu-desc-input"
              />
            </label>
            <p className="gcs-menuMgr__hint">{autoDescription ? t("descriptionAuto", { text: autoDescription }) : t("descriptionHint")}</p>
          </fieldset>
          {item.kind !== "app" && (
            <label className="gcs-field">
              {item.kind === "dropdown" ? t("hrefOptional") : tm("href")}
              <input className="gcs-input" value={item.href} maxLength={500} onChange={(e) => onPatch({ href: e.target.value })} data-testid="gcs-menu-href" />
            </label>
          )}
          <div className="gcs-field" role="group" aria-label={tm("icon")}>
            <span>{tm("icon")}</span>
            <GcsIconInput key={item.uid} name={`icon-${item.uid}`} value={item.icon} onChange={(v) => onPatch({ icon: v })} testId="gcs-menu-icon" />
          </div>
          <label className="gcs-checkRow">
            <input type="checkbox" checked={item.newTab} onChange={(e) => onPatch({ newTab: e.target.checked })} />
            {tm("newTab")}
          </label>
          {depth === 1 && (
            <div className="gcs-field">
              <label className="gcs-checkRow">
                <input type="checkbox" className="gcs-switch" role="switch" checked={item.shortLink} onChange={(e) => onPatch({ shortLink: e.target.checked })} data-testid="gcs-menu-short" />
                {t("shortLink")}
              </label>
              <p className="gcs-menuMgr__hint">{t("shortLinkHint")}</p>
            </div>
          )}
          <fieldset className="gcs-menuMgr__fieldset">
            <legend>{t("badgeTitle")}</legend>
            <div className="gcs-menuMgr__row2">
              <label className="gcs-field">
                {t("badgeText")}
                <input className="gcs-input" value={item.badge} maxLength={12} placeholder={tm("badgeHint")} onChange={(e) => onPatch({ badge: e.target.value })} data-testid="gcs-menu-badge" />
              </label>
              <label className="gcs-field">
                {t("counter")}
                <select className="gcs-input" value={item.counter ?? ""} onChange={(e) => onPatch({ counter: e.target.value || null })} data-testid="gcs-menu-counter">
                  <option value="">{t("noCounter")}</option>
                  {counters.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="gcs-field">
              {t("highlight")}
              <select className="gcs-input" value={item.highlight ?? ""} onChange={(e) => onPatch({ highlight: e.target.value || null })} data-testid="gcs-menu-highlight">
                <option value="">{t("highlights.none")}</option>
                <option value="accent">{t("highlights.accent")}</option>
                <option value="glow">{t("highlights.glow")}</option>
              </select>
            </label>
          </fieldset>
        </>
      )}

      <fieldset className="gcs-menuMgr__fieldset">
        <legend>{t("visibility")}</legend>
        <div className="gcs-segLinks" role="radiogroup" aria-label={t("audience")}>
          {(["all", "guests", "members"] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={item.audience === a} className={`gcs-segLink${item.audience === a ? " gcs-segLink--active" : ""}`} onClick={() => onPatch({ audience: a })} data-testid={`gcs-menu-audience-${a}`}>
              {t(`audiences.${a}`)}
            </button>
          ))}
        </div>
        <p className="gcs-menuMgr__hint">{tm("groupsHint")}</p>
        <div className="gcs-menuMgr__groups">
          {groups.map((g) => (
            <label key={g.id} className="gcs-check">
              <input type="checkbox" checked={item.groups.includes(g.id)} onChange={(e) => onPatch({ groups: e.target.checked ? [...item.groups, g.id] : item.groups.filter((x) => x !== g.id) })} />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
