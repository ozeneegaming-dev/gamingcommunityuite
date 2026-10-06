import { GcsIcon } from "@gcs/ui/icons";
import type { ReactNode } from "react";
import { GcsAcpBreadcrumb } from "./GcsAcpBreadcrumb";

type Props = {
  /** Iconița Font Awesome după nume (`fa-solid fa-users`), de obicei aceeași ca a intrării din meniul ACP. */
  icon: string | null | undefined;
  title: ReactNode;
  /** O descriere scurtă, sub titlu. */
  description?: ReactNode;
  /** Breadcrumb explicit (după „Dashboard”); implicit se deduce din meniu și din cale. */
  breadcrumb?: { label: string; href?: string }[];
  /** Acțiunile principale, în dreapta (ex. „Adaugă”). */
  actions?: ReactNode;
  testId?: string;
};

/**
 * Antetul unei pagini ACP (etapa 6 §1.1): un card cu iconița secțiunii într-un pătrat, titlul (`<h1>`), descrierea,
 * breadcrumb-ul și acțiunile principale în dreapta.
 */
export function GcsAcpPageHeader({ icon, title, description, breadcrumb, actions, testId = "gcs-acp-page-header" }: Props) {
  return (
    <header className="gcs-acpPageHead" data-testid={testId}>
      <span className="gcs-acpPageHead__icon" aria-hidden="true">
        <GcsIcon name={icon ?? "fa-solid fa-gauge-high"} />
      </span>
      <div className="gcs-acpPageHead__text">
        <h1 className="gcs-display gcs-acpPageHead__title">{title}</h1>
        {description && <p className="gcs-acpPageHead__desc">{description}</p>}
        <GcsAcpBreadcrumb current={typeof title === "string" ? title : undefined} items={breadcrumb} />
      </div>
      {actions && <div className="gcs-acpPageHead__actions">{actions}</div>}
    </header>
  );
}
