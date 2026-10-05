import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../_components/GcsActionForm";
import { createGroup } from "./actions";
import { GroupOrder } from "./GroupOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.groups"))("title") };
}

export default async function AcpGroupsPage() {
  await requireAcpSection("members.groups");
  const t = await getTranslations("acp.groups");
  const { db } = services();
  const groups = await db.group.findMany({
    orderBy: { position: "asc" },
    select: { id: true, key: true, name: true, isProtected: true, isVip: true, _count: { select: { primaryUsers: true, members: true } } },
  });
  const rows = groups.map((g) => ({
    id: g.id,
    key: g.key,
    name: g.name,
    members: g._count.primaryUsers + g._count.members,
    type: g.isVip ? ("vip" as const) : g.isProtected ? ("protected" as const) : ("custom" as const),
  }));
  const per = (key: "moveUp" | "moveDown") => Object.fromEntries(rows.map((r) => [r.id, t(key, { group: r.name })]));

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard as="section" aria-label={t("order")}>
        <GroupOrder
          // Lista se reinițializează când se schimbă grupurile (ex. după „Creează grupul”).
          key={rows.map((r) => `${r.id}:${r.name}`).join(",")}
          groups={rows}
          labels={{
            name: t("columns.name"),
            members: t("columns.members"),
            type: t("columns.type"),
            edit: t("edit"),
            types: { protected: t("protected"), vip: t("vip"), custom: t("custom") },
            moveUp: per("moveUp"),
            moveDown: per("moveDown"),
          }}
        />
      </GcsCard>
      <GcsCard as="section" aria-label={t("create.title")} style={{ padding: 16, maxWidth: 520 }}>
        <h2 className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("create.title")}
        </h2>
        <GcsActionForm action={createGroup} submitLabel={t("create.submit")}>
          <label className="gcs-field">
            {t("create.name")}
            <input className="gcs-input" name="name" required maxLength={64} />
          </label>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
