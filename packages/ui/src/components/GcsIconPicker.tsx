"use client";

import { faBan, faChevronDown, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../cx";
import { GcsIconSvg } from "../icons/svg";

export type GcsIconPickerMatch = { name: string; width: number; height: number; path: string };

/** Categoriile din popup (cheile din `GCS_ICON_CATEGORIES`, în ordinea lor). */
const CATEGORIES = ["popular", "gaming", "community", "staff", "tech", "rewards", "arrows", "brands"] as const;
type Category = (typeof CATEGORIES)[number];

export type GcsIconPickerProps = {
  /** Numele câmpului din formular (input ascuns cu iconița aleasă). */
  name: string;
  value: string | null;
  /** Endpoint-ul de căutare (`?q=`, `?cat=`, `?name=`), care întoarce `{ icons: GcsIconPickerMatch[] }`. */
  searchUrl: string;
  labels: {
    search: string;
    none: string;
    noResults: string;
    /** Textul butonului fără iconiță aleasă. */
    choose?: string;
    categories?: Partial<Record<Category, string>>;
  };
  onChange?: (value: string | null) => void;
  /** Butonul fără numele iconiței (doar pătratul), pentru rândurile înguste. */
  compact?: boolean;
  testId?: string;
};

function Preview({ icon }: { icon: GcsIconPickerMatch }) {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${icon.width} ${icon.height}`} width="1.15em" height="1.15em" fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}

/** `fa-solid fa-ranking-star` → „Ranking star”. */
export const iconLabel = (name: string) => {
  const base = name.replace(/^fa-(solid|regular|brands) fa-/, "").replace(/-/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
};

async function fetchIcons(url: string, signal: AbortSignal): Promise<GcsIconPickerMatch[]> {
  const r = await fetch(url, { signal });
  return r.ok ? ((await r.json()) as { icons: GcsIconPickerMatch[] }).icons : [];
}

/**
 * Selectorul de iconițe: un buton care arată iconița aleasă și deschide un popup cu căutare, categorii (întâi iconițele
 * folosite des într-o comunitate de gaming) și „Fără iconiță”. Tastatura: Enter / spațiu deschide, Escape închide,
 * săgețile se mișcă în grilă.
 */
export function GcsIconPicker({ name, value, searchUrl, labels, onChange, compact, testId }: GcsIconPickerProps) {
  const [current, setCurrent] = useState(value);
  const [shown, setShown] = useState<GcsIconPickerMatch | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("popular");
  const [results, setResults] = useState<GcsIconPickerMatch[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const popId = useId();

  // Iconița aleasă (desenul ei) pentru buton.
  useEffect(() => {
    if (!current) return setShown(null);
    if (shown?.name === current) return;
    const ctrl = new AbortController();
    fetchIcons(`${searchUrl}?name=${encodeURIComponent(current)}`, ctrl.signal)
      .then((icons) => setShown(icons[0] ?? null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [current, searchUrl, shown?.name]);

  // Rezultatele popupului: căutarea sau categoria.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchIcons(`${searchUrl}?q=${encodeURIComponent(query)}&cat=${category}`, ctrl.signal)
        .then(setResults)
        .catch(() => {});
    }, query ? 150 : 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, query, category, searchUrl]);

  // Click în afara popupului sau Escape îl închid (focusul revine pe buton).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const choose = (icon: GcsIconPickerMatch | null) => {
    setCurrent(icon?.name ?? null);
    setShown(icon);
    onChange?.(icon?.name ?? null);
    setOpen(false);
    trigger.current?.focus();
  };

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const cols = Math.max(1, Math.round((grid.current?.clientWidth ?? 320) / 44));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!step) return;
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, at + step))]?.focus();
  }

  return (
    <div ref={root} className={cx("gcs-iconPicker", open && "gcs-iconPicker--open")} data-testid={testId}>
      <input type="hidden" name={name} value={current ?? ""} />
      <button
        ref={trigger}
        type="button"
        className={cx("gcs-iconPicker__trigger", compact && "gcs-iconPicker__trigger--compact")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title={current ? iconLabel(current) : labels.none}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId ? `${testId}-open` : "gcs-icon-picker-open"}
      >
        <span className="gcs-iconPicker__tile" aria-hidden="true">
          {shown ? <Preview icon={shown} /> : <GcsIconSvg icon={faBan} />}
        </span>
        {!compact && <span className="gcs-iconPicker__name">{current ? iconLabel(current) : (labels.choose ?? labels.none)}</span>}
        {!compact && <GcsIconSvg icon={faChevronDown} className="gcs-iconPicker__chev" />}
      </button>
      {open && (
        <div id={popId} role="dialog" aria-label={labels.search} className="gcs-iconPicker__pop">
          <label className="gcs-iconPicker__search">
            <GcsIconSvg icon={faMagnifyingGlass} />
            <span className="gcs-srOnly">{labels.search}</span>
            <input type="search" className="gcs-input" placeholder={labels.search} value={query} autoFocus onChange={(e) => setQuery(e.target.value)} data-testid={testId ? `${testId}-search` : "gcs-icon-picker-search"} />
          </label>
          {!query && (
            <div className="gcs-iconPicker__cats" role="tablist" aria-label={labels.search}>
              {CATEGORIES.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={category === c} className="gcs-iconPicker__cat" onClick={() => setCategory(c)}>
                  {labels.categories?.[c] ?? c}
                </button>
              ))}
            </div>
          )}
          <div ref={grid} className="gcs-iconPicker__grid" role="listbox" aria-label={labels.search} onKeyDown={onGridKey}>
            {results.map((icon) => (
              <button
                key={icon.name}
                type="button"
                role="option"
                aria-selected={current === icon.name}
                aria-label={iconLabel(icon.name)}
                title={iconLabel(icon.name)}
                className="gcs-iconPicker__item"
                onClick={() => choose(icon)}
              >
                <Preview icon={icon} />
              </button>
            ))}
          </div>
          {results.length === 0 && query && <p className="gcs-muted gcs-iconPicker__empty">{labels.noResults}</p>}
          <div className="gcs-iconPicker__foot">
            <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" onClick={() => choose(null)}>
              <span className="gcs-btn__icon" aria-hidden="true">
                <GcsIconSvg icon={faBan} />
              </span>
              {labels.none}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
