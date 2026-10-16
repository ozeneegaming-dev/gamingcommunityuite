"use client";

import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { advancedSearchHref, NO_FILTERS, pushRecent, SEARCH_PERIODS, type GcsQuickResult, type GcsSearchFilters, type GcsSearchScope } from "@/lib/quick-search";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { HEADER_EVENTS } from "./header-context";

const RECENT_KEY = "gcs-recent-searches";
const DEBOUNCE_MS = 280;
const FORUM_SCOPES: readonly GcsSearchScope[] = ["all", "topics", "posts"];

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Fără stocare (mod privat): căutările recente rămân doar în pagină.
  }
}

/**
 * Căutarea din antet (specul 2026-10-10-hero-cockpit §1): iconița (sau câmpul) deschide un panou cu câmpul, domeniile
 * (doar ale aplicațiilor instalate), filtrele forumului, rezultatele rapide cu eticheta tipului, căutările recente și
 * indiciile de tastatură; Ctrl+K îl deschide de oriunde. Enter fără selecție → pagina completă („Căutare avansată”).
 */
export function GcsSearchPanel({ variant = "icon", shortcut = true }: { variant?: "icon" | "field"; shortcut?: boolean }) {
  const t = useTranslations("header.search");
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<GcsSearchScope>("all");
  const [filters, setFilters] = useState<GcsSearchFilters>(NO_FILTERS);
  const [meta, setMeta] = useState<{ scopes: GcsSearchScope[]; forums: { id: number; name: string }[] } | null>(null);
  const [results, setResults] = useState<GcsQuickResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "limited">("idle");
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const loadMeta = useCallback(() => {
    setRecent(readRecent());
    if (meta) return;
    void fetch("/api/search/quick?meta=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { scopes: GcsSearchScope[]; forums: { id: number; name: string }[] } | null) => d && setMeta(d))
      .catch(() => {});
  }, [meta]);
  const pop = useHeaderPopover({ trap: true, onOpen: loadMeta });

  // Ctrl+K / ⌘K de oriunde, și deschiderea din bara de jos (mobil).
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      // Cu două căutări în antet (iconița și câmpul), doar prima răspunde.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        pop.setOpen(true);
      }
    };
    const onOpen = () => pop.setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(HEADER_EVENTS.search, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(HEADER_EVENTS.search, onOpen);
    };
  }, [shortcut, pop.setOpen]);

  // Rezultatele rapide (după o pauză în tastare); un răspuns vechi nu-l suprascrie pe cel nou.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    const n = ++seq.current;
    setState("loading");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: term, scope, period: filters.period });
      if (filters.forum) params.set("forum", String(filters.forum));
      if (filters.author.trim()) params.set("author", filters.author.trim());
      if (filters.titles) params.set("titles", "1");
      void fetch(`/api/search/quick?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [], limited: false }))
        .then((d: { results: GcsQuickResult[]; limited: boolean }) => {
          if (n !== seq.current) return;
          setResults(d.results);
          setActive(-1);
          setState(d.limited ? "limited" : "done");
        })
        .catch(() => n === seq.current && setState("done"));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, scope, filters]);

  const remember = (term: string) => {
    const next = pushRecent(readRecent(), term);
    writeRecent(next);
    setRecent(next);
  };
  const go = (href: string) => {
    remember(q);
    pop.close(false);
    router.push(href);
  };
  const advanced = advancedSearchHref(scope, q, filters);
  const scopes = meta?.scopes ?? ["all", "topics", "posts"];
  const forumScope = FORUM_SCOPES.includes(scope);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % results.length : (a - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[active];
      if (picked) go(picked.href);
      else if (q.trim().length >= 2) go(advanced);
    }
  };

  return (
    <div className={`gcs-sp gcs-sp--${variant}`} {...pop.rootProps} data-testid="gcs-search">
      {variant === "field" ? (
        <button {...pop.triggerProps} className="gcs-sp__field" aria-label={t("open")} data-testid="gcs-search-open">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <span className="gcs-sp__fieldText">{t("placeholder")}</span>
          <kbd className="gcs-sp__kbd">Ctrl K</kbd>
        </button>
      ) : (
        <button {...pop.triggerProps} className="gcs-hb__sq gcs-sp__trigger" aria-label={t("open")} data-testid="gcs-search-open">
          <GcsIconSvg icon={faMagnifyingGlass} />
        </button>
      )}
      {pop.mounted && (
        <div {...pop.panelProps} role="dialog" aria-label={t("dialog")} className="gcs-sp__panel gcs-hb__panel" data-testid="gcs-search-panel">
          <div className="gcs-sp__input">
            <GcsIconSvg icon={faMagnifyingGlass} />
            <label htmlFor={`${listId}-q`} className="gcs-srOnly">
              {t("dialog")}
            </label>
            <input
              ref={input}
              id={`${listId}-q`}
              type="search"
              value={q}
              placeholder={t("placeholder")}
              autoComplete="off"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={`${listId}-results`}
              aria-activedescendant={active >= 0 ? `${listId}-r${active}` : undefined}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              data-autofocus=""
              data-testid="gcs-search-input"
            />
            <button type="button" className="gcs-sp__esc" onClick={() => pop.close(true)} aria-label={t("close")}>
              <kbd>Esc</kbd>
              <GcsIconSvg icon={faXmark} className="gcs-sp__escIcon" />
            </button>
          </div>

          <div className="gcs-sp__scopes" role="group" aria-label={t("scopeLabel")}>
            {scopes.map((s) => (
              <button key={s} type="button" className="gcs-sp__scope" aria-pressed={s === scope} onClick={() => setScope(s)} data-testid={`gcs-search-scope-${s}`}>
                {t(`scopes.${s}`)}
              </button>
            ))}
          </div>

          {forumScope && (
            <div className="gcs-sp__filters" role="group" aria-label={t("filters")}>
              <span className="gcs-sp__muted">{t("filters")}:</span>
              <label className="gcs-sp__filter">
                <span className="gcs-srOnly">{t("forum")}</span>
                <select value={filters.forum ?? ""} onChange={(e) => setFilters((f) => ({ ...f, forum: Number(e.target.value) || null }))} data-testid="gcs-search-forum">
                  <option value="">
                    {t("forum")}: {t("forumAll")}
                  </option>
                  {(meta?.forums ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-sp__filter">
                <span className="gcs-srOnly">{t("author")}</span>
                <input type="text" value={filters.author} placeholder={t("author")} maxLength={40} onChange={(e) => setFilters((f) => ({ ...f, author: e.target.value }))} data-testid="gcs-search-author" />
              </label>
              <label className="gcs-sp__filter">
                <span className="gcs-srOnly">{t("period")}</span>
                <select value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value as GcsSearchFilters["period"] }))} data-testid="gcs-search-period">
                  {SEARCH_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {t("period")}: {t(`periods.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-sp__check">
                <input type="checkbox" checked={filters.titles} onChange={(e) => setFilters((f) => ({ ...f, titles: e.target.checked }))} data-testid="gcs-search-titles" />
                {t("titles")}
              </label>
            </div>
          )}

          <div className="gcs-sp__body">
            <div className="gcs-sp__col">
              <span className="gcs-sp__heading">{t("quick")}</span>
              {state === "limited" && <p className="gcs-sp__muted">{t("limited")}</p>}
              {q.trim().length < 2 ? (
                <p className="gcs-sp__muted">{t("typing")}</p>
              ) : results.length === 0 ? (
                <p className="gcs-sp__muted" role="status">
                  {state === "loading" ? t("loading") : t("empty")}
                </p>
              ) : (
                <ul id={`${listId}-results`} role="listbox" aria-label={t("quick")} className="gcs-sp__results" data-testid="gcs-search-results">
                  {results.map((r, i) => (
                    <li key={`${r.type}-${r.href}`} id={`${listId}-r${i}`} role="option" aria-selected={i === active}>
                      {r.user ? (
                        // Un membru: numele stilizat (componenta comună) e chiar linkul spre profil.
                        <div className={`gcs-sp__result${i === active ? " gcs-sp__result--active" : ""}`} data-testid="gcs-search-result" data-type={r.type}>
                          <span className={`gcs-sp__tag gcs-sp__tag--${r.type}`}>{t(`tags.${r.type}`)}</span>
                          <span className="gcs-sp__title" onClickCapture={() => remember(q)}>
                            <GcsMemberName userId={r.user.id} name={r.user.name} nameKey={r.user.nameKey} href={r.href} />
                          </span>
                          {r.meta && <span className="gcs-sp__meta">{r.meta}</span>}
                        </div>
                      ) : (
                        <a
                          href={r.href}
                          className={`gcs-sp__result${i === active ? " gcs-sp__result--active" : ""}`}
                          onClick={(e) => {
                            e.preventDefault();
                            go(r.href);
                          }}
                          data-testid="gcs-search-result"
                          data-type={r.type}
                        >
                          <span className={`gcs-sp__tag gcs-sp__tag--${r.type}`}>{t(`tags.${r.type}`)}</span>
                          <span className="gcs-sp__title">{r.title}</span>
                          {r.meta && <span className="gcs-sp__meta">{r.meta}</span>}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="gcs-sp__recent">
              <span className="gcs-sp__heading">{t("recent")}</span>
              {recent.length === 0 ? (
                <p className="gcs-sp__muted">{t("noRecent")}</p>
              ) : (
                <ul data-testid="gcs-search-recent">
                  {recent.map((r) => (
                    <li key={r}>
                      <button type="button" className="gcs-sp__recentItem" onClick={() => setQ(r)}>
                        {r}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="gcs-sp__foot">
            <span className="gcs-sp__muted">{t("hints")}</span>
            <a
              href={advanced}
              className="gcs-sp__advanced gcs-arrowLink"
              onClick={(e) => {
                e.preventDefault();
                go(advanced);
              }}
              data-testid="gcs-search-advanced"
            >
              {t("advanced")} <span className="gcs-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
