import "server-only";
import { compileGroupMentionCss, type GcsSvgIcon } from "@gcs/core";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { services } from "./services";

/** Iconița generică a unui grup fără iconiță aleasă (pastila, cardul și lista de sugestii). */
const DEFAULT_GROUP_ICON = "fa-solid fa-users";

/** Numele unei iconițe Font Awesome → datele SVG (lista de sugestii și cardul nu încarcă registrul de iconițe). */
export function iconData(name: string | null | undefined): GcsSvgIcon | null {
  const def = resolveIcon(name);
  if (!def) return null;
  const [width, height, , , path] = def.icon;
  return { width, height, path: Array.isArray(path) ? path.join(" ") : path };
}

/** CSS-ul pastilelor `@Grup` (culoarea și iconița fiecărui grup), adăugat la `/gcs-names.css`. */
export async function groupMentionsCss(): Promise<string> {
  const groups = await services().groupMentions.groups();
  return compileGroupMentionCss(
    groups.map((g) => ({ id: g.id, color: g.color, icon: iconData(g.icon) })),
    iconData(DEFAULT_GROUP_ICON),
  );
}
