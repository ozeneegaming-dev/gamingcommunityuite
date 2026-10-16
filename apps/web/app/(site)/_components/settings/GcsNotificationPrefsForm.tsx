"use client";

import { faFloppyDisk, faLock, faRotateLeft, faStar, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { resetNotificationPreferences, saveNotificationPreferences } from "../../notification-actions";
import { GcsStatus } from "./GcsStatus";
import { useSettingsAction } from "./useSettingsAction";

type State = "on" | "important" | "off";
type Mode = "instant" | "daily" | "weekly";
type Channel = "site" | "toast" | "email" | "push";
type Channels = Record<Channel, State> & { emailMode: Mode };
type Locks = Partial<Record<Channel, "forced" | "disabled">>;

export type GcsNotificationPrefType = {
  type: string;
  label: string;
  important: boolean;
  defaults: Channels & { locks: Locks };
  effective: Channels;
  override: Partial<Channels>;
};
export type GcsNotificationPrefCategory = { key: string; label: string; icon: ReactNode; types: GcsNotificationPrefType[] };

const CHANNELS: Channel[] = ["site", "toast", "email", "push"];
const STATES: State[] = ["on", "important", "off"];
const MODES: Mode[] = ["instant", "daily", "weekly"];

/** Valorile implicite cu blocările aplicate (ce vede membrul după „Resetează la implicit”). */
function defaultsOf(d: GcsNotificationPrefType["defaults"]): Channels {
  const out: Channels = { site: d.site, toast: d.toast, email: d.email, push: d.push, emailMode: d.emailMode };
  for (const ch of CHANNELS) {
    if (d.locks[ch] === "forced") out[ch] = "on";
    else if (d.locks[ch] === "disabled") out[ch] = "off";
  }
  return out;
}

/**
 * Setări → Notificări (Notificări v2): pentru fiecare categorie (cu tipurile aplicațiilor active), pe fiecare tip,
 * starea fiecărui canal (pornit / doar important / oprit) și modul emailului (imediat / zilnic / săptămânal). Un canal
 * blocat din ACP e afișat dezactivat, cu lacătul și motivul. „Toate” schimbă dintr-odată tipurile categoriei.
 */
export function GcsNotificationPrefsForm({ categories }: { categories: GcsNotificationPrefCategory[] }) {
  const t = useTranslations("settings.notifications");
  const { pending, status, run } = useSettingsAction(t("saved"));
  const all = categories.flatMap((c) => c.types);
  const [value, setValue] = useState<Record<string, Channels>>(() => Object.fromEntries(all.map((r) => [r.type, { ...r.effective }])));
  const [confirm, setConfirm] = useState(false);
  const byType = new Map(all.map((r) => [r.type, r]));

  const set = (type: string, patch: Partial<Channels>) => setValue((v) => ({ ...v, [type]: { ...v[type]!, ...patch } }));
  const setCategory = (cat: GcsNotificationPrefCategory, ch: Channel | "emailMode", next: string) =>
    setValue((v) => {
      const out = { ...v };
      for (const r of cat.types) {
        if (ch !== "emailMode" && r.defaults.locks[ch]) continue;
        if (ch === "emailMode" && r.defaults.locks.email === "disabled") continue;
        out[r.type] = { ...out[r.type]!, [ch]: next } as Channels;
      }
      return out;
    });

  const lockText = (lock: "forced" | "disabled") => (lock === "forced" ? t("lockForced") : t("lockDisabled"));

  return (
    <form
      className="gcs-settingsForm gcs-prefGrid"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveNotificationPreferences({ prefs: value }));
      }}
      data-testid="gcs-notif-prefs"
    >
      <div className="gcs-prefGrid__legend">
        <span>
          <strong>{t("state_on")}</strong> — {t("legend_on")}
        </span>
        <span>
          <strong>{t("state_important")}</strong> — {t("legend_important")}
        </span>
        <span>
          <strong>{t("state_off")}</strong> — {t("legend_off")}
        </span>
      </div>
      {categories.map((cat) => (
        <details key={cat.key} className="gcs-prefGrid__category" open data-testid={`gcs-pref-category-${cat.key}`}>
          <summary className="gcs-prefGrid__summary">
            <span className="gcs-prefGrid__catIcon" aria-hidden="true">
              {cat.icon}
            </span>
            <span className="gcs-prefGrid__catName">{cat.label}</span>
            <span className="gcs-prefGrid__catCount">{cat.types.length}</span>
          </summary>
          <div className="gcs-prefGrid__table" role="table" aria-label={cat.label}>
            <div className="gcs-prefGrid__row gcs-prefGrid__row--head" role="row">
              <span role="columnheader">{t("type")}</span>
              {CHANNELS.map((ch) => (
                <span key={ch} role="columnheader">
                  {t(`channel_${ch}`)}
                </span>
              ))}
              <span role="columnheader">{t("emailMode")}</span>
            </div>
            {cat.types.length > 1 && (
              <div className="gcs-prefGrid__row gcs-prefGrid__row--bulk" role="row">
                <span role="rowheader" className="gcs-prefGrid__label">
                  {t("allInCategory")}
                </span>
                {CHANNELS.map((ch) => (
                  <span key={ch} role="cell" className="gcs-prefGrid__cell">
                    <span className="gcs-prefGrid__cellLabel">{t(`channel_${ch}`)}</span>
                    <select className="gcs-input gcs-prefGrid__select" aria-label={`${t(`channel_${ch}`)}: ${t("allInCategory")} (${cat.label})`} value="" onChange={(e) => e.target.value && setCategory(cat, ch, e.target.value)}>
                      <option value="">—</option>
                      {STATES.map((s) => (
                        <option key={s} value={s}>
                          {t(`state_${s}`)}
                        </option>
                      ))}
                    </select>
                  </span>
                ))}
                <span role="cell" className="gcs-prefGrid__cell">
                  <span className="gcs-prefGrid__cellLabel">{t("emailMode")}</span>
                  <select className="gcs-input gcs-prefGrid__select" aria-label={`${t("emailMode")}: ${t("allInCategory")} (${cat.label})`} value="" onChange={(e) => e.target.value && setCategory(cat, "emailMode", e.target.value)}>
                    <option value="">—</option>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`mode_${m}`)}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            )}
            {cat.types.map((r) => {
              const v = value[r.type]!;
              const emailOff = v.email === "off" || r.defaults.locks.email === "disabled";
              return (
                <div key={r.type} className="gcs-prefGrid__row" role="row" data-testid={`gcs-pref-${r.type}`}>
                  <span role="rowheader" className="gcs-prefGrid__label">
                    {r.label}
                    {r.important && (
                      <span className="gcs-prefGrid__important" title={t("importantType")}>
                        <GcsIconSvg icon={faStar} />
                        <span className="gcs-srOnly">{t("importantType")}</span>
                      </span>
                    )}
                  </span>
                  {CHANNELS.map((ch) => {
                    const lock = r.defaults.locks[ch];
                    const name = `${t(`channel_${ch}`)}: ${r.label}`;
                    return (
                      <span key={ch} role="cell" className={`gcs-prefGrid__cell${lock ? " gcs-prefGrid__cell--locked" : ""}`}>
                        <span className="gcs-prefGrid__cellLabel">{t(`channel_${ch}`)}</span>
                        <select
                          className="gcs-input gcs-prefGrid__select"
                          aria-label={name}
                          value={v[ch]}
                          disabled={!!lock}
                          onChange={(e) => set(r.type, { [ch]: e.target.value as State } as Partial<Channels>)}
                          data-testid={`gcs-pref-${r.type}-${ch}`}
                        >
                          {STATES.map((s) => (
                            <option key={s} value={s}>
                              {t(`state_${s}`)}
                            </option>
                          ))}
                        </select>
                        {lock && (
                          <span className="gcs-prefGrid__lock" title={lockText(lock)} data-testid={`gcs-pref-${r.type}-${ch}-lock`}>
                            <GcsIconSvg icon={faLock} />
                            <span className="gcs-srOnly">{lockText(lock)}</span>
                          </span>
                        )}
                      </span>
                    );
                  })}
                  <span role="cell" className="gcs-prefGrid__cell">
                    <span className="gcs-prefGrid__cellLabel">{t("emailMode")}</span>
                    <select
                      className="gcs-input gcs-prefGrid__select"
                      aria-label={`${t("emailMode")}: ${r.label}`}
                      value={v.emailMode}
                      disabled={emailOff}
                      onChange={(e) => set(r.type, { emailMode: e.target.value as Mode })}
                      data-testid={`gcs-pref-${r.type}-emailMode`}
                    >
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(`mode_${m}`)}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      ))}
      <div className="gcs-prefGrid__actions">
        <GcsButton icon={<GcsIconSvg icon={faFloppyDisk} />} type="submit" variant="primary" disabled={pending}>
          {t("save")}
        </GcsButton>
        <GcsButton icon={<GcsIconSvg icon={faRotateLeft} />} variant="ghost" disabled={pending} onClick={() => setConfirm(true)} data-testid="gcs-pref-reset">
          {t("reset")}
        </GcsButton>
      </div>
      <GcsStatus status={status} />
      {confirm && (
        <GcsModal title={t("reset")} icon={<GcsIconSvg icon={faTriangleExclamation} />} size="sm" closeLabel={t("cancel")} onClose={() => setConfirm(false)}>
          <div className="gcs-confirmDialog" data-testid="gcs-confirm-dialog">
            <div className="gcs-confirmDialog__text">{t("resetConfirm")}</div>
            <div className="gcs-confirmDialog__actions">
              <GcsButton variant="ghost" onClick={() => setConfirm(false)} data-testid="gcs-confirm-cancel">
                {t("cancel")}
              </GcsButton>
              <GcsButton
                variant="primary"
                icon={<GcsIconSvg icon={faRotateLeft} />}
                disabled={pending}
                onClick={() => {
                  setConfirm(false);
                  run(
                    () => resetNotificationPreferences({}),
                    () => setValue(Object.fromEntries([...byType.values()].map((r) => [r.type, defaultsOf(r.defaults)]))),
                    t("resetDone"),
                  );
                }}
                data-testid="gcs-confirm-ok"
              >
                {t("reset")}
              </GcsButton>
            </div>
          </div>
        </GcsModal>
      )}
    </form>
  );
}
