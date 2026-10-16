import { GCS_RICH_FIELDS } from "@gcs/core";
import { STAFF_PAGE_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GcsRichTextInput } from "@/app/(site)/_components/editor/GcsRichTextInput";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";
import { saveStaffProfile } from "./actions";
import { GcsStaffMemberOrder, GcsStaffSections } from "./GcsStaffEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.staffPage"))("title") };
}

/**
 * ACP → Membri → Staff → Pagina Staff (Pagina Staff v2): secțiunile (ordinea, titlul benzii, aspectul detaliat / compact,
 * vizibilitatea), ordinea membrilor din fiecare secțiune și, pentru fiecare membru, descrierea și responsabilitățile.
 */
export default async function AcpStaffPage() {
  const panel = await requireAcpSection(STAFF_PAGE_ACP_SECTION);
  const t = await getTranslations("acp.staffPage");
  const { staffPage, acp } = services();
  const [sections, canEdit] = await Promise.all([staffPage.editor(panel.actor), acp.can(panel.actor, STAFF_PAGE_ACP_SECTION, "edit")]);
  const docs = new Map(await Promise.all(sections.flatMap((s) => s.members).map(async (m) => [m.id, await staffPage.profileDoc(m.id)] as const)));

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-address-book"
        description={t("description")}
        actions={
          <Link href="/staff" className="gcs-btn gcs-btn--ghost gcs-btn--sm" target="_blank">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-btn__icon" />
            {t("view")}
          </Link>
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("sections")} className="gcs-mdCard">
        <div className="gcs-acpWidget__header">
          <h2 className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-layer-group" />
            {t("sections")}
          </h2>
        </div>
        <div className="gcs-mdCard__body">
          <p className="gcs-mdCard__muted">{t("sectionsHint")}</p>
          {canEdit ? (
            <GcsStaffSections sections={sections.map((s) => ({ groupId: s.groupId, name: s.name, title: s.title, layout: s.layout, enabled: s.enabled, members: s.members.length }))} />
          ) : (
            <ul>
              {sections.map((s) => (
                <li key={s.groupId}>{s.title}</li>
              ))}
            </ul>
          )}
        </div>
      </GcsCard>
      {sections
        .filter((s) => s.members.length > 0)
        .map((s) => (
          <GcsCard as="section" key={s.groupId} aria-label={s.title} className="gcs-mdCard" data-testid="gcs-staff-editor-members" data-group={s.key}>
            <div className="gcs-acpWidget__header">
              <h2 className="gcs-acpWidget__title">
                <GcsAcpTitleIcon name={s.icon ?? "fa-solid fa-user-shield"} />
                {s.title}
              </h2>
            </div>
            <div className="gcs-mdCard__body">
              {canEdit && s.members.length > 1 && <GcsStaffMemberOrder groupId={s.groupId} members={s.members.map((m) => ({ id: m.id, name: m.name }))} />}
              {s.members.map((m) => (
                <details key={m.id} className="gcs-staffEditor__member" data-testid="gcs-staff-editor-member" data-member={m.name}>
                  <summary>
                    <GcsMemberLink user={m} href={null} />
                    <span className="gcs-mdCard__muted">{m.duties.length > 0 ? t("dutiesCount", { count: m.duties.length }) : t("noDuties")}</span>
                  </summary>
                  {canEdit && (
                    <GcsActionForm action={saveStaffProfile.bind(null, m.id)} submitLabel={t("saveMember")} submitKind="save">
                      <div className="gcs-field">
                        <span id={`gcs-staff-desc-${m.id}`}>{t("descriptionLabel")}</span>
                        <GcsRichTextInput name="descriptionDoc" id={`gcs-staff-desc-input-${m.id}`} initial={docs.get(m.id) ?? ""} allow={GCS_RICH_FIELDS.profileText} maxLength={2000} compact labelledBy={`gcs-staff-desc-${m.id}`} />
                      </div>
                      <label className="gcs-field">
                        {t("dutiesLabel")}
                        <textarea className="gcs-input" name="duties" rows={4} defaultValue={m.duties.join("\n")} placeholder={t("dutiesPlaceholder")} data-testid="gcs-staff-duties" />
                      </label>
                    </GcsActionForm>
                  )}
                </details>
              ))}
            </div>
          </GcsCard>
        ))}
    </>
  );
}
