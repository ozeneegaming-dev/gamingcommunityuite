import "server-only";
import { MENUS_ACP_SECTION } from "@gcs/core";
import { headers } from "next/headers";
import { getAcpContext } from "./acp";
import { NAV_PREVIEW_HEADER } from "./nav-preview";
import { services } from "./services";

const DAY_MS = 86_400_000;
let registered: object | null = null;

/**
 * Leagă de serviciul meniului (o dată pe set de servicii): previzualizarea ciornei (header-ul pus de proxy + dreptul pe
 * Manager meniu + poarta ACP) și contoarele live ale insignelor („online”, topicurile și membrii noi de azi).
 */
export function registerNavHooks(): void {
  const s = services();
  if (registered === s) return;
  registered = s;
  s.nav.setPreviewResolver(async () => {
    let h: Headers;
    try {
      h = await headers();
    } catch {
      return false;
    }
    if (h.get(NAV_PREVIEW_HEADER) !== "1") return false;
    const ctx = await getAcpContext();
    return ctx.state === "ok" && (await s.acp.can(ctx.actor, MENUS_ACP_SECTION, "edit"));
  });
  s.nav.setCounterResolver(async (key) => {
    const since = new Date(Date.now() - DAY_MS);
    if (key === "online") return (await s.presence.online()).users.length;
    if (key === "topics_today") return s.db.topic.count({ where: { createdAt: { gte: since }, visibility: "VISIBLE" } });
    if (key === "members_today") return s.db.user.count({ where: { createdAt: { gte: since }, isBot: false } });
    return null;
  });
}
