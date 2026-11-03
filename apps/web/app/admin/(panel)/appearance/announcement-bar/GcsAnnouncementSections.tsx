"use client";

import { faBold, faItalic, faLink, faPlus, faRotateLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  ANNOUNCEMENT_ALIGNS,
  ANNOUNCEMENT_BG_KINDS,
  ANNOUNCEMENT_COUNTDOWN_END,
  ANNOUNCEMENT_CTA_STYLES,
  ANNOUNCEMENT_DEVICES,
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_PAGES,
  ANNOUNCEMENT_PILL_STYLES,
  ANNOUNCEMENT_POSITIONS,
  ANNOUNCEMENT_PRESETS,
  ANNOUNCEMENT_ROTATE,
  ANNOUNCEMENT_SIZES,
  ANNOUNCEMENT_TEXT_MODES,
  ANNOUNCEMENT_VARIABLES,
  announcementFromZonedInput,
  announcementZonedInput,
  type GcsAnnouncementBar,
  type GcsAnnouncementStats,
} from "@gcs/modules/announcement";
import { GcsButton, GcsGroupPill, GcsIconSvg } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { GcsIconInput, GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";

export type AnnGroup = { id: number; name: string; color: string | null };
export type AnnSectionProps = {
  bar: GcsAnnouncementBar;
  set: (patch: Partial<GcsAnnouncementBar>) => void;
};

/** Butoanele de alegere (un grup radio), ca în machetă: „Subțire · Normală · Mare”. */
export function AnnSeg<T extends string>({ value, options, label, onChange, testId, disabled }: { value: T; options: readonly { value: T; label: string }[]; label: string; onChange: (v: T) => void; testId?: string; disabled?: boolean }) {
  return (
    <span className="gcs-annSeg" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "gcs-annSeg__opt gcs-annSeg__opt--on" : "gcs-annSeg__opt"}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          data-testid={testId ? `${testId}-${o.value}` : undefined}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Un rând cu comutator (`gcs-toggleRow`): textul în stânga, comutatorul în dreapta. */
export function AnnToggle({ label, checked, onChange, testId, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; testId?: string; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className="gcs-toggleRow gcs-annEd__toggle">
      <span>
        {label}
        {hint && <span className="gcs-field__hint gcs-annEd__toggleHint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="gcs-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}

function Field({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "gcs-field gcs-formGrid__wide" : "gcs-field"}>
      <span className="gcs-annEd__label">{label}</span>
      {children}
      {hint && <span className="gcs-field__hint">{hint}</span>}
    </label>
  );
}

/** O culoare: pătratul de alegere și codul hex. */
function ColorField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  const [text, setText] = useState(value);
  return (
    <span className="gcs-annEd__color">
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        data-testid={`${testId}-pick`}
      />
      <input
        className="gcs-input"
        value={text}
        maxLength={7}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setText(value)}
        data-testid={testId}
      />
    </span>
  );
}

/** O listă de adrese de pagini (`/clanuri/*`): rândurile cu „×” și „Adaugă o adresă”. */
function PathList({ value, onChange, testId, addLabel, removeLabel, placeholder }: { value: string[]; onChange: (v: string[]) => void; testId: string; addLabel: string; removeLabel: string; placeholder: string }) {
  return (
    <div className="gcs-annEd__paths" data-testid={testId}>
      {value.map((p, i) => (
        <div key={i} className="gcs-annEd__pathRow">
          <input
            className="gcs-input"
            value={p}
            maxLength={ANNOUNCEMENT_LIMITS.path}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value.trim() : x)))}
            data-testid={`${testId}-${i}`}
          />
          <button type="button" className="gcs-iconBtn" aria-label={removeLabel} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <GcsIconSvg icon={faXmark} />
          </button>
        </div>
      ))}
      {value.length < ANNOUNCEMENT_LIMITS.paths && (
        <GcsButton type="button" variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={() => onChange([...value, "/"])} data-testid={`${testId}-add`}>
          {addLabel}
        </GcsButton>
      )}
    </div>
  );
}

/** Grupurile alese (pastilele grupurilor, cu „×”) și lista din care se adaugă unul. */
function GroupPicker({ value, groups, onChange, addLabel, removeLabel, testId }: { value: number[]; groups: AnnGroup[]; onChange: (v: number[]) => void; addLabel: string; removeLabel: string; testId: string }) {
  const chosen = value.map((id) => groups.find((g) => g.id === id)).filter((g): g is AnnGroup => !!g);
  const free = groups.filter((g) => !value.includes(g.id));
  return (
    <div className="gcs-annEd__chips" data-testid={testId}>
      {chosen.map((g) => (
        <span key={g.id} className="gcs-annEd__gchip">
          <GcsGroupPill group={g} href={null} size="sm" />
          <button type="button" className="gcs-annEd__gchipX" aria-label={`${removeLabel}: ${g.name}`} onClick={() => onChange(value.filter((x) => x !== g.id))}>
            <GcsIconSvg icon={faXmark} />
          </button>
        </span>
      ))}
      {free.length > 0 && (
        <select
          className="gcs-input gcs-annEd__addGroup"
          value=""
          aria-label={addLabel}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onChange([...value, id]);
          }}
          data-testid={`${testId}-add`}
        >
          <option value="">+ {addLabel}</option>
          {free.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── Conținut ──────────────────────────────────────────────────────────────────────────────────────────

export function AnnContentSection({ bar, set, timeZone }: AnnSectionProps & { timeZone: string }) {
  const t = useTranslations("acp.announcementBar");
  const area = useRef<HTMLTextAreaElement>(null);

  /** Formatarea din bara de unelte: încadrează textul ales (sau un exemplu) și îl lasă selectat. */
  const wrap = (before: string, after: string, sample: string) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const chosen = value.slice(s, e) || sample;
    const next = `${value.slice(0, s)}${before}${chosen}${after}${value.slice(e)}`.slice(0, ANNOUNCEMENT_LIMITS.text);
    set({ text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + chosen.length);
    });
  };
  const insert = (token: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? bar.text.length;
    set({ text: `${bar.text.slice(0, at)}${token}${bar.text.slice(el?.selectionEnd ?? at)}`.slice(0, ANNOUNCEMENT_LIMITS.text) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("sections.content")}</legend>
        <div className="gcs-formGrid">
          <Field label={t("label")}>
            <input className="gcs-input" value={bar.label} maxLength={ANNOUNCEMENT_LIMITS.label} placeholder={t("labelPlaceholder")} onChange={(e) => set({ label: e.target.value })} data-testid="gcs-ann-label" />
          </Field>
          <div className="gcs-field">
            <span className="gcs-annEd__label">{t("icon")}</span>
            <GcsIconInput key={bar.id} name="gcs-ann-icon" value={bar.icon} onChange={(icon) => set({ icon })} testId="gcs-ann-icon" />
          </div>
        </div>
        <div className="gcs-field">
          <span className="gcs-annEd__label" id={`gcs-ann-text-${bar.id}`}>
            {t("text")}
          </span>
          <div className="gcs-annEd__rte">
            <div className="gcs-annEd__toolbar" role="toolbar" aria-label={t("format.toolbar")}>
              <button type="button" className="gcs-iconBtn" aria-label={t("format.bold")} title={t("format.bold")} onClick={() => wrap("**", "**", t("format.sample"))}>
                <GcsIconSvg icon={faBold} />
              </button>
              <button type="button" className="gcs-iconBtn" aria-label={t("format.italic")} title={t("format.italic")} onClick={() => wrap("*", "*", t("format.sample"))}>
                <GcsIconSvg icon={faItalic} />
              </button>
              <button type="button" className="gcs-iconBtn" aria-label={t("format.link")} title={t("format.link")} onClick={() => wrap("[", "](/)", t("format.linkSample"))}>
                <GcsIconSvg icon={faLink} />
              </button>
            </div>
            <textarea
              ref={area}
              className="gcs-input gcs-annEd__textarea"
              rows={2}
              value={bar.text}
              maxLength={ANNOUNCEMENT_LIMITS.text}
              aria-labelledby={`gcs-ann-text-${bar.id}`}
              onChange={(e) => set({ text: e.target.value.replace(/[\r\n]+/g, " ") })}
              data-testid="gcs-ann-text"
            />
          </div>
          <span className="gcs-annEd__vars">
            {ANNOUNCEMENT_VARIABLES.map((v) => (
              <button key={v} type="button" className="gcs-annEd__var" title={t(`vars.${v}`)} onClick={() => insert(`{${v}}`)} data-testid={`gcs-ann-var-${v}`}>
                {`{${v}}`}
              </button>
            ))}
          </span>
          <span className="gcs-field__hint">{t("textHelp")}</span>
        </div>
        <Field label={t("mobileText")} hint={t("mobileTextHelp")}>
          <input className="gcs-input" value={bar.mobileText} maxLength={ANNOUNCEMENT_LIMITS.mobileText} onChange={(e) => set({ mobileText: e.target.value })} data-testid="gcs-ann-mobile-text" />
        </Field>
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("cta.title")}</legend>
        <AnnToggle label={t("cta.on")} checked={bar.cta !== null} onChange={(on) => set({ cta: on ? { label: "", href: "/", style: "white", newTab: false } : null })} testId="gcs-ann-cta-on" />
        {bar.cta && (
          <div className="gcs-formGrid">
            <Field label={t("cta.label")}>
              <input className="gcs-input" value={bar.cta.label} maxLength={ANNOUNCEMENT_LIMITS.link} onChange={(e) => set({ cta: { ...bar.cta!, label: e.target.value } })} data-testid="gcs-ann-cta-label" />
            </Field>
            <Field label={t("cta.href")}>
              <input className="gcs-input" value={bar.cta.href} maxLength={300} placeholder="/forum" spellCheck={false} onChange={(e) => set({ cta: { ...bar.cta!, href: e.target.value.trim() } })} data-testid="gcs-ann-cta-href" />
            </Field>
            <label className="gcs-checkRow gcs-formGrid__wide">
              <input type="checkbox" checked={bar.cta.newTab} onChange={(e) => set({ cta: { ...bar.cta!, newTab: e.target.checked } })} data-testid="gcs-ann-cta-newtab" />
              {t("cta.newTab")}
            </label>
          </div>
        )}
        <AnnToggle label={t("link.on")} checked={bar.link !== null} onChange={(on) => set({ link: on ? { label: "", href: "/" } : null })} testId="gcs-ann-link-on" />
        {bar.link && (
          <div className="gcs-formGrid">
            <Field label={t("link.label")}>
              <input className="gcs-input" value={bar.link.label} maxLength={ANNOUNCEMENT_LIMITS.link} placeholder={t("link.labelPlaceholder")} onChange={(e) => set({ link: { ...bar.link!, label: e.target.value } })} data-testid="gcs-ann-link-label" />
            </Field>
            <Field label={t("link.href")}>
              <input className="gcs-input" value={bar.link.href} maxLength={300} placeholder="/forum/regulament" spellCheck={false} onChange={(e) => set({ link: { ...bar.link!, href: e.target.value.trim() } })} data-testid="gcs-ann-link-href" />
            </Field>
          </div>
        )}
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("countdown.title")}</legend>
        <AnnToggle
          label={t("countdown.on")}
          checked={bar.countdown !== null}
          onChange={(on) => set({ countdown: on ? { at: new Date(Date.now() + 3 * 86_400_000).toISOString(), onEnd: "text", endText: t("countdown.endTextDefault") } : null })}
          testId="gcs-ann-countdown-on"
        />
        {bar.countdown && (
          <div className="gcs-formGrid">
            <Field label={t("countdown.at")} hint={t("countdown.atHelp")}>
              <input
                type="datetime-local"
                className="gcs-input"
                value={announcementZonedInput(bar.countdown.at, timeZone)}
                onChange={(e) => {
                  const at = announcementFromZonedInput(e.target.value, timeZone);
                  if (at) set({ countdown: { ...bar.countdown!, at } });
                }}
                data-testid="gcs-ann-countdown-at"
              />
            </Field>
            <div className="gcs-field">
              <span className="gcs-annEd__label">{t("countdown.onEnd")}</span>
              <AnnSeg
                label={t("countdown.onEnd")}
                value={bar.countdown.onEnd}
                options={ANNOUNCEMENT_COUNTDOWN_END.map((v) => ({ value: v, label: t(`countdown.ends.${v}`) }))}
                onChange={(onEnd) => set({ countdown: { ...bar.countdown!, onEnd } })}
                testId="gcs-ann-countdown-end"
              />
            </div>
            {bar.countdown.onEnd === "text" && (
              <Field label={t("countdown.endText")} wide>
                <input className="gcs-input" value={bar.countdown.endText} maxLength={ANNOUNCEMENT_LIMITS.endText} onChange={(e) => set({ countdown: { ...bar.countdown!, endText: e.target.value } })} data-testid="gcs-ann-countdown-text" />
              </Field>
            )}
          </div>
        )}
      </fieldset>
    </>
  );
}

// ─── Aspect ────────────────────────────────────────────────────────────────────────────────────────────

export function AnnLookSection({ bar, set }: AnnSectionProps) {
  const t = useTranslations("acp.announcementBar");
  const post = useUploadPost();
  const custom = bar.preset === "custom";

  const upload = async (file: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    const body = new FormData();
    body.set("file", file);
    const res = await post<{ url: string }>("/api/acp/announcement/image", body, onProgress);
    if (!res.ok) return res.error;
    set({ bgImage: res.data.url, bgKind: "image" });
    return null;
  };

  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("look.colors")}</legend>
        <div className="gcs-annEd__swatches" role="radiogroup" aria-label={t("look.colors")}>
          {ANNOUNCEMENT_PRESETS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={bar.preset === p} className={bar.preset === p ? "gcs-annEd__sw gcs-annEd__sw--on" : "gcs-annEd__sw"} onClick={() => set({ preset: p })} data-testid={`gcs-ann-preset-${p}`}>
              <i className={`gcs-annEd__swatch gcs-annBar--${p}`} aria-hidden="true" />
              {t(`presets.${p}`)}
            </button>
          ))}
        </div>
        {custom && (
          <div className="gcs-formGrid">
            <div className="gcs-field gcs-formGrid__wide">
              <span className="gcs-annEd__label">{t("look.background")}</span>
              <AnnSeg label={t("look.background")} value={bar.bgKind} options={ANNOUNCEMENT_BG_KINDS.map((v) => ({ value: v, label: t(`look.bg.${v}`) }))} onChange={(bgKind) => set({ bgKind })} testId="gcs-ann-bg" />
            </div>
            <div className="gcs-field">
              <span className="gcs-annEd__label">{bar.bgKind === "gradient" ? t("look.gradientColors") : t("look.bgColor")}</span>
              <span className="gcs-annEd__colors">
                <ColorField key={`${bar.id}-c1`} label={t("look.bgColor")} value={bar.bgColor} onChange={(bgColor) => set({ bgColor })} testId="gcs-ann-bg-color" />
                {bar.bgKind === "gradient" && <ColorField key={`${bar.id}-c2`} label={t("look.bgColor2")} value={bar.bgColor2} onChange={(bgColor2) => set({ bgColor2 })} testId="gcs-ann-bg-color2" />}
              </span>
            </div>
            {bar.bgKind === "gradient" && (
              <Field label={t("look.angle")}>
                <input type="number" className="gcs-input" min={0} max={360} step={5} value={bar.bgAngle} onChange={(e) => set({ bgAngle: Math.min(360, Math.max(0, Math.round(Number(e.target.value) || 0))) })} data-testid="gcs-ann-bg-angle" />
              </Field>
            )}
            <div className="gcs-field">
              <span className="gcs-annEd__label">{t("look.fgColor")}</span>
              <ColorField key={`${bar.id}-fg`} label={t("look.fgColor")} value={bar.fgColor} onChange={(fgColor) => set({ fgColor })} testId="gcs-ann-fg-color" />
            </div>
            {bar.bgKind === "image" && (
              <div className="gcs-field gcs-formGrid__wide">
                <span className="gcs-annEd__label">{t("look.image")}</span>
                <GcsUploadInput
                  key={bar.id}
                  title={t("look.imageTitle")}
                  rules={UPLOAD_RULES.image(3)}
                  current={bar.bgImage ? { url: bar.bgImage, name: t("look.imageCurrent"), meta: t("look.imageHint") } : null}
                  upload={upload}
                  onRemove={() => set({ bgImage: null })}
                  testId="gcs-ann-bg-image"
                />
                <span className="gcs-field__hint">{t("look.imageHint")}</span>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("look.shape")}</legend>
        <div className="gcs-formGrid gcs-formGrid--3">
          <div className="gcs-field">
            <span className="gcs-annEd__label">{t("look.size")}</span>
            <AnnSeg label={t("look.size")} value={bar.size} options={ANNOUNCEMENT_SIZES.map((v) => ({ value: v, label: t(`look.sizes.${v}`) }))} onChange={(size) => set({ size })} testId="gcs-ann-size" />
          </div>
          <div className="gcs-field">
            <span className="gcs-annEd__label">{t("look.align")}</span>
            <AnnSeg label={t("look.align")} value={bar.align} options={ANNOUNCEMENT_ALIGNS.map((v) => ({ value: v, label: t(`look.aligns.${v}`) }))} onChange={(align) => set({ align })} testId="gcs-ann-align" />
          </div>
          <div className="gcs-field">
            <span className="gcs-annEd__label">{t("look.textMode")}</span>
            <AnnSeg label={t("look.textMode")} value={bar.textMode} options={ANNOUNCEMENT_TEXT_MODES.map((v) => ({ value: v, label: t(`look.textModes.${v}`) }))} onChange={(textMode) => set({ textMode })} testId="gcs-ann-textmode" />
          </div>
        </div>
        {bar.textMode === "marquee" && <p className="gcs-field__hint gcs-annEd__note">{t("look.marqueeHint")}</p>}
        <div className="gcs-formGrid">
          <Field label={t("look.ctaStyle")}>
            <select
              className="gcs-input"
              value={bar.cta?.style ?? "white"}
              disabled={!bar.cta}
              onChange={(e) => bar.cta && set({ cta: { ...bar.cta, style: e.target.value as NonNullable<GcsAnnouncementBar["cta"]>["style"] } })}
              data-testid="gcs-ann-cta-style"
            >
              {ANNOUNCEMENT_CTA_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(`look.ctaStyles.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("look.pill")}>
            <select className="gcs-input" value={bar.pillStyle} onChange={(e) => set({ pillStyle: e.target.value as GcsAnnouncementBar["pillStyle"] })} data-testid="gcs-ann-pill">
              {ANNOUNCEMENT_PILL_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(`look.pills.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
    </>
  );
}

// ─── Poziție ───────────────────────────────────────────────────────────────────────────────────────────

/** Desenul unei poziții (antetul, bara, pagina), ca în machetă. */
function PositionArt({ position }: { position: GcsAnnouncementBar["position"] }) {
  const bar = <b />;
  return (
    <i className={`gcs-annEd__posArt gcs-annEd__posArt--${position}`} aria-hidden="true">
      {position === "top" && bar}
      <em />
      {position === "under" && bar}
      <u className="gcs-annEd__posPage">{position === "page" && bar}</u>
      {position === "bottom" && bar}
    </i>
  );
}

export function AnnPositionSection({ bar, set }: AnnSectionProps) {
  const t = useTranslations("acp.announcementBar");
  const canStick = bar.position === "top" || bar.position === "under";
  return (
    <fieldset className="gcs-formSec">
      <legend>{t("position.title")}</legend>
      <div className="gcs-annEd__positions" role="radiogroup" aria-label={t("position.title")}>
        {ANNOUNCEMENT_POSITIONS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={bar.position === p} className={bar.position === p ? "gcs-annEd__pos gcs-annEd__pos--on" : "gcs-annEd__pos"} onClick={() => set({ position: p })} data-testid={`gcs-ann-pos-${p}`}>
            <PositionArt position={p} />
            {t(`positions.${p}`)}
          </button>
        ))}
      </div>
      <AnnToggle label={t("position.sticky")} hint={canStick ? undefined : t("position.stickyHint")} checked={bar.sticky && canStick} disabled={!canStick} onChange={(sticky) => set({ sticky })} testId="gcs-ann-sticky" />
      <AnnToggle
        label={t("position.fullWidth")}
        hint={bar.position === "page" ? t("position.fullWidthHint") : undefined}
        checked={bar.fullWidth && bar.position !== "page"}
        disabled={bar.position === "page"}
        onChange={(fullWidth) => set({ fullWidth })}
        testId="gcs-ann-fullwidth"
      />
    </fieldset>
  );
}

// ─── Cine o vede ───────────────────────────────────────────────────────────────────────────────────────

export function AnnAudienceSection({ bar, set, groups, locales }: AnnSectionProps & { groups: AnnGroup[]; locales: { code: string; name: string }[] }) {
  const t = useTranslations("acp.announcementBar");
  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("audience.who")}</legend>
        <AnnToggle label={t("guests")} checked={bar.guests} onChange={(guests) => set({ guests })} testId="gcs-ann-guests" />
        <AnnToggle label={t("members")} checked={bar.members} onChange={(members) => set({ members })} testId="gcs-ann-members" />
        {bar.members && (
          <>
            <div className="gcs-field">
              <span className="gcs-annEd__label">
                {t("audience.groups")} <span className="gcs-field__hint">{t("audience.groupsHint")}</span>
              </span>
              <GroupPicker value={bar.groups} groups={groups} onChange={(g) => set({ groups: g })} addLabel={t("audience.addGroup")} removeLabel={t("audience.removeGroup")} testId="gcs-ann-groups" />
            </div>
            <div className="gcs-field">
              <span className="gcs-annEd__label">{t("audience.excludeGroups")}</span>
              <GroupPicker value={bar.excludeGroups} groups={groups} onChange={(g) => set({ excludeGroups: g })} addLabel={t("audience.addGroup")} removeLabel={t("audience.removeGroup")} testId="gcs-ann-exclude-groups" />
            </div>
            <div className="gcs-field">
              <span className="gcs-annEd__label">{t("audience.newMembers")}</span>
              <span className="gcs-annEd__inline">
                <input type="checkbox" role="switch" className="gcs-switch" aria-label={t("audience.newMembers")} checked={bar.newMembersDays > 0} onChange={(e) => set({ newMembersDays: e.target.checked ? 7 : 0 })} data-testid="gcs-ann-new-on" />
                <span className="gcs-field__hint">{t("audience.newMembersBefore")}</span>
                <input
                  type="number"
                  className="gcs-input gcs-annEd__num"
                  min={1}
                  max={ANNOUNCEMENT_LIMITS.days}
                  disabled={bar.newMembersDays === 0}
                  value={bar.newMembersDays || 7}
                  aria-label={t("audience.newMembersDays")}
                  onChange={(e) => set({ newMembersDays: Math.min(ANNOUNCEMENT_LIMITS.days, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                  data-testid="gcs-ann-new-days"
                />
                <span className="gcs-field__hint">{t("audience.newMembersAfter")}</span>
              </span>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="gcs-formSec">
        <legend>{t("audience.where")}</legend>
        <div className="gcs-field">
          <span className="gcs-annEd__label">{t("audience.devices")}</span>
          <AnnSeg label={t("audience.devices")} value={bar.devices} options={ANNOUNCEMENT_DEVICES.map((v) => ({ value: v, label: t(`audience.deviceOptions.${v}`) }))} onChange={(devices) => set({ devices })} testId="gcs-ann-devices" />
        </div>
        <div className="gcs-field">
          <span className="gcs-annEd__label">{t("pages")}</span>
          <AnnSeg label={t("pages")} value={bar.pages} options={ANNOUNCEMENT_PAGES.map((v) => ({ value: v, label: t(`pageOptions.${v}`) }))} onChange={(pages) => set({ pages, paths: pages === "paths" && bar.paths.length === 0 ? ["/"] : bar.paths })} testId="gcs-ann-pages" />
          {bar.pages === "paths" && <PathList value={bar.paths} onChange={(paths) => set({ paths })} testId="gcs-ann-paths" addLabel={t("audience.addPath")} removeLabel={t("audience.removePath")} placeholder="/clanuri/*" />}
          <span className="gcs-field__hint">{t("audience.pathsHint")}</span>
        </div>
        <div className="gcs-field">
          <span className="gcs-annEd__label">{t("audience.excludePaths")}</span>
          <PathList value={bar.excludePaths} onChange={(excludePaths) => set({ excludePaths })} testId="gcs-ann-exclude-paths" addLabel={t("audience.addPath")} removeLabel={t("audience.removePath")} placeholder="/servers/*" />
        </div>
        <div className="gcs-field">
          <span className="gcs-annEd__label">{t("audience.locales")}</span>
          <span className="gcs-annEd__chips" role="group" aria-label={t("audience.locales")}>
            <button type="button" className={bar.locales.length === 0 ? "gcs-annEd__chip gcs-annEd__chip--on" : "gcs-annEd__chip"} aria-pressed={bar.locales.length === 0} onClick={() => set({ locales: [] })} data-testid="gcs-ann-locale-all">
              {t("audience.allLocales")}
            </button>
            {locales.map((l) => {
              const on = bar.locales.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  className={on ? "gcs-annEd__chip gcs-annEd__chip--on" : "gcs-annEd__chip"}
                  aria-pressed={on}
                  onClick={() => set({ locales: on ? bar.locales.filter((x) => x !== l.code) : [...bar.locales, l.code] })}
                  data-testid={`gcs-ann-locale-${l.code}`}
                >
                  {l.name}
                </button>
              );
            })}
          </span>
        </div>
      </fieldset>
    </>
  );
}

// ─── Program ───────────────────────────────────────────────────────────────────────────────────────────

export function AnnScheduleSection({ bar, set, timeZone, zoneLabel }: AnnSectionProps & { timeZone: string; zoneLabel: string }) {
  const t = useTranslations("acp.announcementBar");
  const windowOn = bar.timeFrom !== null;
  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("schedule.title")}</legend>
        <div className="gcs-formGrid">
          <Field label={t("startsAt")}>
            <input type="datetime-local" className="gcs-input" value={announcementZonedInput(bar.startsAt, timeZone)} onChange={(e) => set({ startsAt: announcementFromZonedInput(e.target.value, timeZone) })} data-testid="gcs-ann-starts" />
          </Field>
          <Field label={t("endsAt")}>
            <input type="datetime-local" className="gcs-input" value={announcementZonedInput(bar.endsAt, timeZone)} onChange={(e) => set({ endsAt: announcementFromZonedInput(e.target.value, timeZone) })} data-testid="gcs-ann-ends" />
          </Field>
        </div>
        <p className="gcs-field__hint gcs-annEd__note" data-testid="gcs-ann-zone">
          {t("schedule.zoneHint", { zone: zoneLabel, id: timeZone })}
        </p>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("schedule.when")}</legend>
        <div className="gcs-field">
          <span className="gcs-annEd__label">
            {t("schedule.days")} <span className="gcs-field__hint">{t("schedule.daysHint")}</span>
          </span>
          <span className="gcs-annEd__days" role="group" aria-label={t("schedule.days")}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = bar.days.length === 0 || bar.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={on ? "gcs-annEd__day gcs-annEd__day--on" : "gcs-annEd__day"}
                  aria-pressed={on}
                  aria-label={t(`schedule.dayNames.${d}`)}
                  onClick={() => {
                    const all = bar.days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : bar.days;
                    const next = on ? all.filter((x) => x !== d) : [...all, d].sort((a, b) => a - b);
                    // Nicio zi aleasă nu are sens: înapoi la „toate zilele”.
                    set({ days: next.length === 0 || next.length === 7 ? [] : next });
                  }}
                  data-testid={`gcs-ann-day-${d}`}
                >
                  {t(`schedule.dayShort.${d}`)}
                </button>
              );
            })}
          </span>
        </div>
        <AnnToggle label={t("schedule.window")} checked={windowOn} onChange={(on) => set(on ? { timeFrom: "18:00", timeTo: "23:59" } : { timeFrom: null, timeTo: null })} testId="gcs-ann-window-on" />
        {windowOn && (
          <span className="gcs-annEd__inline">
            <input type="time" className="gcs-input gcs-annEd__time" aria-label={t("schedule.from")} value={bar.timeFrom ?? ""} onChange={(e) => e.target.value && set({ timeFrom: e.target.value })} data-testid="gcs-ann-time-from" />
            <span className="gcs-field__hint">{t("schedule.until")}</span>
            <input type="time" className="gcs-input gcs-annEd__time" aria-label={t("schedule.to")} value={bar.timeTo ?? ""} onChange={(e) => e.target.value && set({ timeTo: e.target.value })} data-testid="gcs-ann-time-to" />
          </span>
        )}
      </fieldset>
    </>
  );
}

// ─── Comportament ──────────────────────────────────────────────────────────────────────────────────────

export function AnnBehaviourSection({
  bar,
  set,
  stats,
  saved,
  statsOn,
  onReset,
  resetting,
  defaultRotate,
}: AnnSectionProps & { stats: GcsAnnouncementStats | null; saved: boolean; statsOn: boolean; onReset: () => void; resetting: boolean; defaultRotate: number }) {
  const t = useTranslations("acp.announcementBar");
  const format = useFormatter();
  return (
    <>
      <fieldset className="gcs-formSec">
        <legend>{t("behaviour.title")}</legend>
        <AnnToggle label={t("dismissible")} checked={bar.dismissible} onChange={(dismissible) => set({ dismissible })} testId="gcs-ann-dismissible" />
        <AnnToggle label={t("behaviour.closeOnCta")} checked={bar.closeOnCta} disabled={!bar.cta} onChange={(closeOnCta) => set({ closeOnCta })} testId="gcs-ann-close-cta" />
        <div className="gcs-formGrid">
          <Field label={t("behaviour.reappear")} hint={t("behaviour.reappearHint")}>
            <input
              type="number"
              className="gcs-input"
              min={0}
              max={ANNOUNCEMENT_LIMITS.days}
              value={bar.reappearDays}
              onChange={(e) => set({ reappearDays: Math.min(ANNOUNCEMENT_LIMITS.days, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
              data-testid="gcs-ann-reappear"
            />
          </Field>
          <Field label={t("behaviour.rotate")} hint={t("behaviour.rotateHint", { n: defaultRotate, min: ANNOUNCEMENT_ROTATE.min, max: ANNOUNCEMENT_ROTATE.max })}>
            <input
              type="number"
              className="gcs-input"
              min={ANNOUNCEMENT_ROTATE.min}
              max={ANNOUNCEMENT_ROTATE.max}
              placeholder={String(defaultRotate)}
              value={bar.rotateSeconds ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                set({ rotateSeconds: v === "" ? null : Math.min(ANNOUNCEMENT_ROTATE.max, Math.max(ANNOUNCEMENT_ROTATE.min, Math.round(Number(v) || ANNOUNCEMENT_ROTATE.min))) });
              }}
              data-testid="gcs-ann-bar-rotate"
            />
          </Field>
        </div>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("stats.title")}</legend>
        {!statsOn && <p className="gcs-field__hint gcs-annEd__note">{t("stats.off")}</p>}
        <div className="gcs-annEd__stats">
          <div>
            <small>{t("stats.views")}</small>
            <b data-testid="gcs-ann-stat-views">{format.number(stats?.views ?? 0)}</b>
          </div>
          <div>
            <small>{t("stats.clicks")}</small>
            <b data-testid="gcs-ann-stat-clicks">{format.number(stats?.clicks ?? 0)}</b>
          </div>
          <div>
            <small>{t("stats.dismissals")}</small>
            <b data-testid="gcs-ann-stat-dismissals">{format.number(stats?.dismissals ?? 0)}</b>
          </div>
        </div>
        <span className="gcs-field__hint">
          {!saved ? t("stats.unsaved") : stats?.since ? t("stats.since", { date: format.dateTime(new Date(stats.since), { dateStyle: "medium", timeStyle: "short" }) }) : t("stats.sinceStart")}
        </span>
        {saved && (
          <GcsButton type="button" variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} loading={resetting} onClick={onReset} data-testid="gcs-ann-stats-reset">
            {t("stats.reset")}
          </GcsButton>
        )}
      </fieldset>
    </>
  );
}
