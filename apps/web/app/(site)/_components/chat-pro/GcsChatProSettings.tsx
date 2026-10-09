"use client";

import { faGear, faMagnifyingGlass, faPalette, faRobot, faSliders, faUser } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatProCommand, GcsChatProEarnedBadge, GcsChatProPrefs, GcsUserRef } from "@gcs/modules";
import {
  CHAT_PRO_COLOR_ELEMENTS,
  CHAT_PRO_COMMANDS,
  CHAT_PRO_EMOJI,
  CHAT_PRO_HEIGHT,
  CHAT_PRO_LAYOUTS,
  DEFAULT_CHAT_PRO_PREFS,
  type GcsChatProColorElement,
  type GcsChatProLayout,
} from "@gcs/modules/chat-pro-prefs";
import { GcsBadgeArt, GcsButton, GcsIconSvg, GcsModal, GcsMemberName, type GcsIconSvgProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useErrorMessage } from "@/lib/use-error-message";
import { ignoreChatUser } from "../../chat-actions";
import { loadChatIgnored, saveChatProBadges, saveChatProNickname } from "../../chat-pro-actions";
import { GcsColorPicker } from "./GcsColorPicker";

type Section = "prefs" | "bot" | "layout" | "account";
const SECTIONS: { key: Section; icon: GcsIconSvgProps["icon"] }[] = [
  { key: "prefs", icon: faSliders },
  { key: "bot", icon: faRobot },
  { key: "layout", icon: faPalette },
  { key: "account", icon: faUser },
];
/** Culorile de pornire ale selectorului, pe element, când membrul nu a ales încă una (tonuri ale temei Nova). */
const FALLBACK: Record<GcsChatProColorElement, string> = {
  messageBg: "#1A1F29FF",
  messageBorder: "#1E2533FF",
  messageText: "#CED5DEFF",
  chatBg: "#151922FF",
  header: "#1A1F29FF",
  ranking: "#1A1F29FF",
  input: "#0B0F17FF",
  buttons: "#202630FF",
  accent: "#DF390CFF",
  uiBorder: "#1E2533FF",
  uiText: "#CED5DEFF",
};

type Row = { section: Section; key: string; label: string; hint?: string; control: ReactNode; wide?: boolean };

/**
 * Setările de chat ale membrului (Chat Pro), salvate pe server: Preferințe, Bot, Aranjament și Cont, cu o căutare care
 * filtrează rândurile din toate secțiunile. Schimbările se văd pe loc în chat (doar pentru el).
 */
export function GcsChatProSettings(props: {
  prefs: GcsChatProPrefs;
  onPrefs: (patch: Partial<GcsChatProPrefs> | Record<string, unknown>) => void;
  nickname: string | null;
  onNickname: (nickname: string | null) => void;
  earned: GcsChatProEarnedBadge[];
  badgeIds: number[];
  onBadges: (ids: number[]) => void;
  commands: GcsChatProCommand[];
  voteAvailable: boolean;
  acpHref?: string | null;
  onClose: () => void;
}) {
  const { prefs, onPrefs, earned, commands, voteAvailable, onClose } = props;
  const t = useTranslations("chatPro.settings");
  const errorMessage = useErrorMessage();
  const id = useId();
  const [section, setSection] = useState<Section>("prefs");
  const [query, setQuery] = useState("");
  const [element, setElement] = useState<GcsChatProColorElement>("messageBg");
  const [nick, setNick] = useState(props.nickname ?? "");
  const [nickStatus, setNickStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [badgeIds, setBadgeIds] = useState(props.badgeIds);
  const [badgeStatus, setBadgeStatus] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<GcsUserRef[] | null>(null);

  useEffect(() => {
    if (section === "account" && ignored === null) void loadChatIgnored({}).then((r) => setIgnored(r.ok ? r.data : []));
  }, [section, ignored]);

  const toggle = (key: keyof GcsChatProPrefs, label: string, hint?: string, extra: { disabled?: boolean } = {}): Row => ({
    section: "prefs",
    key,
    label,
    ...(hint ? { hint } : {}),
    control: (
      <input
        type="checkbox"
        role="switch"
        className="gcs-chat__switch"
        checked={prefs[key] === true}
        disabled={extra.disabled}
        aria-label={label}
        onChange={(e) => onPrefs({ [key]: e.target.checked })}
        data-testid={`gcs-chatpro-pref-${key}`}
      />
    ),
  });
  const slider = (key: "voiceVolume" | "height" | "emojiSize", label: string, min: number, max: number, unit: string, section: Section): Row => ({
    section,
    key,
    label,
    wide: true,
    control: (
      <span className="gcs-chatPro__sliderRow">
        <input type="range" min={min} max={max} value={prefs[key]} aria-label={label} onChange={(e) => onPrefs({ [key]: Number(e.target.value) })} data-testid={`gcs-chatpro-pref-${key}`} />
        <output>
          {prefs[key]}
          {unit}
        </output>
        <GcsButton variant="ghost" size="sm" onClick={() => onPrefs({ [key]: DEFAULT_CHAT_PRO_PREFS[key] })}>
          {t("reset")}
        </GcsButton>
      </span>
    ),
  });

  const rows: Row[] = [
    toggle("sound", t("sound"), t("soundHint")),
    slider("voiceVolume", t("voiceVolume"), 0, 100, "%", "prefs"),
    toggle("autoplayGifs", t("autoplayGifs"), t("autoplayGifsHint")),
    toggle("linkPreviews", t("linkPreviews"), t("linkPreviewsHint")),
    toggle("showTyping", t("showTyping"), t("showTypingHint")),
    toggle("shareTyping", t("shareTyping"), t("shareTypingHint")),
    toggle("ignoredPlaceholder", t("ignoredPlaceholder"), t("ignoredPlaceholderHint")),
    toggle("mentionAlerts", t("mentionAlerts"), t("mentionAlertsHint")),
    toggle("autoscroll", t("autoscroll"), t("autoscrollHint")),
    toggle("hideBar", t("hideBar"), t("hideBarHint")),
    toggle("showRanking", t("showRanking"), t("showRankingHint")),
    toggle("mobileMediaButtons", t("mobileMediaButtons"), t("mobileMediaButtonsHint")),
    { ...toggle("voteReminders", t("voteReminders"), voteAvailable ? t("voteRemindersHint") : t("voteOff"), { disabled: !voteAvailable }), section: "bot" },
    ...CHAT_PRO_COMMANDS.map(
      (c): Row => ({
        section: "bot",
        key: `command-${c}`,
        label: t(`commands.${c}`),
        hint: commands.includes(c) ? t(`commands.${c}Hint`) : t("commandOff"),
        control: (
          <input
            type="checkbox"
            role="switch"
            className="gcs-chat__switch"
            checked={prefs.commandResults[c]}
            aria-label={t(`commands.${c}`)}
            onChange={(e) => onPrefs({ commandResults: { [c]: e.target.checked } })}
            data-testid={`gcs-chatpro-command-${c}`}
          />
        ),
      }),
    ),
    {
      section: "layout",
      key: "position",
      label: t("position"),
      hint: t("positionHint"),
      control: (
        <select className="gcs-input" value={prefs.position} aria-label={t("position")} onChange={(e) => onPrefs({ position: e.target.value })} data-testid="gcs-chatpro-pref-position">
          {(["auto", "top", "bottom"] as const).map((p) => (
            <option key={p} value={p}>
              {t(`positions.${p}`)}
            </option>
          ))}
        </select>
      ),
    },
    {
      section: "layout",
      key: "layout",
      label: t("layout"),
      hint: t("layoutHint"),
      wide: true,
      control: (
        <div className="gcs-chatPro__layouts" role="radiogroup" aria-label={t("layout")}>
          {CHAT_PRO_LAYOUTS.map((l: GcsChatProLayout) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={prefs.layout === l}
              className={`gcs-chatPro__layoutTile${prefs.layout === l ? " gcs-chatPro__layoutTile--on" : ""}`}
              onClick={() => onPrefs({ layout: l })}
              data-testid={`gcs-chatpro-layout-${l}`}
            >
              <span className={`gcs-chatPro__layoutIcon gcs-chatPro__layoutIcon--${l}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t(`layouts.${l}`)}
            </button>
          ))}
        </div>
      ),
    },
    {
      section: "layout",
      key: "accent",
      label: t("accent"),
      hint: t("accentHint"),
      control: (
        <span className="gcs-chatPro__sliderRow">
          <input type="color" value={prefs.accent ?? "#DF390C"} aria-label={t("accent")} onChange={(e) => onPrefs({ accent: e.target.value.toUpperCase() })} data-testid="gcs-chatpro-pref-accent" />
          <GcsButton variant="ghost" size="sm" onClick={() => onPrefs({ accent: null })}>
            {t("reset")}
          </GcsButton>
        </span>
      ),
    },
    {
      section: "layout",
      key: "colors",
      label: t("colors"),
      hint: t("colorsHint"),
      wide: true,
      control: (
        <div className="gcs-chatPro__colors">
          <label className="gcs-field">
            {t("element")}
            <select className="gcs-input" value={element} onChange={(e) => setElement(e.target.value as GcsChatProColorElement)} data-testid="gcs-chatpro-color-element">
              {CHAT_PRO_COLOR_ELEMENTS.map((el) => (
                <option key={el} value={el}>
                  {t(`elements.${el}`)}
                  {prefs.colors[el] ? " •" : ""}
                </option>
              ))}
            </select>
          </label>
          <GcsColorPicker
            value={prefs.colors[element] ?? null}
            fallback={FALLBACK[element]}
            onChange={(hex) => onPrefs({ colors: { [element]: hex } })}
            onReset={() => onPrefs({ colors: { [element]: null } })}
            labels={{ area: t("colorArea"), hue: t("hue"), opacity: t("opacity"), hex: "HEX", reset: t("reset") }}
          />
        </div>
      ),
    },
    slider("height", t("height"), CHAT_PRO_HEIGHT.min, CHAT_PRO_HEIGHT.max, "px", "layout"),
    slider("emojiSize", t("emojiSize"), CHAT_PRO_EMOJI.min, CHAT_PRO_EMOJI.max, "px", "layout"),
    {
      section: "account",
      key: "nickname",
      label: t("nickname"),
      hint: t("nicknameHint"),
      wide: true,
      control: (
        <form
          className="gcs-chatPro__inline"
          onSubmit={(e) => {
            e.preventDefault();
            void saveChatProNickname({ nickname: nick }).then((r) => {
              if (!r.ok) return setNickStatus({ ok: false, text: errorMessage(r.error) });
              props.onNickname(r.data);
              setNickStatus({ ok: true, text: t("saved") });
            });
          }}
        >
          <input className="gcs-input" value={nick} maxLength={24} onChange={(e) => setNick(e.target.value)} aria-label={t("nickname")} placeholder={t("nicknamePlaceholder")} data-testid="gcs-chatpro-nickname" />
          <GcsButton type="submit" variant="primary" size="sm">
            {t("save")}
          </GcsButton>
          {nickStatus && (
            <span role="status" className={nickStatus.ok ? "gcs-chatPro__ok" : "gcs-chatPro__err"}>
              {nickStatus.text}
            </span>
          )}
        </form>
      ),
    },
    {
      section: "account",
      key: "badges",
      label: t("badges"),
      hint: t("badgesHint"),
      wide: true,
      control:
        earned.length === 0 ? (
          <p className="gcs-chatPro__empty">{t("noBadges")}</p>
        ) : (
          <div className="gcs-chatPro__badgePick" data-testid="gcs-chatpro-badges">
            {earned.map((b) => {
              const on = badgeIds.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  className={`gcs-chatPro__badgeChip${on ? " gcs-chatPro__badgeChip--on" : ""}`}
                  disabled={!on && badgeIds.length >= 2}
                  onClick={() => {
                    const next = on ? badgeIds.filter((x) => x !== b.id) : [...badgeIds, b.id];
                    void saveChatProBadges({ ids: next }).then((r) => {
                      if (!r.ok) return setBadgeStatus(errorMessage(r.error));
                      setBadgeIds(r.data);
                      props.onBadges(r.data);
                      setBadgeStatus(null);
                    });
                  }}
                >
                  <GcsBadgeArt badge={b} size={24} decorative />
                  {b.name}
                </button>
              );
            })}
            {badgeStatus && <span role="alert">{badgeStatus}</span>}
          </div>
        ),
    },
    {
      section: "account",
      key: "ignored",
      label: t("ignored"),
      hint: t("ignoredHint"),
      wide: true,
      control:
        ignored === null ? (
          <p className="gcs-chatPro__empty">{t("loading")}</p>
        ) : ignored.length === 0 ? (
          <p className="gcs-chatPro__empty">{t("noIgnored")}</p>
        ) : (
          <ul className="gcs-chatPro__ignored">
            {ignored.map((u) => (
              <li key={u.id}>
                <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
                <GcsButton variant="ghost" size="sm" onClick={() => void ignoreChatUser({ userId: u.id, ignore: false }).then((r) => r.ok && setIgnored(ignored.filter((x) => x.id !== u.id)))}>
                  {t("unignore")}
                </GcsButton>
              </li>
            ))}
          </ul>
        ),
    },
    { ...toggle("disabled", t("disable"), t("disableHint")), section: "account" },
  ];

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => `${r.label} ${r.hint ?? ""}`.toLowerCase().includes(q)) : rows.filter((r) => r.section === section);

  return (
    <GcsModal title={t("title")} icon={<GcsIconSvg icon={faGear} />} onClose={onClose} closeLabel={t("close")} size="lg" className="gcs-chatPro__settings">
      <label className="gcs-chatPro__search gcs-chatPro__search--settings">
        <GcsIconSvg icon={faMagnifyingGlass} />
        <input className="gcs-input" type="search" placeholder={t("search")} aria-label={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="gcs-chatpro-settings-search" />
      </label>
      <div className="gcs-chatPro__settingsBody">
        <nav className="gcs-chatPro__settingsNav" aria-label={t("sections")}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`gcs-chatPro__settingsTab${!q && section === s.key ? " gcs-chatPro__settingsTab--on" : ""}`}
              aria-current={!q && section === s.key ? "true" : undefined}
              onClick={() => {
                setQuery("");
                setSection(s.key);
              }}
              data-testid={`gcs-chatpro-settings-${s.key}`}
            >
              <GcsIconSvg icon={s.icon} />
              {t(`sectionNames.${s.key}`)}
            </button>
          ))}
        </nav>
        <section className="gcs-chatPro__settingsPanel" aria-labelledby={`${id}-title`}>
          <h3 id={`${id}-title`} className="gcs-chatPro__settingsTitle">
            {q ? t("results") : t(`sectionNames.${section}`)}
          </h3>
          {visible.length === 0 && <p className="gcs-chatPro__empty">{t("noResults")}</p>}
          {visible.map((r) => (
            <div key={r.key} className={`gcs-chatPro__setRow${r.wide ? " gcs-chatPro__setRow--wide" : ""}`} data-testid={`gcs-chatpro-row-${r.key}`}>
              <div className="gcs-chatPro__setText">
                <span className="gcs-chatPro__setLabel">{r.label}</span>
                {r.hint && <span className="gcs-chatPro__setHint">{r.hint}</span>}
              </div>
              <div className="gcs-chatPro__setControl">{r.control}</div>
            </div>
          ))}
          {props.acpHref && !q && section === "prefs" && (
            <p className="gcs-chatPro__setHint">
              <a href={props.acpHref}>{t("acp")}</a>
            </p>
          )}
        </section>
      </div>
    </GcsModal>
  );
}
