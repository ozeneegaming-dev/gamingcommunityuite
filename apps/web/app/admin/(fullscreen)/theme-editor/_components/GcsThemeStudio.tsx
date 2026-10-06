"use client";

import type { GcsResult } from "@gcs/core";
import { DEFAULT_THEME_SETTINGS, compileThemeCss, themePath, withThemePath, type GcsThemeSettings } from "@gcs/core/themes";
import { GcsIconSvg, GcsModal } from "@gcs/ui";
import {
  faArrowRightFromBracket,
  faChevronLeft,
  faChevronRight,
  faCode,
  faDisplay,
  faFloppyDisk,
  faLightbulb,
  faMobileScreenButton,
  faMoon,
  faPalette,
  faRotateLeft,
  faSliders,
  faTabletScreenButton,
  faCheck,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { isPreviewReadyMessage, STUDIO_MESSAGE_SOURCE, type GcsStudioApplyMessage } from "@/lib/theme-preview";
import { discardThemeStudio, publishThemeStudio, saveThemeStudioDraft } from "../actions";
import { GcsStudioColorRow, GcsStudioColorSelector, GcsStudioImageRow, GcsStudioSettingRow, colorLabel } from "./GcsStudioControls";
import { CSS_ROW_ICON, STUDIO_PANELS, colorPath, parentPanel, type GcsStudioColorRef, type GcsStudioImageSlot, type GcsStudioPanelId } from "./studio-panels";

export type GcsThemeStudioValue = { settings: GcsThemeSettings; customCss: string; logoUrl: string | null; faviconUrl: string | null };

type Mode = "dark" | "light";
type Size = "mobile" | "tablet" | "desktop";

/** Lățimea previzualizării pentru fiecare mărime. */
const SIZES: Record<Size, string> = { mobile: "390px", tablet: "820px", desktop: "100%" };
const SAVE_DELAY = 700;
const THEMES_PAGE = "/admin/appearance/themes";

/** Imaginea unui loc din temă (coloanele temei pentru logo / favicon, setările pentru variantele logo-ului). */
function imageUrl(v: GcsThemeStudioValue, slot: GcsStudioImageSlot): string | null {
  switch (slot) {
    case "logo":
      return v.logoUrl;
    case "favicon":
      return v.faviconUrl;
    case "logoLight":
      return v.settings.logo.imageLight;
    case "logoMobile":
      return v.settings.logo.imageMobile;
    case "logoMobileLight":
      return v.settings.logo.imageMobileLight;
  }
}

function withImage(v: GcsThemeStudioValue, slot: GcsStudioImageSlot, url: string | null): GcsThemeStudioValue {
  if (slot === "logo") return { ...v, logoUrl: url };
  if (slot === "favicon") return { ...v, faviconUrl: url };
  const key = slot === "logoLight" ? "imageLight" : slot === "logoMobile" ? "imageMobile" : "imageMobileLight";
  return { ...v, settings: withThemePath(v.settings, `logo.${key}`, url) };
}

/** Butonul din bara de iconițe: tooltip (CSS, la hover și focus) și `aria-label`. */
function RailButton({
  icon,
  label,
  onClick,
  pressed,
  tone,
  disabled,
  testId,
}: {
  icon: Parameters<typeof GcsIconSvg>[0]["icon"];
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tone?: "save";
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`gcs-themeStudio__railBtn${pressed ? " gcs-themeStudio__railBtn--active" : ""}${tone === "save" ? " gcs-themeStudio__railBtn--save" : ""}`}
      aria-label={label}
      data-tip={label}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <GcsIconSvg icon={icon} />
    </button>
  );
}

/** Editorul de CSS: un `textarea` monospațiat cu numerele liniilor (fără un editor greu). */
function CssDialog({ value, onChange, onClose }: { value: string; onChange: (css: string) => void; onClose: () => void }) {
  const t = useTranslations("themeStudio");
  const [atOpen] = useState(value);
  const gutter = useRef<HTMLPreElement>(null);
  const lines = Math.max(1, value.split("\n").length);
  return (
    <GcsModal title={t("cssDialog.title")} icon={<GcsIconSvg icon={faCode} />} onClose={onClose} closeLabel={t("cssDialog.done")} size="lg" className="gcs-themeStudio__cssModal">
      <p className="gcs-themeStudio__help">{t("cssDialog.hint")}</p>
      <div className="gcs-themeStudio__codeEditor">
        <pre ref={gutter} className="gcs-themeStudio__gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <textarea
          className="gcs-themeStudio__codeInput"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          spellCheck={false}
          maxLength={50_000}
          wrap="off"
          aria-label={t("cssDialog.title")}
          data-testid="gcs-studio-css"
        />
      </div>
      <div className="gcs-themeStudio__dialogActions">
        <button type="button" className="gcs-themeStudio__btn gcs-themeStudio__btn--ghost" onClick={() => onChange(atOpen)} disabled={value === atOpen} data-testid="gcs-studio-css-revert">
          <GcsIconSvg icon={faRotateLeft} />
          {t("cssDialog.revert")}
        </button>
        <button type="button" className="gcs-themeStudio__btn" onClick={onClose} data-testid="gcs-studio-css-done">
          <GcsIconSvg icon={faCheck} />
          {t("cssDialog.done")}
        </button>
      </div>
    </GcsModal>
  );
}

/**
 * Editorul vizual de temă (pe tot ecranul): previzualizarea live a site-ului într-un `iframe` (stânga), bara de iconițe
 * și panourile cu navigare în adâncime (dreapta). Fiecare modificare se compilează local (aceeași funcție ca serverul)
 * și ajunge instant în previzualizare prin `postMessage`; draft-ul se salvează automat, „Salvează” îl publică.
 */
export function GcsThemeStudio({
  themeKey,
  themeName,
  siteName,
  hasDraft: initialDraft,
  fonts,
  previewUrl,
  initial,
}: {
  themeKey: string;
  themeName: string;
  siteName: string;
  hasDraft: boolean;
  fonts: readonly string[];
  previewUrl: string;
  initial: GcsThemeStudioValue;
}) {
  const t = useTranslations("themeStudio");
  const errorMessage = useErrorMessage();
  const router = useRouter();

  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const [mode, setMode] = useState<Mode>("dark");
  const [size, setSize] = useState<Size>("desktop");
  const [stack, setStack] = useState<GcsStudioPanelId[]>(["start"]);
  const [colorTarget, setColorTarget] = useState<GcsStudioColorRef | null>(null);
  const [tab, setTab] = useState<"settings" | "colors">("settings");
  const [cssOpen, setCssOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<GcsStudioImageSlot | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "muted"; text: string } | null>(null);

  const frame = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const reloadAfterSave = useRef(false);

  const css = useMemo(() => compileThemeCss(value.settings, value.customCss), [value.settings, value.customCss]);

  // ─── Previzualizarea ───────────────────────────────────────────────────────
  const postPreview = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    const message: GcsStudioApplyMessage = {
      source: STUDIO_MESSAGE_SOURCE,
      type: "apply",
      css,
      mode,
      logo: { text: value.settings.logo.text, slogan: value.settings.logo.slogan },
    };
    win.postMessage(message, window.location.origin);
  }, [css, mode, value.settings.logo.text, value.settings.logo.slogan]);

  useEffect(() => postPreview(), [postPreview]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (isPreviewReadyMessage(e.data)) postPreview();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postPreview]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // ─── Salvarea automată a draft-ului ────────────────────────────────────────
  const saveNow = useCallback(async () => {
    const v = latest.current;
    setStatus({ tone: "muted", text: t("status.saving") });
    const res = await saveThemeStudioDraft(themeKey, { ...v.settings, customCss: v.customCss, logoUrl: v.logoUrl, faviconUrl: v.faviconUrl });
    if (!res.ok) {
      setStatus({ tone: "error", text: errorMessage(res.error) });
      return false;
    }
    setHasDraft(true);
    setStatus({ tone: "muted", text: t("status.saved") });
    if (reloadAfterSave.current) {
      reloadAfterSave.current = false;
      frame.current?.contentWindow?.location.reload();
    }
    return true;
  }, [errorMessage, t, themeKey]);

  /** Rulează salvările una după alta (ordinea contează: ultima stare câștigă). */
  const enqueueSave = useCallback(() => {
    const next = chain.current.then(saveNow);
    chain.current = next.catch(() => false);
    return next;
  }, [saveNow]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      await enqueueSave();
      setPending(false);
    }
    await chain.current;
  }, [enqueueSave]);

  const update = useCallback(
    (fn: (v: GcsThemeStudioValue) => GcsThemeStudioValue) => {
      const next = fn(latest.current);
      latest.current = next;
      setValue(next);
      setPending(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void enqueueSave().then(() => {
          if (!timer.current) setPending(false);
        });
      }, SAVE_DELAY);
    },
    [enqueueSave],
  );

  const setSetting = (path: string, v: unknown) => update((cur) => ({ ...cur, settings: withThemePath(cur.settings, path, v) }));

  // ─── Imaginile ─────────────────────────────────────────────────────────────
  const upload = async (slot: GcsStudioImageSlot, file: File) => {
    setUploading(slot);
    await flush();
    setStatus({ tone: "muted", text: t("status.uploading") });
    const body = new FormData();
    body.set("file", file);
    body.set("kind", slot);
    body.set("theme", themeKey);
    const res = (await fetch("/api/themes/images", { method: "POST", body })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: { code: "internal", status: 500 } }))) as GcsResult<{ url: string }>;
    setUploading(null);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    const next = withImage(latest.current, slot, res.data.url);
    latest.current = next;
    setValue(next);
    setHasDraft(true);
    setStatus({ tone: "muted", text: t("status.saved") });
    frame.current?.contentWindow?.location.reload();
  };

  const removeImage = (slot: GcsStudioImageSlot) => {
    reloadAfterSave.current = true;
    update((cur) => withImage(cur, slot, null));
  };

  // ─── Salvare / ieșire ──────────────────────────────────────────────────────
  const dirty = hasDraft || pending;

  const publish = async () => {
    setBusy(true);
    await flush();
    const res = await publishThemeStudio(themeKey);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setHasDraft(false);
    setStatus({ tone: "ok", text: t("status.published") });
  };

  const exit = () => {
    if (dirty) setExitOpen(true);
    else router.push(THEMES_PAGE);
  };

  const leaveWithoutSaving = async () => {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await chain.current;
    const res = await discardThemeStudio(themeKey);
    setBusy(false);
    if (!res.ok) return setStatus({ tone: "error", text: errorMessage(res.error) });
    setExitOpen(false);
    router.push(THEMES_PAGE);
  };

  // ─── Panourile ─────────────────────────────────────────────────────────────
  const current = stack[stack.length - 1]!;
  const panel = STUDIO_PANELS[current];
  const palette = value.settings[mode];
  const open = (id: GcsStudioPanelId) => {
    setStack((s) => [...s, id]);
    setTab("settings");
  };
  const back = () => {
    if (colorTarget) return setColorTarget(null);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : [parentPanel(current) ?? "start"]));
    setTab("settings");
  };

  const settingRows = (panel.settings ?? []).map((item, i): ReactNode => {
    if (typeof item === "string") {
      return (
        <GcsStudioSettingRow
          key={item}
          path={item}
          value={themePath(value.settings, item)}
          defaultValue={themePath(DEFAULT_THEME_SETTINGS, item)}
          fonts={fonts}
          onChange={(v) => setSetting(item, v)}
        />
      );
    }
    if ("heading" in item) {
      return (
        <h3 key={`h${i}`} className="gcs-themeStudio__subhead">
          {t(`headings.${item.heading}`)}
        </h3>
      );
    }
    return (
      <GcsStudioImageRow
        key={item.image}
        slot={item.image}
        url={imageUrl(value, item.image)}
        busy={uploading !== null}
        onUpload={(file) => void upload(item.image, file)}
        onRemove={() => removeImage(item.image)}
      />
    );
  });

  const colorRows = (panel.colors ?? []).map((ref) => {
    const path = colorPath(ref, mode);
    return (
      <GcsStudioColorRow
        key={path}
        colorRef={ref}
        value={String(themePath(value.settings, path))}
        defaultValue={String(themePath(DEFAULT_THEME_SETTINGS, path))}
        palette={palette}
        onOpen={() => setColorTarget(ref)}
        onRevert={() => setSetting(path, themePath(DEFAULT_THEME_SETTINGS, path))}
      />
    );
  });

  const hasSettings = settingRows.length > 0;
  const hasColors = colorRows.length > 0;
  const shownTab = hasSettings && hasColors ? tab : hasColors ? "colors" : "settings";
  const modeNote = <p className="gcs-themeStudio__modeNote">{t(`editingMode.${mode}`)}</p>;

  let body: ReactNode;
  let title: string;
  if (colorTarget) {
    const path = colorPath(colorTarget, mode);
    title = colorLabel(t, colorTarget);
    body = (
      <>
        {modeNote}
        <GcsStudioColorSelector colorRef={colorTarget} value={String(themePath(value.settings, path))} palette={palette} onChange={(v) => setSetting(path, v)} />
      </>
    );
  } else if (panel.rows) {
    title = current === "start" ? t("title") : t(`panels.${current}`);
    body = (
      <nav className="gcs-themeStudio__nav" aria-label={title}>
        {panel.rows.map((row, i) => {
          if (row.type === "separator") return <hr key={`s${i}`} className="gcs-themeStudio__sep" />;
          const isCss = row.type === "css";
          const icon = isCss ? CSS_ROW_ICON : STUDIO_PANELS[row.panel].icon;
          const label = isCss ? t("customCss") : t(`panels.${row.panel}`);
          return (
            <button
              key={isCss ? "css" : row.panel}
              type="button"
              className="gcs-themeStudio__navRow"
              onClick={() => (isCss ? setCssOpen(true) : open(row.panel))}
              data-testid={isCss ? "gcs-studio-nav-css" : `gcs-studio-nav-${row.panel}`}
            >
              <span className="gcs-themeStudio__navIcon">
                <GcsIconSvg icon={icon} />
              </span>
              <span className="gcs-themeStudio__navLabel">{label}</span>
              <GcsIconSvg icon={faChevronRight} className="gcs-themeStudio__chevron" />
            </button>
          );
        })}
      </nav>
    );
  } else {
    title = t(`panels.${current}`);
    body = (
      <>
        {hasSettings && hasColors && (
          <div className="gcs-themeStudio__tabs" role="tablist" aria-label={title}>
            {(["settings", "colors"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shownTab === id}
                className={shownTab === id ? "gcs-themeStudio__tab gcs-themeStudio__tab--active" : "gcs-themeStudio__tab"}
                onClick={() => setTab(id)}
                data-testid={`gcs-studio-tab-${id}`}
              >
                <GcsIconSvg icon={id === "settings" ? faSliders : faPalette} />
                {t(`tabs.${id}`)}
              </button>
            ))}
          </div>
        )}
        {shownTab === "settings" ? (
          <div className="gcs-themeStudio__settings">{settingRows}</div>
        ) : (
          <div className="gcs-themeStudio__colors">
            {modeNote}
            {colorRows}
          </div>
        )}
      </>
    );
  }

  const atStart = current === "start" && !colorTarget;
  const statusText = status?.text ?? (hasDraft ? t("status.unpublished") : t("status.upToDate"));

  return (
    <div className="gcs-themeStudio" data-testid="gcs-theme-studio">
      {/* Previzualizarea în stânga (restul lățimii), bara de iconițe la mijloc, panoul în dreapta. */}
      <main className="gcs-themeStudio__preview" aria-label={t("preview")}>
        <div className="gcs-themeStudio__frameWrap" data-size={size}>
          <iframe ref={frame} src={previewUrl} title={t("previewTitle", { site: siteName })} className="gcs-themeStudio__frame" style={{ width: SIZES[size] }} data-testid="gcs-studio-preview" />
        </div>
      </main>

      <div className="gcs-themeStudio__rail" role="toolbar" aria-orientation="vertical" aria-label={t("rail.label")}>
        <RailButton icon={faLightbulb} label={t("rail.light")} pressed={mode === "light"} onClick={() => setMode("light")} testId="gcs-studio-mode-light" />
        <RailButton icon={faMoon} label={t("rail.dark")} pressed={mode === "dark"} onClick={() => setMode("dark")} testId="gcs-studio-mode-dark" />
        <span className="gcs-themeStudio__railSep" aria-hidden="true" />
        <RailButton icon={faMobileScreenButton} label={t("rail.mobile")} pressed={size === "mobile"} onClick={() => setSize("mobile")} testId="gcs-studio-size-mobile" />
        <RailButton icon={faTabletScreenButton} label={t("rail.tablet")} pressed={size === "tablet"} onClick={() => setSize("tablet")} testId="gcs-studio-size-tablet" />
        <RailButton icon={faDisplay} label={t("rail.desktop")} pressed={size === "desktop"} onClick={() => setSize("desktop")} testId="gcs-studio-size-desktop" />
        <span className="gcs-themeStudio__railSep" aria-hidden="true" />
        <RailButton icon={faCode} label={t("rail.css")} onClick={() => setCssOpen(true)} testId="gcs-studio-css-open" />
        <span className="gcs-themeStudio__railSpacer" aria-hidden="true" />
        <RailButton icon={faArrowRightFromBracket} label={t("rail.exit")} onClick={exit} testId="gcs-studio-exit" />
        <RailButton icon={faFloppyDisk} label={t("rail.save")} tone="save" onClick={() => void publish()} disabled={busy || !dirty} testId="gcs-studio-save" />
      </div>

      <aside className="gcs-themeStudio__panel" aria-label={t("title")}>
        <header className="gcs-themeStudio__panelHead">
          {atStart ? (
            <div className="gcs-themeStudio__titleBlock">
              <h1 className="gcs-themeStudio__title gcs-display">{t("title")}</h1>
              <span className="gcs-themeStudio__muted">
                {themeName}
                {hasDraft && <span className="gcs-themeStudio__badge">{t("draft")}</span>}
              </span>
            </div>
          ) : (
            <>
              <button type="button" className="gcs-themeStudio__back" onClick={back} data-testid="gcs-studio-back">
                <GcsIconSvg icon={faChevronLeft} />
                {t("back")}
              </button>
              <h2 className="gcs-themeStudio__title gcs-display">{title}</h2>
            </>
          )}
        </header>
        <div className="gcs-themeStudio__panelBody" data-panel={colorTarget ? "color" : current}>
          {body}
        </div>
        <footer className="gcs-themeStudio__panelFoot">
          <p role="status" className={`gcs-themeStudio__status gcs-themeStudio__status--${status?.tone ?? "muted"}`} data-testid="gcs-studio-status">
            {status?.tone === "error" && <GcsIconSvg icon={faTriangleExclamation} />}
            {statusText}
          </p>
        </footer>
      </aside>

      {cssOpen && <CssDialog value={value.customCss} onChange={(customCss) => update((cur) => ({ ...cur, customCss }))} onClose={() => setCssOpen(false)} />}

      {exitOpen && (
        <GcsModal title={t("exitDialog.title")} icon={<GcsIconSvg icon={faTriangleExclamation} />} onClose={() => setExitOpen(false)} closeLabel={t("exitDialog.stay")} size="sm">
          <p className="gcs-themeStudio__dialogText">{t("exitDialog.body")}</p>
          <div className="gcs-themeStudio__dialogActions">
            <button type="button" className="gcs-themeStudio__btn gcs-themeStudio__btn--danger" onClick={() => void leaveWithoutSaving()} disabled={busy} data-testid="gcs-studio-exit-discard">
              <GcsIconSvg icon={faArrowRightFromBracket} />
              {t("exitDialog.leave")}
            </button>
            <button type="button" className="gcs-themeStudio__btn" onClick={() => setExitOpen(false)} data-testid="gcs-studio-exit-stay">
              <GcsIconSvg icon={faChevronLeft} />
              {t("exitDialog.stay")}
            </button>
          </div>
        </GcsModal>
      )}
    </div>
  );
}
