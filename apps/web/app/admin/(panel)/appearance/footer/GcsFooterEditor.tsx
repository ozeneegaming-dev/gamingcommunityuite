"use client";

import type { GcsFooterColumn, GcsFooterConfig, GcsFooterLink } from "@gcs/modules";
import { gcsToast, GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { faArrowDown, faArrowUp, faCheck, faFloppyDisk, faPlus, faRotateLeft, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { GcsIconInput } from "@/lib/ui-inputs";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveFooter } from "./actions";

type LinkProps = {
  link: GcsFooterLink;
  onChange: (link: GcsFooterLink) => void;
  extra?: React.ReactNode;
  testId: string;
};

/** Un link: iconița (selectorul de iconițe al sistemului, cu categorii și căutare), eticheta și adresa. */
function LinkRow({ link, onChange, extra, testId }: LinkProps) {
  const t = useTranslations("acp.footer");
  const id = useId();
  return (
    <div className="gcs-footerEditor__link" data-testid={testId}>
      {/* Cheia: rândurile se pot șterge sau muta, iar selectorul își ține iconița aleasă. */}
      <GcsIconInput key={link.icon || "-"} name={`${testId}-icon`} value={link.icon || null} compact onChange={(icon) => onChange({ ...link, icon: icon ?? "" })} testId={`${testId}-icon`} />
      <label className="gcs-field gcs-footerEditor__grow">
        <span className="gcs-srOnly">{t("link.label")}</span>
        <input className="gcs-input" value={link.label} maxLength={60} placeholder={t("link.label")} onChange={(e) => onChange({ ...link, label: e.target.value })} data-testid={`${testId}-label`} />
      </label>
      <label className="gcs-field gcs-footerEditor__grow" htmlFor={`${id}-href`}>
        <span className="gcs-srOnly">{t("link.href")}</span>
        <input
          id={`${id}-href`}
          className="gcs-input"
          value={link.href}
          maxLength={300}
          placeholder="/forum"
          title={t("link.hrefHelp")}
          onChange={(e) => onChange({ ...link, href: e.target.value.trim() })}
          data-testid={`${testId}-href`}
        />
      </label>
      {extra}
    </div>
  );
}

const emptyLink = (): GcsFooterLink => ({ label: "", href: "/", icon: "fa-solid fa-link" });
const emptyColumn = (): GcsFooterColumn => ({ title: "", accent: "", links: [emptyLink()] });

/**
 * Editorul subsolului: coloana „Despre” (titlul, partea colorată, textul cu `**evidențieri**`, cardul-link), coloanele
 * de linkuri (adăugare, ștergere, mutare, cel mult `maxColumns` × `maxLinks`) și bara de jos. „Salvează” trimite toată
 * configurația; „Revino la subsolul implicit” cere confirmarea într-un dialog din pagină.
 */
export function GcsFooterEditor({ initial, isDefault, maxColumns, maxLinks }: { initial: GcsFooterConfig; isDefault: boolean; maxColumns: number; maxLinks: number }) {
  const t = useTranslations("acp.footer");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [config, setConfig] = useState(initial);
  const [ctaOn, setCtaOn] = useState(initial.about.cta !== null);
  const [cta, setCta] = useState<GcsFooterLink>(initial.about.cta ?? { label: "", href: "/staff", icon: "fa-solid fa-shield-halved" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, start] = useTransition();

  const setAbout = (patch: Partial<GcsFooterConfig["about"]>) => setConfig((c) => ({ ...c, about: { ...c.about, ...patch } }));
  const setBottom = (patch: Partial<GcsFooterConfig["bottom"]>) => setConfig((c) => ({ ...c, bottom: { ...c.bottom, ...patch } }));
  const setColumn = (i: number, col: GcsFooterColumn) => setConfig((c) => ({ ...c, columns: c.columns.map((x, j) => (j === i ? col : x)) }));
  const moveColumn = (i: number, d: -1 | 1) =>
    setConfig((c) => {
      const cols = [...c.columns];
      const j = i + d;
      if (j < 0 || j >= cols.length) return c;
      [cols[i], cols[j]] = [cols[j]!, cols[i]!];
      return { ...c, columns: cols };
    });

  const save = () =>
    start(async () => {
      const res = await saveFooter({ ...config, about: { ...config.about, cta: ctaOn ? cta : null } });
      if (!res.ok) {
        gcsToast({ title: errorMessage(res.error), icon: <GcsIconSvg icon={faTriangleExclamation} /> });
        return;
      }
      gcsToast({ title: t("saved"), icon: <GcsIconSvg icon={faCheck} /> });
      router.refresh();
    });

  const reset = () =>
    start(async () => {
      const res = await saveFooter(null);
      setConfirmReset(false);
      if (!res.ok) {
        gcsToast({ title: errorMessage(res.error), icon: <GcsIconSvg icon={faTriangleExclamation} /> });
        return;
      }
      gcsToast({ title: t("resetDone"), icon: <GcsIconSvg icon={faRotateLeft} /> });
      router.refresh();
    });

  // După „Revino la subsolul implicit”, formularul primește din nou valorile implicite (de pe server).
  useEffect(() => {
    setConfig(initial);
    setCtaOn(initial.about.cta !== null);
    if (initial.about.cta) setCta(initial.about.cta);
  }, [initial]);

  return (
    <div className="gcs-footerEditor" data-testid="gcs-footer-editor">
      <fieldset className="gcs-footerEditor__section">
        <legend>{t("about.section")}</legend>
        <div className="gcs-footerEditor__pair">
          <label className="gcs-field">
            {t("about.title")}
            <input className="gcs-input" value={config.about.title} maxLength={60} onChange={(e) => setAbout({ title: e.target.value })} data-testid="gcs-footer-about-title" />
          </label>
          <label className="gcs-field">
            {t("about.accent")}
            <input className="gcs-input" value={config.about.accent} maxLength={60} onChange={(e) => setAbout({ accent: e.target.value })} data-testid="gcs-footer-about-accent" />
          </label>
        </div>
        <label className="gcs-field">
          {t("about.text")}
          <textarea className="gcs-input" rows={4} value={config.about.text} maxLength={1000} onChange={(e) => setAbout({ text: e.target.value })} data-testid="gcs-footer-about-text-input" />
          <span className="gcs-field__hint">{t("about.textHelp")}</span>
        </label>
        <label className="gcs-checkRow">
          <input type="checkbox" checked={ctaOn} onChange={(e) => setCtaOn(e.target.checked)} data-testid="gcs-footer-cta-on" />
          {t("about.ctaOn")}
        </label>
        {ctaOn && <LinkRow link={cta} onChange={setCta} testId="gcs-footer-cta-row" />}
      </fieldset>

      <fieldset className="gcs-footerEditor__section">
        <legend>{t("columns.section")}</legend>
        <p className="gcs-field__hint">{t("columns.max", { max: maxColumns, links: maxLinks })}</p>
        {config.columns.length === 0 && <p className="gcs-muted">{t("columns.empty")}</p>}
        <div className="gcs-footerEditor__columns">
          {config.columns.map((col, i) => (
            <section key={i} className="gcs-footerEditor__column" aria-label={t("columns.column", { n: i + 1 })} data-testid="gcs-footer-editor-column">
              <header className="gcs-footerEditor__columnHead">
                <strong>{t("columns.column", { n: i + 1 })}</strong>
                <span className="gcs-footerEditor__tools">
                  <button type="button" className="gcs-iconBtn" onClick={() => moveColumn(i, -1)} disabled={i === 0} aria-label={t("columns.up")} title={t("columns.up")}>
                    <GcsIconSvg icon={faArrowUp} />
                  </button>
                  <button type="button" className="gcs-iconBtn" onClick={() => moveColumn(i, 1)} disabled={i === config.columns.length - 1} aria-label={t("columns.down")} title={t("columns.down")}>
                    <GcsIconSvg icon={faArrowDown} />
                  </button>
                  <button
                    type="button"
                    className="gcs-iconBtn"
                    onClick={() => setConfig((c) => ({ ...c, columns: c.columns.filter((_, j) => j !== i) }))}
                    aria-label={t("columns.remove")}
                    title={t("columns.remove")}
                    data-testid="gcs-footer-column-remove"
                  >
                    <GcsIconSvg icon={faTrash} />
                  </button>
                </span>
              </header>
              <div className="gcs-footerEditor__pair">
                <label className="gcs-field">
                  {t("columns.title")}
                  <input className="gcs-input" value={col.title} maxLength={60} onChange={(e) => setColumn(i, { ...col, title: e.target.value })} data-testid="gcs-footer-column-title" />
                </label>
                <label className="gcs-field">
                  {t("columns.accent")}
                  <input className="gcs-input" value={col.accent} maxLength={60} onChange={(e) => setColumn(i, { ...col, accent: e.target.value })} data-testid="gcs-footer-column-accent" />
                </label>
              </div>
              {col.links.map((link, j) => (
                <LinkRow
                  key={j}
                  link={link}
                  testId={`gcs-footer-link-${i}-${j}`}
                  onChange={(l) => setColumn(i, { ...col, links: col.links.map((x, k) => (k === j ? l : x)) })}
                  extra={
                    <button type="button" className="gcs-iconBtn" onClick={() => setColumn(i, { ...col, links: col.links.filter((_, k) => k !== j) })} aria-label={t("columns.removeLink")} title={t("columns.removeLink")}>
                      <GcsIconSvg icon={faTrash} />
                    </button>
                  }
                />
              ))}
              {col.links.length < maxLinks && (
                <GcsButton type="button" variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setColumn(i, { ...col, links: [...col.links, emptyLink()] })} data-testid="gcs-footer-link-add">
                  {t("columns.addLink")}
                </GcsButton>
              )}
            </section>
          ))}
        </div>
        {config.columns.length < maxColumns && (
          <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setConfig((c) => ({ ...c, columns: [...c.columns, emptyColumn()] }))} data-testid="gcs-footer-column-add">
            {t("columns.add")}
          </GcsButton>
        )}
      </fieldset>

      <fieldset className="gcs-footerEditor__section">
        <legend>{t("bottom.section")}</legend>
        <div className="gcs-footerEditor__triple">
          {(["privacy", "contact", "cookies"] as const).map((key) => (
            <label key={key} className="gcs-field">
              {t(`bottom.${key}`)}
              <input className="gcs-input" value={config.bottom[key]} maxLength={300} placeholder="https://" onChange={(e) => setBottom({ [key]: e.target.value.trim() })} data-testid={`gcs-footer-bottom-${key}`} />
            </label>
          ))}
        </div>
        <p className="gcs-field__hint">{t("bottom.urlHelp")}</p>
        <div className="gcs-footerEditor__checks">
          {(["language", "unread", "theme"] as const).map((key) => (
            <label key={key} className="gcs-checkRow">
              <input type="checkbox" checked={config.bottom[key]} onChange={(e) => setBottom({ [key]: e.target.checked })} data-testid={`gcs-footer-bottom-${key}`} />
              {t(`bottom.${key}`)}
            </label>
          ))}
        </div>
        <p className="gcs-field__hint">{t("bottom.social")}</p>
      </fieldset>

      <div className="gcs-footerEditor__actions">
        <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} disabled={pending} data-testid="gcs-footer-save">
          {t("save")}
        </GcsButton>
        {!isDefault && (
          <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => setConfirmReset(true)} disabled={pending} data-testid="gcs-footer-reset">
            {t("reset")}
          </GcsButton>
        )}
      </div>

      {confirmReset && (
        <GcsModal title={t("resetTitle")} icon={<GcsIconSvg icon={faRotateLeft} />} onClose={() => setConfirmReset(false)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("resetBody")}</p>
          <div className="gcs-footerEditor__actions">
            <GcsButton type="button" variant="primary" onClick={reset} disabled={pending} data-testid="gcs-footer-reset-confirm">
              {t("resetConfirm")}
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
