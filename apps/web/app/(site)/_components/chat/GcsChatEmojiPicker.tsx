"use client";

import { faFaceSmile, faHeart, faLightbulb } from "@fortawesome/free-regular-svg-icons";
import { faBurger, faCar, faGamepad, faHand, faPaw } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg, type GcsIconSvgProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { GCS_EMOJI, GCS_EMOTICONS } from "./emoji-data";

const RECENT_KEY = "gcs-chat-recent-emoji";
const MAX_RECENT = 16;

/** Iconița Font Awesome a fiecărei categorii (navigarea din tab-ul „Emoji”). */
const CATEGORY_ICONS: Record<string, GcsIconSvgProps["icon"]> = {
  smileys: faFaceSmile,
  gestures: faHand,
  gaming: faGamepad,
  animals: faPaw,
  food: faBurger,
  travel: faCar,
  objects: faLightbulb,
  symbols: faHeart,
};

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

type Props = {
  /** Deasupra butonului (implicit) sau dedesubt (câmpul de scris e deasupra listei). */
  placement: "above" | "below";
  onPick: (emoji: string) => void;
};

/**
 * Selectorul flotant de emoticoane (după chatbox-ul de referință): tab-urile „Emoticoane” (setul de bază și cele folosite recent)
 * și „Emoji” (toate categoriile într-o listă derulabilă, cu antete lipicioase și navigare pe categorii). Închiderea la
 * click în afară și la Escape o face composer-ul.
 */
export const GcsChatEmojiPicker = forwardRef<HTMLDivElement, Props>(function GcsChatEmojiPicker({ placement, onPick }, ref) {
  const t = useTranslations("chat.ui");
  const id = useId();
  const [mode, setMode] = useState<"emoticons" | "emoji">("emoji");
  const [active, setActive] = useState(GCS_EMOJI[0]!.key);
  const [recent, setRecent] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => setRecent(readRecent()), []);

  const pick = (emoji: string) => {
    onPick(emoji);
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Fără localStorage: lista recentă ține până la închidere.
    }
  };

  /** Click pe o categorie: lista derulează la antetul ei. */
  const jump = (key: string) => {
    setActive(key);
    const box = scroller.current;
    const section = box?.querySelector<HTMLElement>(`[data-category="${key}"]`);
    // Lista are `position: relative`, deci `offsetTop` e față de ea (antetele lipicioase nu se măsoară).
    if (box && section) box.scrollTop = section.offsetTop;
  };

  /** La derulare, categoria vizibilă sus devine cea activă. */
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    let current = GCS_EMOJI[0]!.key;
    for (const section of box.querySelectorAll<HTMLElement>("[data-category]")) {
      if (section.offsetTop <= box.scrollTop + 8) current = section.dataset.category ?? current;
    }
    setActive(current);
  };

  const modeTab = (key: "emoticons" | "emoji") => (
    <button
      type="button"
      role="tab"
      id={`${id}-${key}`}
      aria-selected={mode === key}
      aria-controls={`${id}-${key}-panel`}
      tabIndex={mode === key ? 0 : -1}
      className="gcs-chat__pickerTab"
      onClick={() => setMode(key)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const other = key === "emoji" ? "emoticons" : "emoji";
          setMode(other);
          document.getElementById(`${id}-${other}`)?.focus();
        }
      }}
    >
      {t(`picker.${key}`)}
    </button>
  );

  const emojiButton = (e: string) => (
    <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
      {e}
    </button>
  );

  return (
    <div
      ref={ref}
      className={`gcs-chat__panel gcs-chat__emoji gcs-chat__panel--${placement}`}
      role="dialog"
      aria-label={t("emoji")}
      data-testid="gcs-chat-emoji"
    >
      <div className="gcs-chat__pickerTabs" role="tablist" aria-label={t("emoji")}>
        {modeTab("emoticons")}
        {modeTab("emoji")}
      </div>
      {mode === "emoticons" ? (
        <div className="gcs-chat__emojiScroll" role="tabpanel" id={`${id}-emoticons-panel`} aria-labelledby={`${id}-emoticons`}>
          {recent.length > 0 && (
            <>
              <h3 className="gcs-chat__emojiHead">{t("picker.recent")}</h3>
              <div className="gcs-chat__emojiGrid">{recent.map(emojiButton)}</div>
            </>
          )}
          <h3 className="gcs-chat__emojiHead">{t("picker.popular")}</h3>
          <div className="gcs-chat__emojiGrid">{GCS_EMOTICONS.filter((e) => !recent.includes(e)).map(emojiButton)}</div>
        </div>
      ) : (
        <div role="tabpanel" id={`${id}-emoji-panel`} aria-labelledby={`${id}-emoji`} className="gcs-chat__emojiBody">
          <div className="gcs-chat__cats" role="tablist" aria-label={t("picker.categories")}>
            {GCS_EMOJI.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={active === c.key}
                aria-label={t(`emojiTabs.${c.key}`)}
                title={t(`emojiTabs.${c.key}`)}
                onClick={() => jump(c.key)}
              >
                <GcsIconSvg icon={CATEGORY_ICONS[c.key] ?? faFaceSmile} />
              </button>
            ))}
          </div>
          <div ref={scroller} className="gcs-chat__emojiScroll" onScroll={onScroll} tabIndex={-1}>
            {GCS_EMOJI.map((c) => (
              <section key={c.key} aria-labelledby={`${id}-cat-${c.key}`} data-category={c.key}>
                <h3 id={`${id}-cat-${c.key}`} className="gcs-chat__emojiHead">
                  {t(`emojiTabs.${c.key}`)}
                </h3>
                <div className="gcs-chat__emojiGrid">{c.items.map(emojiButton)}</div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
