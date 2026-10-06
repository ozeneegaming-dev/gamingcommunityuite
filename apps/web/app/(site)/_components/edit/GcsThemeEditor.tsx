"use client";

import { GcsButton, GcsIconSvg } from "@gcs/ui";
import type { GcsResult } from "@gcs/core";
import {
  faArrowUpFromBracket,
  faCode,
  faFont,
  faImage,
  faMoon,
  faPalette,
  faRotateLeft,
  faSun,
  faTableColumns,
  faTrash,
  faUpload,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { closeThemeEditor, discardThemeDraft, publishTheme, saveThemeDraft } from "../../edit-actions";

type Palette = Record<string, string>;
export type GcsThemeEditorValue = {
  dark: Palette;
  light: Palette;
  fontDisplay: string;
  fontText: string;
  radius: number;
  width: number;
  customCss: string;
  logoUrl: string | null;
  faviconUrl: string | null;
};
type Patch = Partial<Omit<GcsThemeEditorValue, "dark" | "light">> & { dark?: Palette; light?: Palette };

export type GcsThemeEditorProps = {
  themeKey: string;
  themeName: string;
  hasDraft: boolean;
  value: GcsThemeEditorValue;
  tokens: readonly string[];
  fonts: readonly string[];
};

/** Pune CSS-ul draft-ului în `<style id="gcs-theme-draft">` (randat de layout cât timp editorul e deschis). */
function applyDraftCss(css: string) {
  let el = document.getElementById("gcs-theme-draft");
  if (!el) {
    el = document.createElement("style");
    el.id = "gcs-theme-draft";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** Contopește patch-urile în așteptare (paletele pe tokenuri), ca o singură salvare să le ducă pe toate. */
function mergePatch(a: Patch, b: Patch): Patch {
  return { ...a, ...b, ...(a.dark || b.dark ? { dark: { ...a.dark, ...b.dark } } : {}), ...(a.light || b.light ? { light: { ...a.light, ...b.light } } : {}) };
}

/**
 * Editorul de temă de pe site (specul etapei 5): panou lateral cu paleta pentru dark și light, fonturile, raza,
 * lățimea, logo-ul, favicon-ul și CSS-ul extra. Fiecare modificare intră în draft (salvare cu debounce), iar pagina
 * se previzualizează live, doar pentru admin; „Publică” o aplică pentru toți.
 */
export function GcsThemeEditor({ themeKey, themeName, hasDraft: initialDraft, value: initial, tokens, fonts }: GcsThemeEditorProps) {
  const t = useTranslations("themeEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [hasDraft, setHasDraft] = useState(initialDraft);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "muted"; text: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, startTransition] = useTransition();
  const queued = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flush = async () => {
    timer.current = null;
    const patch = queued.current;
    queued.current = {};
    if (Object.keys(patch).length === 0) return;
    setStatus({ tone: "muted", text: t("saving") });
    // Fonturile și URL-urile se validează pe server (Zod + serviciul temelor).
    const res = await saveThemeDraft({ key: themeKey, patch: patch as Parameters<typeof saveThemeDraft>[0]["patch"] });
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    applyDraftCss(res.data.css);
    setHasDraft(true);
    setStatus({ tone: "muted", text: t("draftSaved") });
  };

  const change = (patch: Patch, delay = 300) => {
    setValue((v) => ({ ...v, ...patch, dark: { ...v.dark, ...patch.dark }, light: { ...v.light, ...patch.light } }));
    queued.current = mergePatch(queued.current, patch);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  };

  const upload = async (kind: "logo" | "favicon", file: File | undefined) => {
    if (!file) return;
    setStatus({ tone: "muted", text: t("uploading") });
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("theme", themeKey);
    const res = (await fetch("/api/themes/images", { method: "POST", body }).then((r) => r.json())) as GcsResult<{ url: string; css: string }>;
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setValue((v) => ({ ...v, [kind === "logo" ? "logoUrl" : "faviconUrl"]: res.data.url }));
    applyDraftCss(res.data.css);
    setHasDraft(true);
    setStatus({ tone: "muted", text: t("draftSaved") });
    router.refresh();
  };

  const removeImage = (kind: "logoUrl" | "faviconUrl") => {
    change({ [kind]: null }, 0);
    setTimeout(() => router.refresh(), 600);
  };

  const publish = () =>
    startTransition(async () => {
      if (timer.current) {
        clearTimeout(timer.current);
        await flush();
      }
      const res = await publishTheme({ key: themeKey });
      if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
      setHasDraft(false);
      setStatus({ tone: "ok", text: t("published") });
      router.refresh();
    });

  const discard = () =>
    startTransition(async () => {
      if (timer.current) clearTimeout(timer.current);
      queued.current = {};
      const res = await discardThemeDraft({ key: themeKey });
      setConfirmDiscard(false);
      if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
      applyDraftCss(res.data.css);
      setHasDraft(false);
      setStatus({ tone: "muted", text: t("discarded") });
      router.refresh();
    });

  const close = () =>
    startTransition(async () => {
      if (timer.current) {
        clearTimeout(timer.current);
        await flush();
      }
      await closeThemeEditor();
      router.refresh();
    });

  // Tema refăcută de server (după publicare / renunțare): valorile din panou o urmează.
  useEffect(() => setValue(initial), [initial]);

  const palette = value[mode];
  return (
    <aside className="gcs-themeEditor" aria-label={t("title")} data-testid="gcs-theme-editor">
      <header className="gcs-themeEditor__head">
        <div>
          <strong className="gcs-display">
            <GcsIconSvg icon={faPalette} className="gcs-hIcon" />
            {t("title")}
          </strong>
          <span className="gcs-muted">
            {themeName}
            {hasDraft && (
              <span className="gcs-badge gcs-themeEditor__draft" data-testid="gcs-theme-draft-badge">
                {t("draft")}
              </span>
            )}
          </span>
        </div>
        <button type="button" className="gcs-headerIcon" onClick={close} aria-label={t("close")} data-testid="gcs-theme-editor-close">
          <GcsIconSvg icon={faXmark} />
        </button>
      </header>

      <div className="gcs-themeEditor__body">
        <section className="gcs-themeEditor__section">
          <h3>
            <GcsIconSvg icon={faPalette} className="gcs-hIcon" />
            {t("colors")}
          </h3>
          <div className="gcs-seg__group" role="tablist" aria-label={t("colors")}>
            {(["dark", "light"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "gcs-seg gcs-seg--active" : "gcs-seg"} onClick={() => setMode(m)}>
                <GcsIconSvg icon={m === "dark" ? faMoon : faSun} />
                {t(`modes.${m}`)}
              </button>
            ))}
          </div>
          <div className="gcs-themeEditor__colors">
            {tokens.map((token) => (
              <label key={token} className="gcs-themeEditor__color">
                <input
                  type="color"
                  value={palette[token] ?? "#000000"}
                  onChange={(e) => change({ [mode]: { [token]: e.target.value.toUpperCase() } })}
                  data-testid={`gcs-theme-color-${mode}-${token}`}
                />
                <span>{t(`tokens.${token}`)}</span>
                <code>{palette[token]}</code>
              </label>
            ))}
          </div>
        </section>

        <section className="gcs-themeEditor__section">
          <h3>
            <GcsIconSvg icon={faFont} className="gcs-hIcon" />
            {t("typography")}
          </h3>
          {(["fontDisplay", "fontText"] as const).map((f) => (
            <label key={f} className="gcs-themeEditor__row">
              <span>{t(f)}</span>
              <select className="gcs-input" value={value[f]} onChange={(e) => change({ [f]: e.target.value }, 0)} data-testid={`gcs-theme-${f}`}>
                {fonts.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>

        <section className="gcs-themeEditor__section">
          <h3>
            <GcsIconSvg icon={faTableColumns} className="gcs-hIcon" />
            {t("layout")}
          </h3>
          <label className="gcs-themeEditor__row">
            <span>
              {t("radius")} <code>{value.radius}px</code>
            </span>
            <input type="range" min={0} max={24} value={value.radius} onChange={(e) => change({ radius: Number(e.target.value) })} data-testid="gcs-theme-radius" />
          </label>
          <label className="gcs-themeEditor__row">
            <span>
              {t("width")} <code>{value.width}px</code>
            </span>
            <input type="range" min={1000} max={1920} step={10} value={value.width} onChange={(e) => change({ width: Number(e.target.value) })} data-testid="gcs-theme-width" />
          </label>
        </section>

        <section className="gcs-themeEditor__section">
          <h3>
            <GcsIconSvg icon={faImage} className="gcs-hIcon" />
            {t("branding")}
          </h3>
          {(["logo", "favicon"] as const).map((kind) => {
            const url = kind === "logo" ? value.logoUrl : value.faviconUrl;
            return (
              <div key={kind} className="gcs-themeEditor__image">
                <span>{t(kind)}</span>
                {url ? (
                  // Previzualizarea fișierului încărcat.
                  <img src={url} alt="" className={`gcs-themeEditor__preview gcs-themeEditor__preview--${kind}`} />
                ) : (
                  <span className="gcs-muted">{t("none")}</span>
                )}
                <div className="gcs-themeEditor__imageActions">
                  <label className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                    <GcsIconSvg icon={faArrowUpFromBracket} />
                    {t("upload")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="gcs-visuallyHidden"
                      onChange={(e) => void upload(kind, e.target.files?.[0])}
                      data-testid={`gcs-theme-upload-${kind}`}
                    />
                  </label>
                  {url && (
                    <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faTrash} />} onClick={() => removeImage(kind === "logo" ? "logoUrl" : "faviconUrl")}>
                      {t("remove")}
                    </GcsButton>
                  )}
                </div>
              </div>
            );
          })}
          <p className="gcs-muted gcs-themeEditor__hint">{t("imageHint")}</p>
        </section>

        <section className="gcs-themeEditor__section">
          <h3>
            <GcsIconSvg icon={faCode} className="gcs-hIcon" />
            {t("customCss")}
          </h3>
          <textarea
            className="gcs-input gcs-themeEditor__css"
            spellCheck={false}
            rows={8}
            maxLength={50_000}
            value={value.customCss}
            onChange={(e) => change({ customCss: e.target.value }, 800)}
            aria-label={t("customCss")}
            data-testid="gcs-theme-css"
          />
          <p className="gcs-muted gcs-themeEditor__hint">{t("cssHint")}</p>
        </section>
      </div>

      <footer className="gcs-themeEditor__foot">
        <p role="status" className={`gcs-themeEditor__status gcs-themeEditor__status--${status?.tone ?? "muted"}`} data-testid="gcs-theme-status">
          {status?.text ?? (hasDraft ? t("unpublished") : t("upToDate"))}
        </p>
        <div className="gcs-themeEditor__buttons">
          {confirmDiscard ? (
            <>
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faXmark} />} onClick={() => setConfirmDiscard(false)}>
                {t("cancel")}
              </GcsButton>
              <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={discard} disabled={pending} data-testid="gcs-theme-discard-confirm">
                {t("confirmDiscard")}
              </GcsButton>
            </>
          ) : (
            <>
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => setConfirmDiscard(true)} disabled={pending || !hasDraft}>
                {t("discard")}
              </GcsButton>
              <GcsButton variant="primary" size="sm" icon={<GcsIconSvg icon={faUpload} />} onClick={publish} disabled={pending || !hasDraft} data-testid="gcs-theme-publish">
                {t("publish")}
              </GcsButton>
            </>
          )}
        </div>
      </footer>
    </aside>
  );
}
