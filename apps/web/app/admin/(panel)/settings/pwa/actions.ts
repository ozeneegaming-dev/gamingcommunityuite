"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { loadPwaConfig, PWA_ACP_SECTION, PWA_SETTING, pwaConfigError, type GcsPwaConfig } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Numele, culorile, felul de deschidere și pagina de pornire (iconița are ruta ei de încărcare). */
export async function savePwaConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PWA_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    const display = field(fd, "display");
    const value: GcsPwaConfig = {
      ...(await loadPwaConfig(settings)),
      name: field(fd, "name").trim(),
      shortName: field(fd, "shortName").trim(),
      description: field(fd, "description").trim(),
      themeColor: field(fd, "themeColor").trim(),
      backgroundColor: field(fd, "backgroundColor").trim(),
      display: display === "minimal-ui" || display === "browser" ? display : "standalone",
      startUrl: field(fd, "startUrl").trim() || "/",
    };
    const error = pwaConfigError(value);
    if (error) throw new GcsValidationError({ [error === "invalid_url" ? "startUrl" : error === "too_long" ? "name" : "themeColor"]: error });
    await settings.set(PWA_SETTING, value, actor);
    return null;
  });
}

/** Scoate iconița încărcată (revine cea implicită). */
export async function removePwaIcon(): Promise<GcsResult<null>> {
  return runAcpAction(PWA_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set(PWA_SETTING, { ...(await loadPwaConfig(settings)), icon: "" }, actor);
    return null;
  });
}
