"use client";

import { faChevronLeft, faChevronRight, faDownload, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faUpRightFromSquare, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { GcsIconSvg } from "../icons/svg";
import {
  clampPan,
  distance,
  fitSize,
  swipeDirection,
  VIEW_RESET,
  VIEWER_DOUBLE_ZOOM,
  VIEWER_ZOOM_STEP,
  wrapIndex,
  zoomAt,
  type GcsSize,
  type GcsViewerImage,
  type GcsViewTransform,
} from "./imageViewer";

export type GcsImageViewerLabels = {
  dialog: string;
  close: string;
  prev: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
  original: string;
  download: string;
  thumbnails: string;
  /** „{current} din {total}”. */
  counter: string;
  /** „de {name}”. */
  by: string;
  /** Linkul spre conținutul imaginii („Vezi postarea”). */
  source: string;
};

export type GcsImageViewerProps = {
  images: GcsViewerImage[];
  index: number;
  onClose: () => void;
  labels: GcsImageViewerLabels;
  /** Data din legendă (ISO) → textul afișat; implicit data locală. */
  formatDate?: (iso: string) => string;
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
type Point = { x: number; y: number };

/**
 * Vizualizatorul de imagini pe tot ecranul (nucleul GCS: postări, chat, profil, clanuri, dovezi; galeria îl va
 * refolosi). Mărire cu rotița și cu două degete, deplasare prin tragere, dublu-click pentru mărire, imaginea
 * următoare / anterioară (săgețile, tastele ← →, glisarea pe ecranele tactile), banda de miniaturi, „Deschide
 * originalul” și „Descarcă”, legenda cu autorul, data și linkul spre conținut. Dialog accesibil: focusul rămâne în el,
 * Escape îl închide, iar focusul revine pe elementul care l-a deschis. Cu `prefers-reduced-motion`, fără animații (CSS).
 */
export function GcsImageViewer({ images, index: start, onClose, labels, formatDate }: GcsImageViewerProps) {
  const total = images.length;
  const [index, setIndex] = useState(() => wrapIndex(start, total));
  const [view, setView] = useState<GcsViewTransform>(VIEW_RESET);
  const [natural, setNatural] = useState<GcsSize>({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; time: number; view: GcsViewTransform; pinch: number | null; moved: boolean } | null>(null);
  /** Ultimul gest a mutat imaginea (un click după tragere nu închide dialogul). */
  const moved = useRef(false);
  const image = images[index];

  const stageSize = useCallback((): GcsSize => {
    const r = stage.current?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  }, []);
  /** Punctul relativ la centrul scenei. */
  const local = useCallback((clientX: number, clientY: number): Point => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 } : { x: 0, y: 0 };
  }, []);
  const settle = useCallback((t: GcsViewTransform) => clampPan(t, fitSize(natural, stageSize()), stageSize()), [natural, stageSize]);

  const go = useCallback(
    (delta: number) => {
      if (total < 2) return;
      setIndex((i) => wrapIndex(i + delta, total));
    },
    [total],
  );
  const zoomBy = useCallback((factor: number, at: Point = { x: 0, y: 0 }) => setView((v) => settle(zoomAt(v, v.scale * factor, at.x, at.y))), [settle]);

  // O imagine nouă începe nemărită.
  useEffect(() => {
    setView(VIEW_RESET);
    setNatural({ w: 0, h: 0 });
  }, [index]);

  // Imaginile vecine se încarcă dinainte (navigarea pare instantă).
  useEffect(() => {
    if (total < 2) return;
    for (const d of [1, -1]) {
      const next = images[wrapIndex(index + d, total)];
      if (next) new Image().src = next.src;
    }
  }, [images, index, total]);

  // Focusul intră în dialog și nu iese cu Tab; la închidere revine pe elementul care l-a deschis; pagina nu se derulează.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    el?.querySelector<HTMLElement>("[data-viewer-close]")?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return e.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  // Rotița: mărire în jurul cursorului (ascultător activ, ca pagina să nu se deruleze).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      zoomBy(factor, local(e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy, local]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "+" || e.key === "=") zoomBy(VIEWER_ZOOM_STEP);
    else if (e.key === "-") zoomBy(1 / VIEWER_ZOOM_STEP);
    else if (e.key === "0") setView(VIEW_RESET);
    else return;
    e.preventDefault();
  };

  // ─── Tragerea, ciupirea și glisarea (Pointer Events: mouse, deget, stylus) ─────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = { start: { x: e.clientX, y: e.clientY }, time: Date.now(), view, pinch: pts.length === 2 ? distance(pts[0]!, pts[1]!) : null, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const d = distance(pts[0]!, pts[1]!);
      if (g.pinch === null) g.pinch = d;
      const mid = local((pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
      g.moved = true;
      setView(settle(zoomAt(g.view, (g.view.scale * d) / Math.max(1, g.pinch), mid.x, mid.y)));
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    if (g.view.scale > 1) setView(settle({ scale: g.view.scale, x: g.view.x + dx, y: g.view.y + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const wasPinch = pointers.current.size > 1 || g?.pinch !== null;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // Un deget ridicat din ciupire: gestul continuă cu degetul rămas, de la starea curentă.
      const [rest] = [...pointers.current.values()];
      gesture.current = rest ? { start: rest, time: Date.now(), view, pinch: null, moved: true } : null;
      return;
    }
    gesture.current = null;
    setDragging(false);
    moved.current = g?.moved ?? false;
    if (!g || wasPinch || g.view.scale > 1) return;
    const dir = swipeDirection(e.clientX - g.start.x, e.clientY - g.start.y, Date.now() - g.time);
    if (dir !== 0) go(dir);
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    const at = local(e.clientX, e.clientY);
    setView((v) => (v.scale > 1 ? VIEW_RESET : settle(zoomAt(v, VIEWER_DOUBLE_ZOOM, at.x, at.y))));
  };

  if (!image || typeof document === "undefined") return null;
  const caption = image.caption;
  const original = image.original ?? image.src;
  const date = caption?.date ? (formatDate ? formatDate(caption.date) : new Date(caption.date).toLocaleString()) : null;
  const counter = labels.counter.replace("{current}", String(index + 1)).replace("{total}", String(total));

  return createPortal(
    <div
      className="gcs-viewer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="gcs-viewer__dialog"
        onKeyDown={onKeyDown}
        data-testid="gcs-image-viewer"
      >
        <header className="gcs-viewer__bar">
          <h2 id={titleId} className="gcs-srOnly">
            {labels.dialog}
          </h2>
          <span className="gcs-viewer__counter" aria-live="polite" data-testid="gcs-viewer-counter">
            {total > 1 ? counter : ""}
          </span>
          {caption && (caption.author || date || caption.href) && (
            <p className="gcs-viewer__caption" data-testid="gcs-viewer-caption">
              {caption.author && <strong>{labels.by.replace("{name}", caption.author)}</strong>}
              {date && <time dateTime={caption.date ?? undefined}>{date}</time>}
              {caption.href && (
                <a href={caption.href} className="gcs-viewer__source" onClick={() => close.current()}>
                  {labels.source}
                </a>
              )}
            </p>
          )}
          <div className="gcs-viewer__actions">
            <button type="button" className="gcs-viewer__btn" onClick={() => zoomBy(1 / VIEWER_ZOOM_STEP)} disabled={view.scale <= 1} aria-label={labels.zoomOut} title={labels.zoomOut}>
              <GcsIconSvg icon={faMagnifyingGlassMinus} />
            </button>
            <button type="button" className="gcs-viewer__btn" onClick={() => zoomBy(VIEWER_ZOOM_STEP)} aria-label={labels.zoomIn} title={labels.zoomIn}>
              <GcsIconSvg icon={faMagnifyingGlassPlus} />
            </button>
            <a className="gcs-viewer__btn" href={original} target="_blank" rel="noopener noreferrer" aria-label={labels.original} title={labels.original} data-testid="gcs-viewer-original">
              <GcsIconSvg icon={faUpRightFromSquare} />
            </a>
            <a className="gcs-viewer__btn" href={image.download ?? original} download aria-label={labels.download} title={labels.download} data-testid="gcs-viewer-download">
              <GcsIconSvg icon={faDownload} />
            </a>
            <button type="button" className="gcs-viewer__btn" onClick={() => close.current()} aria-label={labels.close} title={labels.close} data-viewer-close>
              <GcsIconSvg icon={faXmark} />
            </button>
          </div>
        </header>

        <div
          ref={stage}
          className={cx("gcs-viewer__stage", view.scale > 1 && "gcs-viewer__stage--zoomed", dragging && "gcs-viewer__stage--dragging")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onClick={(e) => {
            // Un click pe fundalul scenei (nu pe imagine, nu după o tragere) închide dialogul.
            if (e.target === e.currentTarget && view.scale === 1 && !moved.current) close.current();
          }}
        >
          <img
            key={image.src}
            src={image.src}
            alt={image.alt ?? ""}
            className="gcs-viewer__img"
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
            data-testid="gcs-viewer-image"
            data-scale={view.scale.toFixed(2)}
          />
          {total > 1 && (
            <>
              <button type="button" className="gcs-viewer__nav gcs-viewer__nav--prev" onClick={() => go(-1)} aria-label={labels.prev} title={labels.prev}>
                <GcsIconSvg icon={faChevronLeft} />
              </button>
              <button type="button" className="gcs-viewer__nav gcs-viewer__nav--next" onClick={() => go(1)} aria-label={labels.next} title={labels.next}>
                <GcsIconSvg icon={faChevronRight} />
              </button>
            </>
          )}
        </div>

        {total > 1 && (
          <nav className="gcs-viewer__thumbs" aria-label={labels.thumbnails}>
            {images.map((img, i) => (
              <button
                key={`${img.src}-${i}`}
                type="button"
                className={cx("gcs-viewer__thumb", i === index && "gcs-viewer__thumb--active")}
                aria-current={i === index ? "true" : undefined}
                aria-label={labels.counter.replace("{current}", String(i + 1)).replace("{total}", String(total))}
                onClick={() => setIndex(i)}
              >
                <img src={img.thumb ?? img.src} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>,
    document.body,
  );
}
