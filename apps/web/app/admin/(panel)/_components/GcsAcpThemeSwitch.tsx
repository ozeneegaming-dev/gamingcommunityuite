"use client";

import { cx } from "@gcs/ui";
import { useState } from "react";

export type GcsAcpTheme = "auto" | "light" | "dark";
export const ACP_THEME_COOKIE = "gcs-acp-theme";

/** Tema ACP (Auto/Light/Dark), o preferință a adminului salvată într-un cookie (spec §12). */
export function GcsAcpThemeSwitch({ initial, labels }: { initial: GcsAcpTheme; labels: { group: string } & Record<GcsAcpTheme, string> }) {
  const [theme, setTheme] = useState(initial);

  function choose(next: GcsAcpTheme) {
    setTheme(next);
    document.cookie = `${ACP_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector<HTMLElement>(".gcs-acp")?.setAttribute("data-theme", next);
  }

  return (
    <div
      role="group"
      aria-label={labels.group}
      style={{ display: "flex", background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)", borderRadius: 9, padding: 3 }}
    >
      {(["auto", "light", "dark"] as const).map((v) => (
        <button key={v} type="button" className={cx("gcs-seg", v === theme && "gcs-seg--active")} aria-pressed={v === theme} onClick={() => choose(v)}>
          {labels[v]}
        </button>
      ))}
    </div>
  );
}
