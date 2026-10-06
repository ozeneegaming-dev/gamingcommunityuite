import { NOTIFICATIONS_ACP_SECTION } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { saveNotificationDefaults } from "./actions";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.notifications"))("title") };
}

/** ACP → Membri → Setări membri → Notificări: valorile implicite (Site / Email) pe tip și ora digestului. */
export default async function AcpNotificationDefaultsPage() {
  await requireAcpSection(NOTIFICATIONS_ACP_SECTION);
  const [t, tAll, ts] = await Promise.all([getTranslations("acp.notifications"), getTranslations(), getTranslations("settings.notifications")]);
  const { notifications, registry, settings } = services();
  const [defaults, digestHour] = await Promise.all([notifications.defaults(), settings.get<number>("notifications.digest_hour")]);

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bell">
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16, maxWidth: 820 }}>
        <GcsActionForm action={saveNotificationDefaults} submitLabel={t("save")} submitKind="save">
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("hint")}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="gcs-prefTable">
              <thead>
                <tr>
                  <th scope="col">{ts("type")}</th>
                  <th scope="col">{ts("site")}</th>
                  <th scope="col">{ts("email")}</th>
                </tr>
              </thead>
              <tbody>
                {registry.notificationTypes().map((def) => {
                  const label = tAll.has(def.labelKey) ? tAll(def.labelKey) : def.key;
                  const value = defaults[def.key]!;
                  return (
                    <tr key={def.key} data-testid={`gcs-acp-notif-${def.key}`}>
                      <th scope="row" style={{ fontWeight: 500, textTransform: "none", fontSize: 14, color: "var(--gcs-text)", letterSpacing: 0 }}>
                        {label}
                      </th>
                      <td>
                        <input type="checkbox" name={`site:${def.key}`} defaultChecked={value.site} aria-label={`${ts("site")}: ${label}`} />
                      </td>
                      <td>
                        <select className="gcs-input" name={`email:${def.key}`} defaultValue={value.email} aria-label={`${ts("email")}: ${label}`}>
                          {(["OFF", "INSTANT", "DIGEST"] as const).map((o) => (
                            <option key={o} value={o}>
                              {ts(`email_${o}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="gcs-field" style={{ maxWidth: 320 }}>
            {ts("digest_hour")}
            <input className="gcs-input" name="digestHour" type="number" min={0} max={23} defaultValue={digestHour} required />
          </label>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
