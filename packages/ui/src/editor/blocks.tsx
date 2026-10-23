"use client";

import { faCheck, faCubes, faSliders, faXmark } from "@fortawesome/free-solid-svg-icons";
import { mergeAttributes, Node, type Editor, type JSONContent } from "@tiptap/core";
import { useState } from "react";
import { GcsIconSvg } from "../icons/svg";

/**
 * Blocurile sigure ale editorului (Forum v2, macheta GiveawayBlocks): secțiune, casetă de atenționare, grilă de carduri,
 * buton, coloane, pași, progres, conținut ascuns și HTML (doar Root). Aceleași noduri și atribute ca în
 * `GcsContentRenderer` (serverul le validează și le desenează în culorile temei); în editor apar ca blocuri marcate,
 * iar atributele se aleg dintr-un mic formular („Blocuri” și „Setările blocului” din bara de unelte).
 */

/** Familiile de blocuri (permisiunile `forums.block_*`) și nodurile lor. */
export const GCS_EDITOR_BLOCK_NODES = {
  section: ["gcsSection"],
  callout: ["gcsCallout"],
  cards: ["gcsCardGrid", "gcsCard"],
  button: ["gcsButton"],
  columns: ["gcsColumns", "gcsColumn"],
  steps: ["gcsSteps", "gcsStep"],
  progress: ["gcsProgress"],
  hidden: ["gcsHidden"],
  html: ["gcsHtml"],
} as const;
export type GcsEditorBlock = keyof typeof GCS_EDITOR_BLOCK_NODES;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Un atribut text păstrat în `data-*` (gol = lipsă). */
function textAttr(name: string, def: string | null = null) {
  return {
    default: def,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${kebab(name)}`) ?? def,
    renderHTML: (a: Record<string, unknown>) => (a[name] === null || a[name] === undefined || a[name] === "" ? {} : { [`data-${kebab(name)}`]: String(a[name]) }),
  };
}

/** Un atribut numeric (serverul cere numere întregi, nu text). */
function numAttr(name: string, def: number | null = null) {
  return {
    default: def,
    parseHTML: (el: HTMLElement) => {
      const v = Number(el.getAttribute(`data-${kebab(name)}`));
      return Number.isFinite(v) ? Math.trunc(v) : def;
    },
    renderHTML: (a: Record<string, unknown>) => (typeof a[name] === "number" ? { [`data-${kebab(name)}`]: String(a[name]) } : {}),
  };
}

const container = (name: string, tag: string, cls: string, content: string, attrs: Record<string, ReturnType<typeof textAttr> | ReturnType<typeof numAttr>>, group = "block") =>
  Node.create({
    name,
    group,
    content,
    defining: true,
    addAttributes: () => attrs,
    parseHTML: () => [{ tag: `${tag}[data-gcs-block="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes({ class: `gcs-blockEd ${cls}`, "data-gcs-block": name }, HTMLAttributes), 0],
  });

const leaf = (name: string, cls: string, attrs: Record<string, ReturnType<typeof textAttr> | ReturnType<typeof numAttr>>, text: (a: Record<string, unknown>) => string, group = "block") =>
  Node.create({
    name,
    group,
    atom: true,
    selectable: true,
    addAttributes: () => attrs,
    parseHTML: () => [{ tag: `div[data-gcs-block="${name}"]` }],
    renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes({ class: `gcs-blockEd gcs-blockEd--leaf ${cls}`, "data-gcs-block": name }, HTMLAttributes), ["span", { class: "gcs-blockEd__text" }, text(node.attrs)]],
  });

/** Extensiile Tiptap ale blocurilor (doar cele permise autorului ajung în schemă). */
export function gcsBlockExtensions(allowed: readonly GcsEditorBlock[]) {
  const on = (b: GcsEditorBlock) => allowed.includes(b);
  return [
    ...(on("section") ? [container("gcsSection", "section", "gcs-blockEd--section", "block+", { title: textAttr("title"), icon: textAttr("icon"), tone: textAttr("tone", "accent") })] : []),
    ...(on("callout") ? [container("gcsCallout", "div", "gcs-blockEd--callout", "block+", { kind: textAttr("kind", "info"), title: textAttr("title") })] : []),
    ...(on("cards")
      ? [
          container("gcsCardGrid", "div", "gcs-blockEd--cards", "gcsCard+", { columns: numAttr("columns", 3) }),
          leaf(
            "gcsCard",
            "gcs-blockEd--card",
            { title: textAttr("title", "…"), subtitle: textAttr("subtitle"), value: textAttr("value"), badge: textAttr("badge"), icon: textAttr("icon"), highlight: textAttr("highlight") },
            (a) => [a.badge, a.title, a.subtitle, a.value].filter(Boolean).join(" · "),
            "blockCard",
          ),
        ]
      : []),
    ...(on("button") ? [leaf("gcsButton", "gcs-blockEd--button", { label: textAttr("label", "…"), href: textAttr("href", "/"), variant: textAttr("variant", "primary"), icon: textAttr("icon") }, (a) => `▸ ${String(a.label ?? "")} → ${String(a.href ?? "")}`)] : []),
    ...(on("columns") ? [container("gcsColumns", "div", "gcs-blockEd--columns", "gcsColumn{2,3}", {}), container("gcsColumn", "div", "gcs-blockEd--column", "block+", {}, "blockColumn")] : []),
    ...(on("steps") ? [container("gcsSteps", "div", "gcs-blockEd--steps", "gcsStep+", {}), container("gcsStep", "div", "gcs-blockEd--step", "block+", { title: textAttr("title") }, "blockStep")] : []),
    ...(on("progress") ? [leaf("gcsProgress", "gcs-blockEd--progress", { label: textAttr("label", "…"), value: numAttr("value", 0), max: numAttr("max", 100) }, (a) => `${String(a.label ?? "")}: ${String(a.value ?? 0)} / ${String(a.max ?? 100)}`)] : []),
    ...(on("hidden") ? [container("gcsHidden", "div", "gcs-blockEd--hidden", "block+", { mode: textAttr("mode", "reply"), groups: textAttr("groups"), label: textAttr("label") })] : []),
    ...(on("html") ? [leaf("gcsHtml", "gcs-blockEd--html", { html: textAttr("html", "<p></p>") }, (a) => String(a.html ?? "").slice(0, 120))] : []),
  ];
}

/** Câmpurile formularului fiecărui nod de bloc (valorile ajung în atributele nodului). */
type FieldDef = { key: string; type: "text" | "number" | "select" | "textarea" | "toggle"; options?: readonly string[] };
const TONES = ["accent", "neutral", "ok", "warn", "danger", "info"] as const;
export const GCS_BLOCK_FIELDS: Record<string, FieldDef[]> = {
  gcsSection: [{ key: "title", type: "text" }, { key: "icon", type: "text" }, { key: "tone", type: "select", options: TONES }],
  gcsCallout: [{ key: "kind", type: "select", options: ["info", "warning", "success"] }, { key: "title", type: "text" }],
  gcsCardGrid: [{ key: "columns", type: "select", options: ["1", "2", "3", "4"] }],
  gcsCard: [
    { key: "title", type: "text" },
    { key: "subtitle", type: "text" },
    { key: "value", type: "text" },
    { key: "badge", type: "text" },
    { key: "icon", type: "text" },
    { key: "highlight", type: "toggle" },
  ],
  gcsButton: [{ key: "label", type: "text" }, { key: "href", type: "text" }, { key: "variant", type: "select", options: ["primary", "ghost"] }, { key: "icon", type: "text" }],
  gcsColumns: [],
  gcsColumn: [],
  gcsSteps: [],
  gcsStep: [{ key: "title", type: "text" }],
  gcsProgress: [{ key: "label", type: "text" }, { key: "value", type: "number" }, { key: "max", type: "number" }],
  gcsHidden: [{ key: "mode", type: "select", options: ["reply", "members", "groups"] }, { key: "groups", type: "text" }, { key: "label", type: "text" }],
  gcsHtml: [{ key: "html", type: "textarea" }],
};

/** Ce inserează fiecare familie (structura de pornire; atributele se completează din formular). */
function template(block: GcsEditorBlock, attrs: Record<string, unknown>): JSONContent {
  const p = { type: "paragraph" };
  switch (block) {
    case "section":
      return { type: "gcsSection", attrs, content: [p] };
    case "callout":
      return { type: "gcsCallout", attrs, content: [p] };
    case "cards":
      return { type: "gcsCardGrid", attrs: { columns: Number(attrs.columns ?? 3) }, content: [1, 2, 3].map((n) => ({ type: "gcsCard", attrs: { title: `#${n}` } })) };
    case "button":
      return { type: "gcsButton", attrs };
    case "columns":
      return { type: "gcsColumns", content: [{ type: "gcsColumn", content: [p] }, { type: "gcsColumn", content: [p] }] };
    case "steps":
      return { type: "gcsSteps", content: [1, 2, 3].map((n) => ({ type: "gcsStep", attrs: { title: `${n}.` }, content: [p] })) };
    case "progress":
      return { type: "gcsProgress", attrs };
    case "hidden":
      return { type: "gcsHidden", attrs, content: [p] };
    case "html":
      return { type: "gcsHtml", attrs };
  }
}

const FIRST_NODE: Record<GcsEditorBlock, string> = {
  section: "gcsSection",
  callout: "gcsCallout",
  cards: "gcsCardGrid",
  button: "gcsButton",
  columns: "gcsColumns",
  steps: "gcsSteps",
  progress: "gcsProgress",
  hidden: "gcsHidden",
  html: "gcsHtml",
};

const BLOCK_NODE_NAMES = new Set<string>(Object.values(GCS_EDITOR_BLOCK_NODES).flat());

/** Blocul din jurul selecției (cel mai apropiat), cu poziția lui, sau `null`. */
export function blockAtSelection(editor: Editor): { name: string; pos: number; attrs: Record<string, unknown> } | null {
  const { selection } = editor.state;
  const selected = (selection as unknown as { node?: { type: { name: string }; attrs: Record<string, unknown> } }).node;
  if (selected && BLOCK_NODE_NAMES.has(selected.type.name)) return { name: selected.type.name, pos: selection.from, attrs: { ...selected.attrs } };
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (BLOCK_NODE_NAMES.has(node.type.name) && (GCS_BLOCK_FIELDS[node.type.name]?.length ?? 0) > 0) return { name: node.type.name, pos: $from.before(d), attrs: { ...node.attrs } };
  }
  return null;
}

/** Textele formularelor blocurilor (traduse de pagină; o cheie lipsă apare ca atare). */
export type GcsBlockLabels = Record<string, string>;

/**
 * Uneltele blocurilor din bara editorului: „Blocuri” (alegerea unui bloc permis, apoi formularul lui) și „Setările
 * blocului” (formularul blocului din jurul cursorului).
 */
export function GcsBlockTools({ editor, allowed, labels }: { editor: Editor | null; allowed: readonly GcsEditorBlock[]; labels: GcsBlockLabels }) {
  const [open, setOpen] = useState<null | "menu" | { mode: "insert"; block: GcsEditorBlock } | { mode: "edit"; name: string; pos: number }>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const l = (k: string) => labels[k] ?? k;
  if (!editor || allowed.length === 0) return null;
  const current = blockAtSelection(editor);

  const startInsert = (block: GcsEditorBlock) => {
    const defaults: Record<string, unknown> = {};
    for (const f of GCS_BLOCK_FIELDS[FIRST_NODE[block]] ?? []) {
      const def = editor.schema.nodes[FIRST_NODE[block]]?.spec.attrs?.[f.key]?.default;
      if (def !== undefined && def !== null) defaults[f.key] = def;
    }
    setValues(defaults);
    if ((GCS_BLOCK_FIELDS[FIRST_NODE[block]] ?? []).length === 0) {
      editor.chain().focus().insertContent(template(block, {})).run();
      setOpen(null);
    } else setOpen({ mode: "insert", block });
  };

  // Valorile formularului în forma cerută de server (o iconiță sau o adresă greșită nu strică toată postarea).
  const clean = (name: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of GCS_BLOCK_FIELDS[name] ?? []) {
      const v = values[f.key];
      const s = typeof v === "string" ? v.trim() : "";
      if (f.type === "number") out[f.key] = Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0;
      else if (f.type === "toggle") out[f.key] = v === true || v === "1" ? "1" : null;
      else if (f.key === "columns") out[f.key] = Number(v ?? 3);
      else if (f.key === "icon") out[f.key] = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,60}$/.test(s) ? s : null;
      else if (f.key === "href") out[f.key] = s === "" ? "/" : /^(?:https?:\/\/|mailto:|\/|#)/i.test(s) ? s : `https://${s}`;
      else if (f.key === "groups") out[f.key] = s.split(/[\s,]+/).filter((x) => /^\d{1,9}$/.test(x)).slice(0, 20).join(",") || null;
      else if (f.type === "select") out[f.key] = f.options?.includes(s) ? s : (f.options?.[0] ?? null);
      else out[f.key] = s !== "" ? s : null;
    }
    // Câmpurile obligatorii ale serverului (titlul cardului, eticheta butonului și a progresului).
    for (const key of ["title", "label"]) if (name !== "gcsSection" && name !== "gcsCallout" && name !== "gcsStep" && name !== "gcsHidden" && key in out && out[key] === null) out[key] = "…";
    if (name === "gcsProgress" && Number(out.max) < 1) out.max = 1;
    return out;
  };

  const apply = () => {
    if (!open || open === "menu") return;
    if (open.mode === "insert") editor.chain().focus().insertContent(template(open.block, clean(FIRST_NODE[open.block]))).run();
    else {
      const attrs = clean(open.name);
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(open.pos);
          if (!node) return false;
          tr.setNodeMarkup(open.pos, undefined, { ...node.attrs, ...attrs });
          return true;
        })
        .run();
    }
    setOpen(null);
  };

  const formName = open && open !== "menu" ? (open.mode === "insert" ? FIRST_NODE[open.block] : open.name) : null;

  return (
    <span className="gcs-blockTools">
      <button type="button" className={`gcs-tool gcs-tool--wide${open === "menu" ? " gcs-tool--active" : ""}`} aria-label={l("blocks")} title={l("blocks")} aria-expanded={open === "menu"} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => (o === "menu" ? null : "menu"))} data-testid="gcs-editor-blocks">
        <GcsIconSvg icon={faCubes} />
      </button>
      {current && (
        <button
          type="button"
          className="gcs-tool"
          aria-label={l("blockSettings")}
          title={l("blockSettings")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setValues(current.attrs);
            setOpen({ mode: "edit", name: current.name, pos: current.pos });
          }}
          data-testid="gcs-editor-block-settings"
        >
          <GcsIconSvg icon={faSliders} />
        </button>
      )}
      {open === "menu" && (
        <span className="gcs-editor__popover gcs-blockTools__menu" role="menu" aria-label={l("blocks")}>
          {allowed.map((b) => (
            <button key={b} type="button" role="menuitem" className="gcs-blockTools__item gcs-sweep" onMouseDown={(e) => e.preventDefault()} onClick={() => startInsert(b)} data-testid={`gcs-editor-block-${b}`}>
              {l(`type.${b}`)}
            </button>
          ))}
        </span>
      )}
      {formName && (
        <span className="gcs-editor__popover gcs-blockTools__form" role="dialog" aria-label={l(`node.${formName}`)}>
          <strong className="gcs-blockTools__title">{l(`node.${formName}`)}</strong>
          {(GCS_BLOCK_FIELDS[formName] ?? []).map((f) => {
            const id = `gcs-block-${formName}-${f.key}`;
            const v = values[f.key];
            return (
              <label key={f.key} className="gcs-field gcs-blockTools__field" htmlFor={id}>
                <span>{l(`field.${f.key}`)}</span>
                {f.type === "select" ? (
                  <select id={id} className="gcs-input" value={v === null || v === undefined ? "" : String(v)} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {l(`option.${o}`)}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea id={id} className="gcs-input" rows={5} value={typeof v === "string" ? v : ""} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
                ) : f.type === "toggle" ? (
                  <input id={id} type="checkbox" checked={v === "1" || v === true} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.checked ? "1" : null }))} />
                ) : (
                  <input id={id} className="gcs-input" type={f.type === "number" ? "number" : "text"} value={v === null || v === undefined ? "" : String(v)} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
                )}
              </label>
            );
          })}
          <span className="gcs-blockTools__actions">
            <button type="button" className="gcs-btn gcs-btn--primary gcs-btn--sm" onClick={apply} data-testid="gcs-editor-block-apply">
              <span className="gcs-btn__icon" aria-hidden="true">
                <GcsIconSvg icon={faCheck} />
              </span>
              {l(open && open !== "menu" && open.mode === "edit" ? "apply" : "insert")}
            </button>
            <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setOpen(null)}>
              <span className="gcs-btn__icon" aria-hidden="true">
                <GcsIconSvg icon={faXmark} />
              </span>
              {l("cancel")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
