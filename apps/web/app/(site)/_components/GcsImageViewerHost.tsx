"use client";

import { faMagnifyingGlassPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg, GcsImageViewer, type GcsImageViewerLabels, type GcsViewerImage } from "@gcs/ui";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { galleryOf, IMAGE_VIEWER_EVENT, isViewerTarget, VIEWER_SELECTOR, type GcsImageViewerRequest } from "@/lib/image-viewer";

type Props = { labels: GcsImageViewerLabels & { enlarge: string }; locale: string };

/** Imaginile din conținutul scris de membri (HTML randat de server) devin focusabile și se deschid și din tastatură. */
const CONTENT_IMAGES = ".gcs-postBody img.gcs-postImage";

/**
 * Vizualizatorul de imagini al site-ului (o singură instanță, în layout): un click pe o imagine dintr-o postare
 * (`img.gcs-postImage`) sau pe un element `data-gcs-viewer` (chat, profil, clanuri, dovezi) deschide galeria
 * contextului ei; `openImageViewer()` îl deschide din cod. Imaginile din postări primesc focus și rolul de buton, iar
 * cele micșorate (mai mari decât locul lor) arată indiciul „Mărește” la hover și la focus.
 */
export function GcsImageViewerHost({ labels, locale }: Props) {
  const [request, setRequest] = useState<{ images: GcsViewerImage[]; index: number } | null>(null);
  const [cue, setCue] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const open = (el: Element) => {
      const gallery = galleryOf(el);
      if (gallery.images.length > 0) {
        setCue(null);
        setRequest(gallery);
      }
    };
    const targetOf = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(VIEWER_SELECTOR);
      return el && isViewerTarget(el) ? el : null;
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = targetOf(e);
      if (!el) return;
      e.preventDefault();
      open(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = (e.target as Element | null)?.matches?.(CONTENT_IMAGES) ? (e.target as Element) : null;
      if (!el || !isViewerTarget(el)) return;
      e.preventDefault();
      open(el);
    };
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<GcsImageViewerRequest>).detail;
      if (detail?.images?.length) setRequest({ images: detail.images, index: detail.index ?? 0 });
    };
    // Indiciul „Mărește” la colțul unei imagini micșorate.
    const showCue = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(`${CONTENT_IMAGES}, [data-gcs-viewer]`);
      if (!el || !isViewerTarget(el)) return;
      const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
      if (!img || !(img.naturalWidth > img.clientWidth * 1.1 || img.naturalHeight > img.clientHeight * 1.1)) return;
      const r = img.getBoundingClientRect();
      setCue({ top: r.top + window.scrollY + 8, left: r.right + window.scrollX - 8 });
    };
    const hideCue = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(`${CONTENT_IMAGES}, [data-gcs-viewer]`)) setCue(null);
    };
    // Imaginile din postări: focus și rol de buton (și pentru conținutul încărcat ulterior).
    const mark = () => {
      for (const img of document.querySelectorAll<HTMLImageElement>(`${CONTENT_IMAGES}:not([data-gcs-zoomable])`)) {
        if (!isViewerTarget(img)) continue;
        img.dataset.gcsZoomable = "";
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", img.alt ? `${labels.enlarge}: ${img.alt}` : labels.enlarge);
      }
    };
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    });
    mark();
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", showCue);
    document.addEventListener("pointerout", hideCue);
    document.addEventListener("focusin", showCue);
    document.addEventListener("focusout", hideCue);
    window.addEventListener(IMAGE_VIEWER_EVENT, onRequest);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerover", showCue);
      document.removeEventListener("pointerout", hideCue);
      document.removeEventListener("focusin", showCue);
      document.removeEventListener("focusout", hideCue);
      window.removeEventListener(IMAGE_VIEWER_EVENT, onRequest);
    };
  }, [labels.enlarge]);

  const format = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  return (
    <>
      {cue &&
        createPortal(
          <span className="gcs-zoomCue" style={{ top: cue.top, left: cue.left, transform: "translateX(-100%)" }} aria-hidden="true" data-testid="gcs-zoom-cue">
            <GcsIconSvg icon={faMagnifyingGlassPlus} />
            {labels.enlarge}
          </span>,
          document.body,
        )}
      {request && <GcsImageViewer images={request.images} index={request.index} labels={labels} formatDate={format} onClose={() => setRequest(null)} />}
    </>
  );
}
