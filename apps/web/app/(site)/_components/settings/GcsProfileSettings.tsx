"use client";

import type { GcsResult } from "@gcs/core";
import { GcsAvatar, GcsButton } from "@gcs/ui";
import { useState } from "react";
import { removeImage, saveProfile, setCoverPosition } from "../../settings-actions";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

export type GcsFieldDef = { key: string; label: string; type: "TEXT" | "TEXTAREA" | "URL" | "NUMBER" | "SELECT" | "IMAGE_SELECT"; options: string[]; required: boolean; maxLength: number; section: "ABOUT" | "GAMES" };

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
};

/** Setări → Profil: câmpurile custom și bio-ul (un singur formular). */
export function GcsProfileFieldsForm({ fields, values, bio, labels }: { fields: GcsFieldDef[]; values: Record<string, string>; bio: string; labels: Labels }) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? ""])));
  const [bioText, setBio] = useState(bio);
  const input = (f: GcsFieldDef) => {
    const common = { id: `field-${f.key}`, name: f.key, value: form[f.key] ?? "", required: f.required, className: "gcs-input" };
    const onChange = (e: { target: { value: string } }) => setForm((s) => ({ ...s, [f.key]: e.target.value }));
    if ((f.type === "SELECT" || f.type === "IMAGE_SELECT")) {
      return (
        <select {...common} onChange={onChange}>
          <option value="">{labels.choose}</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (f.type === "TEXTAREA") return <textarea {...common} maxLength={f.maxLength} onChange={onChange} rows={4} />;
    return <input {...common} type={f.type === "URL" ? "url" : f.type === "NUMBER" ? "number" : "text"} maxLength={f.maxLength} onChange={onChange} />;
  };
  const section = (key: "ABOUT" | "GAMES", title: string) => {
    const list = fields.filter((f) => f.section === key);
    if (list.length === 0) return null;
    return (
      <fieldset className="gcs-settingsFieldset">
        <legend>{title}</legend>
        {list.map((f) => (
          <div key={f.key} className="gcs-field">
            <label htmlFor={`field-${f.key}`}>
              {f.label}
              {f.required && " *"}
            </label>
            {input(f)}
          </div>
        ))}
      </fieldset>
    );
  };

  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveProfile({ bio: bioText, fields: form }));
      }}
    >
      <div className="gcs-field">
        <label htmlFor="settings-bio">{labels.bio}</label>
        <input id="settings-bio" className="gcs-input" maxLength={160} value={bioText} onChange={(e) => setBio(e.target.value)} />
        <p className="gcs-field__hint">{labels.bioHint}</p>
      </div>
      {section("ABOUT", labels.about)}
      {section("GAMES", labels.games)}
      <div>
        <GcsButton type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

/** Încărcarea avatarului sau a cover-ului (prin `/api/profile/images`, fără limita de 1 MB a Server Actions). */
export function GcsImageSetting({
  kind,
  name,
  url,
  positionY,
  allowed,
  accept,
  labels,
}: {
  kind: "avatar" | "cover";
  name: string;
  url: string | null;
  positionY: number;
  allowed: boolean;
  accept: string;
  labels: Labels;
}) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [position, setPosition] = useState(positionY);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("positionY", String(position));
    const res = (await fetch("/api/profile/images", { method: "POST", body }).then((r) => r.json())) as GcsResult<{ url: string }>;
    setUploading(false);
    run(async () => res);
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="gcs-btn gcs-btn--ghost" style={{ cursor: "pointer" }}>
            {labels.upload}
            <input
              type="file"
              accept={accept}
              className="gcs-srOnly"
              data-testid={`gcs-upload-${kind}`}
              disabled={uploading || pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </label>
          {url && (
            <GcsButton variant="ghost" disabled={pending} onClick={() => run(() => removeImage({ kind }))}>
              {labels.remove}
            </GcsButton>
          )}
        </div>
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
