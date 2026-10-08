"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

export type GcsPickedPlayer = { id: number; name: string; kind: string; value: string };

/**
 * Căutarea unui jucător după nume sau ID (formularele reclamației și sancțiunii): `/api/servers/players?q=`, cu lista
 * rezultatelor ca listbox (săgețile și Enter din tastatură). Numele vin din joc: doar text.
 */
export function GcsPlayerPicker({ value, onChange, label, hint, testId }: { value: GcsPickedPlayer | null; onChange: (p: GcsPickedPlayer | null) => void; label: string; hint?: string; testId?: string }) {
  const t = useTranslations("bridge.picker");
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GcsPickedPlayer[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/servers/players?q=${encodeURIComponent(text)}`, { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as { players: GcsPickedPlayer[] }) : { players: [] };
        if (mine === seq.current) {
          setResults(data.players);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (mine === seq.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const pick = (p: GcsPickedPlayer) => {
    onChange(p);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className="gcs-field">
        <span>{label}</span>
        <span className="gcs-pickedPlayer" data-testid={testId ? `${testId}-picked` : undefined}>
          <strong>{value.name || value.value}</strong>
          {value.kind !== "NAME" && <code className="gcs-identity__id">{value.value}</code>}
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => onChange(null)}>
            {t("change")}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="gcs-field gcs-picker">
      <label htmlFor={`${id}-q`}>{label}</label>
      <input
        id={`${id}-q`}
        className="gcs-input"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-o${active}` : undefined}
        value={q}
        maxLength={64}
        placeholder={t("placeholder")}
        data-testid={testId}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {hint && <span className="gcs-field__hint">{hint}</span>}
      {open && q.trim().length >= 2 && (
        <ul id={`${id}-list`} role="listbox" className="gcs-picker__list" aria-label={label}>
          {results.length === 0 ? (
            <li className="gcs-picker__empty" role="option" aria-selected={false} aria-disabled="true">
              {t("none")}
            </li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={i === active}
                className="gcs-picker__option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <strong>{p.name || p.value}</strong>
                {p.kind !== "NAME" && <code className="gcs-identity__id">{p.value}</code>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
