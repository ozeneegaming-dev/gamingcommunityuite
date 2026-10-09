"use client";

import { cssColor, hexToHsva, hsvaToHex, type GcsHsva } from "@gcs/modules/chat-pro-prefs";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Labels = { area: string; hue: string; opacity: string; hex: string; reset: string };

/**
 * Selectorul de culoare al setărilor Chat Pro: pătratul saturație / luminozitate (mouse, deget sau săgeți), nuanța,
 * opacitatea, câmpul HEX (`#RRGGBB` sau `#RRGGBBAA`) și „Resetează” (revine la culoarea temei). Valoarea e `#RRGGBBAA`.
 */
export function GcsColorPicker({ value, fallback, onChange, onReset, labels }: { value: string | null; fallback: string; onChange: (hex8: string) => void; onReset: () => void; labels: Labels }) {
  const [hsva, setHsva] = useState<GcsHsva>(() => hexToHsva(value ?? fallback) ?? { h: 0, s: 0, v: 0.2, a: 1 });
  const [hex, setHex] = useState(value ?? fallback);
  const area = useRef<HTMLDivElement>(null);

  // O valoare nouă din afară (alt element ales, resetare): pickerul o preia.
  useEffect(() => {
    const next = hexToHsva(value ?? fallback);
    if (next) setHsva(next);
    setHex(value ?? fallback);
  }, [value, fallback]);

  const commit = (next: GcsHsva) => {
    setHsva(next);
    const out = hsvaToHex(next);
    setHex(out);
    onChange(out);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    commit({ ...hsva, s, v });
  };

  const onAreaKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    commit({ ...hsva, s: Math.min(1, Math.max(0, hsva.s + m[0])), v: Math.min(1, Math.max(0, hsva.v + m[1])) });
  };

  const pure = hsvaToHex({ h: hsva.h, s: 1, v: 1, a: 1 });
  const opaque = hsvaToHex({ ...hsva, a: 1 });
  return (
    <div className="gcs-colorPicker" data-testid="gcs-color-picker">
      <div
        ref={area}
        className="gcs-colorPicker__area"
        style={{ backgroundColor: cssColor(pure) }}
        role="slider"
        tabIndex={0}
        aria-label={labels.area}
        aria-valuetext={`${Math.round(hsva.s * 100)}%, ${Math.round(hsva.v * 100)}%`}
        aria-valuenow={Math.round(hsva.s * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && fromPointer(e)}
        onKeyDown={onAreaKey}
      >
        <span className="gcs-colorPicker__thumb" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, backgroundColor: cssColor(opaque) }} />
      </div>
      <div className="gcs-colorPicker__controls">
        <label className="gcs-colorPicker__row">
          <span>{labels.hex}</span>
          <span className="gcs-colorPicker__swatch" style={{ backgroundColor: cssColor(hex.length === 9 ? hex : `${hex}FF`) }} aria-hidden="true" />
          <input
            className="gcs-input gcs-colorPicker__hex"
            value={hex}
            maxLength={9}
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v);
              const parsed = hexToHsva(v);
              if (parsed) {
                setHsva(parsed);
                onChange(hsvaToHex(parsed));
              }
            }}
            data-testid="gcs-color-hex"
          />
        </label>
        <label className="gcs-colorPicker__row">
          <span>{labels.hue}</span>
          <input type="range" className="gcs-colorPicker__hue" min={0} max={360} value={Math.round(hsva.h)} onChange={(e) => commit({ ...hsva, h: Number(e.target.value) })} />
        </label>
        <label className="gcs-colorPicker__row">
          <span>{labels.opacity}</span>
          <input
            type="range"
            className="gcs-colorPicker__alpha"
            min={0}
            max={100}
            value={Math.round(hsva.a * 100)}
            style={{ ["--gcs-swatch" as string]: cssColor(opaque) }}
            onChange={(e) => commit({ ...hsva, a: Number(e.target.value) / 100 })}
            data-testid="gcs-color-alpha"
          />
          <output className="gcs-colorPicker__pct">{Math.round(hsva.a * 100)}%</output>
        </label>
        <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={onReset} data-testid="gcs-color-reset">
          {labels.reset}
        </button>
      </div>
    </div>
  );
}
