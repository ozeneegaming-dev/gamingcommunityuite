import { BADGE_ICON_SUGGESTIONS } from "@gcs/ui/badge-art";
import { resolveIcon, searchIcons, type GcsIconMatch } from "@gcs/ui/icon-registry";

/**
 * Selectorul de iconițe din editorul insignelor (ACP): fără text de căutat, iconițele potrivite pentru realizări
 * (trofee, medalii, jocuri…); cu text, aceeași căutare ca `/api/icons/search`. Date statice, deci cache-uibile.
 */
export function GET(req: Request): Response {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  const icons: GcsIconMatch[] = q.trim()
    ? searchIcons(q, 60)
    : BADGE_ICON_SUGGESTIONS.flatMap((name) => {
        const def = resolveIcon(name);
        if (!def) return [];
        const [width, height, , , path] = def.icon;
        return [{ name, width, height, path: Array.isArray(path) ? path.join(" ") : path }];
      });
  return Response.json({ icons }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
