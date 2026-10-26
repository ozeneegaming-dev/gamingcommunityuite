import { normalizeUsername, type GcsAuditQuery } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

export type GcsLogSearch = { actor?: string; action?: string; target?: string; targetType?: string; from?: string; to?: string };

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Filtrele jurnalului din adresă (pagina și exportul CSV): actorul și ținta după numele membrului, acțiunea (prefix),
 * tipul țintei și intervalul. `null` = un nume care nu există (niciun rând).
 */
export async function auditFilters(db: Pick<PrismaClient, "user">, sp: GcsLogSearch): Promise<Omit<GcsAuditQuery, "page"> | null> {
  const byName = (name: string | undefined) => (name?.trim() ? db.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true } }) : Promise.resolve(null));
  const [actor, target] = await Promise.all([byName(sp.actor), byName(sp.target)]);
  if ((sp.actor?.trim() && !actor) || (sp.target?.trim() && !target)) return null;
  return {
    ...(actor ? { actorId: actor.id } : {}),
    ...(target ? { targetType: "user", targetId: target.id } : sp.targetType?.trim() ? { targetType: sp.targetType.trim() } : {}),
    ...(sp.action?.trim() ? { action: sp.action.trim() } : {}),
    ...(isDate(sp.from) ? { from: new Date(`${sp.from}T00:00:00`) } : {}),
    ...(isDate(sp.to) ? { to: new Date(`${sp.to}T23:59:59.999`) } : {}),
  };
}
