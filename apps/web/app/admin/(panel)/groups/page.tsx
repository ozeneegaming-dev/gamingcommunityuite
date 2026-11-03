import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";
import { GcsGroupCreate } from "./GcsGroupCreate";
import { GroupOrder, type GcsGroupFlag, type GcsGroupRow } from "./GroupOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.groups"))("title") };
}

/** Permisiunile de grup din etichetele rândurilor (ACP, moderator global, acces la site). */
const FLAG_KEYS = ["acp.access", "forums.moderate_all", "core.view_public"] as const;
/** Câte avataruri apar lângă numărul de membri. */
const AVATARS = 3;

/**
 * ACP → Membri → Grupuri: lista compactă a grupurilor (filtre pe tip, căutare, ordinea prin tragere sau ↑/↓, membrii și
 * drepturile importante ale fiecăruia) și „Grup nou” în antet. Editarea are pagina ei (`/admin/groups/<id>`).
 */
export default async function AcpGroupsPage() {
  await requireAcpSection("members.groups");
  const t = await getTranslations("acp.groups");
  const { db, registry } = services();
  const groups = await db.group.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      color: true,
      isProtected: true,
      isVip: true,
      settings: { where: { key: { in: [...FLAG_KEYS] } }, select: { key: true, value: true } },
      primaryUsers: { take: AVATARS, orderBy: { createdAt: "asc" }, select: { id: true, name: true, image: true } },
      members: { take: AVATARS, orderBy: { addedAt: "asc" }, select: { user: { select: { id: true, name: true, image: true } } } },
      _count: { select: { primaryUsers: true, members: true, acpRoles: true } },
    },
  });

  // Valoarea efectivă a unei permisiuni de grup: cea salvată sau cea implicită a grupului (ca motorul de permisiuni).
  const defs = new Map(FLAG_KEYS.map((key) => [key, registry.permissionDef(key)]));
  const effective = (g: (typeof groups)[number], key: (typeof FLAG_KEYS)[number]) => {
    const row = g.settings.find((s) => s.key === key);
    if (row) return row.value;
    const def = defs.get(key);
    return def ? ((def.default as Record<string, unknown>)[g.key] ?? def.fallback) : undefined;
  };

  const rows = groups.map((g): GcsGroupRow => {
    const flags: GcsGroupFlag[] = [];
    if (g.key === "root_admin") flags.push("acpFull");
    else if (effective(g, "acp.access") === true || g._count.acpRoles > 0) flags.push("acp");
    if (effective(g, "forums.moderate_all") === true) flags.push("globalMod");
    if (g.key === "banned" || effective(g, "core.view_public") === false) flags.push("noAccess");
    if (g.isVip) flags.push("vip");
    const sample = [...g.primaryUsers, ...g.members.map((m) => m.user)];
    return {
      id: g.id,
      key: g.key,
      name: g.name,
      color: g.color,
      type: g.isVip ? "vip" : g.isProtected ? "protected" : "custom",
      members: g._count.primaryUsers + g._count.members,
      avatars: sample.filter((u, i) => sample.findIndex((x) => x.id === u.id) === i).slice(0, AVATARS),
      flags,
    };
  });

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-users" actions={<GcsGroupCreate />}>
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("order")} className="gcs-acpGroups__card">
        <GroupOrder
          // Lista se reinițializează când se schimbă grupurile (ex. un grup nou sau redenumit).
          key={rows.map((r) => `${r.id}:${r.name}`).join(",")}
          groups={rows}
        />
      </GcsCard>
    </>
  );
}
