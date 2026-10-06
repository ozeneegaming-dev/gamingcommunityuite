import "server-only";
import type { GcsActor } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import type { GcsTranslateLabels } from "@/app/(site)/_components/GcsTranslateButton";
import { services } from "./services";

/** Etichetele butonului „Traduce”, sau `null` dacă viewer-ul nu-l are (provider oprit sau fără `core.translate`). */
export async function translateLabels(actor: GcsActor): Promise<GcsTranslateLabels | null> {
  if (!(await services().translation.available(actor).catch(() => false))) return null;
  const t = await getTranslations("translate");
  return { translate: t("translate"), translating: t("translating"), original: t("hide"), translated: t("translated"), failed: t("failed"), limited: t("limited") };
}
