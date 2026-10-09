import "server-only";
import type { GcsGroupRef } from "@gcs/modules";
import { GcsGroupPill, type GcsGroupPillProps } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { services } from "./services";
import { groupPillText, type GcsGroupPillT } from "./group-pill-text";

/**
 * Pastilele grupurilor, partea de server (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): fiecare pastilă e un link
 * spre `/members?group=<id>` (doar grupurile publice), cu tooltip-ul calculat din numărătorile din cache: descrierea
 * scurtă (dacă există), „31 de membri (12 ca grup secundar) · 7 online acum” și, opțional, un rând dat de o aplicație.
 * Merge pentru orice grup, și pentru cele create mai târziu în ACP (un grup nou: „0 membri · 0 online acum”).
 */
const groupData = cache(async () => {
  const { groupDirectory } = services();
  const [groups, counts, t] = await Promise.all([groupDirectory.groups(), groupDirectory.counts(), getTranslations("groups.pill")]);
  return { byId: new Map(groups.map((g) => [g.id, g])), counts, t };
});

/** Traducerile pastilei, în forma cerută de `groupPillText`. */
const pillT = (t: Awaited<ReturnType<typeof getTranslations<"groups.pill">>>): GcsGroupPillT => (key, values) => t(key, values as never);

/** Datele unei pastile pentru un grup (din cache): linkul (doar grupurile publice), tooltip-ul și eticheta. */
export async function groupPillProps(groupId: number, detail?: string | null): Promise<Pick<GcsGroupPillProps, "group" | "href" | "tooltip" | "ariaLabel"> & { ref: GcsGroupRef } | null> {
  const { byId, counts, t } = await groupData();
  const g = byId.get(groupId);
  if (!g) return null;
  return { ref: g, group: { id: g.id, name: g.name, color: g.color }, href: g.public ? `/members?group=${g.id}` : null, ...groupPillText(g, counts.get(g.id), pillT(t), detail) };
}

/**
 * Pastila unui grup după id (server): `GcsGroupPill` cu iconița, linkul și tooltip-ul. `detail`: un rând în plus în
 * tooltip, dat de o aplicație (ex. serverele unui admin). `label`: alt text vizibil (ex. titlul grupului).
 */
export async function GcsGroupLink({
  groupId,
  detail,
  label,
  ...props
}: { groupId: number; detail?: string | null; label?: string } & Omit<GcsGroupPillProps, "group" | "href" | "tooltip" | "ariaLabel" | "icon">) {
  const p = await groupPillProps(groupId, detail);
  if (!p) return null;
  const { ref, ...pill } = p;
  return (
    <GcsGroupPill {...props} {...pill} group={{ ...pill.group, name: label ?? pill.group.name }} icon={ref.icon ? <GcsIcon name={ref.icon} /> : undefined} />
  );
}
