"use client";

import { faImages, faPlay } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatEmbed, GcsChatFile } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type Props = {
  files: GcsChatFile[];
  embeds: GcsChatEmbed[];
  allowImages: boolean;
  allowYoutube: boolean;
  /**
   * Preferințele Chat Pro ale viewer-ului (lipsă = chat-ul standard): GIF-urile pornesc singure sau doar la hover,
   * volumul mesajelor vocale și butonul „Arată media” pe ecranele mici.
   */
  pro?: { autoplayGifs: boolean; volume: number; collapse: boolean };
};

const GIF_URL = /\.gif(?:\?|$)/i;

/**
 * Un GIF oprit (Chat Pro, „Pornește GIF-urile automat” dezactivat): primul cadru desenat pe un canvas, cu insigna „GIF”;
 * la hover (sau în vizualizator) GIF-ul rulează.
 */
function GcsStillGif({ src, alt }: { src: string; alt: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "still" | "playing">("loading");
  if (state === "playing") return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onPointerLeave={() => setState("still")} />;
  return (
    <span className="gcs-chatPro__still" onPointerEnter={() => state === "still" && setState("playing")} data-testid="gcs-chat-still-gif">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        style={state === "still" ? { display: "none" } : { visibility: "hidden" }}
        onLoad={(e) => {
          const img = e.currentTarget;
          const c = canvas.current;
          if (!c || !img.naturalWidth) return;
          const k = Math.min(1, 320 / img.naturalWidth, 200 / img.naturalHeight);
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.style.width = `${Math.round(img.naturalWidth * k)}px`;
          c.style.height = `${Math.round(img.naturalHeight * k)}px`;
          c.getContext("2d")?.drawImage(img, 0, 0);
          setState("still");
        }}
      />
      <canvas ref={canvas} role="img" aria-label={alt} hidden={state !== "still"} />
      <span className="gcs-chatPro__gifBadge" aria-hidden="true">
        GIF
      </span>
    </span>
  );
}

/**
 * Fișierele și embed-urile unui mesaj de chat: imaginile încărcate și cele din linkuri (dacă `chat.allow_images`; un
 * click le deschide în vizualizatorul de imagini al site-ului),
 * mesajele vocale (player) și clipurile YouTube (miniatură; clipul se deschide într-o fereastră, prin
 * `youtube-nocookie`, doar la click).
 */
export function GcsChatMedia({ files, embeds, allowImages, allowYoutube, pro }: Props) {
  const t = useTranslations("chat.ui");
  const [video, setVideo] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const shownEmbeds = embeds.filter((e) => (e.kind === "image" ? allowImages : allowYoutube));
  if (files.length === 0 && shownEmbeds.length === 0) return null;
  const still = (url: string) => pro !== undefined && !pro.autoplayGifs && GIF_URL.test(url);
  const collapsible = pro?.collapse === true && (files.some((f) => f.kind === "image") || shownEmbeds.length > 0);
  return (
    <div className={`gcs-chat__media${collapsible ? " gcs-chat__media--collapsible" : ""}`} data-revealed={revealed ? "" : undefined}>
      {collapsible && !revealed && (
        <button type="button" className="gcs-chatPro__mediaToggle" onClick={() => setRevealed(true)} data-testid="gcs-chat-media-toggle">
          <GcsIconSvg icon={faImages} />
          {t("showMedia")}
        </button>
      )}
      {files.map((f) =>
        f.kind === "image" ? (
          // Un click deschide vizualizatorul de imagini al site-ului (galeria chat-ului).
          <button key={f.id} type="button" className="gcs-chat__image" data-gcs-viewer={`/files/${f.id}`} aria-label={t("image")} data-testid="gcs-chat-image">
            <img src={`/files/${f.id}`} alt={t("image")} loading="lazy" width={f.width ?? undefined} height={f.height ?? undefined} />
          </button>
        ) : (
          <audio
            key={f.id}
            className="gcs-chat__audio"
            controls
            preload="metadata"
            src={`/files/${f.id}`}
            aria-label={t("voiceMessage")}
            data-testid="gcs-chat-audio"
            // Volumul ales în setările Chat Pro.
            ref={pro ? (el) => void (el && (el.volume = Math.min(1, Math.max(0, pro.volume / 100)))) : undefined}
          />
        ),
      )}
      {shownEmbeds.map((e) =>
        e.kind === "image" ? (
          <button key={e.url} type="button" className="gcs-chat__image" data-gcs-viewer={e.url} aria-label={t("image")} data-testid="gcs-chat-image">
            {still(e.url) ? <GcsStillGif src={e.url} alt={t("image")} /> : <img src={e.url} alt={t("image")} loading="lazy" referrerPolicy="no-referrer" />}
          </button>
        ) : (
          <button
            key={e.id}
            type="button"
            className="gcs-chat__youtube"
            onClick={() => setVideo(e.id)}
            aria-label={t("playVideo")}
            data-testid="gcs-chat-youtube"
          >
            <img src={`https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="gcs-chat__play" aria-hidden="true">
              <GcsIconSvg icon={faPlay} />
            </span>
          </button>
        ),
      )}
      {video && <GcsYoutubeDialog id={video} onClose={() => setVideo(null)} label={t("video")} close={t("close")} />}
    </div>
  );
}

function GcsYoutubeDialog({ id, onClose, label, close }: { id: string; onClose: () => void; label: string; close: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="gcs-chat__dialog gcs-chat__dialog--video" aria-label={label} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
        title={label}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <button type="button" className="gcs-chat__dialogClose" onClick={onClose}>
        {close}
      </button>
    </dialog>
  );
}
