import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { services } from "./services";
import { SITE_PATH_HEADER } from "./theme-preview";

/** Pagina pe care membrul își schimbă parola (secțiunea „Parola” din Setări → Cont). */
export const PASSWORD_RESET_PAGE = "/settings/account";

/**
 * Resetarea forțată a parolei (Membri v2): cât timp cererea staff-ului e în așteptare, orice pagină a site-ului îl
 * trimite pe membru la Setări → Cont (cu banda „Schimbă-ți parola”). Ieșirea din cont rămâne posibilă.
 */
export async function passwordResetGate(userId: string | null): Promise<void> {
  if (!userId) return;
  const pending = await services()
    .memberAdmin.passwordResetPending(userId)
    .catch(() => false);
  if (!pending) return;
  const path = (await headers()).get(SITE_PATH_HEADER) ?? "";
  if (path === PASSWORD_RESET_PAGE || path.startsWith(`${PASSWORD_RESET_PAGE}/`)) return;
  redirect(`${PASSWORD_RESET_PAGE}?reset=1`);
}
