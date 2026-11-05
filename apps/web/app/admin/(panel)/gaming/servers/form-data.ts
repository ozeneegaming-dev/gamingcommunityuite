import "server-only";
import { enabledGames } from "@gcs/modules";
import { iconDef } from "@/lib/servers";
import { services } from "@/lib/services";
import type { GcsServerFormGame } from "./GcsServerForm";

/** Datele formularului unui server: jocurile din catalog, forumurile (arborele, fără linkuri) și grupurile. */
export async function serverFormData() {
  const { db } = services();
  const [forums, groups] = await Promise.all([
    db.forum.findMany({ where: { type: { not: "LINK" } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, parentId: true } }),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  // Arborele forumurilor, aplatizat în ordinea afișării (cu adâncimea, pentru indentare).
  const tree: { id: number; name: string; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const f of forums.filter((x) => x.parentId === parentId)) {
      tree.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  const games: GcsServerFormGame[] = enabledGames().map((g) => ({ key: g.key, name: g.name, defaultPort: g.defaultPort, defaultQueryPort: g.defaultQueryPort ?? null, protocol: g.protocol, icon: iconDef(g.icon) }));
  return { games, forums: tree, groups };
}
