import { MOD_POWERS, MODERATORS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { addModerators, removeModerator } from "../../../moderation-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.moderators"))("title") };
}

/** ACP → Membri → Staff → Moderatori: moderatorii pe forum (user sau grup), cu puterile lor. */
export default async function AcpModeratorsPage() {
  await requireAcpSection(MODERATORS_ACP_SECTION);
  const t = await getTranslations("acp.moderators");
  const { forumModerators, db } = services();
  const [rows, forums, groups] = await Promise.all([
    forumModerators.list(),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <p className="gcs-muted" style={{ margin: 0, padding: 16 }}>
            {t("empty")}
          </p>
        ) : (
          <table className="gcs-table__table">
            <thead>
              <tr>
                <th className="gcs-table__th" scope="col">{t("forum")}</th>
                <th className="gcs-table__th" scope="col">{t("who")}</th>
                <th className="gcs-table__th" scope="col">{t("powers")}</th>
                <th className="gcs-table__th" scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="gcs-table__row" data-testid="gcs-acp-moderator">
                  <td className="gcs-table__td">{r.forumName}</td>
                  <td className="gcs-table__td">{r.userName ?? r.groupName}</td>
                  <td className="gcs-table__td">{r.powers.map((p) => t(`power.${p}`)).join(", ")}</td>
                  <td className="gcs-table__td">
                    <GcsActionForm action={removeModerator.bind(null, r.id)} submitLabel={t("remove")} variant="ghost" compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-mod-add" style={{ padding: 16, maxWidth: 720 }}>
        <h2 id="gcs-mod-add" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("add")}
        </h2>
        <GcsActionForm action={addModerators} submitLabel={t("submit")}>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            <legend style={{ marginBottom: 6 }}>{t("forums")}</legend>
            {forums.map((f) => (
              <label key={f.id} className="gcs-check">
                <input type="checkbox" name="forumId" value={f.id} />
                {f.name}
              </label>
            ))}
          </fieldset>
          <label className="gcs-field">
            {t("user")}
            <input className="gcs-input" name="userName" maxLength={40} />
          </label>
          <div className="gcs-field">
            <label htmlFor="gcs-mod-group">{t("group")}</label>
            <select id="gcs-mod-group" className="gcs-input" name="groupId" defaultValue="">
              <option value="">{t("noGroup")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            <legend style={{ marginBottom: 6 }}>{t("powers")}</legend>
            {MOD_POWERS.map((p) => (
              <label key={p} className="gcs-check">
                <input type="checkbox" name="power" value={p} />
                {t(`power.${p}`)}
              </label>
            ))}
          </fieldset>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
