"use client";

import { GcsButton, GcsDrawer } from "@gcs/ui";
import { GcsEditor, type GcsEditorBlock } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState, type DragEvent } from "react";
import { GcsIcon } from "@/lib/pages-icons";
import { GcsIconInput } from "@/lib/ui-inputs";
import { useErrorMessage } from "@/lib/use-error-message";
import { useBlockLabels, useEditorLabels } from "../../../../../(site)/_components/topic/useEditorLabels";
import { savePagesLayout } from "../../actions";

type Columns = "1" | "1-1" | "2-1" | "1-2" | "1-1-1";
type BlockType = "content" | "html" | "widget" | "records" | "image" | "block" | "pages";
type Block = { id: string; type: BlockType; title: string; icon: string | null; card: boolean; groups: number[] } & Record<string, unknown>;
type Section = { id: string; title: string; columns: Columns; style: "plain" | "card" | "accent"; blocks: Block[][] };
type Layout = { v: 1; width: "normal" | "wide" | "full"; sections: Section[] };

export type GcsBuilderField =
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "number"; min: number; max: number }
  | { key: string; label: string; type: "text"; maxLength: number };
export type GcsBuilderWidget = { key: string; module: string; label: string; description: string; icon: string; defaults: Record<string, unknown>; fields: GcsBuilderField[] };

type Props = {
  nodeId: number;
  viewHref: string;
  initial: unknown;
  widgets: GcsBuilderWidget[];
  databases: { id: number; name: string; categories: { id: number; name: string }[] }[];
  images: { id: number; title: string; url: string }[];
  blocks: { id: number; name: string; category: string }[];
  folders: { id: number; path: string }[];
  groups: { id: number; name: string }[];
  editorBlocks: GcsEditorBlock[];
};

const COLUMNS: Columns[] = ["1", "1-1", "2-1", "1-2", "1-1-1"];
const TYPES: { type: BlockType; icon: string }[] = [
  { type: "content", icon: "fa-solid fa-pen-to-square" },
  { type: "widget", icon: "fa-solid fa-puzzle-piece" },
  { type: "records", icon: "fa-solid fa-database" },
  { type: "image", icon: "fa-solid fa-image" },
  { type: "block", icon: "fa-solid fa-cube" },
  { type: "pages", icon: "fa-solid fa-sitemap" },
  { type: "html", icon: "fa-solid fa-code" },
];
const ICON_OF = Object.fromEntries(TYPES.map((x) => [x.type, x.icon])) as Record<BlockType, string>;
const count = (c: Columns) => c.split("-").length;
let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`.slice(0, 24);

function normalize(raw: unknown): Layout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Layout>;
  const sections = Array.isArray(o.sections) ? o.sections : [];
  return {
    v: 1,
    width: o.width === "wide" || o.width === "full" ? o.width : "normal",
    sections: sections.map((s) => ({ ...s, blocks: Array.from({ length: count(s.columns) }, (_, i) => (s.blocks?.[i] ?? []).map((b) => ({ ...b, groups: b.groups ?? [] }))) })),
  };
}

function newBlock(type: BlockType, widgets: GcsBuilderWidget[]): Block {
  const base = { id: newId("b"), type, title: "", icon: null, card: type !== "widget", groups: [] };
  switch (type) {
    case "content":
      return { ...base, doc: null, html: "" };
    case "html":
      return { ...base, html: "" };
    case "widget":
      return { ...base, widget: widgets[0]?.key ?? "", config: { ...(widgets[0]?.defaults ?? {}) } };
    case "records":
      return { ...base, databaseId: null, limit: 6, view: "grid", sort: "newest", categoryId: null, hideImages: false };
    case "image":
      return { ...base, mediaId: null, caption: "", link: "", size: "normal" };
    case "block":
      return { ...base, blockId: null };
    case "pages":
      return { ...base, folderId: null };
  }
}

/**
 * Constructorul unei pagini (ACP › Pagini): secțiuni cu aspectul coloanelor (1, ½+½, ⅔+⅓, ⅓+⅔, ⅓×3) și stilul lor,
 * blocuri în coloane (conținut, widget GCS, înregistrări, imagine, bloc reutilizabil, meniu de secțiune, HTML),
 * mutate prin tragere sau cu săgețile; fiecare bloc se editează în panoul din dreapta. „Salvează” trimite tot layout-ul;
 * erorile apar pe blocul lor. Versiunea de dinainte se păstrează (Versiuni).
 */
export function GcsPageBuilder(props: Props) {
  const t = useTranslations("acp.pages.builder");
  const errorMessage = useErrorMessage();
  const [layout, setLayout] = useState<Layout>(() => normalize(props.initial));
  const [editing, setEditing] = useState<{ s: number; c: number; b: number } | null>(null);
  const [adding, setAdding] = useState<{ s: number; c: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [drag, setDrag] = useState<{ s: number; c: number; b: number } | null>(null);
  const widgetsByKey = useMemo(() => new Map(props.widgets.map((w) => [w.key, w])), [props.widgets]);

  const update = (fn: (l: Layout) => Layout) => {
    setLayout((l) => fn(structuredClone(l)));
    setDirty(true);
    setStatus(null);
  };

  function summary(b: Block): string {
    switch (b.type) {
      case "widget":
        return widgetsByKey.get(String(b.widget))?.label ?? String(b.widget);
      case "records":
        return props.databases.find((d) => d.id === b.databaseId)?.name ?? t("noDatabase");
      case "image":
        return props.images.find((m) => m.id === b.mediaId)?.title ?? t("noImage");
      case "block":
        return props.blocks.find((x) => x.id === b.blockId)?.name ?? t("noBlock");
      case "pages":
        return props.folders.find((f) => f.id === b.folderId)?.path ?? t("currentFolder");
      case "html":
        return t("htmlChars", { n: String(b.html ?? "").length });
      default:
        return b.html ? String(b.html).replace(/<[^>]+>/g, " ").trim().slice(0, 80) || t("emptyContent") : t("emptyContent");
    }
  }

  async function save() {
    setPending(true);
    setErrors({});
    setStatus(null);
    const res = await savePagesLayout(props.nodeId, layout);
    setPending(false);
    if (!res.ok) {
      setErrors(res.error.fields ?? {});
      return setStatus({ ok: false, text: errorMessage(res.error) });
    }
    setDirty(false);
    setStatus({ ok: true, text: t("saved") });
  }

  const moveSection = (i: number, d: number) =>
    update((l) => {
      const j = i + d;
      if (j < 0 || j >= l.sections.length) return l;
      [l.sections[i], l.sections[j]] = [l.sections[j]!, l.sections[i]!];
      return l;
    });
  const setColumns = (i: number, c: Columns) =>
    update((l) => {
      const s = l.sections[i]!;
      const flat = s.blocks;
      const next: Block[][] = Array.from({ length: count(c) }, (_, k) => [...(flat[k] ?? [])]);
      for (const extra of flat.slice(count(c))) next[next.length - 1]!.push(...extra);
      s.columns = c;
      s.blocks = next;
      return l;
    });
  const moveBlock = (from: { s: number; c: number; b: number }, to: { s: number; c: number; index: number }) =>
    update((l) => {
      const [blk] = l.sections[from.s]!.blocks[from.c]!.splice(from.b, 1);
      if (!blk) return l;
      const col = l.sections[to.s]!.blocks[to.c]!;
      const index = from.s === to.s && from.c === to.c && to.index > from.b ? to.index - 1 : to.index;
      col.splice(Math.min(Math.max(index, 0), col.length), 0, blk);
      return l;
    });
  const onDrop = (e: DragEvent, s: number, c: number, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (drag) moveBlock(drag, { s, c, index });
    setDrag(null);
  };

  const current = editing ? layout.sections[editing.s]?.blocks[editing.c]?.[editing.b] : undefined;
  const setCurrent = (patch: Partial<Block>) =>
    editing &&
    update((l) => {
      const col = l.sections[editing.s]!.blocks[editing.c]!;
      col[editing.b] = { ...col[editing.b]!, ...patch } as Block;
      return l;
    });

  return (
    <div className="gcs-pgBuilder" data-testid="gcs-pages-builder">
      <div className="gcs-card gcs-pgBuilder__bar">
        <label className="gcs-field gcs-pgBuilder__width">
          <span className="gcs-field__label">{t("width")}</span>
          <select className="gcs-input" value={layout.width} onChange={(e) => update((l) => ({ ...l, width: e.target.value as Layout["width"] }))}>
            {(["normal", "wide", "full"] as const).map((w) => (
              <option key={w} value={w}>
                {t(`widths.${w}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="gcs-pgBuilder__status" role="status" aria-live="polite">
          {status ? <span className={status.ok ? "gcs-ok" : "gcs-formError"}>{status.text}</span> : dirty ? t("unsaved") : null}
        </span>
        <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={props.viewHref} target="_blank">
          <GcsIcon name="fa-solid fa-eye" />
          {t("preview")}
        </Link>
        <GcsButton variant="primary" onClick={save} disabled={pending} icon={<GcsIcon name="fa-solid fa-floppy-disk" />} data-testid="gcs-pages-builder-save">
          {t("save")}
        </GcsButton>
      </div>

      {layout.sections.length === 0 && <p className="gcs-card gcs-acpList__empty">{t("empty")}</p>}

      {layout.sections.map((s, si) => (
        <section key={s.id} className={`gcs-card gcs-pgBuilder__section gcs-pgBuilder__section--${s.style}`} data-testid="gcs-pages-builder-section" aria-label={s.title || t("sectionN", { n: si + 1 })}>
          <div className="gcs-pgBuilder__sectionBar">
            <input
              className="gcs-input gcs-pgBuilder__sectionTitle"
              value={s.title}
              placeholder={t("sectionTitle")}
              aria-label={t("sectionTitle")}
              maxLength={120}
              onChange={(e) =>
                update((l) => {
                  l.sections[si]!.title = e.target.value;
                  return l;
                })
              }
            />
            <span className="gcs-segLinks gcs-pgBuilder__cols" role="radiogroup" aria-label={t("columns")}>
              {COLUMNS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={s.columns === c} className={`gcs-segLink${s.columns === c ? " gcs-segLink--active" : ""}`} onClick={() => setColumns(si, c)} title={t(`cols.${c}`)} data-testid={`gcs-pages-cols-${c}`}>
                  <span className="gcs-pgBuilder__colIcon" aria-hidden="true">
                    {c.split("-").map((n, k) => (
                      <i key={k} style={{ flex: Number(n) }} />
                    ))}
                  </span>
                  <span className="gcs-srOnly">{t(`cols.${c}`)}</span>
                </button>
              ))}
            </span>
            <select
              className="gcs-input gcs-pgBuilder__style"
              value={s.style}
              aria-label={t("style")}
              onChange={(e) =>
                update((l) => {
                  l.sections[si]!.style = e.target.value as Section["style"];
                  return l;
                })
              }
            >
              {(["plain", "card", "accent"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`styles.${v}`)}
                </option>
              ))}
            </select>
            <button type="button" className="gcs-iconBtn" disabled={si === 0} onClick={() => moveSection(si, -1)} aria-label={t("moveUp")} title={t("moveUp")}>
              <GcsIcon name="fa-solid fa-arrow-up" />
            </button>
            <button type="button" className="gcs-iconBtn" disabled={si === layout.sections.length - 1} onClick={() => moveSection(si, 1)} aria-label={t("moveDown")} title={t("moveDown")}>
              <GcsIcon name="fa-solid fa-arrow-down" />
            </button>
            <button
              type="button"
              className="gcs-iconBtn"
              onClick={() =>
                update((l) => {
                  l.sections.splice(si, 1);
                  return l;
                })
              }
              aria-label={t("deleteSection")}
              title={t("deleteSection")}
            >
              <GcsIcon name="fa-solid fa-trash" />
            </button>
          </div>
          <div className="gcs-pgBuilder__grid" style={{ gridTemplateColumns: s.columns.split("-").map((n) => `${n}fr`).join(" ") }}>
            {s.blocks.map((col, ci) => (
              <div key={ci} className="gcs-pgBuilder__col" onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => onDrop(e, si, ci, col.length)} data-testid="gcs-pages-builder-col">
                {col.map((b, bi) => (
                  <div
                    key={b.id}
                    className={`gcs-pgBuilder__tile${errors[`block.${b.id}`] ? " gcs-pgBuilder__tile--error" : ""}`}
                    draggable
                    onDragStart={() => setDrag({ s: si, c: ci, b: bi })}
                    onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => drag && e.preventDefault()}
                    onDrop={(e) => onDrop(e, si, ci, bi)}
                    data-testid="gcs-pages-builder-block"
                    data-type={b.type}
                  >
                    <GcsIcon name={ICON_OF[b.type]} className="gcs-pgBuilder__tileIcon" />
                    <span className="gcs-pgBuilder__tileText">
                      <strong>{b.title || t(`types.${b.type}`)}</strong>
                      <small>{summary(b)}</small>
                      {errors[`block.${b.id}`] && <small className="gcs-formError">{t.has(`errors.${errors[`block.${b.id}`]}` as never) ? t(`errors.${errors[`block.${b.id}`]}` as never) : errors[`block.${b.id}`]}</small>}
                    </span>
                    <span className="gcs-pgBuilder__tileTools">
                      <button type="button" className="gcs-iconBtn" disabled={bi === 0} onClick={() => moveBlock({ s: si, c: ci, b: bi }, { s: si, c: ci, index: bi - 1 })} aria-label={t("moveUp")}>
                        <GcsIcon name="fa-solid fa-chevron-up" />
                      </button>
                      <button type="button" className="gcs-iconBtn" disabled={bi === col.length - 1} onClick={() => moveBlock({ s: si, c: ci, b: bi }, { s: si, c: ci, index: bi + 2 })} aria-label={t("moveDown")}>
                        <GcsIcon name="fa-solid fa-chevron-down" />
                      </button>
                      <button type="button" className="gcs-iconBtn" onClick={() => setEditing({ s: si, c: ci, b: bi })} aria-label={t("editBlock")} title={t("editBlock")} data-testid="gcs-pages-builder-edit">
                        <GcsIcon name="fa-solid fa-pen-to-square" />
                      </button>
                      <button
                        type="button"
                        className="gcs-iconBtn"
                        onClick={() =>
                          update((l) => {
                            l.sections[si]!.blocks[ci]!.splice(bi, 1);
                            return l;
                          })
                        }
                        aria-label={t("deleteBlock")}
                        title={t("deleteBlock")}
                      >
                        <GcsIcon name="fa-solid fa-xmark" />
                      </button>
                    </span>
                  </div>
                ))}
                {adding?.s === si && adding.c === ci ? (
                  <div className="gcs-pgBuilder__palette" role="menu" aria-label={t("addBlock")}>
                    {TYPES.map((x) => (
                      <button
                        key={x.type}
                        type="button"
                        role="menuitem"
                        className="gcs-pgBuilder__paletteItem"
                        data-testid={`gcs-pages-add-${x.type}`}
                        onClick={() => {
                          const blk = newBlock(x.type, props.widgets);
                          update((l) => {
                            l.sections[si]!.blocks[ci]!.push(blk);
                            return l;
                          });
                          setAdding(null);
                          setEditing({ s: si, c: ci, b: col.length });
                        }}
                      >
                        <GcsIcon name={x.icon} />
                        <span>
                          <strong>{t(`types.${x.type}`)}</strong>
                          <small>{t(`typeHints.${x.type}`)}</small>
                        </span>
                      </button>
                    ))}
                    <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setAdding(null)}>
                      {t("cancel")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="gcs-pgBuilder__add" onClick={() => setAdding({ s: si, c: ci })} data-testid="gcs-pages-builder-add">
                    <GcsIcon name="fa-solid fa-plus" />
                    {t("addBlock")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <button
        type="button"
        className="gcs-btn gcs-btn--ghost gcs-pgBuilder__addSection"
        onClick={() => update((l) => ({ ...l, sections: [...l.sections, { id: newId("s"), title: "", columns: "1", style: "plain", blocks: [[]] }] }))}
        data-testid="gcs-pages-builder-add-section"
      >
        <GcsIcon name="fa-solid fa-layer-group" />
        {t("addSection")}
      </button>

      {current && editing && (
        <GcsDrawer title={current.title || t(`types.${current.type}`)} closeLabel={t("close")} size="lg" onClose={() => setEditing(null)} testId="gcs-pages-block-panel" footer={<GcsButton variant="primary" onClick={() => setEditing(null)}>{t("done")}</GcsButton>}>
          <BlockForm block={current} onChange={setCurrent} props={props} widgetsByKey={widgetsByKey} />
        </GcsDrawer>
      )}
    </div>
  );
}

/** Panoul unui bloc: titlul, iconița, cardul, grupurile și câmpurile tipului lui. */
function BlockForm({ block, onChange, props, widgetsByKey }: { block: Block; onChange: (patch: Partial<Block>) => void; props: Props; widgetsByKey: Map<string, GcsBuilderWidget> }) {
  const t = useTranslations("acp.pages.builder");
  const labels = useEditorLabels();
  const blockLabels = useBlockLabels();
  const num = (v: unknown) => (typeof v === "number" ? v : v === "" || v === null || v === undefined ? null : Number(v));
  const widget = block.type === "widget" ? widgetsByKey.get(String(block.widget)) : undefined;
  const db = block.type === "records" ? props.databases.find((d) => d.id === block.databaseId) : undefined;
  const config = (block.config ?? {}) as Record<string, unknown>;
  return (
    <div className="gcs-pgBlockForm">
      <fieldset className="gcs-formSec">
        <legend>{t("secBlock")}</legend>
        <div className="gcs-formGrid gcs-formGrid--2">
          <label className="gcs-field">
            {t("blockTitle")}
            <input className="gcs-input" value={block.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} data-testid="gcs-pages-block-title" />
          </label>
          <div className="gcs-field" role="group" aria-label={t("blockIcon")}>
            <span>{t("blockIcon")}</span>
            <GcsIconInput name={`icon-${block.id}`} value={block.icon} onChange={(v: string | null) => onChange({ icon: v })} />
          </div>
        </div>
        {block.type !== "widget" && (
          <label className="gcs-toggleRow">
            <span>{t("card")}</span>
            <input type="checkbox" checked={block.card} onChange={(e) => onChange({ card: e.target.checked })} />
          </label>
        )}
      </fieldset>

      {block.type === "content" && (
        <div className="gcs-field">
          <span className="gcs-field__label" id="gcs-pg-block-content">
            {t("content")}
          </span>
          <GcsEditor
            id={`gcs-pg-block-editor-${block.id}`}
            labelledBy="gcs-pg-block-content"
            labels={labels}
            forumId={0}
            mentionUrl="/api/forums/mentions"
            initialContent={(block.doc as JSONContent | null) ?? null}
            blocks={props.editorBlocks}
            blockLabels={blockLabels}
            onChange={(doc, empty) => onChange({ doc: empty ? null : doc })}
          />
        </div>
      )}

      {block.type === "html" && (
        <label className="gcs-field">
          {t("html")}
          <textarea className="gcs-input gcs-pgCodeInput" rows={14} spellCheck={false} value={String(block.html ?? "")} onChange={(e) => onChange({ html: e.target.value })} data-testid="gcs-pages-block-html" />
          <span className="gcs-field__hint">{t("htmlHint")}</span>
        </label>
      )}

      {block.type === "widget" && (
        <fieldset className="gcs-formSec">
          <legend>{t("types.widget")}</legend>
          <label className="gcs-field">
            {t("widget")}
            <select
              className="gcs-input"
              value={String(block.widget)}
              onChange={(e) => onChange({ widget: e.target.value, config: { ...(widgetsByKey.get(e.target.value)?.defaults ?? {}) } })}
              data-testid="gcs-pages-block-widget"
            >
              {[...new Set(props.widgets.map((w) => w.module))].map((m) => (
                <optgroup key={m} label={m}>
                  {props.widgets
                    .filter((w) => w.module === m)
                    .map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {widget?.description && <span className="gcs-field__hint">{widget.description}</span>}
          </label>
          {widget?.fields.map((f) => (
            <label key={f.key} className="gcs-field">
              {f.label}
              {f.type === "select" ? (
                <select className="gcs-input" value={String(config[f.key] ?? "")} onChange={(e) => onChange({ config: { ...config, [f.key]: e.target.value } })}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "number" ? (
                <input className="gcs-input" type="number" min={f.min} max={f.max} value={String(config[f.key] ?? "")} onChange={(e) => onChange({ config: { ...config, [f.key]: Number(e.target.value) } })} />
              ) : (
                <input className="gcs-input" maxLength={f.maxLength} value={String(config[f.key] ?? "")} onChange={(e) => onChange({ config: { ...config, [f.key]: e.target.value } })} />
              )}
            </label>
          ))}
        </fieldset>
      )}

      {block.type === "records" && (
        <fieldset className="gcs-formSec">
          <legend>{t("types.records")}</legend>
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("database")}
              <select className="gcs-input" value={String(block.databaseId ?? "")} onChange={(e) => onChange({ databaseId: num(e.target.value), categoryId: null })} data-testid="gcs-pages-block-database">
                <option value="">—</option>
                {props.databases.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("category")}
              <select className="gcs-input" value={String(block.categoryId ?? "")} onChange={(e) => onChange({ categoryId: num(e.target.value) })}>
                <option value="">{t("allCategories")}</option>
                {db?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("view")}
              <select className="gcs-input" value={String(block.view)} onChange={(e) => onChange({ view: e.target.value })}>
                {["list", "grid", "compact", "featured", "carousel"].map((v) => (
                  <option key={v} value={v}>
                    {t(`views.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("sort")}
              <select className="gcs-input" value={String(block.sort)} onChange={(e) => onChange({ sort: e.target.value })}>
                {["newest", "updated", "rating", "views", "comments", "featured"].map((v) => (
                  <option key={v} value={v}>
                    {t(`sorts.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("limit")}
              <input className="gcs-input" type="number" min={1} max={50} value={String(block.limit ?? 6)} onChange={(e) => onChange({ limit: Number(e.target.value) })} />
            </label>
          </div>
          <label className="gcs-toggleRow">
            <span>{t("hideImages")}</span>
            <input type="checkbox" checked={block.hideImages === true} onChange={(e) => onChange({ hideImages: e.target.checked })} />
          </label>
        </fieldset>
      )}

      {block.type === "image" && (
        <fieldset className="gcs-formSec">
          <legend>{t("types.image")}</legend>
          {props.images.length === 0 ? (
            <p className="gcs-muted">
              {t("noImages")} <Link href="/admin/pages/media">{t("openMedia")}</Link>
            </p>
          ) : (
            <div className="gcs-pgPicker" role="radiogroup" aria-label={t("pickImage")}>
              {props.images.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={block.mediaId === m.id} className={`gcs-pgPicker__item${block.mediaId === m.id ? " gcs-pgPicker__item--on" : ""}`} onClick={() => onChange({ mediaId: m.id })} title={m.title}>
                  <img src={m.url} alt={m.title} loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <div className="gcs-formGrid gcs-formGrid--2">
            <label className="gcs-field">
              {t("caption")}
              <input className="gcs-input" value={String(block.caption ?? "")} maxLength={300} onChange={(e) => onChange({ caption: e.target.value })} />
            </label>
            <label className="gcs-field">
              {t("link")}
              <input className="gcs-input" value={String(block.link ?? "")} maxLength={500} placeholder="/pages/... · https://" onChange={(e) => onChange({ link: e.target.value })} />
            </label>
            <label className="gcs-field">
              {t("size")}
              <select className="gcs-input" value={String(block.size ?? "normal")} onChange={(e) => onChange({ size: e.target.value })}>
                {["normal", "wide", "full"].map((v) => (
                  <option key={v} value={v}>
                    {t(`sizes.${v}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
      )}

      {block.type === "block" && (
        <label className="gcs-field">
          {t("types.block")}
          <select className="gcs-input" value={String(block.blockId ?? "")} onChange={(e) => onChange({ blockId: num(e.target.value) })}>
            <option value="">—</option>
            {props.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.category ? `${b.category} · ` : ""}
                {b.name}
              </option>
            ))}
          </select>
          <span className="gcs-field__hint">
            <Link href="/admin/pages/blocks">{t("manageBlocks")}</Link>
          </span>
        </label>
      )}

      {block.type === "pages" && (
        <label className="gcs-field">
          {t("folder")}
          <select className="gcs-input" value={String(block.folderId ?? "")} onChange={(e) => onChange({ folderId: num(e.target.value) })}>
            <option value="">{t("currentFolder")}</option>
            {props.folders.map((f) => (
              <option key={f.id} value={f.id}>
                /{f.path}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="gcs-formSec">
        <legend>{t("visibility")}</legend>
        <p className="gcs-muted gcs-acpHint">{t("visibilityHint")}</p>
        <div className="gcs-forumAudience">
          {props.groups.map((g) => (
            <label key={g.id} className="gcs-check">
              <input type="checkbox" checked={block.groups.includes(g.id)} onChange={(e) => onChange({ groups: e.target.checked ? [...block.groups, g.id] : block.groups.filter((x) => x !== g.id) })} />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
