import type { MetadataRoute } from "next";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Manifestul aplicației web (PWA, Notificări v2): numele site-ului, pornirea pe pagina principală și afișarea ca aplicație
 * (pe unele telefoane web push merge doar din site-ul adăugat pe ecranul principal).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "GamingCommunitySuite";
  try {
    name = (await services().settings.get<string>("site.name")) || name;
  } catch {
    // Înainte de instalare nu există încă baza de date.
  }
  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0f17",
    theme_color: "#0b0f17",
  };
}
