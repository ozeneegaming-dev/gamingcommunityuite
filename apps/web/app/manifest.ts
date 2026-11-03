import { DEFAULT_PWA, loadPwaConfig } from "@gcs/modules";
import type { MetadataRoute } from "next";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Manifestul aplicației web (PWA, Notificări v2): numele, culorile, felul în care se deschide, pagina de pornire și
 * iconița din ACP › Setări › Web App (pe unele telefoane web push merge doar din site-ul adăugat pe ecranul principal).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let siteName = "GamingCommunitySuite";
  let cfg = DEFAULT_PWA;
  try {
    const { settings } = services();
    [siteName, cfg] = await Promise.all([settings.get<string>("site.name").then((n) => n || siteName), loadPwaConfig(settings)]);
  } catch {
    // Înainte de instalare nu există încă baza de date.
  }
  const name = cfg.name || siteName;
  return {
    name,
    short_name: cfg.shortName || (name.length > 12 ? name.slice(0, 12) : name),
    ...(cfg.description ? { description: cfg.description } : {}),
    start_url: cfg.startUrl,
    scope: "/",
    display: cfg.display,
    background_color: cfg.backgroundColor,
    theme_color: cfg.themeColor,
    ...(cfg.icon
      ? {
          icons: [
            { src: cfg.icon, sizes: "512x512", type: "image/png", purpose: "any" },
            { src: cfg.icon, sizes: "192x192", type: "image/png", purpose: "any" },
          ],
        }
      : {}),
  };
}
