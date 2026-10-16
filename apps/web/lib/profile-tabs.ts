import "server-only";
import type { GcsActor } from "@gcs/core";
import { memberPanels } from "./member-panels";
import { services } from "./services";

/**
 * Taburile profilului public v2: cele de bază (Despre / perete, Jocuri, Urmăritori, Insigne, Avertismente) și cele aduse
 * de aplicații (`GcsModule.profileTabs`: Activitate și Articole din Forum, Steam și FACEIT din Profil, Skins din
 * Servere). Un tab al unei aplicații oprite (sau la care viewer-ul nu are acces) nu apare; Steam și FACEIT apar doar
 * cu cheile din ACP, contul Steam legat, tabul lăsat vizibil de membru și (FACEIT) datele găsite.
 */
export type GcsProfileTab = { key: string; labelKey: string; icon: string; position: number; /** Eticheta deja tradusă (panourile de membru ale pluginurilor). */ label?: string; /** Un panou de membru (Membri v2). */ panel?: boolean };

const BUILT_IN: GcsProfileTab[] = [
  { key: "about", labelKey: "profile.tabs.about", icon: "fa-solid fa-circle-info", position: 10 },
  { key: "games", labelKey: "profile.tabs.games", icon: "fa-solid fa-gamepad", position: 20 },
  { key: "followers", labelKey: "profile.tabs.followers", icon: "fa-solid fa-user-group", position: 70 },
  { key: "badges", labelKey: "profile.tabs.badges", icon: "fa-solid fa-award", position: 80 },
  { key: "warnings", labelKey: "profile.tabs.warnings", icon: "fa-solid fa-triangle-exclamation", position: 90 },
];

export type GcsProfileTabContext = { userId: string; isSelf: boolean; canSeeWarnings: boolean };

export async function profileTabs(viewer: GcsActor, ctx: GcsProfileTabContext): Promise<GcsProfileTab[]> {
  const { registry, apps, externalProfiles, memberPrefs } = services();
  const [usable, keys, prefs, steamId] = await Promise.all([apps.accessFilter(viewer), externalProfiles.configured(), memberPrefs.get(ctx.userId), externalProfiles.steamId(ctx.userId)]);
  const contributed = registry.profileTabs().filter((t) => usable(t.module));
  const tabs: GcsProfileTab[] = [];
  for (const { def } of contributed) {
    if (def.key === "steam" && !(keys.steam && steamId && prefs.steamTab)) continue;
    if (def.key === "faceit") {
      if (!(keys.faceit && steamId && prefs.faceitTab)) continue;
      // FACEIT doar dacă membrul are un cont găsit (altfel tabul ar fi gol).
      if (!(await externalProfiles.faceit(ctx.userId))) continue;
    }
    tabs.push(def);
  }
  for (const t of BUILT_IN) {
    if (t.key === "warnings" && !ctx.canSeeWarnings) continue;
    tabs.push(t);
  }
  // Membri v2: taburile aduse prin punctul de extensie al panourilor de membru (module și pluginuri), pe profil.
  for (const p of (await memberPanels("profile", viewer)).filter((x) => x.kind === "tab")) {
    if (tabs.some((t) => t.key === p.key)) continue;
    tabs.push({ key: p.key, labelKey: "", label: p.label, icon: p.icon, position: p.position, panel: true });
  }
  return tabs.sort((a, b) => a.position - b.position);
}
