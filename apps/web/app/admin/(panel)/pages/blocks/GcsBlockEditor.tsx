"use client";

import type { GcsEditorBlock } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { GcsIcon } from "@/lib/pages-icons";
import { GcsAcpDocInput } from "../../community/forums/[id]/GcsAcpDocInput";

type Field = { key: string; label: string; type: "text" | "textarea" | "url" | "image" };

/**
 * Conținutul unui bloc reutilizabil, după tip: conținut bogat (editorul postărilor), HTML curățat sau șablon cu câmpuri
 * (`{{cheie}}` în HTML, câmpurile definite aici și valorile lor, completate de staff fără cod).
 */
export function GcsBlockEditor({ id, kind: initialKind, content, html: initialHtml, fields: initialFields, values: initialValues, blocks }: { id: string; kind: string; content: JSONContent | null; html: string; fields: Field[]; values: Record<string, string>; blocks: GcsEditorBlock[] }) {
  const t = useTranslations("acp.pages.blocks");
  const [kind, setKind] = useState(initialKind === "html" || initialKind === "template" ? initialKind : "content");
  const [html, setHtml] = useState(initialHtml);
  const [fields, setFields] = useState<Field[]>(initialFields);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const setField = (i: number, patch: Partial<Field>) => setFields((list) => list.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("secContent")}</legend>
        <label className="gcs-field">
          {t("kind")}
          <select className="gcs-input" name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid={`gcs-pages-block-kind-${id}`}>
            <option value="content">{t("kinds.content")}</option>
            <option value="html">{t("kinds.html")}</option>
            <option value="template">{t("kinds.template")}</option>
          </select>
          <span className="gcs-field__hint">{t(`kindHints.${kind}`)}</span>
        </label>
        {kind === "content" && <GcsAcpDocInput name="content" id={`gcs-pg-block-${id}`} initial={content} blocks={blocks} />}
        {kind !== "content" && (
          <label className="gcs-field">
            {kind === "template" ? t("template") : t("html")}
            <textarea className="gcs-input gcs-pgCodeInput" name="html" rows={12} spellCheck={false} value={html} onChange={(e) => setHtml(e.target.value)} />
            {kind === "template" && <span className="gcs-field__hint">{t("templateHint")}</span>}
          </label>
        )}
      </fieldset>
      {kind === "template" && (
        <fieldset className="gcs-formSec">
          <legend>{t("secFields")}</legend>
          <input type="hidden" name="fields" value={JSON.stringify(fields)} />
          {fields.map((f, i) => (
            <div key={i} className="gcs-formGrid gcs-formGrid--3 gcs-pgBlockField">
              <label className="gcs-field">
                {t("fieldKey")}
                <input className="gcs-input" value={f.key} pattern="[a-z][a-z0-9_]{0,29}" onChange={(e) => setField(i, { key: e.target.value })} />
              </label>
              <label className="gcs-field">
                {t("fieldLabel")}
                <input className="gcs-input" value={f.label} maxLength={60} onChange={(e) => setField(i, { label: e.target.value })} />
              </label>
              <label className="gcs-field">
                {t("fieldType")}
                <select className="gcs-input" value={f.type} onChange={(e) => setField(i, { type: e.target.value as Field["type"] })}>
                  {(["text", "textarea", "url", "image"] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`fieldTypes.${x}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field" style={{ gridColumn: "1 / -1" }}>
                {t("value", { label: f.label || f.key })}
                {f.type === "textarea" ? (
                  <textarea className="gcs-input" name={`value.${f.key}`} rows={3} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input className="gcs-input" name={`value.${f.key}`} value={values[f.key] ?? ""} placeholder={f.type === "image" ? "/files/…" : f.type === "url" ? "https://" : ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
                <span className="gcs-field__hint">
                  <code>{`{{${f.key || "cheie"}}}`}</code>
                </span>
              </label>
              <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setFields((list) => list.filter((_, k) => k !== i))}>
                <GcsIcon name="fa-solid fa-trash" />
                {t("removeField")}
              </button>
            </div>
          ))}
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => setFields((list) => [...list, { key: `camp${list.length + 1}`, label: "", type: "text" }])}>
            <GcsIcon name="fa-solid fa-plus" />
            {t("addField")}
          </button>
        </fieldset>
      )}
    </>
  );
}
