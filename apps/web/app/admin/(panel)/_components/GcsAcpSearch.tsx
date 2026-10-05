"use client";

import type { GcsAcpSearchResult } from "@gcs/core";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { searchAcp } from "../actions";

type Props = {
  labels: { search: string; placeholder: string; noResults: string; groups: Record<GcsAcpSearchResult["group"], string> };
};

/** Căutarea live din header-ul ACP: rezultate grupate (setări, membri, grupuri), navigabile din tastatură. */
export function GcsAcpSearch({ labels }: Props) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GcsAcpSearchResult[] | null>(null);
  const [active, setActive] = useState(-1);
  const request = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults(null);
      return;
    }
    const n = ++request.current;
    const timer = setTimeout(async () => {
      const found = await searchAcp(query);
      if (n === request.current) {
        setResults(found);
        setActive(-1);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const listId = `${id}-results`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const groups = results ? (["settings", "members", "groups"] as const).filter((g) => results.some((r) => r.group === g)) : [];

  return (
    <div className="gcs-acpSearch" role="combobox" aria-expanded={results !== null} aria-haspopup="listbox" aria-owns={listId}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7D8494" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ position: "absolute", left: 14, top: 13 }}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <label htmlFor={`${id}-input`} className="gcs-srOnly">
        {labels.search}
      </label>
      <input
        id={`${id}-input`}
        type="search"
        className="gcs-input"
        placeholder={labels.placeholder}
        value={q}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!results?.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            window.location.assign(results[active]!.href);
          } else if (e.key === "Escape") {
            setQ("");
          }
        }}
        style={{ height: 42, paddingLeft: 40 }}
      />
      {results !== null && (
        <div id={listId} role="listbox" className="gcs-acpSearch__results" aria-label={labels.search}>
          {results.length === 0 && <p style={{ margin: 0, padding: "10px 12px", color: "var(--gcs-muted)", fontSize: 14 }}>{labels.noResults}</p>}
          {groups.map((g) => (
            <div key={g} role="group" aria-label={labels.groups[g]}>
              <span className="gcs-acpSub__title" style={{ display: "block" }}>
                {labels.groups[g]}
              </span>
              {results.map((r, i) =>
                r.group === g ? (
                  <Link
                    key={`${r.group}:${r.href}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    href={r.href}
                    className="gcs-acpSearch__result"
                    onClick={() => setQ("")}
                  >
                    {r.label}
                  </Link>
                ) : null,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
