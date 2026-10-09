"use client";

import { faCircleHalfStroke, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsIconSvg } from "@gcs/ui";
import { useState } from "react";
import { ACP_THEME_COOKIE, type GcsAcpTheme } from "./acp-theme";

const THEME_ICONS = { auto: faCircleHalfStroke, light: faSun, dark: faMoon } as const;

/**
 * Tema ACP (Auto/Light/Dark), o preferință a adminului salvată într-un cookie (spec §12). În bara de sus apar doar
 * iconițele; numele temei rămâne textul butonului pentru cititoarele de ecran și apare ca tooltip.
 */
export function GcsAcpThemeSwitch({ initial, labels }: { initial: GcsAcpTheme; labels: { group: string } & Record<GcsAcpTheme, string> }) {
  const [theme, setTheme] = useState(initial);

  function choose(next: GcsAcpTheme) {
    setTheme(next);
    document.cookie = `${ACP_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector<HTMLElement>(".gcs-acp")?.setAttribute("data-theme", next);
  }

  return (
    <div role="group" aria-label={labels.group} className="gcs-acpTheme" data-testid="gcs-acp-theme">
      {(["auto", "light", "dark"] as const).map((v) => (
        <button
          key={v}
          type="button"
          className={cx("gcs-acpTheme__btn", v === theme && "gcs-acpTheme__btn--active")}
          aria-pressed={v === theme}
          title={labels[v]}
          onClick={() => choose(v)}
        >
          <GcsIconSvg icon={THEME_ICONS[v]} />
          <span className="gcs-srOnly">{labels[v]}</span>
        </button>
      ))}
    </div>
  );
}
