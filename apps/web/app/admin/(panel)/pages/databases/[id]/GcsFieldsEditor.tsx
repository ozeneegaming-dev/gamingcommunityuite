"use client";

import type { GcsPagesFieldDef, GcsPagesFieldType } from "@gcs/modules";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { GcsIcon } from "@/lib/pages-icons";

const TYPES: GcsPagesFieldType[] = ["text", "textarea", "number", "select", "multiselect", "checkbox", "url", "date", "code", "image", "file", "server", "youtube", "member"];
const WITH_OPTIONS: GcsPagesFieldType[] = ["select", "multiselect"];
const FILTERABLE: GcsPagesFieldType[] = ["select", "multiselect", "checkbox"];

type Row = GcsPagesFieldDef & { optionsText: string };

/**
 * Câmpurile unei baze de date (ACP › Pagini › Baze de date › Câmpuri): o listă compactă (tipul, eticheta, cheia, insignele
 * „pe card” / „filtru” / „obligatoriu”), ordonabilă cu săgețile; un rând deschis arată toate opțiunile lui. Totul pleacă
 * ca JSON în câmpul `fields`, validat de server.
 */
export function GcsFieldsEditor({ initial, serversOn }: { initial: GcsPagesFieldDef[]; serversOn: boolean }) {
  const t = useTranslations("acp.pages.fields");
  const [rows, setRows] = useState<Row[]>(() => initial.map((f) => ({ ...f, optionsText: f.options.join("\n") })));
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) =>
    setRows((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const value = JSON.stringify(rows.map(({ optionsText, ...r }) => ({ ...r, options: optionsText.split("\n").map((x) => x.trim()).filter(Boolean) })));
  return (
    <div className="gcs-pgFieldsEd" data-testid="gcs-acp-fields">
      <input type="hidden" name="fields" value={value} />
      {rows.length === 0 && <p className="gcs-muted">{t("empty")}</p>}
      <ul className="gcs-acpList">
        {rows.map((r, i) => (
          <li key={i} className="gcs-acpList__row gcs-pgFieldsEd__row" data-testid="gcs-acp-field" data-key={r.key}>
            <span className="gcs-acpList__main">
              <span className="gcs-achChip">{t(`types.${r.type}`)}</span>
              <span className="gcs-acpList__text">
                <strong>{r.label || t("untitled")}</strong>
                <span className="gcs-acpList__sub">
                  <code>{r.key}</code>
                  {r.required && <span className="gcs-achChip">{t("required")}</span>}
                  {r.listed && <span className="gcs-achChip">{t("listed")}</span>}
                  {r.filter && <span className="gcs-achChip">{t("filter")}</span>}
                </span>
              </span>
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" className="gcs-iconBtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("moveUp")}>
                <GcsIcon name="fa-solid fa-chevron-up" />
              </button>
              <button type="button" className="gcs-iconBtn" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t("moveDown")}>
                <GcsIcon name="fa-solid fa-chevron-down" />
              </button>
              <button type="button" className="gcs-iconBtn" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-label={t("edit")} data-testid="gcs-acp-field-edit">
                <GcsIcon name="fa-solid fa-pen-to-square" />
              </button>
              <button
                type="button"
                className="gcs-iconBtn"
                onClick={() => {
                  setRows((list) => list.filter((_, k) => k !== i));
                  setOpen(null);
                }}
                aria-label={t("remove")}
              >
                <GcsIcon name="fa-solid fa-trash" />
              </button>
            </span>
            {open === i && (
              <div className="gcs-pgFieldsEd__panel">
                <div className="gcs-formGrid gcs-formGrid--3">
                  <label className="gcs-field">
                    {t("label")}
                    <input className="gcs-input" value={r.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} data-testid="gcs-acp-field-label" />
                  </label>
                  <label className="gcs-field">
                    {t("key")}
                    <input className="gcs-input" value={r.key} pattern="[a-z][a-z0-9_]{0,29}" onChange={(e) => set(i, { key: e.target.value })} data-testid="gcs-acp-field-key" />
                    <span className="gcs-field__hint">{t("keyHint")}</span>
                  </label>
                  <label className="gcs-field">
                    {t("type")}
                    <select className="gcs-input" value={r.type} onChange={(e) => set(i, { type: e.target.value as GcsPagesFieldType })} data-testid="gcs-acp-field-type">
                      {TYPES.filter((x) => x !== "server" || serversOn || r.type === "server").map((x) => (
                        <option key={x} value={x}>
                          {t(`types.${x}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="gcs-field">
                  {t("help")}
                  <input className="gcs-input" value={r.help} maxLength={200} onChange={(e) => set(i, { help: e.target.value })} />
                </label>
                {WITH_OPTIONS.includes(r.type) && (
                  <label className="gcs-field">
                    {t("options")}
                    <textarea className="gcs-input" rows={4} value={r.optionsText} onChange={(e) => set(i, { optionsText: e.target.value })} data-testid="gcs-acp-field-options" />
                    <span className="gcs-field__hint">{t("optionsHint")}</span>
                  </label>
                )}
                <div className="gcs-formGrid gcs-formGrid--2">
                  <label className="gcs-field">
                    {t("position")}
                    <select className="gcs-input" value={r.position} onChange={(e) => set(i, { position: e.target.value === "top" ? "top" : "bottom" })}>
                      <option value="top">{t("positions.top")}</option>
                      <option value="bottom">{t("positions.bottom")}</option>
                    </select>
                  </label>
                  <label className="gcs-field">
                    {t("badge")}
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="color" value={r.badge ?? "#4fb3ff"} onChange={(e) => set(i, { badge: e.target.value })} aria-label={t("badge")} />
                      {r.badge && (
                        <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => set(i, { badge: null })}>
                          {t("badgeDefault")}
                        </button>
                      )}
                    </span>
                  </label>
                </div>
                <label className="gcs-toggleRow">
                  <span>{t("required")}</span>
                  <input type="checkbox" checked={r.required} onChange={(e) => set(i, { required: e.target.checked })} />
                </label>
                <label className="gcs-toggleRow">
                  <span>
                    {t("listed")}
                    <small className="gcs-achHint">{t("listedHint")}</small>
                  </span>
                  <input type="checkbox" checked={r.listed} onChange={(e) => set(i, { listed: e.target.checked })} />
                </label>
                {FILTERABLE.includes(r.type) && (
                  <label className="gcs-toggleRow">
                    <span>
                      {t("filter")}
                      <small className="gcs-achHint">{t("filterHint")}</small>
                    </span>
                    <input type="checkbox" checked={r.filter} onChange={(e) => set(i, { filter: e.target.checked })} />
                  </label>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="gcs-btn gcs-btn--ghost gcs-btn--sm"
        onClick={() => {
          setRows((list) => [...list, { key: `camp${list.length + 1}`, label: "", type: "text", required: false, help: "", options: [], listed: false, filter: false, position: "bottom", badge: null, optionsText: "" }]);
          setOpen(rows.length);
        }}
        data-testid="gcs-acp-field-add"
      >
        <GcsIcon name="fa-solid fa-plus" />
        {t("add")}
      </button>
    </div>
  );
}
