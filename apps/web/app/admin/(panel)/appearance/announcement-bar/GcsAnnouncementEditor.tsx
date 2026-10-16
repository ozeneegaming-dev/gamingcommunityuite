"use client";

import { faArrowDown, faArrowUp, faCheck, faFloppyDisk, faPlus, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { ANNOUNCEMENT_PAGES, ANNOUNCEMENT_STYLES, type GcsAnnouncementBar, type GcsAnnouncementConfig, type GcsAnnouncementLink } from "@gcs/modules/announcement";
import { gcsToast, GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveAnnouncementBars } from "./actions";

type Group = { id: number; name: string };

/** `2026-10-16T12:00:00.000Z` → valoarea câmpului `datetime-local` (ora locală a adminului). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

const newId = () => Math.random().toString(36).slice(2, 10);
const emptyBar = (): GcsAnnouncementBar => ({
  id: newId(),
  enabled: true,
  label: "",
  text: "",
  cta: null,
  link: null,
  style: "accent",
  pages: "all",
  guests: true,
  members: true,
  groups: [],
  startsAt: null,
  endsAt: null,
  dismissible: true,
  version: 1,
});

/** Un link opțional al barei (butonul sau linkul): comutatorul, textul și adresa. */
function OptionalLink({ value, onChange, kind, testId }: { value: GcsAnnouncementLink | null; onChange: (v: GcsAnnouncementLink | null) => void; kind: "cta" | "link"; testId: string }) {
  const t = useTranslations("acp.announcementBar");
  return (
    <div className="gcs-footerEditor__section" style={{ padding: 12 }}>
      <label className="gcs-checkRow">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? { label: "", href: "/" } : null)} data-testid={`${testId}-on`} />
        {t(`${kind}.on`)}
      </label>
      {value && (
        <div className="gcs-footerEditor__pair">
          <label className="gcs-field">
            {t(`${kind}.label`)}
            <input className="gcs-input" value={value.label} maxLength={40} onChange={(e) => onChange({ ...value, label: e.target.value })} data-testid={`${testId}-label`} />
          </label>
          <label className="gcs-field">
            {t(`${kind}.href`)}
            <input className="gcs-input" value={value.href} maxLength={300} placeholder="/forum" onChange={(e) => onChange({ ...value, href: e.target.value.trim() })} data-testid={`${testId}-href`} />
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * Editorul barelor de anunț: lista barelor (adăugare, mutare, ștergere cu confirmare în pagină) și, pentru fiecare,
 * textele, linkurile, stilul, paginile, publicul, programarea și închiderea; apoi rotirea. „Salvează” trimite tot.
 */
export function GcsAnnouncementEditor({ initial, groups, maxBars, rotate }: { initial: GcsAnnouncementConfig; groups: Group[]; maxBars: number; rotate: { min: number; max: number } }) {
  const t = useTranslations("acp.announcementBar");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [config, setConfig] = useState(initial);
  const [removing, setRemoving] = useState<number | null>(null);
  const [pending, start] = useTransition();
  /** Rezultatul ultimei salvări, în pagină (ACP-ul nu are gazdă de toast-uri). */
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const setBar = (i: number, patch: Partial<GcsAnnouncementBar>) => setConfig((c) => ({ ...c, bars: c.bars.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const move = (i: number, d: -1 | 1) =>
    setConfig((c) => {
      const bars = [...c.bars];
      const j = i + d;
      if (j < 0 || j >= bars.length) return c;
      [bars[i], bars[j]] = [bars[j]!, bars[i]!];
      return { ...c, bars };
    });

  const save = () =>
    start(async () => {
      const res = await saveAnnouncementBars(config);
      if (!res.ok) {
        setStatus({ ok: false, text: errorMessage(res.error) });
        gcsToast({ title: errorMessage(res.error), icon: <GcsIconSvg icon={faTriangleExclamation} /> });
        return;
      }
      setConfig(res.data);
      setStatus({ ok: true, text: t("saved") });
      gcsToast({ title: t("saved"), icon: <GcsIconSvg icon={faCheck} /> });
      router.refresh();
    });

  return (
    <div className="gcs-footerEditor" data-testid="gcs-ann-editor">
      {config.bars.length === 0 && <p className="gcs-muted">{t("empty")}</p>}
      {config.bars.map((bar, i) => (
        <fieldset key={bar.id} className="gcs-footerEditor__section" data-testid="gcs-ann-editor-bar">
          <legend>{t("bar", { n: i + 1 })}</legend>
          <div className="gcs-footerEditor__actions" style={{ justifyContent: "space-between" }}>
            <label className="gcs-checkRow">
              <input type="checkbox" checked={bar.enabled} onChange={(e) => setBar(i, { enabled: e.target.checked })} data-testid="gcs-ann-enabled" />
              {t("enabled")}
            </label>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" className="gcs-iconBtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("moveUp")}>
                <GcsIconSvg icon={faArrowUp} />
              </button>
              <button type="button" className="gcs-iconBtn" onClick={() => move(i, 1)} disabled={i === config.bars.length - 1} aria-label={t("moveDown")}>
                <GcsIconSvg icon={faArrowDown} />
              </button>
              <button type="button" className="gcs-iconBtn" onClick={() => setRemoving(i)} aria-label={t("remove")} data-testid="gcs-ann-remove">
                <GcsIconSvg icon={faTrash} />
              </button>
            </span>
          </div>
          <div className="gcs-footerEditor__pair">
            <label className="gcs-field">
              {t("label")}
              <input className="gcs-input" value={bar.label} maxLength={20} placeholder={t("labelPlaceholder")} onChange={(e) => setBar(i, { label: e.target.value })} data-testid="gcs-ann-label" />
            </label>
            <label className="gcs-field">
              {t("style")}
              <select className="gcs-input" value={bar.style} onChange={(e) => setBar(i, { style: e.target.value as GcsAnnouncementBar["style"] })} data-testid="gcs-ann-style">
                {ANNOUNCEMENT_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`styles.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="gcs-field">
            {t("text")}
            <input className="gcs-input" value={bar.text} maxLength={200} onChange={(e) => setBar(i, { text: e.target.value })} data-testid="gcs-ann-text" />
          </label>
          <OptionalLink kind="cta" value={bar.cta} onChange={(cta) => setBar(i, { cta })} testId="gcs-ann-cta" />
          <OptionalLink kind="link" value={bar.link} onChange={(link) => setBar(i, { link })} testId="gcs-ann-link" />
          <div className="gcs-footerEditor__triple">
            <label className="gcs-field">
              {t("pages")}
              <select className="gcs-input" value={bar.pages} onChange={(e) => setBar(i, { pages: e.target.value as GcsAnnouncementBar["pages"] })} data-testid="gcs-ann-pages">
                {ANNOUNCEMENT_PAGES.map((p) => (
                  <option key={p} value={p}>
                    {t(`pageOptions.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("startsAt")}
              <input type="datetime-local" className="gcs-input" value={toLocalInput(bar.startsAt)} onChange={(e) => setBar(i, { startsAt: fromLocalInput(e.target.value) })} data-testid="gcs-ann-starts" />
            </label>
            <label className="gcs-field">
              {t("endsAt")}
              <input type="datetime-local" className="gcs-input" value={toLocalInput(bar.endsAt)} onChange={(e) => setBar(i, { endsAt: fromLocalInput(e.target.value) })} data-testid="gcs-ann-ends" />
            </label>
          </div>
          <div className="gcs-footerEditor__checks">
            <label className="gcs-checkRow">
              <input type="checkbox" checked={bar.guests} onChange={(e) => setBar(i, { guests: e.target.checked })} data-testid="gcs-ann-guests" />
              {t("guests")}
            </label>
            <label className="gcs-checkRow">
              <input type="checkbox" checked={bar.members} onChange={(e) => setBar(i, { members: e.target.checked })} data-testid="gcs-ann-members" />
              {t("members")}
            </label>
            <label className="gcs-checkRow">
              <input type="checkbox" checked={bar.dismissible} onChange={(e) => setBar(i, { dismissible: e.target.checked })} data-testid="gcs-ann-dismissible" />
              {t("dismissible")}
            </label>
          </div>
          {bar.members && groups.length > 0 && (
            <div className="gcs-footerEditor__section" style={{ padding: 12 }}>
              <p className="gcs-field__hint" style={{ margin: 0 }}>
                {t("groups")}
              </p>
              <div className="gcs-footerEditor__checks">
                {groups.map((g) => (
                  <label key={g.id} className="gcs-checkRow">
                    <input
                      type="checkbox"
                      checked={bar.groups.includes(g.id)}
                      onChange={(e) => setBar(i, { groups: e.target.checked ? [...bar.groups, g.id] : bar.groups.filter((x) => x !== g.id) })}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      ))}
      {config.bars.length < maxBars && (
        <GcsButton type="button" variant="ghost" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setConfig((c) => ({ ...c, bars: [...c.bars, emptyBar()] }))} data-testid="gcs-ann-add">
          {t("add")}
        </GcsButton>
      )}
      <label className="gcs-field" style={{ maxWidth: 260 }}>
        {t("rotate")}
        <input
          type="number"
          className="gcs-input"
          min={rotate.min}
          max={rotate.max}
          value={config.rotateSeconds}
          onChange={(e) => setConfig((c) => ({ ...c, rotateSeconds: Math.round(Number(e.target.value) || rotate.min) }))}
          data-testid="gcs-ann-rotate"
        />
        <span className="gcs-field__hint">{t("rotateHelp", { min: rotate.min, max: rotate.max })}</span>
      </label>
      <div className="gcs-footerEditor__actions">
        <GcsButton type="button" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} onClick={save} loading={pending} data-testid="gcs-ann-save">
          {t("save")}
        </GcsButton>
        {status && (
          <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"} style={{ margin: 0 }} data-testid="gcs-ann-status">
            {status.text}
          </p>
        )}
      </div>

      {removing !== null && (
        <GcsModal title={t("removeTitle")} icon={<GcsIconSvg icon={faTrash} />} onClose={() => setRemoving(null)} closeLabel={t("cancel")} size="sm">
          <p style={{ marginTop: 0 }}>{t("removeBody", { text: config.bars[removing]?.text || t("bar", { n: removing + 1 }) })}</p>
          <div className="gcs-footerEditor__actions">
            <GcsButton
              type="button"
              variant="primary"
              icon={<GcsIconSvg icon={faTrash} />}
              onClick={() => {
                setConfig((c) => ({ ...c, bars: c.bars.filter((_, j) => j !== removing) }));
                setRemoving(null);
              }}
              data-testid="gcs-ann-remove-confirm"
            >
              {t("removeConfirm")}
            </GcsButton>
            <GcsButton type="button" variant="ghost" onClick={() => setRemoving(null)}>
              {t("cancel")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </div>
  );
}
