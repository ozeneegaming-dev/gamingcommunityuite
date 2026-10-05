import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { assignRoleToGroup, assignRoleToUser, createRole, deleteRole, saveRolePermissions, unassignRole } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.roles"))("title") };
}

const RIGHTS = ["view", "edit", "delete"] as const;
const checkbox = { width: 18, height: 18, accentColor: "var(--gcs-accent)" } as const;

/** Rolurile ACP (spec §6.4): matrice secțiune × {vezi, editează, șterge}, atribuite unui grup sau unui user. */
export default async function AcpRolesPage() {
  await requireAcpSection("members.acp_roles");
  const t = await getTranslations("acp.roles");
  const tAll = await getTranslations();
  const { acp, db, registry } = services();
  const [roles, groups] = await Promise.all([
    acp.listRoles(),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);

  // Secțiunile, grupate pe aplicații, cu etichetele din meniu.
  const sections = registry.acpMenu().map((s) => ({
    title: `${tAll.has(`acp.apps.${s.app}`) ? tAll(`acp.apps.${s.app}`) : s.app} · ${tAll.has(s.title) ? tAll(s.title) : s.title}`,
    items: s.items.map((i) => ({ section: i.section, label: tAll.has(i.labelKey) ? tAll(i.labelKey) : i.section })),
  }));

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard style={{ padding: 16, maxWidth: 520 }}>
        <GcsActionForm action={createRole} submitLabel={t("create.submit")}>
          <label className="gcs-field">
            {t("create.name")}
            <input className="gcs-input" name="name" required maxLength={64} />
          </label>
        </GcsActionForm>
      </GcsCard>

      {roles.map((role) => (
        <GcsCard key={role.id} as="section" aria-label={role.name}>
          <div className="gcs-acpWidget__header">
            <h2 className="gcs-acpWidget__title">{role.name}</h2>
            {!role.isRoot && (
              <GcsActionForm compact variant="ghost" action={deleteRole.bind(null, role.id)} submitLabel={t("delete")} confirm={t("delete")} />
            )}
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            {role.isRoot ? (
              <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("root")}</p>
            ) : (
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 32 }}>{t("matrix.title")}</summary>
                <GcsActionForm action={saveRolePermissions.bind(null, role.id)} submitLabel={t("matrix.save")} style={{ marginTop: 12 }}>
                  <div className="gcs-table">
                    <table className="gcs-table__table">
                      <thead>
                        <tr>
                          <th className="gcs-table__th" scope="col">
                            {t("matrix.section")}
                          </th>
                          {RIGHTS.map((r) => (
                            <th key={r} className="gcs-table__th" scope="col" style={{ textAlign: "center" }}>
                              {t(`matrix.${r}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      {sections.map((group) => (
                        <tbody key={group.title}>
                          <tr>
                            <th colSpan={4} className="gcs-acpSub__title" scope="colgroup" style={{ textAlign: "left" }}>
                              {group.title}
                            </th>
                          </tr>
                          {group.items.map((item) => (
                            <tr key={item.section} className="gcs-table__row">
                              <th className="gcs-table__td" scope="row" style={{ textAlign: "left", fontWeight: 500 }}>
                                {item.label}
                              </th>
                              {RIGHTS.map((r) => (
                                <td key={r} className="gcs-table__td" style={{ textAlign: "center" }}>
                                  <input
                                    type="checkbox"
                                    name={`right:${item.section}:${r}`}
                                    defaultChecked={role.permissions[item.section]?.[r] ?? false}
                                    aria-label={t("matrix.cell", { section: item.label, right: t(`matrix.${r}`) })}
                                    style={checkbox}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      ))}
                    </table>
                  </div>
                </GcsActionForm>
              </details>
            )}

            <div>
              <span className="gcs-field">{t("assignments.title")}</span>
              {role.assignments.length === 0 && <p style={{ color: "var(--gcs-muted)", fontSize: 13 }}>{t("assignments.none")}</p>}
              {role.assignments.map((a) => {
                const target = a.userName ?? a.groupName ?? "?";
                return (
                  <div
                    key={a.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--gcs-border)", fontSize: 14 }}
                  >
                    <span>
                      {a.userName ? `${t("assignments.user")}: ` : `${t("assignments.group")}: `}
                      <strong>{target}</strong>
                    </span>
                    {!role.isRoot && (
                      <GcsActionForm compact variant="ghost" action={unassignRole.bind(null, a.id)} submitLabel={t("assignments.remove", { target })} />
                    )}
                  </div>
                );
              })}
            </div>

            {!role.isRoot && (
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <GcsActionForm action={assignRoleToGroup.bind(null, role.id)} submitLabel={t("assignments.addGroup")} variant="ghost">
                  <label className="gcs-field">
                    {t("assignments.group")}
                    <select className="gcs-input" name="groupId">
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </GcsActionForm>
                <GcsActionForm action={assignRoleToUser.bind(null, role.id)} submitLabel={t("assignments.addUser")} variant="ghost">
                  <label className="gcs-field">
                    {t("assignments.user")}
                    <input className="gcs-input" name="username" required />
                  </label>
                </GcsActionForm>
              </div>
            )}
          </div>
        </GcsCard>
      ))}
    </>
  );
}
