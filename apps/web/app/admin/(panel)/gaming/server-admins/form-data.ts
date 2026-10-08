import "server-only";
import { services } from "@/lib/services";

/** Serverele cu punte (CS 1.6, CS2) și presetările, pentru formularul unui admin de server. */
export async function serverAdminFormData() {
  const { db, bridge } = services();
  const [servers, presets] = await Promise.all([
    db.gameServer.findMany({ where: { game: { in: ["cs16", "cs2"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    bridge.admins.presets(),
  ]);
  return { servers, presets: presets.map((p) => ({ id: p.id, name: p.name, flags: p.flags, immunity: p.immunity })) };
}
