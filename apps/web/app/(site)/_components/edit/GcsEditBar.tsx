"use client";

import { GcsIconSvg } from "@gcs/ui";
import { faPalette, faTableColumns } from "@fortawesome/free-solid-svg-icons";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { openPageEditor, openThemeEditor } from "../../edit-actions";

/** Paginile cu zone de widget-uri: indexul, forumurile și topicurile. */
const WIDGET_PATHS = /^\/(?:$|forum\/|topic\/)/;

/**
 * Bara de editare de pe site, doar pentru cei cu drept pe ACP → Aspect (specul etapei 5): butonul plutitor care
 * deschide editorul de temă și, pe paginile cu widget-uri, modul „Editează pagina”.
 */
export function GcsEditBar({ canTheme, canWidgets, pageEditing }: { canTheme: boolean; canWidgets: boolean; pageEditing: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("themeEditor");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = (which: "theme" | "page") =>
    startTransition(async () => {
      const res = which === "theme" ? await openThemeEditor({}) : await openPageEditor({});
      // Fără sesiune ACP proaspătă (2FA), adminul se reautentifică întâi.
      if (!res.ok && res.error.params?.reason === "acp_gate") return router.push("/admin/reauth");
      if (!res.ok) return setError(errorMessage(res.error));
      router.refresh();
    });
  return (
    <div className="gcs-editBar" role="toolbar" aria-label={t("toolbar")}>
      {canTheme && (
        <button type="button" className="gcs-editBar__btn" onClick={() => open("theme")} disabled={pending} data-testid="gcs-edit-theme">
          <GcsIconSvg icon={faPalette} />
          <span>{t("open")}</span>
        </button>
      )}
      {canWidgets && !pageEditing && WIDGET_PATHS.test(pathname) && (
        <button type="button" className="gcs-editBar__btn" onClick={() => open("page")} disabled={pending} data-testid="gcs-edit-page">
          <GcsIconSvg icon={faTableColumns} />
          <span>{t("editPage")}</span>
        </button>
      )}
      {error && (
        <span role="alert" className="gcs-editBar__error">
          {error}
        </span>
      )}
    </div>
  );
}
