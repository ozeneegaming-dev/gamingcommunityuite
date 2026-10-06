import { cx } from "@gcs/ui";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import type { ReactNode } from "react";
import { services } from "@/lib/services";

/**
 * Iconița din titlul unui widget: cea aleasă pe amplasare (`config.icon`, din „Editează pagina”), altfel iconița
 * declarată de widget (`GcsWidgetDef.icon`). Doar pe server (registrul Font Awesome are toate pachetele).
 */
export function widgetIcon(type: string, config?: Record<string, unknown>): string | null {
  const override = config?.icon;
  if (typeof override === "string" && isGcsIcon(override)) return override;
  return services().registry.widgetDef(type)?.def.icon ?? null;
}

type GcsWidgetTitleProps = {
  /** `id`-ul titlului (ținta lui `aria-labelledby` de pe card). */
  id?: string;
  icon: string | null | undefined;
  children: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
  /** Conținut în dreapta titlului (ex. perioada „Top posteri”). */
  extra?: ReactNode;
  /** `card` = titlul cardurilor (majuscule, mic); `hero` = titlul mare al anunțului. */
  variant?: "card" | "hero";
};

/**
 * Titlul comun al widget-urilor (componentă server): iconița Font Awesome într-un pătrat cu accent + textul.
 * Se poate trimite randat și componentelor client (ex. „Cine e online”), ca prop `ReactNode`.
 */
export function GcsWidgetTitle({ id, icon, children, as: Tag = "h2", className, extra, variant = "card" }: GcsWidgetTitleProps) {
  return (
    <Tag id={id} className={cx("gcs-display gcs-widgetTitle", variant === "card" ? "gcs-sideCard__title" : "gcs-widgetTitle--hero", className)}>
      {icon && isGcsIcon(icon) && (
        <span className="gcs-widgetTitle__icon" aria-hidden="true">
          <GcsIcon name={icon} />
        </span>
      )}
      <span className="gcs-widgetTitle__text">{children}</span>
      {extra && <span className="gcs-widgetTitle__extra">{extra}</span>}
    </Tag>
  );
}
