import type { GcsViewerImage } from "@gcs/ui";

/** Evenimentul care deschide vizualizatorul de imagini al site-ului (ascultat de `GcsImageViewerHost`). */
export const IMAGE_VIEWER_EVENT = "gcs:image-viewer";
export type GcsImageViewerRequest = { images: GcsViewerImage[]; index: number };

/** Deschide vizualizatorul cu imaginile date (ex. „Mărește media” din chat); fără efect pe server. */
export function openImageViewer(images: GcsViewerImage[], index = 0): void {
  if (typeof window === "undefined" || images.length === 0) return;
  window.dispatchEvent(new CustomEvent<GcsImageViewerRequest>(IMAGE_VIEWER_EVENT, { detail: { images, index } }));
}

/** Atributele care trimit o imagine din pagină în vizualizator: adresa mare, originalul și legenda. */
export const VIEWER_SELECTOR = "img.gcs-postImage, [data-gcs-viewer]";
const SIGNATURE = ".gcs-post__signature";
/** Imaginile mici (emoticoane, insigne) nu se deschid. */
export const VIEWER_MIN_SIDE = 48;

/**
 * Imaginea de vizualizat pentru un element din pagină: `data-gcs-viewer` (adresa mare; gol = `src`-ul imaginii),
 * `data-gcs-viewer-original`, iar legenda din cel mai apropiat strămoș cu `data-gcs-caption-*` (autorul, data ISO,
 * linkul spre conținut).
 */
export function viewerImageOf(el: Element): GcsViewerImage | null {
  const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
  const own = el.getAttribute("data-gcs-viewer");
  const src = own || img?.currentSrc || img?.src || "";
  if (!src) return null;
  const host = el.closest("[data-gcs-caption-author], [data-gcs-caption-date], [data-gcs-caption-href]");
  const caption = host
    ? {
        author: host.getAttribute("data-gcs-caption-author"),
        date: host.getAttribute("data-gcs-caption-date"),
        href: host.getAttribute("data-gcs-caption-href"),
      }
    : undefined;
  return {
    src,
    thumb: img?.currentSrc || img?.src || src,
    alt: img?.alt || el.getAttribute("aria-label") || "",
    original: el.getAttribute("data-gcs-viewer-original") || src,
    ...(caption ? { caption } : {}),
  };
}

/** Elementul se deschide în vizualizator: nu e în editor, nu e într-un link spre altă pagină și nu e o imagine mică. */
export function isViewerTarget(el: Element): boolean {
  if (el.closest("[contenteditable='true'], .ProseMirror, .gcs-viewer")) return false;
  if (el.hasAttribute("data-gcs-viewer")) return true;
  const img = el as HTMLImageElement;
  const link = img.closest("a[href]");
  if (link && (link as HTMLAnchorElement).href !== img.src) return false;
  if (img.complete && img.naturalWidth > 0 && img.naturalWidth < VIEWER_MIN_SIDE && img.naturalHeight < VIEWER_MIN_SIDE) return false;
  return true;
}

/** Galeria unei imagini: imaginile din același context (`data-gcs-gallery`: postarea, topicul, chat-ul), în ordine. */
export function galleryOf(el: Element): { images: GcsViewerImage[]; index: number } {
  // O semnătură e galeria ei; altfel imaginile semnăturilor nu intră în galeria topicului.
  const signature = el.closest(SIGNATURE);
  const scope = signature ?? el.closest("[data-gcs-gallery]") ?? el.closest(".gcs-postBody") ?? el.parentElement;
  const nodes = scope ? [...scope.querySelectorAll(VIEWER_SELECTOR)].filter((n) => isViewerTarget(n) && (signature !== null || n.closest(SIGNATURE) === null)) : [el];
  if (!nodes.includes(el)) nodes.unshift(el);
  const images: GcsViewerImage[] = [];
  let index = 0;
  for (const node of nodes) {
    const image = viewerImageOf(node);
    if (!image) continue;
    if (node === el) index = images.length;
    images.push(image);
  }
  return { images, index };
}
