"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const STORAGE_KEY = "gcs-acp-chat-tab";

type Tab = { key: string; label: string; icon: ReactNode; content: ReactNode };

/**
 * Tab-urile din ACP → Chat → Setări (General / Avansat / Permisiuni), ca în chatbox-ul de referință. Tab-ul ales se păstrează
 * în adresă (`#advanced`), ca reîncărcarea paginii să rămână pe el. Navigare din tastatură cu săgețile, Home și End.
 */
export function GcsChatSettingsTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const id = useId();
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Tab-ul ales supraviețuiește reîmprospătării după „Salvează” (Next poate rescrie adresa fără `#`), deci se ține
  // și în sessionStorage.
  const keys = tabs.map((t) => t.key).join(",");
  useEffect(() => {
    let stored = "";
    try {
      stored = sessionStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      // Fără sessionStorage: rămâne doar adresa.
    }
    const wanted = window.location.hash.slice(1) || stored;
    if (keys.split(",").includes(wanted)) setActive(wanted);
  }, [keys]);

  const select = (key: string, focus = false) => {
    setActive(key);
    try {
      sessionStorage.setItem(STORAGE_KEY, key);
      // Starea `null`: routerul Next preia fragmentul și nu-l mai șterge la următoarea actualizare (ex. salvarea).
      window.history.replaceState(null, "", `#${key}`);
    } catch {
      // Fără History API sau sessionStorage: tab-ul nu se păstrează la reîncărcare.
    }
    if (focus) buttons.current[tabs.findIndex((t) => t.key === key)]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next]!.key, true);
  };

  return (
    <>
      <div className="gcs-chatAcp__tabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`${id}-${t.key}-panel`}
            tabIndex={active === t.key ? 0 : -1}
            className="gcs-chatAcp__tab"
            onClick={() => select(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${id}-${t.key}-panel`} aria-labelledby={`${id}-${t.key}`} className="gcs-chatAcp__panel" hidden={active !== t.key}>
          {t.content}
        </div>
      ))}
    </>
  );
}
