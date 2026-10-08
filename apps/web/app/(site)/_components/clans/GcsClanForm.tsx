"use client";

import { faFloppyDisk, faImage, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import type { GcsResult } from "@gcs/core";
import { CLAN_LINK_KINDS, tagInk } from "@gcs/modules/clans-text";
import { GcsButton, GcsClanTag, GcsIconSvg } from "@gcs/ui";
import type { GcsEditorTool } from "@gcs/ui/editor";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type CSSProperties, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { createClan, updateClan } from "../../clan-actions";
import { GcsRichTextInput } from "../editor/GcsRichTextInput";

const DESCRIPTION_TOOLS: GcsEditorTool[] = ["bold", "italic", "underline", "strike", "color", "highlight", "align", "clear", "bulletList", "orderedList", "quote", "horizontalRule", "link", "image", "emoji"];
const HEX = /^#[0-9A-Fa-f]{6}$/;

type Image = { id: string; url: string } | null;
type JoinMode = "OPEN" | "REQUEST" | "INVITE";

export type GcsClanFormInitial = {
  tag: string;
  name: string;
  description: unknown;
  color: string;
  color2: string;
  links: Partial<Record<(typeof CLAN_LINK_KINDS)[number], string>>;
  joinMode: JoinMode;
  logo: Image;
  banner: Image;
  officerRights: string[];
};

export type GcsClanFormOptions = {
  tagMin: number;
  tagMax: number;
  tagCharset: "alnum" | "alnum_symbols" | "unicode";
  requiredFields: string[];
  logoMaxKb: number;
  bannerMaxKb: number;
  forumMode: "auto" | "optional" | "off";
  /** Drepturile pe care staff-ul le permite ofițerilor (lista din care alege liderul). */
  officerRights: string[];
  requireApproval: boolean;
};

/**
 * Formularul clanului (specul 2026-10-08-clanuri §4.1, §7.3): crearea (`/clans/new`) și setările din administrare.
 * Imaginile se încarcă imediat (prin pipeline-ul atașamentelor) și se leagă la salvare; plăcuța și bannerul au o
 * previzualizare în culorile alese. Tagul, numele și drepturile ofițerilor: doar liderul (sau staff-ul).
 */
export function GcsClanForm({
  mode,
  clanId = null,
  initial,
  options,
  leader,
}: {
  mode: "create" | "edit";
  clanId?: number | null;
  initial: GcsClanFormInitial;
  options: GcsClanFormOptions;
  leader: boolean;
}) {
  const t = useTranslations("clans.form");
  const tf = useTranslations("errors.fields");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [tag, setTag] = useState(initial.tag);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState<unknown>(initial.description ?? "");
  const [color, setColor] = useState(initial.color);
  const [color2, setColor2] = useState(initial.color2);
  const [links, setLinks] = useState(initial.links);
  const [joinMode, setJoinMode] = useState<JoinMode>(initial.joinMode);
  const [rights, setRights] = useState(initial.officerRights);
  const [wantForum, setWantForum] = useState(options.forumMode === "auto");
  const [logo, setLogo] = useState<Image>(initial.logo);
  const [banner, setBanner] = useState<Image>(initial.banner);
  const [changed, setChanged] = useState({ logo: false, banner: false });
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const required = (f: string) => options.requiredFields.includes(f);
  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="gcs-formError" role="alert" data-testid={`gcs-clan-error-${key.replace(".", "-")}`}>
        {tf.has(fieldErrors[key]!) ? tf(fieldErrors[key]!) : fieldErrors[key]}
      </span>
    ) : null;

  async function upload(kind: "logo" | "banner", file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    setFieldErrors((e) => ({ ...e, [kind]: "" }));
    const fd = new FormData();
    fd.set("kind", kind);
    if (clanId !== null) fd.set("clanId", String(clanId));
    fd.set("file", file);
    const res = (await fetch("/api/clans/image", { method: "POST", body: fd }).then((r) => r.json()).catch(() => null)) as GcsResult<{ id: string; url: string }> | null;
    setUploading(null);
    if (!res || !res.ok) {
      setFieldErrors((e) => ({ ...e, [kind]: res && !res.ok ? (Object.values(res.error.fields ?? {})[0] ?? "invalid_image") : "invalid_image" }));
      return;
    }
    if (kind === "logo") setLogo(res.data);
    else setBanner(res.data);
    setChanged((c) => ({ ...c, [kind]: true }));
  }

  function remove(kind: "logo" | "banner") {
    if (kind === "logo") setLogo(null);
    else setBanner(null);
    setChanged((c) => ({ ...c, [kind]: true }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setStatus(null);
    setFieldErrors({});
    const input = {
      tag,
      name,
      description,
      color: HEX.test(color) ? color : "#D62839",
      color2: HEX.test(color2) ? color2 : "#1B1E26",
      links: Object.fromEntries(CLAN_LINK_KINDS.map((k) => [k, (links[k] ?? "").trim()])),
      joinMode,
      ...(mode === "create" ? { logoId: logo?.id ?? null, bannerId: banner?.id ?? null } : {}),
      ...(mode === "edit" && changed.logo ? { logoId: logo?.id ?? null } : {}),
      ...(mode === "edit" && changed.banner ? { bannerId: banner?.id ?? null } : {}),
      ...(mode === "edit" && leader ? { officerRights: rights } : {}),
      ...(mode === "create" && options.forumMode === "optional" ? { wantForum } : {}),
    };
    const res = mode === "create" ? await createClan(input) : await updateClan({ clanId: clanId!, input });
    setPending(false);
    if (!res.ok) {
      setFieldErrors(res.error.fields ?? {});
      setStatus({ ok: false, text: errorMessage(res.error) });
      return;
    }
    if (mode === "create") {
      const created = res.data as { id: number; slug: string };
      router.push(`/clans/${created.id}-${created.slug}`);
      return;
    }
    setChanged({ logo: false, banner: false });
    setStatus({ ok: true, text: t("saved") });
    router.refresh();
  }

  const charsHint = t(`charsets.${options.tagCharset}`);
  const preview = { tag: tag.trim() || "TAG", name: name.trim() || t("previewName"), color: HEX.test(color) ? color : "#D62839", color2: HEX.test(color2) ? color2 : "#1B1E26" };

  return (
    <form className="gcs-clanForm" onSubmit={onSubmit} noValidate data-testid="gcs-clan-form">
      <fieldset className="gcs-settingsFieldset">
        <legend>{t("sections.identity")}</legend>
        <div className="gcs-clanForm__row">
          <div className="gcs-field">
            <label htmlFor={`${uid}-tag`}>{t("tag")} *</label>
            <input
              id={`${uid}-tag`}
              className="gcs-input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={options.tagMax + 2}
              disabled={!leader}
              autoComplete="off"
              aria-describedby={`${uid}-tag-hint`}
              data-testid="gcs-clan-field-tag"
            />
            <span id={`${uid}-tag-hint`} className="gcs-field__hint">
              {t("tagHint", { min: options.tagMin, max: options.tagMax, chars: charsHint })}
            </span>
            {fieldError("tag")}
          </div>
          <div className="gcs-field">
            <label htmlFor={`${uid}-name`}>{t("name")} *</label>
            <input id={`${uid}-name`} className="gcs-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={!leader} data-testid="gcs-clan-field-name" />
            <span className="gcs-field__hint">{t("nameHint")}</span>
            {fieldError("name")}
          </div>
        </div>
        {!leader && <p className="gcs-field__hint">{t("leaderOnly")}</p>}
      </fieldset>

      <fieldset className="gcs-settingsFieldset">
        <legend>{t("sections.look")}</legend>
        <div className="gcs-clanForm__preview" style={{ "--gcs-clan-color": preview.color, "--gcs-clan-color2": preview.color2 } as CSSProperties} aria-hidden="true">
          <GcsClanTag clan={{ tag: preview.tag, name: preview.name, color: preview.color, color2: preview.color2, ink: tagInk(preview.color) }} size="lg" plain />
          <strong className="gcs-display" style={{ fontSize: 18 }}>
            {preview.name}
          </strong>
        </div>
        <div className="gcs-clanForm__colors">
          <label className="gcs-clanForm__color">
            <input type="color" value={preview.color} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label={t("color")} data-testid="gcs-clan-field-color" />
            {t("color")}
          </label>
          <label className="gcs-clanForm__color">
            <input type="color" value={preview.color2} onChange={(e) => setColor2(e.target.value.toUpperCase())} aria-label={t("color2")} />
            {t("color2")}
          </label>
        </div>
        {fieldError("color")}
        {(["logo", "banner"] as const).map((kind) => {
          const image = kind === "logo" ? logo : banner;
          const maxKb = kind === "logo" ? options.logoMaxKb : options.bannerMaxKb;
          return (
            <div key={kind} className="gcs-field">
              <span id={`${uid}-${kind}-label`}>
                {t(kind)}
                {required(kind) ? " *" : ""}
              </span>
              <div className="gcs-clanForm__image">
                {image &&
                  (kind === "logo" ? (
                    <span className="gcs-clanLogo" style={{ "--gcs-clan-color": preview.color } as CSSProperties}>
                      <img src={image.url} alt={t("logoCurrent")} />
                    </span>
                  ) : (
                    <img className="gcs-clanForm__bannerPreview" src={image.url} alt={t("bannerCurrent")} />
                  ))}
                <label className="gcs-btn gcs-btn--ghost gcs-btn--sm" style={{ cursor: "pointer" }}>
                  <GcsIconSvg icon={faImage} />
                  {uploading === kind ? t("uploading") : image ? t("replace") : t("upload")}
                  <input
                    id={`gcs-clan-${kind}`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="gcs-srOnly"
                    aria-labelledby={`${uid}-${kind}-label`}
                    onChange={(e) => void upload(kind, e.target.files?.[0])}
                  />
                </label>
                {image && (
                  <GcsButton type="button" variant="ghost" size="sm" icon={<GcsIconSvg icon={faTrash} />} onClick={() => remove(kind)}>
                    {t("removeImage")}
                  </GcsButton>
                )}
              </div>
              <span className="gcs-field__hint">{t(`${kind}Hint`, { kb: maxKb })}</span>
              {fieldError(kind)}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="gcs-settingsFieldset">
        <legend>{t("sections.about")}</legend>
        <div className="gcs-field">
          <span id={`${uid}-description-label`}>
            {t("description")}
            {required("description") ? " *" : ""}
          </span>
          <GcsRichTextInput
            id={`${uid}-description`}
            initial={initial.description ?? ""}
            allow={GCS_RICH_FIELDS.clanDescription}
            tools={DESCRIPTION_TOOLS}
            maxLength={GCS_RICH_FIELDS.clanDescription.maxChars}
            imageUrl
            compact
            labelledBy={`${uid}-description-label`}
            onValue={(v) => setDescription(v)}
          />
          {fieldError("description")}
        </div>
        <div className="gcs-clanForm__row">
          {CLAN_LINK_KINDS.map((k) => (
            <div key={k} className="gcs-field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`${uid}-link-${k}`}>{t(`links.${k}`)}</label>
              <input
                id={`${uid}-link-${k}`}
                className="gcs-input"
                type="url"
                inputMode="url"
                value={links[k] ?? ""}
                onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))}
                placeholder={t(`links.${k}Placeholder`)}
                maxLength={300}
              />
              {fieldError(`links.${k}`)}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="gcs-settingsFieldset">
        <legend>{t("sections.recruit")}</legend>
        <div role="radiogroup" aria-label={t("joinMode")} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(["OPEN", "REQUEST", "INVITE"] as const).map((m) => (
            <label key={m} className="gcs-check">
              <input type="radio" name="joinMode" value={m} checked={joinMode === m} onChange={() => setJoinMode(m)} />
              <span>
                <strong>{t(`joinModes.${m}`)}</strong> <span className="gcs-muted">{t(`joinModesHint.${m}`)}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === "edit" && leader && options.officerRights.length > 0 && (
          <div className="gcs-field" role="group" aria-labelledby={`${uid}-rights`}>
            <span id={`${uid}-rights`}>{t("officerRights")}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="gcs-clan-officer-rights">
              {options.officerRights.map((r) => (
                <label key={r} className="gcs-check">
                  <input type="checkbox" checked={rights.includes(r)} onChange={(e) => setRights((list) => (e.target.checked ? [...list, r] : list.filter((x) => x !== r)))} />
                  {t(`rights.${r}`)}
                </label>
              ))}
            </div>
          </div>
        )}
        {mode === "create" && options.forumMode === "optional" && (
          <label className="gcs-check">
            <input type="checkbox" checked={wantForum} onChange={(e) => setWantForum(e.target.checked)} data-testid="gcs-clan-field-forum" />
            {t("wantForum")}
          </label>
        )}
        {mode === "create" && options.forumMode === "auto" && <p className="gcs-field__hint">{t("forumAuto")}</p>}
      </fieldset>

      {mode === "create" && options.requireApproval && (
        <p className="gcs-clanNotice" role="note">
          {t("approvalNote")}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton type="submit" variant="primary" disabled={pending || uploading !== null} icon={<GcsIconSvg icon={mode === "create" ? faPlus : faFloppyDisk} />} data-testid="gcs-clan-submit">
          {mode === "create" ? t("create") : t("save")}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-clanForm__ok" : "gcs-formError"} data-testid="gcs-clan-form-status">
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
