"use client";

import { faStar as faStarOutline } from "@fortawesome/free-regular-svg-icons";
import { faChevronLeft, faChevronRight, faMagnifyingGlass, faStar } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatEmotePackView, GcsChatEmoteView } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { GCS_EMOJI } from "../chat/emoji-data";

const PAGE = 40;
type Tab = "favorites" | "emoji" | number;

/**
 * Selectorul de emoticoane Chat Pro: căutare după cod, tab-urile Favorite / pachetele încărcate de admini / Emoji,
 * grila paginată (40 pe pagină) și steaua de favorit pe fiecare emoticon. Un click inserează `:cod:` (sau emoji-ul).
 */
export function GcsChatProEmotes(props: {
  packs: GcsChatEmotePackView[];
  favorites: string[];
  placement: "above" | "below";
  onPick: (text: string) => void;
  onToggleFavorite: (code: string) => void;
}) {
  const { packs, favorites, placement, onPick, onToggleFavorite } = props;
  const t = useTranslations("chatPro.emotes");
  const all = useMemo(() => packs.flatMap((p) => p.emotes), [packs]);
  const byCode = useMemo(() => new Map(all.map((e) => [e.code, e])), [all]);
  const [tab, setTab] = useState<Tab>(favorites.length > 0 ? "favorites" : (packs[0]?.id ?? "emoji"));
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
  const emojiList = GCS_EMOJI.flatMap((c) => c.items);
  let emotes: GcsChatEmoteView[] = [];
  let emoji: string[] = [];
  if (q) emotes = all.filter((e) => e.code.includes(q));
  else if (tab === "favorites") emotes = favorites.map((c) => byCode.get(c)).filter((e): e is GcsChatEmoteView => e !== undefined);
  else if (tab === "emoji") emoji = emojiList;
  else emotes = packs.find((p) => p.id === tab)?.emotes ?? [];
  const items = emoji.length > 0 ? emoji.length : emotes.length;
  const pages = Math.max(1, Math.ceil(items / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = <T,>(list: T[]) => list.slice(current * PAGE, current * PAGE + PAGE);
  const choose = (next: Tab) => {
    setTab(next);
    setPage(0);
    setQuery("");
  };

  return (
    <div className={`gcs-chat__panel gcs-chatPro__picker gcs-chat__panel--${placement}`} role="dialog" aria-label={t("title")} data-testid="gcs-chatpro-emotes">
      <label className="gcs-chatPro__search">
        <GcsIconSvg icon={faMagnifyingGlass} />
        <input
          className="gcs-input"
          placeholder={t("search")}
          aria-label={t("search")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          autoFocus
          maxLength={32}
        />
      </label>
      <div className="gcs-chatPro__tabs gcs-chatPro__tabs--scroll" role="tablist" aria-label={t("categories")}>
        <button type="button" role="tab" aria-selected={!q && tab === "favorites"} className="gcs-chatPro__tab" onClick={() => choose("favorites")} title={t("favorites")}>
          <GcsIconSvg icon={faStar} /> {t("favorites")}
        </button>
        {packs.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={!q && tab === p.id} className="gcs-chatPro__tab" onClick={() => choose(p.id)}>
            {p.name}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={!q && tab === "emoji"} className="gcs-chatPro__tab" onClick={() => choose("emoji")}>
          {t("emoji")}
        </button>
      </div>
      <div className="gcs-chatPro__grid" role="tabpanel" aria-label={q ? t("results") : undefined}>
        {items === 0 && <p className="gcs-chatPro__empty">{q ? t("none") : tab === "favorites" ? t("noFavorites") : t("emptyPack")}</p>}
        {slice(emoji).map((e) => (
          <button key={e} type="button" className="gcs-chatPro__cell gcs-chatPro__cell--emoji" aria-label={e} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
        {slice(emotes).map((e) => {
          const fav = favorites.includes(e.code);
          return (
            <span key={e.id} className="gcs-chatPro__cellWrap">
              <button type="button" className="gcs-chatPro__cell" title={`:${e.code}:`} aria-label={`:${e.code}:`} onClick={() => onPick(`:${e.code}:`)} data-testid="gcs-chatpro-emote">
                <img src={e.url} alt="" loading="lazy" width={e.width} height={e.height} />
              </button>
              <button
                type="button"
                className={`gcs-chatPro__fav${fav ? " gcs-chatPro__fav--on" : ""}`}
                aria-pressed={fav}
                aria-label={fav ? t("unfavorite", { code: e.code }) : t("favorite", { code: e.code })}
                onClick={() => onToggleFavorite(e.code)}
              >
                <GcsIconSvg icon={fav ? faStar : faStarOutline} />
              </button>
            </span>
          );
        })}
      </div>
      {pages > 1 && (
        <div className="gcs-chatPro__pager">
          <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("prevPage")} disabled={current === 0} onClick={() => setPage(current - 1)}>
            <GcsIconSvg icon={faChevronLeft} />
          </button>
          <span>{t("page", { page: current + 1, pages })}</span>
          <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("nextPage")} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            <GcsIconSvg icon={faChevronRight} />
          </button>
        </div>
      )}
    </div>
  );
}
