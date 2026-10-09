/** Numărătorile unui grup pentru tooltip (din `GcsGroupDirectory.counts()`). */
export type GcsGroupPillCount = { members: number; secondary: number; online: number };

/** Traducerile `groups.pill.*` (members, secondary, allSecondary, online, aria). */
export type GcsGroupPillT = (key: "members" | "secondary" | "allSecondary" | "online" | "aria", values?: Record<string, string | number>) => string;

/**
 * Rândurile tooltip-ului și eticheta accesibilă ale pastilei unui grup (orice grup, fără configurare):
 * descrierea scurtă (dacă există), „31 de membri (12 ca grup secundar) · 7 online acum” și rândul opțional al unei
 * aplicații. Un grup fără membri: „0 membri · 0 online acum”.
 */
export function groupPillText(
  g: { name: string; description: string },
  count: GcsGroupPillCount | undefined,
  t: GcsGroupPillT,
  detail?: string | null,
): { tooltip: string[]; ariaLabel: string } {
  const c = count ?? { members: 0, secondary: 0, online: 0 };
  const members = t("members", { count: c.members });
  const membersLine =
    c.secondary > 0 && c.secondary === c.members ? `${members}, ${t("allSecondary")}` : c.secondary > 0 ? `${members} ${t("secondary", { count: c.secondary })}` : members;
  const countLine = `${membersLine} · ${t("online", { count: c.online })}`;
  const tooltip = [g.description, countLine, detail ?? ""].filter((line) => line !== "");
  return { tooltip, ariaLabel: `${t("aria", { name: g.name })} · ${countLine}` };
}
