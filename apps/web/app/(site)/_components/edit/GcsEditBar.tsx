"use client";

import { GcsIconSvg } from "@gcs/ui";
import { faPalette } from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { openThemeEditor } from "../../edit-actions";

/**
 * Bara de editare de pe site, doar pentru cei cu drept pe ACP → Aspect (specul etapei 5): butonul plutitor care
 * deschide editorul de temă (și, din taskul următor, modul „Editează pagina”).
 */
export function GcsEditBar() {
  const t = useTranslations("themeEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = () =>
    startTransition(async () => {
      const res = await openThemeEditor({});
      // Fără sesiune ACP proaspătă (2FA), adminul se reautentifică întâi.
      if (!res.ok && res.error.params?.reason === "acp_gate") return router.push("/admin/reauth");
      if (!res.ok) return setError(errorMessage(res.error));
      router.refresh();
    });
  return (
    <div className="gcs-editBar" role="toolbar" aria-label={t("toolbar")}>
      <button type="button" className="gcs-editBar__btn" onClick={open} disabled={pending} data-testid="gcs-edit-theme">
        <GcsIconSvg icon={faPalette} />
        <span>{t("open")}</span>
      </button>
      {error && (
        <span role="alert" className="gcs-editBar__error">
          {error}
        </span>
      )}
    </div>
  );
}
