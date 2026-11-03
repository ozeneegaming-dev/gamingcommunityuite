"use client";

import { faPen } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsDrawer, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

type Props = {
  /** Textul butonului care deschide panoul (implicit „Editează”). */
  label?: string;
  /** Butonul doar cu iconiță (rândurile listelor); textul rămâne pentru cititoarele de ecran și tooltip. */
  iconOnly?: boolean;
  buttonIcon?: ReactNode;
  variant?: "primary" | "ghost";
  title: ReactNode;
  titleIcon?: ReactNode;
  aside?: ReactNode;
  /** Bara de jos a panoului (ex. formularul „Șterge”). */
  footer?: ReactNode;
  size?: "md" | "lg";
  /** Formularul (de obicei un `GcsActionForm`, randat pe server); se închide singur după salvare. */
  children: ReactNode;
  testId?: string;
  /** Panoul pornește deschis (ex. elementul din linkul unei notificări). */
  defaultOpen?: boolean;
};

/**
 * Tiparul „listă + panou” din ACP: un buton (pe rândul elementului sau în titlul paginii) care deschide panoul de
 * editare din dreapta, cu formularul elementului. Paginile rămân scurte: doar elementul ales își arată formularul.
 */
export function GcsAcpEditPanel({ label, iconOnly, buttonIcon, variant = "ghost", title, titleIcon, aside, footer, size, children, testId, defaultOpen = false }: Props) {
  const t = useTranslations("ui.panel");
  const [open, setOpen] = useState(defaultOpen);
  const text = label ?? t("edit");
  return (
    <>
      {iconOnly ? (
        <button type="button" className="gcs-iconBtn" aria-label={text} title={text} onClick={() => setOpen(true)} data-testid={testId ? `${testId}-open` : undefined}>
          {buttonIcon ?? <GcsIconSvg icon={faPen} />}
        </button>
      ) : (
        <GcsButton variant={variant} size="sm" icon={buttonIcon ?? <GcsIconSvg icon={faPen} />} onClick={() => setOpen(true)} data-testid={testId ? `${testId}-open` : undefined}>
          {text}
        </GcsButton>
      )}
      {open && (
        <GcsDrawer title={title} icon={titleIcon} aside={aside} footer={footer} size={size} closeLabel={t("close")} onClose={() => setOpen(false)} testId={testId}>
          {children}
        </GcsDrawer>
      )}
    </>
  );
}
