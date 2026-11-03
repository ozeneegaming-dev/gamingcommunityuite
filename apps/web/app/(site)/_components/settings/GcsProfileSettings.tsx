
"use client";

import { faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { groupFields, type GcsFieldGroupDef } from "@gcs/modules/field-groups";
import { GcsAvatar, GcsButton, GcsIconSvg } from "@gcs/ui";
import type { GcsEditorTool } from "@gcs/ui/editor";
import { useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { saveBirthday } from "../../profile-actions";
import { removeImage, saveProfile, setCoverPosition } from "../../settings-actions";
import { GcsRichTextInput } from "../editor/GcsRichTextInput";
import { birthdayState, birthdayValue, GcsBirthdayFields, type GcsBirthdayLabels } from "./GcsBirthdayForm";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

export type GcsFieldDef = {
  key: string;
  label: string;
  type: "TEXT" | "TEXTAREA" | "URL" | "NUMBER" | "SELECT" | "IMAGE_SELECT" | "SERVER_SELECT";
  options: string[];
  required: boolean;
  maxLength: number;
  section: "ABOUT" | "GAMES";
  optionImages?: Record<string, string>;
  /** Profil gaming v2: grupul din ACP, textul de ajutor și șablonul linkului de contact (membrul scrie doar handle-ul). */
  groupId?: number | null;
  helper?: string;
  linkTemplate?: string | null;
  position?: number;
};

type Labels = {
  bio: string;
  bioHint: string;
  save: string;
  saved: string;
  choose: string;
  about: string;
  games: string;
  avatar: string;
  cover: string;
  upload: string;
  remove: string;
  position: string;
  coverDenied: string;
  handleHint?: string;
};

/** Bara de unelte a câmpurilor „Text lung” (profilul `profileText`): formatarea textului, listele, linkul, emoji. */
const PROFILE_TEXT_TOOLS: GcsEditorTool[] = ["bold", "italic", "underline", "strike", "color", "highlight", "align", "clear", "bulletList", "orderedList", "link", "emoji"];

/** Grupul în care stă ziua de naștere (cheia stabilă a grupului „De bază”). */
const BASIC_GROUP = "basic";

/**
 * Setări → Editează profilul (setările contului v2): bio-ul, apoi câmpurile pe grupurile definite în ACP (De bază cu ziua
 * de naștere, Despre mine cu serverul preferat, Echipamentul meu, Descriere, Contact), fiecare cu textul lui de ajutor.
 * La contact membrul scrie doar handle-ul (prefixul adresei e afișat lângă câmp). Un singur buton salvează tot.
 */
export function GcsProfileFieldsForm({
  fields,
  groups = [],
  servers = [],
  values,
  docs,
  bio,
  birthday,
  labels,
}: {
  fields: GcsFieldDef[];
  groups?: GcsFieldGroupDef[];
  /** Serverele comunității pentru câmpurile „Server preferat”. */
  servers?: string[];
  values: Record<string, string>;
  /** Documentele câmpurilor „Text lung” scrise deja în editor. */
  docs: Record<string, unknown>;
  bio: string;
  birthday?: { date: string | null; visible: boolean; showYear: boolean; labels: GcsBirthdayLabels } | null;
  labels: Labels;
}) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ""])));
  // „Text lung”: valoarea trimisă e documentul editorului (sau textul vechi, neatins); `""` = golit.
  const [rich, setRich] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.filter((f) => f.type === "TEXTAREA").map((f) => [f.key, docs[f.key] ?? values[f.key] ?? ""])));
  const [bioText, setBio] = useState(bio);
  const [bday, setBday] = useState(() => (birthday ? birthdayState(birthday.date, birthday.visible, birthday.showYear) : null));
  const input = (f: GcsFieldDef) => {
    const describedBy = f.helper ? `field-${f.key}-help` : undefined;
    const common = { id: `field-${f.key}`, name: f.key, value: form[f.key] ?? "", required: f.required, className: "gcs-input", "aria-describedby": describedBy };
    const onChange = (e: { target: { value: string } }) => setForm((s) => ({ ...s, [f.key]: e.target.value }));
    if (f.type === "IMAGE_SELECT") {
      // „Select cu imagini” (etapa 5): opțiunile ca niște carduri cu imagine (radio, merg și din tastatură).
      return (
        <div role="radiogroup" aria-labelledby={`field-${f.key}-label`} className="gcs-imageSelect" id={`field-${f.key}`}>
          {!f.required && (
            <label className="gcs-imageSelect__option">
              <input type="radio" name={f.key} value="" checked={!form[f.key]} onChange={onChange} />
              <span>{labels.choose}</span>
            </label>
          )}
          {f.options.map((o) => (
            <label key={o} className="gcs-imageSelect__option">
              <input type="radio" name={f.key} value={o} checked={form[f.key] === o} onChange={onChange} />
              {f.optionImages?.[o] && <img src={f.optionImages[o]} alt="" />}
              <span>{o}</span>
            </label>
          ))}
        </div>
      );
    }
    if (f.type === "SELECT" || f.type === "SERVER_SELECT") {
      const options = f.type === "SERVER_SELECT" ? [...new Set([...servers, ...(form[f.key] ? [form[f.key]!] : [])])] : f.options;
      return (
        <select {...common} onChange={onChange}>
          <option value="">{labels.choose}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (f.type === "TEXTAREA") {
      return (
        <GcsRichTextInput
          id={`field-${f.key}`}
          initial={rich[f.key] ?? ""}
          allow={GCS_RICH_FIELDS.profileText}
          tools={PROFILE_TEXT_TOOLS}
          maxLength={f.maxLength}
          compact
          labelledBy={`field-${f.key}-label`}
          onValue={(v) => setRich((s) => ({ ...s, [f.key]: v }))}
        />
      );
    }
    if (f.linkTemplate) {
      // Contact: prefixul adresei, apoi doar handle-ul; previzualizarea linkului construit.
      const [prefix, suffix] = f.linkTemplate.split("{handle}");
      const handle = (form[f.key] ?? "").trim().replace(/^@+/, "");
      return (
        <div className="gcs-handleInput">
          <span className="gcs-handleInput__prefix" aria-hidden="true">
            {prefix!.replace(/^https:\/\/(www\.)?/, "")}
          </span>
          <input {...common} type="text" maxLength={f.maxLength} autoComplete="off" spellCheck={false} onChange={onChange} data-testid={`gcs-handle-${f.key}`} />
          {suffix ? <span className="gcs-handleInput__prefix">{suffix}</span> : null}
          {handle && /^[A-Za-z0-9_.-]{1,64}$/.test(handle) && (
            <span className="gcs-handleInput__preview" data-testid={`gcs-handle-preview-${f.key}`}>
              {f.linkTemplate.replace("{handle}", handle)}
            </span>
          )}
        </div>
      );
    }
    return <input {...common} type={f.type === "URL" ? "url" : f.type === "NUMBER" ? "number" : "text"} maxLength={f.maxLength} onChange={onChange} />;
  };

  const grouped = groupFields(groups, fields, (s) => (s === "ABOUT" ? labels.about : labels.games));
  // „De bază” are ziua de naștere, chiar fără alte câmpuri.
  const basic = groups.find((g) => g.key === BASIC_GROUP);
  if (bday && basic && !grouped.some((g) => g.group.key === BASIC_GROUP)) grouped.unshift({ group: basic, fields: [] });

  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await saveProfile({ bio: bioText, fields: { ...form, ...(rich as Record<string, string | Record<string, unknown>>) } });
          if (!res.ok || !bday) return res;
          return saveBirthday({ date: birthdayValue(bday), visible: bday.visible, showYear: bday.showYear && bday.year !== "" });
        });
      }}
      data-testid="gcs-profile-form"
    >
      <div className="gcs-field">
        <label htmlFor="settings-bio">{labels.bio}</label>
        <input id="settings-bio" className="gcs-input" maxLength={160} value={bioText} onChange={(e) => setBio(e.target.value)} />
        <p className="gcs-field__hint">{labels.bioHint}</p>
      </div>
      {grouped.map(({ group, fields: list }) => (
        <fieldset key={group.key} className="gcs-settingsFieldset gcs-fieldGroup" data-testid="gcs-field-group" data-group={group.key}>
          <legend>{group.label}</legend>
          {group.helper && <p className="gcs-field__hint gcs-fieldGroup__helper">{group.helper}</p>}
          {group.key === BASIC_GROUP && bday && birthday && <GcsBirthdayFields value={bday} onChange={setBday} labels={birthday.labels} />}
          {list.map((f) => (
            <div key={f.key} className="gcs-field">
              <label htmlFor={`field-${f.key}`} id={`field-${f.key}-label`}>
                {f.label}
                {f.required && " *"}
              </label>
              {input(f)}
              {f.helper && (
                <p className="gcs-field__hint" id={`field-${f.key}-help`}>
                  {f.helper}
                </p>
              )}
            </div>
          ))}
        </fieldset>
      ))}
      <div>
        <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending} data-testid="gcs-profile-save">
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

/**
 * Încărcarea avatarului sau a cover-ului (prin `/api/profile/images`, fără limita de 1 MB a Server Actions): popupul
 * sistemului verifică tipul, mărimea (limita grupului / a cover-ului, `maxMb`) și arată progresul trimiterii.
 */
export function GcsImageSetting({
  kind,
  name,
  url,
  positionY,
  allowed,
  maxMb,
  labels,
}: {
  kind: "avatar" | "cover";
  name: string;
  url: string | null;
  positionY: number;
  allowed: boolean;
  /** Mărimea maximă acceptată de server, în MB. */
  maxMb: number;
  labels: Labels;
}) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [position, setPosition] = useState(positionY);
  const post = useUploadPost();

  const upload = async (file: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("positionY", String(position));
    const res = await post<{ url: string }>("/api/profile/images", body, onProgress);
    if (!res.ok) return res.error;
    run(async () => ({ ok: true, data: res.data }));
    return null;
  };

  const title = kind === "avatar" ? labels.avatar : labels.cover;
  return (
    <fieldset className="gcs-settingsFieldset" data-testid={`gcs-settings-${kind}`}>
      <legend>{title}</legend>
      {kind === "avatar" ? (
        <GcsAvatar name={name} size="l" {...(url ? { src: url } : {})} />
      ) : (
        <div
          className="gcs-coverPreview"
          style={url ? { background: `center ${position}% / cover no-repeat url(${url})` } : undefined}
          data-testid="gcs-cover-preview"
        />
      )}
      {!allowed ? (
        <p className="gcs-field__hint">{labels.coverDenied}</p>
      ) : (
        <GcsUploadInput
          title={title}
          rules={UPLOAD_RULES.image(maxMb)}
          current={url ? { url, name: title } : null}
          upload={upload}
          disabled={pending}
          {...(url ? { onRemove: () => run(() => removeImage({ kind })) } : {})}
          testId={`gcs-upload-${kind}`}
          className="gcs-imageSetting__upload"
        />
      )}
      {kind === "cover" && url && allowed && (
        <div className="gcs-field">
          <label htmlFor="cover-position">{labels.position}</label>
          <input
            id="cover-position"
            type="range"
            min={0}
            max={100}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            onPointerUp={() => run(() => setCoverPosition({ positionY: position }))}
            onKeyUp={() => run(() => setCoverPosition({ positionY: position }))}
          />
        </div>
      )}
      <GcsStatus status={status} />
    </fieldset>
  );
}
