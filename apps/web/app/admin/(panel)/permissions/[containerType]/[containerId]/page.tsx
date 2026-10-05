import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { PermissionMatrix } from "./PermissionMatrix";

type Props = { params: Promise<{ containerType: string; containerId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { containerType, containerId } = await params;
  return { title: (await getTranslations("acp.permissions"))("title", { type: containerType, id: containerId }) };
}

/** Matricea de permisiuni a unui container (forum, categorie etc.). Acțiunile vin din permisiunile modulelor. */
export default async function AcpPermissionsPage({ params }: Props) {
  await requireAcpSection("members.groups");
  const { containerType, containerId } = await params;
  const { db, registry } = services();
  const defs = registry.permissionDefs().filter((d) => d.scope === "container" && d.containerType === containerType);
  if (defs.length === 0) notFound();

  const t = await getTranslations("acp.permissions");
  const tAll = await getTranslations();
  const [groups, rows, inherit] = await Promise.all([
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, key: true, name: true } }),
    db.containerPermission.findMany({ where: { containerType, containerId }, select: { groupId: true, action: true } }),
    db.containerInherit.findUnique({ where: { containerType_containerId: { containerType, containerId } } }),
  ]);
  // Un container care moștenește nu are reguli proprii: matricea pornește de la permisiunile efective (ale părintelui),
  // ca la oprirea moștenirii să se schimbe doar ce bifează adminul.
  let effectiveRows = rows;
  if (inherit?.inherits && inherit.parentId) {
    let source = inherit.parentId;
    for (let depth = 0; depth < 32; depth++) {
      const up = await db.containerInherit.findUnique({ where: { containerType_containerId: { containerType, containerId: source } } });
      if (!up?.inherits || !up.parentId) break;
      source = up.parentId;
    }
    effectiveRows = await db.containerPermission.findMany({ where: { containerType, containerId: source }, select: { groupId: true, action: true } });
  }
  const actions = defs.map((d) => ({ key: d.key, label: tAll.has(d.labelKey) ? tAll(d.labelKey) : d.key }));
  const cell: Record<string, string> = {};
  for (const g of groups) for (const a of actions) cell[`${g.id}:${a.key}`] = t("allow", { group: g.name, action: a.label });

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title", { type: containerType, id: containerId })}
      </h1>
      <GcsCard style={{ padding: 16 }}>
        <PermissionMatrix
          containerType={containerType}
          containerId={containerId}
          groups={groups}
          actions={actions}
          allowed={effectiveRows.map((r) => `${r.groupId}:${r.action}`)}
          inherit={{ inherits: inherit?.inherits ?? false, parentId: inherit?.parentId ?? "" }}
          labels={{ group: t("group"), inherit: t("inherit"), parentId: t("parentId"), save: t("save"), cell }}
        />
      </GcsCard>
    </>
  );
}
