"use client";

import { useEffect, useId, useState } from "react";

export type GcsIconPickerMatch = { name: string; width: number; height: number; path: string };

export type GcsIconPickerProps = {
  /** Numele câmpului din formular (input ascuns cu iconița aleasă). */
  name: string;
  value: string | null;
  /** Endpoint-ul de căutare (`?q=`), care întoarce `{ icons: GcsIconPickerMatch[] }`. */
  searchUrl: string;
  labels: { search: string; none: string; noResults: string };
  onChange?: (value: string | null) => void;
};

function Preview({ icon }: { icon: GcsIconPickerMatch }) {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${icon.width} ${icon.height}`} width="1.25em" height="1.25em" fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}

/** Selectorul de iconițe Font Awesome: căutare, grilă de rezultate și „fără iconiță”. */
export function GcsIconPicker({ name, value, searchUrl, labels, onChange }: GcsIconPickerProps) {
  const [current, setCurrent] = useState(value);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GcsIconPickerMatch[]>([]);
  const inputId = useId();

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${searchUrl}?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ icons: GcsIconPickerMatch[] }>) : { icons: [] }))
        .then((d) => setResults(d.icons))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, searchUrl]);

  const choose = (v: string | null) => {
    setCurrent(v);
    onChange?.(v);
  };

  return (
    <div className="gcs-iconPicker">
      <input type="hidden" name={name} value={current ?? ""} />
      <label htmlFor={inputId} className="gcs-srOnly">
        {labels.search}
      </label>
      <input id={inputId} type="search" className="gcs-input" placeholder={labels.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="gcs-iconPicker__grid" role="listbox" aria-label={labels.search}>
        <button type="button" role="option" aria-selected={current === null} className="gcs-iconPicker__item" onClick={() => choose(null)} title={labels.none}>
          ∅
        </button>
        {results.map((icon) => (
          <button
            key={icon.name}
            type="button"
            role="option"
            aria-selected={current === icon.name}
            aria-label={icon.name}
            title={icon.name}
            className="gcs-iconPicker__item"
            onClick={() => choose(icon.name)}
          >
            <Preview icon={icon} />
          </button>
        ))}
      </div>
      {results.length === 0 && query && <p className="gcs-muted">{labels.noResults}</p>}
    </div>
  );
}
