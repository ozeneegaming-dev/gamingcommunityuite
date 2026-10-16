"use client";

import { faCheck, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg, GcsModal } from "@gcs/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Confirmarea unei acțiuni din ACP într-un dialog din pagină (niciodată `window.confirm`): titlul, textul, butonul de
 * confirmare (roșu pentru acțiunile distructive) și „Renunță”. Escape sau click pe fundal = renunță.
 */
export function GcsConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("acp.confirm");
  return (
    <GcsModal title={title} icon={<GcsIconSvg icon={danger ? faTriangleExclamation : faCheck} />} size="sm" closeLabel={t("cancel")} onClose={onCancel}>
      <div className="gcs-confirmDialog" data-testid="gcs-confirm-dialog">
        {body && <div className="gcs-confirmDialog__text">{body}</div>}
        {children}
        <div className="gcs-confirmDialog__actions">
          <GcsButton variant="ghost" onClick={onCancel} data-testid="gcs-confirm-cancel">
            {t("cancel")}
          </GcsButton>
          <GcsButton
            variant="primary"
            className={danger ? "gcs-btn--danger" : undefined}
            icon={<GcsIconSvg icon={danger ? faTriangleExclamation : faCheck} />}
            disabled={busy}
            onClick={onConfirm}
            data-testid="gcs-confirm-ok"
          >
            {confirmLabel}
          </GcsButton>
        </div>
      </div>
    </GcsModal>
  );
}
