"use client";

import { faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { MAP_IMAGE_MODES, MAP_TEMPLATE_MAX, cleanMapName, mapArtUrl, mapTemplateError, mapTemplateUrl, type GcsMapImageMode } from "@gcs/modules/map-images";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

type Props = {
  game: { key: string; name: string };
  /** Valorile salvate (modul activ se arată din ele). */
  template: string;
  mode: GcsMapImageMode;
  /** Harta de probă implicită (prima din catalog sau una obișnuită). */
  sample: string;
  /** http e permis doar în dezvoltare (decis pe server). */
  allowHttp: boolean;
  /** Fără drept pe setările punții: doar starea și previzualizarea. */
  action: ((fd: FormData) => Promise<GcsResult<null>>) | null;
};

type Probe = { url: string; state: "loading" | "ok" | "error"; size?: string };

/**
 * Șablonul imaginilor hărților pentru un joc (specul 2026-10-08-servere-bridge §13): modul activ (direct / copiere /
 * fără șablon), câmpul cu validarea pe loc, modul și previzualizarea live pentru o hartă de probă — imaginea de la
 * adresa calculată, peste arta GCS (rezerva pe care o văd vizitatorii dacă imaginea lipsește sau e blocată).
 */
export function GcsMapTemplateForm({ game, template: saved, mode: savedMode, sample: initialSample, allowHttp, action }: Props) {
  const t = useTranslations("acp.serverMaps.template");
  const tErr = useTranslations("errors.fields");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [template, setTemplate] = useState(saved);
  const [mode, setMode] = useState<GcsMapImageMode>(savedMode);
  const [sample, setSample] = useState(initialSample);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const code = template.trim() ? mapTemplateError(template.trim(), { allowHttp }) : null;
  const error = code ? (tErr.has(code) ? tErr(code) : code) : undefined;
  const url = template.trim() && !code ? mapTemplateUrl(template.trim(), sample, { allowHttp }) : null;
  const art = mapArtUrl(game.key);
  const state = probe?.url === url ? probe.state : "loading";
  const active = saved ? savedMode : "none";
  const id = `gcs-map-tpl-${game.key}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action || code) return;
    setPending(true);
    setStatus(null);
    const result = await action(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    setStatus({ ok: true, text: t("saved") });
    router.refresh();
  }

  return (
    <section className="gcs-mapTpl" aria-labelledby={`${id}-title`} data-testid="gcs-map-template" data-game={game.key} data-mode={active}>
      <header className="gcs-mapTpl__head">
        <h3 id={`${id}-title`} className="gcs-mapTpl__title">
          {game.name}
        </h3>
        <span className={`gcs-badge ${active === "direct" ? "gcs-badge--ok" : active === "copy" ? "gcs-badge--info" : "gcs-badge--neutral"}`} data-testid="gcs-map-template-mode">
          {t(`active.${active}`)}
        </span>
      </header>
      <p className="gcs-mapTpl__desc">{t(`activeDesc.${active}`)}</p>

      <form className="gcs-mapTpl__form" onSubmit={onSubmit} noValidate>
        <input type="hidden" name="game" value={game.key} />
        <GcsField label={t("field")} hint={t("hint", { example: "https://exemplu.com/harti/{map}.jpg" })} {...(error ? { error } : {})}>
          <input
            name="template"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAP_TEMPLATE_MAX}
            placeholder="https://exemplu.com/harti/{map}.jpg"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            readOnly={!action}
            data-testid="gcs-map-template-input"
          />
        </GcsField>

        <fieldset className="gcs-mapTpl__modes" disabled={!action}>
          <legend className="gcs-field__label">{t("mode")}</legend>
          {MAP_IMAGE_MODES.map((m) => (
            <label key={m} className="gcs-mapTpl__mode">
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`gcs-map-template-mode-${m}`} />
              <span>
                <strong>{t(`modes.${m}`)}</strong>
                <span className="gcs-mapTpl__modeDesc">{t(`modesDesc.${m}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="gcs-mapTpl__preview">
          <GcsField label={t("sample")} className="gcs-mapTpl__sample">
            <input value={sample} onChange={(e) => setSample(e.target.value)} maxLength={64} autoComplete="off" spellCheck={false} data-testid="gcs-map-template-sample" />
          </GcsField>
          <figure className="gcs-mapTpl__figure" data-testid="gcs-map-template-preview" data-state={url ? state : "art"}>
            <span className="gcs-mapPic gcs-mapTpl__pic" style={{ "--gcs-map-art": `url("${art}")` } as CSSProperties}>
              {url && (
                <img
                  key={url}
                  src={url}
                  alt=""
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onLoad={(e) => setProbe({ url, state: "ok", size: `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}` })}
                  onError={() => setProbe({ url, state: "error" })}
                />
              )}
              <span className="gcs-mapTpl__picName">{cleanMapName(sample) ?? sample}</span>
            </span>
            <figcaption className="gcs-mapTpl__caption" aria-live="polite">
              {url ? (
                <>
                  <code className="gcs-mapTpl__url" data-testid="gcs-map-template-url">
                    {url}
                  </code>
                  <span data-state={state}>{state === "ok" ? t("previewOk", { size: probe?.size ?? "" }) : state === "error" ? t("previewError") : t("previewLoading")}</span>
                </>
              ) : (
                <span>{template.trim() && !code ? t("previewBadMap") : t("previewArt")}</span>
              )}
            </figcaption>
          </figure>
        </div>

        {action && (
          <div className="gcs-mapTpl__actions">
            <GcsButton type="submit" variant="primary" disabled={pending || Boolean(code)} icon={<GcsIconSvg icon={faFloppyDisk} />} data-testid="gcs-map-template-save">
              {t("save")}
            </GcsButton>
            {status && (
              <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-mapTpl__ok" : "gcs-mapTpl__err"}>
                {status.text}
              </span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
