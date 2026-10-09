import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";

/**
 * Autorul unui conținut al cărui cont a fost șters (specul 2026-10-09-stergere-unire-membri §1): o etichetă generică, fără
 * link spre profil, fără avatar și fără numele vechi.
 */
export async function GcsDeletedMember({ withIcon = false }: { withIcon?: boolean }) {
  const t = await getTranslations("site");
  return (
    <span className="gcs-deletedMember" data-testid="gcs-deleted-member">
      {withIcon && <GcsIcon name="fa-solid fa-user-slash" className="gcs-deletedMember__icon" />}
      {t("deletedMember")}
    </span>
  );
}

/** Coloana autorului unei postări fără cont (postbit-ul „Membru șters”). */
export async function GcsDeletedPostbit() {
  const t = await getTranslations("site");
  return (
    <div className="gcs-postbit__deleted" data-testid="gcs-postbit-deleted">
      <span className="gcs-postbit__deletedAvatar" aria-hidden="true">
        <GcsIcon name="fa-solid fa-user-slash" />
      </span>
      <span className="gcs-deletedMember">{t("deletedMember")}</span>
    </div>
  );
}
