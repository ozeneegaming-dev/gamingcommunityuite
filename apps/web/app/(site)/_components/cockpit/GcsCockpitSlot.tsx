import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { viewerTheme } from "@/lib/appearance";
import { cockpitShownOn } from "@/lib/cockpit";
import { cockpitData } from "@/lib/cockpit.server";
import { services } from "@/lib/services";
import { SITE_PATH_HEADER } from "@/lib/theme-preview";
import { GcsCockpit } from "./GcsCockpit";

/**
 * Locul consolei Hero Cockpit în layout-ul site-ului (sub antet): în orice temă (funcție a sistemului), când consola e pornită în temă (`cockpit.enabled`).
 * Datele se calculează pe server doar când pagina cerută e una pe care apare consola; după o navigare fără
 * reîncărcare spre ea, componenta le cere singură.
 */
export async function GcsCockpitSlot() {
  const { shown } = await viewerTheme();
  const s = shown.settings;
  if (!s.cockpit.enabled) return null;
  const path = (await headers()).get(SITE_PATH_HEADER) ?? "";
  const [actor, siteName] = await Promise.all([currentActor(), services().settings.get<string>("site.name")]);
  const initial = cockpitShownOn(s.cockpit.pages, path) ? await cockpitData(actor, s.cockpit).catch((error: unknown) => {
    console.error("[GCS] consola Hero Cockpit:", error);
    return null;
  }) : null;
  return <GcsCockpit pages={s.cockpit.pages} initial={initial} siteName={siteName} image={s.cockpit.image} />;
}
