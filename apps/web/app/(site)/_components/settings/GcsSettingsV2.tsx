"use client";

import { faFloppyDisk, faLink, faLinkSlash, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import type { GcsMemberPrefs, GcsTopicOpen } from "@gcs/modules";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useState } from "react";
import { requestEmailChange, saveMemberPrefs, setDeviceAutoLogin, unlinkAccount } from "../../settings-actions";
import { authClient } from "@/lib/auth-client";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

type BoolPref = Exclude<keyof GcsMemberPrefs, "topicOpen">;

/** Legarea / dezlegarea unui cont (Steam prin OpenID, Discord / Google prin OAuth), pe pagina conexiunii. */
export function GcsConnectionActions({ provider, linked, available, labels }: { provider: "steam" | "discord" | "google"; linked: boolean; available: boolean; labels: { link: string; unlink: string; saved: string; unavailable: string } }) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const back = `/settings/connections/${provider}`;
  if (!linked && !available) return <p className="gcs-muted">{labels.unavailable}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        {linked ? (
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={faLinkSlash} />} disabled={pending} onClick={() => run(() => unlinkAccount({ providerId: provider }))} data-testid={`gcs-unlink-${provider}`}>
            {labels.unlink}
          </GcsButton>
        ) : provider === "steam" ? (
          <GcsButton variant="primary" asChild icon={<GcsIconSvg icon={faLink} />}>
            <a href={`/api/auth/steam/sign-in?callbackURL=${encodeURIComponent(back)}`} data-testid="gcs-link-steam">
              {labels.link}
            </a>
          </GcsButton>
        ) : (
          <GcsButton variant="primary" icon={<GcsIconSvg icon={faLink} />} onClick={() => authClient.linkSocial({ provider, callbackURL: back, errorCallbackURL: back })} data-testid={`gcs-link-${provider}`}>
            {labels.link}
          </GcsButton>
        )}
      </div>
      <GcsStatus status={status} />
    </div>
  );
}

/** Setări → Email: adresa curentă și schimbarea ei (linkul de confirmare pleacă pe adresa nouă). */
export function GcsEmailForm({ email, labels }: { email: string | null; labels: { current: string; none: string; newEmail: string; send: string; sent: string; hint: string } }) {
  const { pending, status, run } = useSettingsAction(labels.sent);
  const [value, setValue] = useState("");
  return (
    <form
      className="gcs-settingsFieldset"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => requestEmailChange({ email: value }), () => setValue(""));
      }}
      data-testid="gcs-email-form"
    >
      <p className="gcs-muted" style={{ margin: 0 }} data-testid="gcs-email-current">
        {email ? labels.current : labels.none}
      </p>
      <div className="gcs-field">
        <label htmlFor="v2-new-email">{labels.newEmail}</label>
        <input id="v2-new-email" type="email" className="gcs-input" value={value} onChange={(e) => setValue(e.target.value)} required autoComplete="email" />
        <p className="gcs-field__hint">{labels.hint}</p>
      </div>
      <div>
        <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faPaperPlane} />} disabled={pending}>
          {labels.send}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

/** Un comutator al preferințelor contului v2 (se salvează la schimbare). */
export function GcsPrefToggle({ name, value, label, hint, saved, testId }: { name: BoolPref; value: boolean; label: string; hint?: string; saved: string; testId?: string }) {
  const { pending, status, run } = useSettingsAction(saved);
  const [on, setOn] = useState(value);
  return (
    <div className="gcs-prefToggle">
      <label className="gcs-check">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            run(() => saveMemberPrefs({ [name]: next }));
          }}
          data-testid={testId ?? `gcs-pref-${name}`}
        />
        {label}
      </label>
      {hint && <p className="gcs-field__hint">{hint}</p>}
      <GcsStatus status={status} />
    </div>
  );
}

/** Setări → Vizualizarea conținutului: unde se deschide un topic din liste (prima necitită, început, ultima postare). */
export function GcsContentViewForm({ value, labels }: { value: GcsTopicOpen; labels: { legend: string; save: string; saved: string; options: Record<GcsTopicOpen, { label: string; hint: string }> } }) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [choice, setChoice] = useState<GcsTopicOpen>(value);
  return (
    <form
      className="gcs-settingsForm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMemberPrefs({ topicOpen: choice }));
      }}
      data-testid="gcs-content-view-form"
    >
      <fieldset className="gcs-settingsFieldset">
        <legend>{labels.legend}</legend>
        <div className="gcs-optionList" role="radiogroup" aria-label={labels.legend}>
          {(["unread", "start", "last"] as const).map((k) => (
            <label key={k} className={`gcs-optionRow${choice === k ? " gcs-optionRow--active" : ""}`}>
              <input type="radio" name="topicOpen" value={k} checked={choice === k} onChange={() => setChoice(k)} data-testid={`gcs-topic-open-${k}`} />
              <span className="gcs-optionRow__text">
                <strong>{labels.options[k].label}</strong>
                <span className="gcs-muted">{labels.options[k].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <GcsButton type="submit" variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} disabled={pending} data-testid="gcs-content-view-save">
          {labels.save}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
    </form>
  );
}

export type GcsDeviceRow = { id: string; name: string; method: string; ip: string | null; location: string | null; firstSeen: string; lastSeen: string; current: boolean; autoLogin: boolean };

/** Setări → Dispozitive: dispozitivele din ultimele 90 de zile, cu autentificarea automată pe fiecare. */
export function GcsDevicesList({ devices, labels }: { devices: GcsDeviceRow[]; labels: { current: string; method: string; location: string; ip: string; firstSeen: string; lastSeen: string; autoLogin: string; autoLoginHint: string; saved: string; empty: string } }) {
  const { pending, status, run } = useSettingsAction(labels.saved);
  const [state, setState] = useState(() => Object.fromEntries(devices.map((d) => [d.id, d.autoLogin])));
  if (devices.length === 0) return <p className="gcs-muted">{labels.empty}</p>;
  return (
    <div className="gcs-settingsForm">
      <ul className="gcs-deviceList" data-testid="gcs-devices">
        {devices.map((d) => (
          <li key={d.id} className="gcs-deviceList__item" data-testid="gcs-device" data-current={d.current ? "true" : undefined}>
            <div className="gcs-deviceList__head">
              <strong>{d.name}</strong>
              {d.current && <span className="gcs-badge gcs-deviceList__current">{labels.current}</span>}
            </div>
            <dl className="gcs-deviceList__meta">
              <div>
                <dt>{labels.method}</dt>
                <dd>{d.method}</dd>
              </div>
              <div>
                <dt>{labels.location}</dt>
                <dd>{d.location ?? "—"}</dd>
              </div>
              <div>
                <dt>{labels.ip}</dt>
                <dd className="gcs-mono">{d.ip ?? "—"}</dd>
              </div>
              <div>
                <dt>{labels.firstSeen}</dt>
                <dd>{d.firstSeen}</dd>
              </div>
              <div>
                <dt>{labels.lastSeen}</dt>
                <dd>{d.lastSeen}</dd>
              </div>
            </dl>
            <label className="gcs-check">
              <input
                type="checkbox"
                checked={state[d.id] ?? true}
                disabled={pending}
                onChange={(e) => {
                  const autoLogin = e.target.checked;
                  setState((s) => ({ ...s, [d.id]: autoLogin }));
                  run(() => setDeviceAutoLogin({ id: d.id, autoLogin }));
                }}
                data-testid="gcs-device-autologin"
              />
              {labels.autoLogin}
            </label>
          </li>
        ))}
      </ul>
      <p className="gcs-field__hint">{labels.autoLoginHint}</p>
      <GcsStatus status={status} />
    </div>
  );
}
