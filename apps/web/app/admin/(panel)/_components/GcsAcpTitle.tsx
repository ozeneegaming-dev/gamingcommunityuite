import { GcsIcon } from "@gcs/ui/icons";
import type { CSSProperties, ReactNode } from "react";

type Props = {
  /** Iconița Font Awesome după nume (`fa-solid fa-users`), de obicei aceeași ca a intrării din meniul ACP. */
  icon: string | null | undefined;
  children: ReactNode;
  style?: CSSProperties;
};

/** Titlul unei pagini ACP (`<h1>`): iconița decorativă (ascunsă cititoarelor de ecran) urmată de text. */
export function GcsAcpTitle({ icon, children, style }: Props) {
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
