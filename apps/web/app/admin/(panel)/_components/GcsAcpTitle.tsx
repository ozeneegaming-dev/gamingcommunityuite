import { GcsIcon } from "@gcs/ui/icons";
import type { CSSProperties, ReactNode } from "react";
import { GcsAcpPageHeader } from "./GcsAcpPageHeader";

type Props = {
  /** Iconița Font Awesome după nume (`fa-solid fa-users`), de obicei aceeași ca a intrării din meniul ACP. */
  icon: string | null | undefined;
  children: ReactNode;
  /** O descriere scurtă (doar în antetul de pagină). */
  description?: ReactNode;
  /** Acțiunile din dreapta antetului de pagină. */
  actions?: ReactNode;
  /**
   * `plain`: doar titlul (`<h1>` cu iconiță), pentru titlurile din interiorul altor carduri (paginile de intrare în
   * ACP, profilul unui membru). Implicit: antetul de pagină (`GcsAcpPageHeader`).
   */
  variant?: "page" | "plain";
  style?: CSSProperties;
};

/** Titlul unei pagini ACP: antetul de pagină comun (card cu iconiță, breadcrumb, acțiuni) sau, `plain`, doar `<h1>`. */
export function GcsAcpTitle({ icon, children, description, actions, variant = "page", style }: Props) {
  if (variant === "page") return <GcsAcpPageHeader icon={icon} title={children} description={description} actions={actions} />;
  return (
    <h1 className="gcs-display gcs-acpTitle" style={{ margin: 0, fontSize: 28, fontWeight: 700, ...style }}>
      <GcsIcon name={icon} className="gcs-acpTitle__icon" />
      {children}
    </h1>
  );
}

/** Iconița din titlul unei secțiuni (`<h2 class="gcs-acpWidget__title">`). */
export function GcsAcpTitleIcon({ name }: { name: string | null | undefined }) {
  return <GcsIcon name={name} className="gcs-acpTitle__icon" />;
}
