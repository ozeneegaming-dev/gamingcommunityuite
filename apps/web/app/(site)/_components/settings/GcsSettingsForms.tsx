"use client";

import { faDiscord, faGoogle, faSteam } from "@fortawesome/free-brands-svg-icons";
import { faEnvelope, faFloppyDisk, faKey, faLink, faLinkSlash, faPaperPlane, faRotateLeft, faUserCheck, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsAvatar, GcsButton, GcsIconSvg } from "@gcs/ui";
import { useEffect, useState } from "react";
import {
  changePassword,
  ignoreByName,
  requestEmailChange,
  saveAppearance,
  savePrivacy,
  unignore,
  unlinkAccount,
} from "../../settings-actions";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

const ACCENT_PRESETS = ["#D62839", "#B794FF", "#5EA2FF", "#3DDC97", "#F4B740", "#FF7AC6", "#22D3EE"];

type Option = { id: number; key: string; name: string };

/** Setări → Aspect: rama, stilul numelui și culoarea de accent, cu previzualizare live (înainte de salvare). */
export function GcsAppearanceForm({
  user,
  frames,
  styles,
  current,
  labels,
}: {
  user: { name: string; image: string | null; groupKey: string };
  frames: Option[];
  styles: Option[];
  current: { avatarFrameId: number | null; nameStyleId: number | null; accentColor: string | null };
  labels: { frame: string; noFrame: string; style: string; groupStyle: string; accent: string; defaultAccent: string; save: string; saved: string; preview: string };
}) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [frameId, setFrameId] = useState(current.avatarFrameId);
  const [styleId, setStyleId] = useState(current.nameStyleId);
  const [accent, setAccent] = useState<string | null>(current.accentColor);
  const frameKey = frames.find((f) => f.id === frameId)?.key;
  const nameKey = styles.find((s) => s.id === styleId)?.key ?? user.groupKey;

  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAppearance({ avatarFrameId: frameId, nameStyleId: styleId, accentColor: accent }));
      }}
    >
      <section className="gcs-appearancePreview" aria-label={labels.preview} style={{ borderColor: accent ?? undefined }} data-testid="gcs-appearance-preview">
        <div className="gcs-appearancePreview__cover" style={{ background: `linear-gradient(120deg, ${accent ?? "#D62839"}, transparent)` }} />
        <GcsAvatar name={user.name} size="l" {...(user.image ? { src: user.image } : {})} {...(frameKey ? { frame: frameKey } : {})} />
        <span className={`gcs-display gcs-name--${nameKey}`} style={{ fontSize: 26 }}>
          {user.name}
        </span>
      </section>

      {frames.length > 0 && (
        <fieldset className="gcs-settingsFieldset" data-testid="gcs-frame-options">
          <legend>{labels.frame}</legend>
          <div className="gcs-choiceGrid">
            <label className="gcs-choice">
              <input type="radio" name="frame" checked={frameId === null} onChange={() => setFrameId(null)} />
              <GcsAvatar name={user.name} size="m" {...(user.image ? { src: user.image } : {})} />
              <span>{labels.noFrame}</span>
            </label>
            {frames.map((f) => (
              <label key={f.id} className="gcs-choice">
                <input type="radio" name="frame" value={f.key} checked={frameId === f.id} onChange={() => setFrameId(f.id)} />
                <GcsAvatar name={user.name} size="m" frame={f.key} {...(user.image ? { src: user.image } : {})} />
                <span>{f.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {styles.length > 0 && (
        <fieldset className="gcs-settingsFieldset" data-testid="gcs-style-options">
          <legend>{labels.style}</legend>
          <div className="gcs-choiceGrid">
            <label className="gcs-choice">
              <input type="radio" name="style" checked={styleId === null} onChange={() => setStyleId(null)} />
              <span className={`gcs-name--${user.groupKey}`}>{user.name}</span>
              <span>{labels.groupStyle}</span>
            </label>
            {styles.map((s) => (
              <label key={s.id} className="gcs-choice">
                <input type="radio" name="style" value={s.key} checked={styleId === s.id} onChange={() => setStyleId(s.id)} />
                <span className={`gcs-name--${s.key}`}>{user.name}</span>
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="gcs-settingsFieldset">
        <legend>{labels.accent}</legend>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`gcs-swatch${accent === c ? " gcs-swatch--active" : ""}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={accent === c}
              onClick={() => setAccent(c)}
            />
          ))}
          <input type="color" aria-label={labels.accent} value={accent ?? "#D62839"} onChange={(e) => setAccent(e.target.value.toUpperCase())} className="gcs-swatchInput" data-testid="gcs-accent-input" />
          <GcsButton icon={<GcsIconSvg icon={faRotateLeft} />} variant="ghost" onClick={() => setAccent(null)}>
            {labels.defaultAccent}
          </GcsButton>
        </div>
      </fieldset>
      <div>
        <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

type Privacy = { profile: "PUBLIC" | "MEMBERS" | "FOLLOWED"; messages: "MEMBERS" | "FOLLOWED" | "NOBODY"; wall: "MEMBERS" | "FOLLOWED" | "NOBODY"; showOnline: boolean };

/** Setări → Confidențialitate. */
export function GcsPrivacyForm({ privacy, labels }: { privacy: Privacy; labels: Record<string, string> }) {
  const { pending, status, run } = useSettingsAction(labels.saved!);
  const [value, setValue] = useState(privacy);
  const select = <K extends "profile" | "messages" | "wall">(key: K, options: Privacy[K][]) => (
    <div className="gcs-field">
      <label htmlFor={`privacy-${key}`}>{labels[key]}</label>
      <select id={`privacy-${key}`} className="gcs-input" value={value[key]} onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value as Privacy[K] }))}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[`${key}_${o}`]}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePrivacy(value));
      }}
    >
      {select("profile", ["PUBLIC", "MEMBERS", "FOLLOWED"])}
      {select("messages", ["MEMBERS", "FOLLOWED", "NOBODY"])}
      {select("wall", ["MEMBERS", "FOLLOWED", "NOBODY"])}
      <label className="gcs-checkRow">
        <input type="checkbox" checked={value.showOnline} onChange={(e) => setValue((v) => ({ ...v, showOnline: e.target.checked }))} />
        {labels.showOnline}
      </label>
      <p className="gcs-field__hint">{labels.followedHint}</p>
      <div>
        <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

/** Setări → Ignorați: lista și adăugarea după nume (cu sugestii din `/api/forums/mentions`). */
export function GcsIgnoredForm({ ignored, labels }: { ignored: { id: string; name: string; posts: boolean; messages: boolean }[]; labels: Record<string, string> }) {
  const { pending, status, run } = useSettingsAction(labels.saved!);
  const [name, setName] = useState("");
  const [posts, setPosts] = useState(true);
  const [messages, setMessages] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (name.trim().length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/forums/mentions?q=${encodeURIComponent(name.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<{ users: { name: string }[] }>)
        .then((d) => setSuggestions(d.users.map((u) => u.name)))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [name]);

  return (
    <div className="gcs-settingsForm">
      <form
        className="gcs-settingsFieldset"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => ignoreByName({ name, posts, messages }), () => setName(""));
        }}
      >
        <div className="gcs-field">
          <label htmlFor="ignore-name">{labels.name}</label>
          <input id="ignore-name" className="gcs-input" list="ignore-suggestions" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <datalist id="ignore-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <label className="gcs-checkRow">
          <input type="checkbox" checked={posts} onChange={(e) => setPosts(e.target.checked)} />
          {labels.posts}
        </label>
        <label className="gcs-checkRow">
          <input type="checkbox" checked={messages} onChange={(e) => setMessages(e.target.checked)} />
          {labels.messages}
        </label>
        <div>
          <GcsButton icon={<GcsIconSvg icon={faUserPlus} />} type="submit" variant="primary" disabled={pending || !name.trim()}>
            {labels.add}
          </GcsButton>
        </div>
      </form>
      <GcsStatus status={status} />
      {ignored.length === 0 ? (
        <p className="gcs-muted">{labels.empty}</p>
      ) : (
        <ul className="gcs-settingsList" data-testid="gcs-ignored-list">
          {ignored.map((u) => (
            <li key={u.id}>
              <span>
                <strong>{u.name}</strong>{" "}
                <span className="gcs-muted">
                  · {[u.posts ? labels.posts : null, u.messages ? labels.messages : null].filter(Boolean).join(", ")}
                </span>
              </span>
              <GcsButton icon={<GcsIconSvg icon={faUserCheck} />} variant="ghost" disabled={pending} onClick={() => run(() => unignore({ userId: u.id }))}>
                {labels.remove}
              </GcsButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Setări → Cont: emailul (cu confirmare), parola și conturile legate. */
export function GcsAccountForms({
  email,
  hasPassword,
  accounts,
  labels,
}: {
  email: string | null;
  hasPassword: boolean;
  accounts: { providerId: "discord" | "google" | "steam" }[];
  labels: Record<string, string>;
}) {
  const emailAction = useSettingsAction(labels.emailSent!);
  const passwordAction = useSettingsAction(labels.passwordChanged!);
  const linkAction = useSettingsAction(labels.saved!);
  const [newEmail, setNewEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <div className="gcs-settingsForm">
      <form
        className="gcs-settingsFieldset"
        onSubmit={(e) => {
          e.preventDefault();
          emailAction.run(() => requestEmailChange({ email: newEmail }), () => setNewEmail(""));
        }}
      >
        <h2 className="gcs-settingsTitle">
          <GcsIconSvg icon={faEnvelope} className="gcs-hIcon" />
          {labels.emailTitle}
        </h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          {email ? labels.currentEmail : labels.noEmail}
        </p>
        <div className="gcs-field">
          <label htmlFor="new-email">{labels.newEmail}</label>
          <input id="new-email" type="email" className="gcs-input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
        </div>
        <div>
          <GcsButton icon={<GcsIconSvg icon={faPaperPlane} />} type="submit" variant="primary" disabled={emailAction.pending}>
            {labels.sendLink}
          </GcsButton>
        </div>
        <GcsStatus status={emailAction.status} />
      </form>

      {hasPassword && (
        <form
          className="gcs-settingsFieldset"
          onSubmit={(e) => {
            e.preventDefault();
            passwordAction.run(() => changePassword({ currentPassword: current, newPassword: next }), () => {
              setCurrent("");
              setNext("");
            });
          }}
        >
          <h2 className="gcs-settingsTitle">
            <GcsIconSvg icon={faKey} className="gcs-hIcon" />
            {labels.passwordTitle}
          </h2>
          <div className="gcs-field">
            <label htmlFor="current-password">{labels.currentPassword}</label>
            <input id="current-password" type="password" autoComplete="current-password" className="gcs-input" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="gcs-field">
            <label htmlFor="new-password">{labels.newPassword}</label>
            <input id="new-password" type="password" autoComplete="new-password" minLength={8} className="gcs-input" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div>
            <GcsButton icon={<GcsIconSvg icon={faKey} />} type="submit" variant="primary" disabled={passwordAction.pending}>
              {labels.changePassword}
            </GcsButton>
          </div>
          <GcsStatus status={passwordAction.status} />
        </form>
      )}

      <section className="gcs-settingsFieldset">
        <h2 className="gcs-settingsTitle">
          <GcsIconSvg icon={faLink} className="gcs-hIcon" />
          {labels.linkedTitle}
        </h2>
        {(["discord", "google", "steam"] as const).map((p) => {
          const linked = accounts.some((a) => a.providerId === p);
          return (
            <div key={p} className="gcs-settingsList__row">
              <span>
                <GcsIconSvg icon={p === "discord" ? faDiscord : p === "google" ? faGoogle : faSteam} className="gcs-hIcon" />
                <strong>{p === "discord" ? "Discord" : p === "google" ? "Google" : "Steam"}</strong> <span className="gcs-muted">· {linked ? labels.linked : labels.notLinked}</span>
              </span>
              {linked && (
                <GcsButton icon={<GcsIconSvg icon={faLinkSlash} />} variant="ghost" disabled={linkAction.pending} onClick={() => linkAction.run(() => unlinkAccount({ providerId: p }))}>
                  {labels.unlink}
                </GcsButton>
              )}
            </div>
          );
        })}
        <GcsStatus status={linkAction.status} />
      </section>
    </div>
  );
}
