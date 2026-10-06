"use client";

import { faPlay } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatEmbed, GcsChatFile } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type Props = {
  files: GcsChatFile[];
  embeds: GcsChatEmbed[];
  allowImages: boolean;
  allowYoutube: boolean;
};

/**
 * Fișierele și embed-urile unui mesaj de chat: imaginile încărcate și cele din linkuri (dacă `chat.allow_images`),
 * mesajele vocale (player) și clipurile YouTube (miniatură; clipul se deschide într-o fereastră, prin
 * `youtube-nocookie`, doar la click).
 */
export function GcsChatMedia({ files, embeds, allowImages, allowYoutube }: Props) {
  const t = useTranslations("chat.ui");
  const [video, setVideo] = useState<string | null>(null);
  const shownEmbeds = embeds.filter((e) => (e.kind === "image" ? allowImages : allowYoutube));
  if (files.length === 0 && shownEmbeds.length === 0) return null;
  return (
    <div className="gcs-chat__media">
      {files.map((f) =>
        f.kind === "image" ? (
          <a key={f.id} href={`/files/${f.id}`} target="_blank" rel="noopener" className="gcs-chat__image">
            <img src={`/files/${f.id}`} alt={t("image")} loading="lazy" width={f.width ?? undefined} height={f.height ?? undefined} />
          </a>
        ) : (
          <audio key={f.id} className="gcs-chat__audio" controls preload="metadata" src={`/files/${f.id}`} aria-label={t("voiceMessage")} data-testid="gcs-chat-audio" />
        ),
      )}
      {shownEmbeds.map((e) =>
        e.kind === "image" ? (
          <a key={e.url} href={e.url} target="_blank" rel="nofollow ugc noopener" className="gcs-chat__image">
            <img src={e.url} alt={t("image")} loading="lazy" referrerPolicy="no-referrer" />
          </a>
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
