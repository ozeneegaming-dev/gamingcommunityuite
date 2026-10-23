"use client";

import { compactHeaderLayout, HEADER_ROWS, HEADER_ZONES, placedHeaderElements, type GcsHeaderBuilder, type GcsHeaderDeviceLayout, type GcsHeaderElement, type GcsHeaderRow } from "@gcs/core/themes";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { deviceForWidth, type GcsDevice } from "@/lib/header-device";
import { HEADER_EVENTS, HeaderStateContext, type GcsHeaderState } from "./header-context";

export type GcsHeaderOptions = {
  rowTop: number;
  rowMain: number;
  rowBottom: number;
  sticky: boolean;
  compact: boolean;
  hideOnScroll: boolean;
  dropdowns: "click" | "hover";
  mega: boolean;
  navAlign: "left" | "center" | "right";
  /** Navigarea pe mobil: iconițele în antet sau în bara de jos. */
  placement: "header" | "bottom";
};

/** Pragul de la care antetul devine compact (specul §9: „~120px”). */
export const COMPACT_AFTER = 120;
/** Elementele care trebuie să existe chiar dacă nu sunt puse în antet (Ctrl+K, bara de jos: „Creează”, meniul). */
const HELPERS: readonly GcsHeaderElement[] = ["search", "create", "nav"];

function subscribeWidth(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** Dispozitivul după lățimea ferestrei; la hidratare, cel ghicit de server (fără nepotriviri). */
function useDevice(initial: GcsDevice): GcsDevice {
  return useSyncExternalStore(
    subscribeWidth,
    () => deviceForWidth(window.innerWidth),
    () => initial,
  );
}

/** Rândurile goale nu se randează; zonele rămân (stânga / centru / dreapta), ca alinierea să fie stabilă. */
const rowHasItems = (layout: GcsHeaderDeviceLayout, row: GcsHeaderRow) => HEADER_ZONES.some((z) => layout[row][z].length > 0);

/**
 * Antetul construit (specul 2026-10-10-hero-cockpit §9): elementele (randate pe server) se așază în rândurile și zonele
 * aspectului pentru dispozitivul curent. La derulare, peste 120 px, antetul se strânge în bara compactă (Esports:
 * rândul de sus 76→0 cu fade, meniul 94→74, crestătura la 0,68 din centrul de sus, umbra; 0,3 s, cubic-bezier(.22,1,.36,1);
 * celelalte presetări: logo + meniul pe un rând + căutarea). Opțional, se ascunde la derularea în jos. În
 * previzualizarea editorului, aspectul se schimbă live (evenimentul `gcs:header-preview`).
 */
export function GcsHeaderFrame({
  parts,
  layout: initialLayout,
  options: initialOptions,
  initialDevice,
  mobileBar,
}: {
  parts: Partial<Record<string, ReactNode>>;
  layout: GcsHeaderBuilder;
  options: GcsHeaderOptions;
  initialDevice: GcsDevice;
  mobileBar: ReactNode;
}) {
  const [layout, setLayout] = useState(initialLayout);
  const [options, setOptions] = useState(initialOptions);
  const device = useDevice(initialDevice);
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => setLayout(initialLayout), [initialLayout]);
  useEffect(() => setOptions(initialOptions), [initialOptions]);

  // Derularea: starea compactă (peste prag) și ascunderea la derularea în jos (opțional).
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setCompact(options.compact && y > COMPACT_AFTER);
      if (options.hideOnScroll) {
        if (y <= COMPACT_AFTER || y < last - 4) setHidden(false);
        else if (y > last + 4) setHidden(true);
      } else setHidden(false);
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [options.compact, options.hideOnScroll]);

  // Previzualizarea live din editorul vizual (aspectul și opțiunile antetului, din draft).
  useEffect(() => {
    const onPreview = (e: Event) => {
      const d = (e as CustomEvent<{ layout?: GcsHeaderBuilder; options?: Partial<GcsHeaderOptions> }>).detail;
      if (d?.layout) setLayout(d.layout);
      if (d?.options) setOptions((o) => ({ ...o, ...d.options }));
    };
    window.addEventListener(HEADER_EVENTS.preview, onPreview);
    return () => window.removeEventListener(HEADER_EVENTS.preview, onPreview);
  }, []);

  const deviceLayout = layout[device];
  const compacted = useMemo(() => compactHeaderLayout(deviceLayout), [deviceLayout]);
  // Bara compactă rearanjată (logo + meniu + căutare pe un rând) doar când elementele trebuie mutate; altfel doar CSS.
  const arrangement = compact && compacted.moved ? compacted.layout : deviceLayout;
  const placed = new Set<string>(placedHeaderElements(arrangement));
  if (placed.has("searchField")) placed.add("search");
  const helpers = HELPERS.filter((k) => !placed.has(k) && parts[k]);
  const notch = layout.preset === "esports" && device !== "mobile";

  const state = useMemo<GcsHeaderState>(() => ({ device, compact, dropdowns: options.dropdowns, mega: options.mega, preset: layout.preset, layout }), [device, compact, options.dropdowns, options.mega, layout]);
  const style = { "--hb-top": `${options.rowTop}px`, "--hb-main": `${options.rowMain}px`, "--hb-bottom": `${options.rowBottom}px` } as CSSProperties;

  const element = (key: GcsHeaderElement, row: GcsHeaderRow, zone: string) => {
    const node = parts[key];
    if (!node) return null;
    const el = (
      <div key={key} className={`gcs-hb__el gcs-hb__el--${key.replace(".", "-")}`} data-el={key}>
        {node}
      </div>
    );
    // Esports: logo-ul din centrul rândului principal stă în crestătura trapezoidală, cu barele de accent înclinate.
    if (key === "logo" && notch && row === "main" && zone === "center") {
      return (
        <div key={key} className="gcs-hb__notch" data-testid="gcs-header-notch">
          <span className="gcs-hb__notchShape" aria-hidden="true" />
          <span className="gcs-hb__notchBar gcs-hb__notchBar--left" aria-hidden="true" />
          <span className="gcs-hb__notchBar gcs-hb__notchBar--right" aria-hidden="true" />
          {el}
        </div>
      );
    }
    return el;
  };

  return (
    <HeaderStateContext.Provider value={state}>
      <header
        className={`gcs-hb gcs-hb--${layout.preset}`}
        data-preset={layout.preset}
        data-device={device}
        data-compact={compact ? "" : undefined}
        data-moved={compact && compacted.moved ? "" : undefined}
        data-hidden={hidden ? "" : undefined}
        data-sticky={options.sticky || options.compact ? "" : undefined}
        data-align={options.navAlign}
        style={style}
        data-testid="gcs-header-builder"
      >
        {HEADER_ROWS.map((row) =>
          rowHasItems(arrangement, row) ? (
            <div
              key={row}
              className={`gcs-hb__row gcs-hb__row--${row}`}
              data-row={row}
              data-collapsed={compact && !compacted.moved && row !== compacted.row ? "" : undefined}
              data-nav-row={row === compacted.row ? "" : undefined}
            >
              <div className={`gcs-hb__inner${arrangement[row].center.length > 0 ? " gcs-hb__inner--center" : ""}`}>
                {HEADER_ZONES.map((zone) => (
                  <div key={zone} className={`gcs-hb__zone gcs-hb__zone--${zone}`} data-zone={zone}>
                    {arrangement[row][zone].map((key) => element(key, row, zone))}
                  </div>
                ))}
              </div>
            </div>
          ) : null,
        )}
        {helpers.length > 0 && (
          <div className="gcs-hb__helpers">
            {helpers.map((k) => (
              <div key={k} className={`gcs-hb__el gcs-hb__el--${k}`} data-el={k}>
                {parts[k]}
              </div>
            ))}
          </div>
        )}
      </header>
      {device === "mobile" && options.placement === "bottom" && mobileBar}
    </HeaderStateContext.Provider>
  );
}
