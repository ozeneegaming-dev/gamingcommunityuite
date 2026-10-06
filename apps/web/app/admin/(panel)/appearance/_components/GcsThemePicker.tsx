"use client";

import { faBrush } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

/** Alegerea temei editate (ACP → Aspect → CSS / Șabloane): schimbă `?theme=` și reîncarcă pagina pe tema nouă. */
export function GcsThemePicker({ themes, current }: { themes: { key: string; name: string }[]; current: string }) {
  const t = useTranslations("acp.codeEditor");
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="gcs-themePicker">
      <span className="gcs-themePicker__icon" aria-hidden="true">
        <GcsIconSvg icon={faBrush} />
      </span>
      <span className="gcs-themePicker__label">{t("theme")}</span>
      <select
        className="gcs-input gcs-themePicker__select"
        value={current}
        onChange={(e) => router.push(`${pathname}?theme=${encodeURIComponent(e.target.value)}`)}
        data-testid="gcs-theme-picker"
      >
        {themes.map((theme) => (
          <option key={theme.key} value={theme.key}>
            {theme.name}
          </option>
        ))}
      </select>
    </label>
  );
}
