"use client";

import { faStar as faStarOutline } from "@fortawesome/free-regular-svg-icons";
import { faMagnifyingGlass, faStar } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatProGif } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

/**
 * Selectorul de GIF-uri Chat Pro (GIPHY sau Tenor, după ACP): GIF-urile populare la deschidere, căutarea, favoritele
 * (steaua) și textul de atribuire cerut de furnizor. Un click trimite GIF-ul în chat.
 */
export function GcsChatProGifs(props: {
  attribution: string;
  favorites: GcsChatProGif[];
  placement: "above" | "below";
  onSend: (gif: GcsChatProGif) => void;
  onToggleFavorite: (gif: GcsChatProGif) => void;
}) {
  const { attribution, favorites, placement, onSend, onToggleFavorite } = props;
  const t = useTranslations("chatPro.gifs");
  const [tab, setTab] = useState<"browse" | "favorites">("browse");
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GcsChatProGif[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    async (q: string) => {
      setStatus(null);
      setGifs(null);
      try {
        const res = await fetch(`/api/chat-pro/gifs${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        const body = (await res.json().catch(() => ({ gifs: [] }))) as { gifs?: GcsChatProGif[] };
        if (!res.ok) setStatus(res.status === 429 ? t("rateLimited") : t("error"));
        setGifs(body.gifs ?? []);
      } catch {
        setStatus(t("error"));
        setGifs([]);
      }
    },
    [t],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const list = tab === "favorites" ? favorites : (gifs ?? []);
  return (
    <div className={`gcs-chat__panel gcs-chatPro__picker gcs-chatPro__gifs gcs-chat__panel--${placement}`} role="dialog" aria-label={t("title")} data-testid="gcs-chatpro-gifs">
      <form
        className="gcs-chatPro__search"
        onSubmit={(e) => {
          e.preventDefault();
          setTab("browse");
          void load(query.trim());
        }}
      >
        <GcsIconSvg icon={faMagnifyingGlass} />
        <input className="gcs-input" placeholder={t("search")} aria-label={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={50} autoFocus />
      </form>
      <div className="gcs-chatPro__tabs" role="tablist" aria-label={t("title")}>
        <button type="button" role="tab" aria-selected={tab === "browse"} className="gcs-chatPro__tab" onClick={() => setTab("browse")}>
          {query.trim() && gifs ? t("results") : t("trending")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "favorites"} className="gcs-chatPro__tab" onClick={() => setTab("favorites")}>
          <GcsIconSvg icon={faStar} /> {t("favorites")}
        </button>
      </div>
      {status && <p className="gcs-chatPro__empty" role="status">{status}</p>}
      <div className="gcs-chatPro__gifGrid" role="tabpanel">
        {tab === "browse" && gifs === null && <p className="gcs-chatPro__empty">{t("loading")}</p>}
        {list.length === 0 && (tab === "favorites" || gifs !== null) && <p className="gcs-chatPro__empty">{tab === "favorites" ? t("noFavorites") : t("none")}</p>}
        {list.map((g) => {
          const fav = favorites.some((f) => f.id === g.id);
          return (
            <span key={g.id} className="gcs-chatPro__gifCell">
              <button type="button" className="gcs-chatPro__gifBtn" aria-label={g.title || "GIF"} onClick={() => onSend(g)} data-testid="gcs-chatpro-gif">
                <img src={g.preview} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
              <button
                type="button"
                className={`gcs-chatPro__fav${fav ? " gcs-chatPro__fav--on" : ""}`}
                aria-pressed={fav}
                aria-label={fav ? t("unfavorite") : t("favorite")}
                onClick={() => onToggleFavorite(g)}
              >
                <GcsIconSvg icon={fav ? faStar : faStarOutline} />
              </button>
            </span>
          );
        })}
      </div>
      <p className="gcs-chat__attribution" data-testid="gcs-chatpro-gif-attribution">
        {attribution}
      </p>
    </div>
  );
}
