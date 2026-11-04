"use client";

import { GcsButton } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import { GcsIcon } from "@/lib/pages-icons";
import { useErrorMessage } from "@/lib/use-error-message";
import { savePagesHtml } from "../../actions";

/**
 * Editorul unei pagini „HTML manual”: codul (Ctrl+S salvează, Tab inserează spații), lista etichetelor GCS din dreapta
 * (un click le pune la cursor) și „Vezi pagina”. Serverul curăță HTML-ul (fără scripturi, evenimente sau URL-uri active).
 */
export function GcsHtmlEditor({ nodeId, initial, viewHref, tags }: { nodeId: number; initial: string; viewHref: string; tags: { tag: string; label: string; kind: "block" | "database" }[] }) {
  const t = useTranslations("acp.pages.html");
  const errorMessage = useErrorMessage();
  const area = useRef<HTMLTextAreaElement>(null);
  const [html, setHtml] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setStatus(null);
    const res = await savePagesHtml(nodeId, html);
    setPending(false);
    setStatus(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: errorMessage(res.error) });
  }

  function insert(text: string) {
    const el = area.current;
    if (!el) return setHtml((h) => h + text);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = html.slice(0, a) + text + html.slice(b);
    setHtml(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + text.length, a + text.length);
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      insert("  ");
    }
  }

  return (
    <div className="gcs-pgHtmlEd" data-testid="gcs-pages-html-editor">
      <div className="gcs-card gcs-pgHtmlEd__main">
        <label className="gcs-srOnly" htmlFor="gcs-pg-html">
          {t("code")}
        </label>
        <textarea id="gcs-pg-html" ref={area} className="gcs-input gcs-pgCodeInput gcs-pgHtmlEd__code" spellCheck={false} value={html} onChange={(e) => setHtml(e.target.value)} onKeyDown={onKey} rows={28} data-testid="gcs-pages-html-code" />
        <div className="gcs-pgForm__actions">
          <span role="status" aria-live="polite" className={status?.ok ? "gcs-ok" : "gcs-formError"}>
            {status?.text}
          </span>
          <Link className="gcs-btn gcs-btn--ghost" href={viewHref} target="_blank">
            <GcsIcon name="fa-solid fa-eye" />
            {t("view")}
          </Link>
          <GcsButton onClick={save} disabled={pending} icon={<GcsIcon name="fa-solid fa-floppy-disk" />} data-testid="gcs-pages-html-save">
            {t("save")}
          </GcsButton>
        </div>
      </div>
      <aside className="gcs-card gcs-pgHtmlEd__tags" aria-label={t("tags")}>
        <h2 className="gcs-pgBlock__title">{t("tags")}</h2>
        <p className="gcs-muted gcs-acpHint">{t("tagsHint")}</p>
        {tags.length === 0 && <p className="gcs-muted">{t("noTags")}</p>}
        <ul>
          {tags.map((x) => (
            <li key={x.tag}>
              <button type="button" className="gcs-pgHtmlEd__tag" onClick={() => insert(x.tag)}>
                <GcsIcon name={x.kind === "block" ? "fa-solid fa-cube" : "fa-solid fa-database"} />
                <span>
                  <strong>{x.label}</strong>
                  <code>{x.tag}</code>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
