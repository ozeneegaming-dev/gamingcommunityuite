import "server-only";
import { ANNOUNCEMENT_SETTING, DEFAULT_ANNOUNCEMENT_CONFIG, announcementConfigError, visibleAnnouncementBars, type GcsAnnouncementBar, type GcsAnnouncementConfig } from "@gcs/modules";
import type { GcsActor } from "@gcs/core";
import { cookies } from "next/headers";
import { services } from "./services";

/** Cookie-ul barelor închise (per browser): intrări `<cine>~<bară>~<versiune>`, despărțite de `|`. */
export const ANNOUNCEMENT_COOKIE = "gcs-ann";

/** Cine închide bara: membrul (id-ul lui) sau vizitatorul. Așa, pe același browser, alt cont vede bara din nou. */
export const announcementViewerKey = (actor: Pick<GcsActor, "userId">) => actor.userId ?? "guest";

/** Configurația salvată (sau cea goală); o valoare stricată nu oprește pagina. */
export async function announcementConfig(): Promise<GcsAnnouncementConfig> {
  const raw = await services().settings.get<GcsAnnouncementConfig | null>(ANNOUNCEMENT_SETTING);
  return raw && announcementConfigError(raw) === null ? raw : DEFAULT_ANNOUNCEMENT_CONFIG;
}

/** Barele închise de acest membru / vizitator, din cookie (cele cu altă versiune decât acum nu mai contează). */
export function dismissedFrom(cookie: string | undefined, viewerKey: string): Set<string> {
  const out = new Set<string>();
  let raw = cookie ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Valoare stricată: nimic închis.
  }
  for (const entry of raw.split("|")) {
    const [who, id, version] = entry.split("~");
    if (who === viewerKey && id && version) out.add(`${id}~${version}`);
  }
  return out;
}

/** Barele de afișat acestui membru / vizitator acum (pe toate paginile; filtrul de pagină e în browser), fără cele închise. */
export async function announcementView(actor: GcsActor): Promise<{ bars: GcsAnnouncementBar[]; rotateSeconds: number; viewerKey: string }> {
  const [config, jar] = await Promise.all([announcementConfig(), cookies()]);
  const viewerKey = announcementViewerKey(actor);
  const dismissed = dismissedFrom(jar.get(ANNOUNCEMENT_COOKIE)?.value, viewerKey);
  const bars = visibleAnnouncementBars(config, actor, null).filter((b) => !(b.dismissible && dismissed.has(`${b.id}~${b.version}`)));
  return { bars, rotateSeconds: config.rotateSeconds, viewerKey };
}
